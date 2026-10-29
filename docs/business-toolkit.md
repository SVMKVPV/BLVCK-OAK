# BLVCK OAK owner business toolkit

The private `/business-tools.html` workspace covers all 78 catalogue services. It is linked from the owner Automation Desk. Every service explicitly separates its implemented owner capabilities from the full service scope and remaining integrations. Planning registers must not be described as complete SaaS products.

## Implemented

- Owner-only records, due queues, status, search, pagination, CSV export, activity history and optimistic version checks.
- Itemised draft invoices, pricing/margin, commission, cash-flow, timesheet, campaign, entered-tax and renewal calculations.
- Stock/points ledgers with transactional adjustments, reasons, idempotent requests and non-negative balances.
- Supplier CSV validation and transactional private-product import; existing SKUs are skipped.
- CSV cleanup/deduplication and exact-reference payment reconciliation with ambiguity reporting.
- Editable content/reply/script/document templates, escaped printable HTML documents, standalone page HTML and Sydney calendar events.
- Search of owner-approved private answers, with source links. No public knowledge endpoint exists.
- On-demand SSRF-protected public-page checks with an HTML fingerprint baseline and SEO checks.
- Scheduled internal task rules: once/daily/weekly/monthly; runs at minute 35 each hour. No records/rules are seeded or activated by deployment. Catch-up creates one overdue task and advances beyond today. Short months clamp dates. Paused rules do not run. Rules never send messages or charge/publish anything.
- Optional OpenAI Responses text drafting (`OPENAI_API_KEY` and `OPENAI_MODEL`). Explicit owner request, 10 requests/hour, `store:false`, bounded output and no tools. No API key/model is included in source or client payloads. No AI call was made during implementation.
- Links to the existing customer CRM, estimator, partner quotes/payment plans, referrals, project progress, marketplace and analytics.

## Storage and access

`@netlify/database` provisions Netlify Postgres on a supported account and applies the additive migration in `netlify/database/migrations/`. Requires the runtime `NETLIFY_DB_URL` supplied by Netlify and the database driver setting chosen by the platform. Existing Blob CRM records are unchanged.

The API reuses verified-owner authentication and same-origin CSRF. Every record query is scoped to the authenticated account ID. Assignee names are metadata, not access grants. Public GET requests return 401/403 before database access. No arbitrary SQL, provider credentials, raw customer data or internal document search is publicly exposed. Private page paths are excluded from public traffic tracking.

Mutations use Postgres transactions, row locks, advisory locks, unique constraints and durable request IDs. Stock fields and check results cannot be overwritten by a normal edit. Archived records are retained; no hard-delete endpoint is provided. Exporting all records is bounded at 10,000 records and fails explicitly above that bound.

## Still requires connection or implementation

AI drafting is blocked without the key/model. SMS, WhatsApp, voice, mailbox sync, live calendars, social publishing, video rendering, image generation, bulk campaigns/unsubscribe processing, accounting/bank feeds, payroll, couriers and external search-performance feeds are not connected. Their owner records/drafts work, while their full integration work remains explicit on each tool.

Subscriptions, memberships, paid-download delivery, new public products, multi-vendor settlement, public chat, multi-user/client editing and white-label tenant provisioning are not implemented by these planning registers. Existing site payment and portal capabilities remain available through links. Generated HTML pages are downloadable drafts; they are not automatically published.

## Verification

`pnpm run check` runs validation and all tests. `tests/business-tools.test.mjs` covers service completeness, validation, calculations, CSV, escaping, access boundaries, migrations, database persistence, idempotency, ledgers, supplier imports, scheduled tasks and saved page checks. The local NetlifyDB/PGlite harness uses one pool connection because PGlite has one backend; it does not simulate a multi-backend production database. Production correctness additionally relies on native PostgreSQL locks/constraints.

`pnpm run build` includes the new static assets. Production smoke checks require the new page/script and verify that anonymous API calls remain denied. Local visual QA uses fictional fixtures in ignored `dist/` only; fixtures must never be committed or deployed.
