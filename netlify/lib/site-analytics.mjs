import { PortalError } from './portal-auth.mjs';

export const ANALYTICS_TIME_ZONE = 'Australia/Sydney';
export const ANALYTICS_EVENTS = new Set(['page_view', 'quote_click', 'contact_click', 'booking_click', 'audit_click', 'form_start', 'form_success']);
const DAY = 86400000;

export function localDate(value, timeZone = ANALYTICS_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
}

export function analyticsRange(params, now = Date.now()) {
  const today = localDate(now);
  const days = Number(params.get('days') || 30);
  const hasDates = params.has('start') || params.has('end');
  if (!hasDates && (!Number.isInteger(days) || days < 1 || days > 366)) throw new PortalError('Choose a period between 1 and 366 days.');
  const end = hasDates ? params.get('end') : today;
  const start = hasDates ? params.get('start') : new Date(dateValue(end) - (days - 1) * DAY).toISOString().slice(0, 10);
  const first = dateValue(start), last = dateValue(end);
  if (first === null || last === null || first > last || last > dateValue(today) || first < Date.UTC(2000, 0, 1)) throw new PortalError('Choose valid start and end dates, ending no later than today.');
  const periodDays = Math.round((last - first) / DAY) + 1;
  if (periodDays > 366) throw new PortalError('Choose a period of 366 days or less.');
  const device = String(params.get('device') || '').trim().toLowerCase();
  if (device && !['desktop', 'mobile', 'tablet', 'unknown'].includes(device)) throw new PortalError('Choose a valid device filter.');
  const country = String(params.get('country') || '').trim();
  const page = String(params.get('page') || '').trim();
  if (country.length > 80 || /[\x00-\x1f]/.test(country) || (page && (!page.startsWith('/') || page.length > 160 || /[?#\x00-\x1f]/.test(page)))) throw new PortalError('Check the country and page filters.');
  return {
    start, end, days: periodDays, timeZone: ANALYTICS_TIME_ZONE,
    previousStart: new Date(first - periodDays * DAY).toISOString().slice(0, 10),
    previousEnd: new Date(first - DAY).toISOString().slice(0, 10),
    filters: { country, device, page },
  };
}

export function publicAnalyticsPath(value) {
  let path = String(value || '/').split(/[?#]/, 1)[0];
  // Decode before exclusions so encoded private names and dot segments cannot
  // become public measurement paths. A literal percent produced by %25 is valid.
  for (let pass = 0; pass < 3 && (pass === 0 || /%[0-9a-f]{2}/i.test(path)); pass += 1) {
    try { path = decodeURIComponent(path); } catch { return null; }
    path = path.split(/[?#]/, 1)[0];
  }
  if (/%[0-9a-f]{2}/i.test(path) || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x1f\x7f\\]/.test(path)) return null;
  try { path = new URL(encodeURI(path), 'https://blvckoak.com.au').pathname; } catch { return null; }
  if (/^\/(?:partners|analytics|operations|login|pay|progress|oakpay-app)(?:\.html)?(?:\/|$)/i.test(path)) return null;
  if (/^\/(?:api|\.netlify)(?:\/|$)/i.test(path)) return null;
  return path.length <= 160 ? path : null;
}

export function coarseTechnology(userAgent = '') {
  const ua = String(userAgent).slice(0, 600);
  const bot = /bot|crawler|spider|headless|lighthouse|pagespeed/i.test(ua);
  const device = /ipad|tablet|android(?!.*mobile)/i.test(ua) ? 'tablet' : /mobile|iphone|ipod/i.test(ua) ? 'mobile' : ua ? 'desktop' : 'unknown';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera' : /firefox\//i.test(ua) ? 'Firefox' : /chrome\//i.test(ua) ? 'Chrome' : /safari\//i.test(ua) ? 'Safari' : 'Other / unknown';
  return { device, browser, bot };
}

export async function readAnalyticsRows(store, limit = 10000) {
  const result = await store.list({ prefix: 'analytics-visit/' });
  const timestamp = item => Number(item.key.slice('analytics-visit/'.length).split('-', 1)[0]) || 0;
  const blobs = (result.blobs || []).sort((a, b) => timestamp(b) - timestamp(a));
  const selected = blobs.slice(0, limit);
  const rows = [];
  // Bound storage concurrency instead of issuing thousands of requests at once.
  for (let index = 0; index < selected.length; index += 50) {
    const batch = await Promise.all(selected.slice(index, index + 50).map(({ key }) => store.get(key, { type: 'json' })));
    for (const row of batch) {
      if (!row || !Number.isFinite(Number(row.at))) continue;
      const path = publicAnalyticsPath(row.path);
      if (path) rows.push({ ...row, path });
    }
  }
  return { rows, truncated: blobs.length > limit, scanned: selected.length };
}

function group(rows, label, maximum = 50) {
  const values = new Map();
  for (const row of rows) {
    const key = String(label(row) || 'Unknown').slice(0, 200);
    values.set(key, (values.get(key) || 0) + 1);
  }
  return [...values].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, maximum);
}

export function aggregateAnalytics(rows, range, now = Date.now()) {
  const filtered = rows.filter(row => {
    if (row.bot) return false;
    if (range.filters.country && String(row.country || '').toLowerCase() !== range.filters.country.toLowerCase()) return false;
    if (range.filters.device && (row.device || 'unknown') !== range.filters.device) return false;
    return !range.filters.page || String(row.path).startsWith(range.filters.page);
  }).map(row => ({ ...row, day: localDate(Number(row.at)), event: row.event || 'page_view' }));
  const current = filtered.filter(row => row.day >= range.start && row.day <= range.end);
  const previous = filtered.filter(row => row.day >= range.previousStart && row.day <= range.previousEnd);
  const summarise = records => {
    const views = records.filter(row => row.event === 'page_view');
    return { views: views.length, visitors: new Set(views.map(row => row.visitor).filter(Boolean)).size, interactions: records.filter(row => row.event !== 'page_view').length };
  };
  const views = current.filter(row => row.event === 'page_view');
  const timeline = [];
  for (let day = dateValue(range.start); day <= dateValue(range.end); day += DAY) {
    const date = new Date(day).toISOString().slice(0, 10);
    timeline.push({ date, ...summarise(current.filter(row => row.day === date)) });
  }
  const recent = filtered.filter(row => Number(row.at) >= now - 30 * 60000 && Number(row.at) <= now);
  return {
    summary: summarise(current), previous: summarise(previous), timeline,
    realtime: { views: recent.filter(row => row.event === 'page_view').length, approximateVisitors: new Set(recent.map(row => row.visitor).filter(Boolean)).size },
    sources: group(views, row => row.campaign?.utm_source || row.source || 'Direct / unknown'),
    mediums: group(views, row => row.campaign?.utm_medium || 'No campaign medium'),
    campaigns: group(views, row => row.campaign?.utm_campaign || 'No campaign'),
    pages: group(views, row => row.path, 100),
    countries: group(views, row => row.country),
    cities: group(views, row => row.city && row.city !== 'Unknown' ? [row.city, row.country].filter(Boolean).join(', ') : 'Unknown'),
    devices: group(views, row => row.device || 'Unknown — earlier tracking'),
    browsers: group(views, row => row.browser || 'Unknown — earlier tracking'),
    events: group(current, row => row.event),
    referrals: group(views, row => row.campaign?.ref || 'No referral code'),
  };
}
