# BLVCK OAK owner Automation Desk

Open `/operations.html` and sign in with the same verified owner email used by the partner workspace. The owner is resolved server-side using the existing configured email. A partner account cannot read or edit these records.

## Everyday workflow

1. Open **Today** to see due and overdue next actions. Web contacts, audits, consultation requests and automation quote requests already enter the shared sales store. Use **Add a lead** for an enquiry received elsewhere; this does not send an email.
2. Open a customer. Review the original enquiry, choose a stage, keep a private note and optionally override the suggested next action and Sydney due date.
3. Choose an editable response, follow-up, scope, onboarding or check-in template. Copy, download or open it in an email app. Sending is performed separately in the email app. Inbox replies are not synced.
4. After making contact, select **I’ve contacted them**. This records first/latest contact dates, moves a new lead to contacted and pauses the existing one-time automatic enquiry follow-up.
5. Use **Prepare client quote** to prefill the existing owner quote form. Review the scope and enter the agreed final amount. This handoff does not create a payment link, approve a price or send a customer email.
6. Mark a customer **Won** when appropriate and work through the delivery checklist. Once the delivery steps are complete and the actual launch date is recorded, the next action becomes a 30-day customer check-in. These are in-app reminders, not scheduled notification emails.
7. Use **Reports** to export a current lead snapshot or spreadsheet-safe CSV. Snapshot counts cover the latest 250 records and are not a historical conversion funnel. Won status is not a Stripe payment confirmation.

## Existing systems reused

- Sales lead records and stages in the existing `black-oak-sales` store; no parallel CRM.
- The existing email-code owner authentication and CSRF protection.
- Partner quote creation, payment links, 15-part payments and client progress publishing.
- Referral tools and traffic reports, linked from **Your tools**.
- The existing service-related 24-hour follow-up scheduler. It now also honours the lead's pause setting. Manual entries are always excluded. Changing a stage from new already excludes the lead from this scheduler.

The private API returns `Cache-Control: no-store`; owner checks apply to every read and write. Writes validate the saved workflow revision and use the existing store's conditional write to avoid silently overwriting another update. Legacy partner edits preserve workflow settings and advance the revision. The private route is excluded from analytics collection and marked noindex.

## Boundaries

The 78-service sales catalogue is a list of services that can be scoped and built. This desk implements the first internal sales and delivery workflows; it does not activate every catalogue item. Reply drafts use deterministic templates and do not call an AI provider. No new third-party subscriptions or automatic outbound sequences are introduced.

SMS, WhatsApp, voice, inbox synchronisation and social publishing still require their specific provider connections and operating rules. The email/payment indicators check only whether the existing configuration is present, not whether delivery or payments have succeeded. Payment and referral business rules are unchanged.

## Verification

`pnpm run check` covers owner authentication, CSRF, private-record access, validation, idempotent manual creation, stale updates, contact logging, follow-up suppression, Sydney dates and report exports. Browser UI checks use clearly labelled fictional records in ignored build output, never production records. The deployed smoke test checks the page and script plus anonymous denial on `/api/owner-operations` without sending messages or creating accounts, leads or payments.
