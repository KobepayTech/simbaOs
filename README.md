# simbaOs

Simba Sports Club fan membership platform by KobepayTech.

## Current version

Private review: https://simba-fan-membership.sosteristephen.chatgpt.site

Includes QR onboarding at `/join`, mandatory selection from Tanzania’s 31 regions, permanent fan IDs, number preferences from 1 to 1,000,000, premium number categories, membership-card previews, D1 persistence, availability checks, and voting eligibility/duplicate-vote guards.

Premium rules: 1–100 premium, 101–999 higher premium, repeated digits override the range category. Prices have not been approved. Numbers are only assigned after verified payment; current registrations are pending preferences, not reservations.

Renewal reminder dates are calculated one calendar month before expiry, clamped at month end. Reminder queue and number assignment helpers are internal integration foundations, not connected payment or SMS services.

## Run locally

Requires Node.js 22.13+ and pnpm matching `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Build and typecheck:

```sh
pnpm exec tsc --noEmit
pnpm build
```

For local database setup, build first and apply the initial migration once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_clever_richard_fisk.sql
```

See [runtime instructions](docs/RUNTIME.md) for the Worker runtime and authentication details. The app uses Cloudflare D1, not Supabase. `.openai/hosting.json` retains logical bindings only; no existing private Site ID or credentials are exported.

## Source layout

- `app/fan-app.tsx`: fan interface and onboarding.
- `app/api/`: membership, number availability, and voting endpoints.
- `lib/membership.ts`: regions, number categories, reminder-date rules.
- `lib/membership-lifecycle.ts`: trusted payment assignment, ballot snapshots, reminder queue queries.
- `db/` and `drizzle/`: database schema and migrations.
- `public/join-qr.svg`: QR code pointing to the private preview’s onboarding URL; regenerate for the final public domain.
- `docs/CONTENT-SOURCES.md`: source audit and launch dependencies.

## Before public launch

This is a working private-review foundation, not a complete production membership service. Outstanding work:

1. Approve prices, membership duration, renewal fees and expiry/release policy.
2. Connect payment collection and verified, idempotent payment callbacks.
3. Connect public phone OTP, identity checks and account recovery. Current authentication relies on the Sites gateway; direct self-hosting needs a trusted auth adapter. Never trust user-supplied identity headers on a public server.
4. Connect an SMS provider and production scheduler. No SMS is currently sent.
5. Complete club administration and ballot management. No real ballots have been created.
6. Configure public access and the intended domain; regenerate the onboarding QR.

Content uses selected facts and links from Simba’s public website. The entire news archive has not been scraped. No private fan data or secrets are included.
