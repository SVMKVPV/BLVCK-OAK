# Black Oak production setup

This is a full-stack Netlify project: the public website plus protected Stripe Checkout, passwordless six-digit email authentication, Stripe Connect onboarding, delayed weekly partner rewards, transactional email, a secure contact form and the live Enterprise offer counter.

Do not deploy only `index.html`, `style.css` and `script.js`. Payments, referrals, email and the counter require the included Netlify Functions.

## Fixed commercial rules in this build

- Link in Bio: **A$13.13 per month**, billed automatically by Stripe until cancelled
- Valid Link in Bio referral: **first month free**, then **A$13.13 per month**
- Essential: **A$500**
- Professional: **A$1,500**
- Enterprise: **A$2,900**
- Valid Enterprise referral: **60% off**, so the customer pays **A$1,160**
- Enterprise promotion: hard-capped by Stripe at the first **1,000 completed redemptions**
- Enterprise partner reward: **A$390** (A$100 plus 10% of the original A$2,900 list price)
- Other qualifying sales: A$100; when paid total is above A$501, add 10% of paid total
- Rewards: minimum 14-day hold, then processed weekly

All four catalogue prices are created on the server. Link in Bio uses Stripe subscription mode; the three website-build packages remain one-time payments. There are no public Stripe Payment Links in the site.

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

Do not use an unverified Gmail address as `EMAIL_FROM`; use your verified business domain. The partner portal creates or signs into an account only after the visitor enters the private six-digit code sent to their inbox. Codes expire after 10 minutes, allow at most five attempts and cannot be replayed.

## 3. Configure Stripe in test mode

1. Complete the Stripe business profile and enable a Connect platform using Express connected accounts.
2. Add your own bank account only inside Stripe’s private payout settings.
3. In Stripe Developers → Webhooks, add:

   `https://YOUR-NETLIFY-DOMAIN/api/stripe/webhook`

4. Subscribe it to:

   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `charge.refunded`
   - `charge.dispute.created`

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
GOOGLE_MAPS_API_KEY=YOUR_SERVER_SIDE_PLACES_KEY
STRIPE_ENTERPRISE_REFERRAL_COUPON_ID=bo-ent-60-first-1000
RESEND_API_KEY=re_YOUR_KEY
EMAIL_FROM=Black Oak Digital <partners@YOUR-VERIFIED-DOMAIN>
OWNER_EMAIL=YOUR-PRIVATE-BUSINESS-INBOX
SUPPORT_EMAIL=support@YOUR-VERIFIED-DOMAIN
REFERRAL_COUNTRY=AU
REFERRAL_PAYOUT_DAY=friday
REFERRAL_BASE_REWARD_CENTS=10000
REFERRAL_BONUS_THRESHOLD_CENTS=50100
REFERRAL_BONUS_RATE=0.10
REFERRAL_HOLD_DAYS=14
REFERRAL_VERIFICATION_TTL_MINUTES=30
REFERRAL_TERMS_VERSION=2026-08-31
```

Never commit real values to `.env`, GitHub or the public site.

## 5. Test the complete flow

Use test data only:

1. Submit the contact form and confirm both owner alert and customer acknowledgement arrive.
2. Create a partner account using an inbox you control and enter the six-digit code from the email.
3. Confirm an incorrect code is rejected, a code cannot be reused, and a code older than 10 minutes is rejected.
4. Finish Stripe Express onboarding from the authenticated partner dashboard.
5. Sign out, sign in again with the same email and confirm the existing profile and referral code return.
6. Try the partner’s tracked Essential, Professional and Enterprise links.
7. Start a Link in Bio checkout without a code and confirm Stripe shows **A$13.13 AUD billed monthly**. Repeat with a verified referral code and confirm the first month is **A$0**, followed by **A$13.13 monthly**.
8. Confirm Enterprise shows A$2,900 less 60%, with A$1,160 due.
9. Confirm an invalid code, incomplete partner, malformed code and same-email self-referral are rejected. The free Link in Bio month does not create a partner reward.
10. Complete a test payment and confirm Stripe’s event is successful, owner/customer email arrives and the Enterprise counter changes after an Enterprise referral purchase.
11. Confirm the A$390 reward is pending for at least 14 days.
12. In test data only, make a reward eligible and use Netlify’s **Run now** control for `weekly-referral-payouts`; confirm the Stripe test transfer.
13. Test partial/full refunds and a dispute; confirm the reward reduces, cancels, blocks or reverses.

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

Read `BUSINESS-DETAILS-BEFORE-LAUNCH.md`. The included privacy, terms and refund pages are working drafts, but the code cannot invent your legal entity, ABN, GST status, address or governing state. Have the pages and referral offer reviewed before live launch.

At the discounted Enterprise price, the platform receives A$1,160 before Stripe fees and tax, then owes a A$390 partner reward after the hold. You remain responsible for margin, tax, fraud, chargebacks and any partner transfer that cannot be recovered.


## Partner authentication and private links

Partners and the owner sign in at `/partners.html` with a six-digit email code. There are no passwords or JWTs. Successful verification creates a 12-hour server-side session referenced by a Secure, HttpOnly, SameSite=Strict cookie. Mutating dashboard requests also require an exact same-origin request and a session-specific CSRF token.

The owner is determined only by the verified account email matching `OWNER_EMAIL`. Do not place an owner role, email allowlist or secret in browser JavaScript.

Approved projects use a high-entropy private token for client payment and progress pages. If a link is exposed, sign in as the owner and choose **Reset private links** on the quote. Send the newly generated links to the client; the old Black Oak payment and progress links stop working immediately. A Stripe-hosted Checkout URL that was already opened is controlled separately in Stripe.
