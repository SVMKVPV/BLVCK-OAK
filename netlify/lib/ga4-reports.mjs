import { runtimeEnv } from './referrals.mjs';

const API = 'https://analyticsdata.googleapis.com/v1beta/properties/';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const summaryMetrics = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'screenPageViews', 'eventCount', 'keyEvents', 'totalRevenue', 'userEngagementDuration'];

export function ga4Configuration(env = runtimeEnv) {
  const names = ['GA4_PROPERTY_ID', 'GA4_CLIENT_ID', 'GA4_CLIENT_SECRET', 'GA4_REFRESH_TOKEN'];
  const values = Object.fromEntries(names.map(name => [name, String(env(name) || '').trim()]));
  const missing = names.filter(name => !values[name]);
  if (values.GA4_PROPERTY_ID && !/^\d+$/.test(values.GA4_PROPERTY_ID)) missing.push('GA4_PROPERTY_ID must be a numeric property ID');
  return { configured: missing.length === 0, missing, propertyId: /^\d+$/.test(values.GA4_PROPERTY_ID) ? values.GA4_PROPERTY_ID : null, values };
}

export class AnalyticsServiceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function reportError(status) {
  if (status === 429) return new AnalyticsServiceError('quota', 'Google Analytics quota is temporarily exhausted. Try again later.');
  if (status === 401 || status === 403) return new AnalyticsServiceError('permission', 'Google Analytics access needs attention. Check the read-only authorization, property access and enabled Data API.');
  if (status === 400) return new AnalyticsServiceError('report', 'This report is unavailable for the selected property or filters. Other reports can still load.');
  return new AnalyticsServiceError('unavailable', 'Google Analytics is temporarily unavailable. Try again later.');
}

export function ga4Filters(filters, { realtime = false } = {}) {
  const expressions = [];
  if (filters.country) expressions.push({ filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: filters.country, caseSensitive: false } } });
  if (filters.device) expressions.push({ filter: { fieldName: 'deviceCategory', stringFilter: { matchType: 'EXACT', value: filters.device, caseSensitive: false } } });
  if (filters.page && !realtime) expressions.push({ filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: filters.page, caseSensitive: false } } });
  return expressions.length ? { andGroup: { expressions } } : undefined;
}

function report(id, title, dimensions, metrics, range, options = {}) {
  return { id, title, method: options.realtime ? 'runRealtimeReport' : 'runReport', body: {
    dimensions: dimensions.map(name => ({ name })), metrics: metrics.map(name => ({ name })),
    ...(options.realtime ? { minuteRanges: [{ startMinutesAgo: 29, endMinutesAgo: 0 }] } : { dateRanges: [{ startDate: options.previous ? range.previousStart : range.start, endDate: options.previous ? range.previousEnd : range.end }], currencyCode: 'AUD' }),
    ...(ga4Filters(range.filters, options) ? { dimensionFilter: ga4Filters(range.filters, options) } : {}),
    limit: String(options.limit || 50), returnPropertyQuota: true,
    ...(dimensions.length ? { orderBys: options.chronological ? [{ dimension: { dimensionName: dimensions[0] } }] : [{ metric: { metricName: metrics[0] }, desc: true }] } : {}),
  } };
}

export function ga4ReportRequests(range) {
  return [
    report('summary', 'Overview', [], summaryMetrics, range),
    report('previous', 'Previous period', [], summaryMetrics, range, { previous: true }),
    report('timeline', 'Daily performance', ['date'], ['activeUsers', 'sessions', 'screenPageViews', 'keyEvents'], range, { limit: 366, chronological: true }),
    report('channels', 'Acquisition channels', ['sessionDefaultChannelGroup'], ['sessions', 'engagedSessions', 'keyEvents', 'totalRevenue'], range),
    report('sources', 'Source / medium', ['sessionSourceMedium'], ['sessions', 'engagedSessions', 'keyEvents', 'totalRevenue'], range),
    report('campaigns', 'Campaigns', ['sessionCampaignName'], ['sessions', 'keyEvents', 'totalRevenue'], range),
    report('pages', 'Pages', ['pagePath'], ['screenPageViews', 'activeUsers', 'eventCount', 'keyEvents'], range, { limit: 100 }),
    report('landing', 'Landing pages', ['landingPage'], ['sessions', 'engagedSessions', 'keyEvents'], range),
    report('events', 'Events and key events', ['eventName'], ['eventCount', 'totalUsers', 'keyEvents'], range),
    report('geography', 'Countries and cities', ['country', 'city'], ['activeUsers', 'sessions', 'keyEvents'], range),
    report('technology', 'Devices and browsers', ['deviceCategory', 'browser'], ['activeUsers', 'sessions', 'engagementRate'], range),
    report('returning', 'New / returning', ['newVsReturning'], ['activeUsers', 'sessions'], range),
    report('commerce', 'Products', ['itemName'], ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'], range),
    report('realtime', 'Active users · last 30 minutes', [], ['activeUsers', 'eventCount', 'screenPageViews'], range, { realtime: true }),
    report('realtimeLocations', 'Realtime countries', ['country'], ['activeUsers', 'eventCount'], range, { realtime: true }),
  ];
}

export function normaliseGa4Report(definition, data) {
  const dimensions = (data.dimensionHeaders || []).map(header => header.name);
  const metrics = (data.metricHeaders || []).map(header => header.name);
  return {
    id: definition.id, title: definition.title, columns: [...dimensions, ...metrics],
    rows: (data.rows || []).map(row => [
      ...(row.dimensionValues || []).map(value => String(value.value || '(not set)').slice(0, 500)),
      ...(row.metricValues || []).map(value => Number.isFinite(Number(value.value)) ? Number(value.value) : 0),
    ]),
    rowCount: Number(data.rowCount || data.rows?.length || 0),
    metadata: {
      timeZone: data.metadata?.timeZone || null,
      currencyCode: data.metadata?.currencyCode || 'AUD',
      subjectToThresholding: Boolean(data.metadata?.subjectToThresholding),
      dataLossFromOtherRow: Boolean(data.metadata?.dataLossFromOtherRow),
    },
  };
}

export function createGa4Client({ fetcher = fetch, now = Date.now } = {}) {
  let token = null;
  let tokenKey = '';
  async function accessToken(configuration) {
    const values = configuration.values;
    const key = [values.GA4_CLIENT_ID, values.GA4_REFRESH_TOKEN].join(':');
    if (token && tokenKey === key && token.expires > now()) return token.value;
    let response;
    try {
      response = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: values.GA4_CLIENT_ID, client_secret: values.GA4_CLIENT_SECRET, refresh_token: values.GA4_REFRESH_TOKEN, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) });
    } catch { throw new AnalyticsServiceError('connection', 'The Google authorization service is temporarily unavailable.'); }
    if (!response.ok) throw new AnalyticsServiceError('authorization', 'Reconnect Google Analytics read-only access. The existing authorization could not be refreshed.');
    const data = await response.json();
    if (typeof data.access_token !== 'string' || !data.access_token) throw new AnalyticsServiceError('authorization', 'Google Analytics authorization is incomplete.');
    tokenKey = key;
    token = { value: data.access_token, expires: now() + Math.max(0, Math.min(Number(data.expires_in) || 3600, 3600) - 60) * 1000 };
    return token.value;
  }
  return async function runReports(configuration, range) {
    const access = await accessToken(configuration);
    const definitions = ga4ReportRequests(range);
    const reports = [];
    // Four concurrent requests stay below the standard property concurrency quota.
    for (let offset = 0; offset < definitions.length; offset += 4) {
      const batch = await Promise.all(definitions.slice(offset, offset + 4).map(async definition => {
        try {
          const response = await fetcher(`${API}${configuration.propertyId}:${definition.method}`, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify(definition.body), signal: AbortSignal.timeout(9000) });
          if (!response.ok) throw reportError(response.status);
          return normaliseGa4Report(definition, await response.json());
        } catch (error) {
          return { id: definition.id, title: definition.title, columns: [], rows: [], error: error instanceof AnalyticsServiceError ? error.message : 'This report timed out or could not be loaded. Try again later.' };
        }
      }));
      reports.push(...batch);
    }
    return reports;
  };
}
