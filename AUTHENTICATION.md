# Authentication architecture

Black Oak uses passwordless email authentication for partners and the owner. No password, JWT, GitHub login or ChatGPT login is involved.

## Components

- `partners.html` and `partners.js`: sign-in UI, six-digit code verification, authenticated dashboard requests and logout.
- `netlify/functions/partner-auth.mjs`: starts and verifies email challenges, then creates the session.
- `netlify/lib/portal-auth.mjs`: token generation, hashing, session cookies, account lookup, same-origin checks and CSRF validation.
- `netlify/functions/partner-api.mjs`: authenticated partner data and owner-only mutations.
- Netlify Blobs: strongly consistent challenge, account and session records.
- Resend: delivery of one-time codes.
- Stripe: Checkout, Connect onboarding and signed webhook authentication.

## Sign-in flow

1. The browser sends the email and either `login` or `signup` to `POST /api/partners/auth`.
2. The server generates a 32-byte challenge and a six-digit code. It stores the challenge under its SHA-256 hash and stores only `SHA-256(challenge:code)`.
3. The code is emailed through Resend. It expires after 10 minutes, allows no more than five attempts and is consumed atomically.
4. Successful verification creates or loads the account and generates a separate 32-byte session token.
5. The raw session token is returned only in the `__Host-blackoak-session` cookie. The server stores only its SHA-256 hash.
6. `GET /api/partners` validates the cookie and returns dashboard data plus the session-specific CSRF token.
7. Every modifying dashboard request requires the session cookie, the exact configured HTTPS origin and the CSRF token.
8. Logout deletes the server-side session and expires the browser cookie.

## Cookie and authorization policy

The session cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, has `Path=/`, has no `Domain` attribute and expires after 12 hours.

Owner authority is never accepted from the browser or an account role field. An authenticated account is the owner only when its verified email exactly matches the private `OWNER_EMAIL` environment variable.

Partners may access only their own indexed quotes. Owner checks protect approval, cancellation, project updates, portfolio publishing and private-link rotation.

## Private client links

Approved quotes have a separate 32-byte `publicToken`. The token is placed after the URL fragment marker and is POSTed by the payment or progress page, reducing exposure in HTTP request logs and referrer headers.

The token is a bearer credential: anyone holding the complete link can use the client view. If it is exposed, the owner must choose **Reset private links** in the dashboard. This replaces the token and immediately invalidates the previous Black Oak payment and progress URLs. Payment and project records are unchanged.

A Stripe-hosted Checkout URL already issued by Stripe is a separate capability. Review or expire that Checkout Session in Stripe if it may also have been exposed.

## Service credentials

Store these only as encrypted Netlify environment variables:

- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_CLIENT_ID`
- `STRIPE_CONNECT_WEBHOOK_SECRET`
- `GOOGLE_MAPS_API_KEY`
- `OWNER_EMAIL`, `EMAIL_FROM`, `SUPPORT_EMAIL` and `SITE_URL`

The browser never receives secret Stripe, Resend or Google keys. Stripe webhook bodies are accepted only after signature verification. Stripe OAuth uses a hashed, single-use, 10-minute state value and requests read-only scope.
