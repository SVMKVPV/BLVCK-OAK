# BLVCK OAK

Production website, passwordless partner portal, custom quote workflow, Stripe Checkout and Stripe Connect integrations for BLVCK OAK.

## Run locally

Requires Node 22 and pnpm (`corepack enable`).

```sh
pnpm install
pnpm run check        # syntax check, preflight and unit tests
pnpm run build        # writes the public site to dist/
npx netlify dev       # site + Netlify Functions on http://localhost:8888
```

Without `netlify dev`, `node e2e/serve.mjs dist 4173` serves the built static site (no API).

Browser smoke tests: `pnpm run build && npx playwright test --config e2e/playwright.config.mjs`.

## Layout

| Path | Contents |
| --- | --- |
| `*.html`, `*.js`, `*.css` | Public and private pages with their scripts and styles |
| `netlify/functions/` | API handlers (`/api/*` routes in `netlify.toml`) |
| `netlify/lib/` | Shared server logic (auth, Stripe, email, rate limits, spam check) |
| `scripts/` | Build, preflight, release smoke and asset tooling |
| `tests/` | Node unit and integration tests (`*.test.mjs`) |
| `e2e/` | Playwright browser smoke tests |
| `previews/`, `community/`, `assets/` | Template previews, community profiles and media |

## Deploy

Netlify builds from `main` with `pnpm run check && pnpm run build` (production also runs `preflight:live`). Every PR runs the Verify workflow. See [SETUP.md](SETUP.md) for environment variables, Stripe, Resend and launch checks, and [AUTHENTICATION.md](AUTHENTICATION.md) for the login design.

Real credentials belong in Netlify environment variables. Never commit live Stripe, Resend, Turnstile or Google API keys.
