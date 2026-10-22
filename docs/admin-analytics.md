# BLVCK OAK owner analytics

## Access

Sign in through `/partners.html` with the existing owner email, then choose **Analytics**. The separate page is `/analytics.html` (also available through Netlify's clean URL handling).

The page contains no private statistics in its static HTML. Both reporting endpoints call the existing verified-session authorization and require `isOwner` on the server before reading report configuration, storage or caches. Partner accounts receive 403. Guests receive 401. Report responses are `Cache-Control: no-store`; no private data is stored in browser local storage. The page is `noindex,nofollow` and is excluded from the sitemap.

## Available immediately

The **Website records** source reads the existing private first-party visit records independently of Stripe and Google configuration. It includes selected/custom dates (up to 366 days), previous-period comparisons, daily views, approximate visitors, recent visitors, source/UTM/referral breakdowns, pages, coarse countries/cities, devices/browsers and allowlisted interactions. Every displayed table has a CSV export; formulas in text cells are neutralised.

Visitor estimates group the existing salted network-address hash. They are not GA4 users or sessions. Multiple people on one network can look like one visitor; network changes can look like more than one. Sources are per-page-view observations and include internal navigation. No session attribution, bounce rate, engagement rate, retention or conversion rate is inferred from page views. Older records have no device/event fields and remain explicitly unknown. Events default to `page_view` only for earlier records without an event field.

The public collector keeps only an allowlist of event names, clean public page paths, source host/campaign labels, coarse device/browser categories and platform-provided coarse location. It does not save field values, raw IP addresses or full User-Agent strings. Private admin, partner, pay and progress paths are excluded. DNT, Global Privacy Control and recognised crawler requests are ignored. Frontend instrumentation records `form_success` only after a successful application response; client analytics remain observational, not authoritative sales records.

Reports read at most the latest 10,000 records, with bounded storage concurrency, and explicitly display a coverage warning when capped. First-party results are cached privately in the function instance for 30 seconds. Old records are not silently fabricated or backfilled.

## Connect a collecting GA4 property

The report integration is implemented but live Google access is unverified until configured. Connecting the reports does not install a Google tag, create a property, mark key events, enable ecommerce or import historical first-party visits.

1. Identify the numeric GA4 **property ID** for BLVCK OAK, not the `G-...` web measurement ID.
2. Enable **Google Analytics Data API** for the Google Cloud project associated with the OAuth client.
3. Authorize an account with access to that GA4 property using `https://www.googleapis.com/auth/analytics.readonly` and offline access. Use Google's documented OAuth flow and an appropriate production/internal consent configuration. Retain the refresh token securely. Do not send secrets in chat or commit them to Git.
4. Configure these Netlify variables with **Functions** scope, using secret protection where available:

| Variable | Purpose |
| --- | --- |
| `GA4_PROPERTY_ID` | Numeric GA4 property identifier |
| `GA4_CLIENT_ID` | OAuth client ID |
| `GA4_CLIENT_SECRET` | OAuth client secret |
| `GA4_REFRESH_TOKEN` | Read-only offline refresh token for a user with property access |

5. Redeploy to apply configuration. Sign in as the owner and open **Analytics → Google Analytics**.
6. Confirm a known period against the native GA4 interface, including property timezone, filters, reporting identity, data thresholds and attribution. Confirm key events/ecommerce in GA4 itself before relying on those numbers.

Tokens are exchanged server-side at Google's OAuth token endpoint, held only in function memory and sent to Google's Data API via Authorization headers. The browser receives report values and safe configuration-status messages, never credentials. There is no new dependency or need to loosen the site's browser Content Security Policy for reporting.

## GA4 coverage and limits

The integration calls the real GA4 Data API for overview metrics, a previous-period comparison, daily performance, session channels/source-medium/campaigns, pages, landing pages, events/key events, geography, devices/browsers, new versus returning users, products/revenue and last-30-minute realtime users/countries. Currency is requested in AUD. Reports return independent section errors when a metric combination, property permission or quota prevents that report; working sections remain usable.

Requests run at most four at a time and have network timeouts. Successful report responses are cached privately for 60 seconds. Tables are bounded to 50 results, 100 pages or 366 daily rows; metadata flags truncation, thresholding and other-row loss. CSV contains the displayed report rows, not raw event exports. Realtime ignores the historical date and page-path filters; it uses country/device filters and the last 30 minutes.

Native GA4 links remain available for **Explorations, Advertising, audiences, retention cohorts, attribution configuration, DebugView and property administration**. These are not replicated by this dashboard. Stripe payment/fee/customer reports remain in the existing business workspace and are separate from GA4 revenue, settlement and tax data.

## Primary references

- [GA4 Data API runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [GA4 dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema)
- [GA4 realtime dimensions and metrics](https://developers.google.com/analytics/devguides/reporting/data/v1/realtime-api-schema)
- [GA4 API quotas](https://developers.google.com/analytics/devguides/reporting/data/v1/quotas)
- [Google OAuth web-server and offline access](https://developers.google.com/identity/protocols/oauth2/web-server)

## Verification

`node --test tests/admin-analytics.test.mjs` covers actual verified owner/partner session distinctions, unauthenticated requests, authorization before cache/config/data reads, invalid dates/filters, previous periods, aggregation of legacy and new records, private-path exclusion, independent first-party availability, GA4 setup handling, real token/report request formation with mocked upstream responses, partial failures, redacted outputs and CSV formula handling. Live GA4 authorization and property-specific metric availability must be checked after credentials are configured.
