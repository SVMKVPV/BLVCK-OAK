# Payment, referral and launch hardening

- Routes Link in Bio, Essential, Professional and Enterprise through one server-priced Stripe Checkout function; Link in Bio uses Stripe subscription mode at A$13.13 per month.
- Removes all public test Payment Links and rejects browser-supplied prices.
- Uses one strict referral format: `BO-` plus ten hexadecimal characters.
- Verifies email ownership with a six-digit, time-limited, single-use email code before creating a partner session or Stripe payout account.
- Uses a new private email code for every sign-in and never exposes Stripe onboarding links to unauthenticated visitors.
- Requires completed Stripe identity, transfer and payout verification before a code can be used.
- Blocks exact-email self-referrals and rechecks after payment.
- Accepts rewards only from signed Stripe events with trusted metadata and exact AUD totals.
- Deduplicates webhook events, Stripe Checkout creation and reward records.
- Hard-caps the Enterprise discount at 1,000 Stripe coupon redemptions.
- Holds rewards for at least 14 days, then processes them in the weekly scheduled payout function.
- Reduces rewards for partial refunds, cancels full refunds and reverses transferred amounts where possible.
- Suspends or reverses rewards when a dispute opens.
- Adds owner/customer payment alerts and a rate-limited contact endpoint through a verified email provider.
- Adds privacy, terms and refund pages, strict browser headers, repeatable tests and a live-configuration preflight.
- Adds owner-controlled rotation for private client payment and progress links so exposed Black Oak links can be revoked.

No software can eliminate alternate-email self-referrals, identity theft, account compromise, chargebacks after payout, tax/legal risk or unrecoverable transfers. Keep Stripe Radar enabled, manually review suspicious activity, keep sufficient reserves and complete the external checklist before live launch.
