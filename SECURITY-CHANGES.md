# Payment, referral and launch hardening

- Routes Essential, Professional and Enterprise through one server-priced Stripe Checkout function.
- Removes all public test Payment Links and rejects browser-supplied prices.
- Uses one strict referral format: `BO-` plus ten hexadecimal characters.
- Verifies email ownership with a high-entropy, time-limited magic link before creating a Stripe payout account.
- Sends recovery links to the registered inbox instead of exposing codes or onboarding links to unauthenticated visitors.
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

No software can eliminate alternate-email self-referrals, identity theft, account compromise, chargebacks after payout, tax/legal risk or unrecoverable transfers. Keep Stripe Radar enabled, manually review suspicious activity, keep sufficient reserves and complete the external checklist before live launch.
