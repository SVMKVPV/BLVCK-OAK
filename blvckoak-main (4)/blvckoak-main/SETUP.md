# Black Oak production setup

This version adds signed-in partner accounts, custom client quotes and deposits, live client progress, an owner-published portfolio, Digital Marketing, and a public self-quote builder. Start with PARTNER-PORTAL-SETUP.md, then use this guide for Stripe, email and Netlify account configuration.

This is a full-stack Netlify project: the public website plus protected Stripe Checkout, verified-email referral registration, Stripe Connect onboarding, delayed weekly partner rewards, transactional email, a secure contact form and the live Enterprise offer counter.

Do not deploy only `index.html`, `style.css` and `script.js`. Payments, referrals, email and the counter require the included Netlify Functions.

## Fixed commercial rules in this build

- Essential: **A$500**
- Professional: **A$1,500**
- Enterprise: **A$2,900**
- Valid Enterprise referral: **60% off**, so the customer pays **A$1,160**
- Enterprise promotion: hard-capped by Stripe at the first **1,000 completed redemptions**
- Enterprise partner reward: **A$390** (A$100 plus 10% of the original A$2,900 list price)
- Other qualifying sales: A$100; when paid total is above A$501, add 10% of paid total
- Rewards: minimum 14-day hold, then processed weekly

All three package prices are created on the server. There are no public Stripe Payment Links in the site.

The `/quote.html` calculator provides indicative planning ranges only. It keeps one-off work separate from optional monthly marketing and maintenance. A final quote still requires written scope confirmation; advertising spend, third-party software, hosting and other external costs are excluded unless expressly agreed.

## 1. Test the source locally

Open this folder in Visual Studio Code and run:

```powershell
pnpm install
pnpm run check
pnpm run build
```

The visual pages can be viewed with Live Server. Checkout, referral registration, email, the offer counter and weekly payouts require Netlify Functions and real test-mode service credentials.

## 2. Configure transactional email

This build uses Resend’s HTTPS API without an extra library.

1. Create or sign in to your Resend account.
2. Add a domain you control and complete the SPF and DKIM records Resend gives you. Add DMARC as recommended.
3. Create an API key restricted to sending email.
4. Choose an address on that verified domain for `EMAIL_FROM`.
5. Set `OWNER_EMAIL` to the private inbox that should receive paid-sale, referral-partner and contact alerts.
6. Set `SUPPORT_EMAIL` to the reply-to address customers can use.

Do not use an unverified Gmail address as `EMAIL_FROM`; use your verified business domain. Successful email-code sign-in is required before managing a referral profile or starting Stripe payout onboarding.

## 3. Configure Stripe in test mode

1. Complete the Stripe business profile and enable a Connect platform. Express connected accounts remain used for referral payouts; Standard account read-only OAuth is used only for Pay as You Sell sales tracking.
2. Add your own bank account only inside Stripe’s private payout settings.
3. In Stripe Developers → Webhooks, add:

   `https://YOUR-NETLIFY-DOMAIN/api/stripe/webhook`

4. Subscribe it to:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
   - `charge.dispute.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

5. Copy the test secret key (`sk_test_...`) and the webhook signing secret (`whsec_...`).
6. Keep Stripe Radar enabled and configure receipts, business branding and support details in Stripe.

## 4. Deploy the complete source to Netlify

1. Put the unzipped source in a private GitHub repository.
2. In Netlify choose **Add new project → Import an existing project**.
3. Connect the repository. `netlify.toml` runs the checks, builds `dist`, deploys `netlify/functions` and schedules weekly payouts.
4. In **Project configuration → Environment variables**, add:

```text
SITE_URL=https://YOUR-NETLIFY-DOMAIN
STRIPE_SECRET_KEY=sk_test_YOUR_TEST_SECRET
STRIPE_WEBHOOK_SECRET=whsec_YOUR_TEST_WEBHOOK_SECRET
STRIPE_CONNECT_CLIENT_ID=ca_YOUR_CONNECT_CLIENT_ID
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_YOUR_CONNECTED_ACCOUNT_WEBHOOK_SECRET
STRIPE_ENTERPRISE_REFERRAL_COUPON_ID=bo-ent-60-first-1000
RESEND_API_KEY=re_YOUR_KEY
EMAIL_FROM=Black Oak Digital <partners@YOUR-VERIFIED-DOMAIN>
OWNER_EMAIL=YOUR-PRIVATE-BUSINESS-INBOX
SUPPORT_EMAIL=support@YOUR-VERIFIED-DOMAIN
GOOGLE_MAPS_API_KEY=AIza_YOUR_SERVER_SIDE_PLACES_KEY
REFERRAL_COUNTRY=AU
REFERRAL_PAYOUT_DAY=friday
REFERRAL_BASE_REWARD_CENTS=10000
REFERRAL_BONUS_THRESHOLD_CENTS=50100
REFERRAL_BONUS_RATE=0.10
REFERRAL_HOLD_DAYS=14
REFERRAL_VERIFICATION_TTL_MINUTES=30
REFERRAL_TERMS_VERSION=2026-09-02
```

For Pay as You Sell, enable Standard account OAuth in Stripe Connect settings and register this exact redirect:

`https://YOUR-NETLIFY-DOMAIN/api/stripe/connect/callback`

Create a second webhook endpoint with **Events from: Connected accounts**, using the same `/api/stripe/webhook` URL. Subscribe it to `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created` and `account.application.deauthorized`. Its signing secret is different from the ordinary account webhook and belongs in `STRIPE_CONNECT_WEBHOOK_SECRET`.

Never commit real values to `.env`, GitHub or the public site.

Enable **Places API (New)** for the Google Cloud project behind `GOOGLE_MAPS_API_KEY`, attach billing, restrict the key to that API, and set a daily quota that matches your budget. The key is read only by the Netlify Function. The dashboard must be served over HTTPS for browser location permission.

## 5. Test the complete flow

Use test data only:

1. Submit the contact form and confirm both owner alert and customer acknowledgement arrive.
2. Create a partner account at /partners.html using an inbox you control.
3. Confirm the account is inaccessible until the six-digit email code is verified.
4. Finish Stripe Express onboarding from the signed-in dashboard.
5. Sign out and sign in again. Confirm the existing profile returns instead of a duplicate.
6. Try the tracked Enterprise link and use the partner code with other standard packages.
7. Confirm Enterprise shows A$2,900 less 60%, with A$1,160 due.
8. Confirm an invalid code, incomplete partner, malformed code and same-email self-referral are rejected.
9. Complete a test payment and confirm Stripe’s event is successful, owner/customer email arrives and the Enterprise counter changes after an Enterprise referral purchase.
10. Confirm the A$390 reward is pending for at least 14 days.
11. In test data only, make a reward eligible and use Netlify’s **Run now** control for `weekly-referral-payouts`; confirm the Stripe test transfer.
12. Test partial/full refunds and a dispute; confirm the reward reduces, cancels, blocks or reverses.
13. In the signed-in dashboard, allow location access and confirm the local lead finder returns Google Maps listings without a listed website.
14. Create Pay as You Sell test quotes for percentage, fixed-per-sale and sales-milestone methods. Connect a Stripe test account, complete a successful AUD payment in that account and verify the calculated contribution appears once on the private quote page.
15. Refund and dispute a connected-account test sale, then disconnect the account. Verify the accrued unpaid amount and connection state update safely.
16. Pay the agreed website total and verify new sales no longer accrue website cost. Separately accept and cancel a test monthly maintenance subscription when maintenance was offered.
17. Set a project to Completed at 100%, open its portfolio editor in the owner workspace, publish safe public details and confirm the card appears on `/portfolio.html`. Unpublish it and confirm it disappears.

## 6. Switch to live payments

1. Activate the Stripe account and complete all business verification.
2. Add your settlement bank account and payout schedule in Stripe.
3. Create a separate live webhook endpoint with the same URL and event list. Test and live webhook secrets are different.
4. Replace Netlify’s test Stripe values with `sk_live_...` and the live `whsec_...`.
5. Run `pnpm run preflight:live` in an environment containing the production values.
6. Redeploy, then make the smallest safe real payment and refund test.
7. Verify customer receipts, the owner alert, the bank payout record and accounting reconciliation.

Never place bank details in site files or Netlify environment variables; Stripe collects them privately.

## 7. Complete business and legal details

Read `BUSINESS-DETAILS-BEFORE-LAUNCH.md`. The ACN and ABN supplied by the owner are included, and the privacy, terms and refund pages remain working drafts. Add the registered legal entity name, GST status, address and governing state, then have the pages and referral offer reviewed before live launch.

At the discounted Enterprise price, the platform receives A$1,160 before Stripe fees and tax, then owes a A$390 partner reward after the hold. You remain responsible for margin, tax, fraud, chargebacks and any partner transfer that cannot be recovered.
