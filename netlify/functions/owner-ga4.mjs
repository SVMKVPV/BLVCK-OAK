import { json, runtimeEnv } from '../lib/referrals.mjs';
import { clientError, portalStore, requireAccount } from '../lib/portal-auth.mjs';
import { analyticsRange } from '../lib/site-analytics.mjs';
import { AnalyticsServiceError, createGa4Client, ga4Configuration } from '../lib/ga4-reports.mjs';

export function createGa4Handler({ getStore = portalStore, authenticate = requireAccount, env = runtimeEnv, now = Date.now, runReports = createGa4Client() } = {}) {
  const cache = new Map();
  return async function handler(request) {
    try {
      if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
      const auth = await authenticate(request, getStore());
      if (!auth.isOwner) return json({ error: 'This page is available to the BLVCK OAK owner only.' }, 403);
      const range = analyticsRange(new URL(request.url).searchParams, now());
      const configuration = ga4Configuration(env);
      if (!configuration.configured) return json({ source: 'ga4', connected: false, missing: configuration.missing, propertyId: configuration.propertyId, range, message: 'Google Analytics is not connected. First-party website reports remain available.' });
      const key = JSON.stringify([configuration.propertyId, range]);
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return json({ ...cached.data, cached: true });
      const reports = await runReports(configuration, range);
      const result = {
        source: 'ga4', connected: reports.some(report => !report.error), propertyId: configuration.propertyId, range,
        generatedAt: new Date(now()).toISOString(), reports,
        analyticsUrl: `https://analytics.google.com/analytics/web/#/p${configuration.propertyId}/reports/intelligenthome`,
        notes: [
          'These are Google Analytics Data API reports. Consent, blockers, reporting identity, thresholds, processing delay and attribution can cause differences from first-party records or the Google Analytics interface.',
          'Money is requested in AUD. Product revenue requires properly instrumented ecommerce events; it is separate from Stripe settlement and tax records.',
          'Realtime uses the last 30 minutes and ignores the date and page-path filters. Country and device filters still apply. Results are cached for up to 60 seconds.',
          'Rows are limited to the top 50, or 100 pages. Exports contain the displayed report rows, not a complete raw-event export.',
          'Use Google Analytics for Explorations, Advertising, audiences, retention cohorts, attribution configuration, property administration and DebugView.',
        ],
      };
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      if (result.connected) cache.set(key, { data: result, expires: now() + 60000 });
      return json(result);
    } catch (error) {
      if (error instanceof AnalyticsServiceError) return json({ error: error.message, code: error.code }, 503);
      const result = clientError(error);
      return json({ error: result.error }, result.status);
    }
  };
}

export default createGa4Handler();
