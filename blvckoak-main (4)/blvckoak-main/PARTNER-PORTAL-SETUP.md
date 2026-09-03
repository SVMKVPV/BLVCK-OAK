# Black Oak partner accounts, quotes and deposits

## How it works

- Enterprise now has a visible referral-code field directly on its package card.
- Partners create an account and verify a six-digit email code before managing referral codes.
- Repeat sign-in uses a new email code. No password or ChatGPT account is required.
- Partners see only their own quotes. The owner sees all quotes and payments.
- Each quote records the client, service, scope, total AUD price and deposit.
- Partner-created prices need owner approval. The owner can adjust drafts before approval.
- The owner can create immediately approved quotes and cancel approved, unpaid quotes.
- Approved quotes cannot be silently repriced. Cancel an unpaid quote and create a replacement if the agreement changes.
- One private client link collects the deposit first and the balance later. Zero deposit means full payment.
- Quotes can instead use Pay as You Sell: a percentage per sale, a fixed amount per sale, or a fixed payment after a chosen number of sales.
- Pay as You Sell clients connect an existing Stripe account with read-only OAuth. Signed connected-account webhooks record successful AUD sales, refunds and disputes; the calculated amount is paid through the private quote link and stops at the agreed website total.
- Optional monthly maintenance is shown separately and starts only if the client accepts a Stripe subscription after paying the project balance.
- Customer, partner and owner receive payment notification emails.
- Payments are recognised only after a signed Stripe webhook. Repeated clicks reuse the same active checkout.
- Refunds and disputes pause further collection for owner review.
- Signed-in partners can use their browser location to find nearby Google Maps listings that do not include a website.
- Completed projects can be drafted and published to `/portfolio.html` by the owner. Public listings include only the chosen title, category, summary, completion date and optional HTTPS website link; private client and quote data is excluded.

## Commercial boundary

The standard package prices, Enterprise 60% promotion and package commissions are unchanged.

Custom quotes are separate. They do not receive the standard Enterprise discount and do not automatically create a A$100/A$390/percentage referral payout. Any custom-job commission must be agreed separately with the owner. This avoids paying a fixed reward on an arbitrarily small price or deposit.

Custom totals are A$100–A$100,000. A deposit and any remaining instalment must each be at least A$50. The approved total is the complete customer price, including any applicable tax. Confirm tax treatment and invoices with your accountant.

## Connect the site

Use the COMPLETE Netlify source, not a static HTML-only upload.

1. Import the source repository into Netlify. The configuration builds the pages and deploys the functions.
2. Set these values privately in Netlify, available to Functions:
   - SITE_URL: your exact HTTPS origin, for example https://blvckoak.netlify.app
   - OWNER_EMAIL: your owner inbox. THIS ADDRESS BECOMES THE ADMINISTRATOR.
   - RESEND_API_KEY
   - EMAIL_FROM: an address on your verified Resend sending domain
   - SUPPORT_EMAIL
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - STRIPE_CONNECT_CLIENT_ID: the `ca_...` ID from Stripe Connect OAuth settings
   - STRIPE_CONNECT_WEBHOOK_SECRET: signing secret for the connected-account webhook endpoint
   - GOOGLE_MAPS_API_KEY: a server-side key restricted to Places API (New)
3. Keep the other referral settings from .env.example.
4. Configure a **Your account** webhook at `/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` and `charge.dispute.created`.
5. In Stripe Connect OAuth settings, enable Standard account OAuth, register `https://YOUR-DOMAIN/api/stripe/connect/callback` as the exact redirect and copy its `ca_...` client ID.
6. Configure a separate **Connected accounts** webhook at the same `/api/stripe/webhook` URL for `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created` and `account.application.deauthorized`. Save its separate signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.
7. Verify the sending domain in Resend. Gmail may be your owner recipient, but the sender must use your verified domain.
8. Deploy and use the exact SITE_URL. Secure cookies and origin checks deliberately reject mismatched domains and file:// copies.
9. In Google Cloud, enable Places API (New), attach billing, restrict the API key to Places API (New), and set a daily usage quota you can afford. Never put the key in browser JavaScript.

The owner and partners use /partners.html. Sign in with OWNER_EMAIL for approval controls. Never put credentials into website code.

Existing partners: create an account with the same email used for the old registration. Their existing referral code and Stripe account are retained.

## Test before switching Stripe live

Use Stripe TEST MODE and inboxes you control:

1. Create a partner account. Verify sign-in codes expire, cannot be replayed and stop after five incorrect attempts.
2. Sign in again. Confirm the same profile returns.
3. Complete Stripe onboarding. Confirm the standard Enterprise referral code works only when the partner is eligible.
4. Submit a A$2,400 custom quote with a A$600 deposit. Confirm it is not payable before owner approval.
5. Sign in with OWNER_EMAIL. Review the service and description, adjust pricing if needed, then approve.
6. Copy the approved client link. Verify A$2,400 total and A$600 due first.
7. Pay the deposit in Stripe test mode. Confirm the webhook records A$600 and the link shows A$1,800 remaining.
8. Pay the balance. Confirm paid-in-full status and no further payment.
9. Repeat checkout clicks and webhook deliveries. Confirm no duplicate session or recorded payment.
10. Test a refund and dispute. Confirm payment-review status and no further collection.
11. Cancel a different approved unpaid quote. Confirm its session expires and it cannot accept payment.
12. Confirm a partner cannot view another partner's dashboard records or approve/cancel prices.
13. Confirm emails reach owner, partner and customer. Check Resend delivery status if an email fails.
14. Allow location access in the partner dashboard, run each lead-finder category, and confirm listings open in Google Maps. Test blocked location permission and the daily limit.
15. Create one test quote for each Pay as You Sell method. Connect a Stripe test account, make a successful AUD test sale and confirm the private quote accrues the correct amount once. Test a refund, dispute and account disconnection.
16. Pay a Pay as You Sell quote in full and confirm later sales do not add more website cost. If maintenance was offered, separately accept it in Stripe test mode and then test subscription cancellation and past-due status.
17. Mark a test project 100% complete, add its public portfolio details and publish it. Confirm it appears on `/portfolio.html` without the client name, email, quote price or private progress link, then unpublish it and confirm it disappears.

The automated tests use isolated fixtures and a fake Stripe adapter. They do not replace real provider integration tests.

## Operational notes

- Unconfirmed payment attempts older than 23 hours fail closed for reconciliation. Never reset these to collect again without checking Stripe.
- Refunded/disputed quotes stay paused. Handle the correction in Stripe and agree any replacement quote only after confirming the balance.
- Dashboard lists show the latest 100 quotes.
- Quote creation limits: partners 20 per day; owner 100 per day.
- Nearby lead-search limits: partners 25 per UTC day; owner 100. Each search requests up to 20 Google Places results, then displays only operating listings without a returned website field.
- Email failures do not erase payments. The owner dashboard and Stripe remain the payment records.
- Sessions last 12 hours; sign out revokes the server-side session.
- Review policy drafts, legal identity, ABN/GST details and project agreements before live launch.
