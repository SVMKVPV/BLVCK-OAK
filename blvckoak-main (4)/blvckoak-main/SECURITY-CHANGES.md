# Payment, referral and launch hardening

- Routes Essential, Professional and Enterprise through one server-priced Stripe Checkout function.
- Removes all public test Payment Links and rejects browser-supplied prices.
- Uses one strict referral format: `BO-` plus ten hexadecimal characters.
- Requires a time-limited email sign-in code; codes stop after five failures and are consumed atomically.
- Uses revocable server-stored sessions with Secure, HttpOnly, SameSite cookies and CSRF checks.
- Resolves owner authority only from the verified email matching the private OWNER_EMAIL setting.
- Restricts partner records to their owner and requires owner approval for custom prices.
- Locks approved prices and computes deposit/balance amounts on the server.
- Reuses one idempotent Stripe checkout per payment stage, including concurrent clicks.
- Does not award package commissions on arbitrary custom quotes or deposits.
- Records custom payments only from signed webhooks; refunds and disputes pause collection.
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
