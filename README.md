# simbaOs

Simba Sports Club fan membership platform by KobepayTech.

## Mobile web app

Private review: https://simba-fan-membership.sosteristephen.chatgpt.site

Mobile-first, installable PWA with bottom navigation, Swahili/English UI, home-screen icons, an offline reconnect screen, QR onboarding, printable membership cards and live card verification. Private membership data, payments and votes are never cached offline.

Implemented workflows:
- Phone OTP registration and same-phone account recovery (Twilio Verify adapter; credentials required).
- All 31 Tanzanian regional groups; district branches, scoped branch leaders, announcements and events.
- Permanent joining rank, renewable numbers 1–1,000,000, configurable tier prices, timed checkout reservations and waitlists.
- Payment orders, signed idempotent settlement callbacks, automatic activation/renewal, expiry release and late-payment review. A payment-provider adapter must be connected to the documented contract.
- One-month renewal reminders plus optional 7-day/1-day notices, SMS outbox and scheduled Worker source.
- Benefit catalog, points-based passes, one-time redemption, event check-ins, renewal/referral/attendance points.
- Candidate profiles, national/regional/district ballots, opening-time eligibility snapshot, one vote per verified active member, separate participation and choices, results after closing.
- Administrator pricing, member/collection dashboards, staff assignments, audit records and connection status.

See [connection requirements and security boundaries](docs/INTEGRATIONS.md). No live payment, OTP or SMS credentials are included. The current review is private and has no fabricated members, ballots, partner offers or approved fees.

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

For local database setup, build first and apply **each** pending migration once in numeric order (0000 through 0003):

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_clever_richard_fisk.sql
```

See [runtime instructions](docs/RUNTIME.md) for the Worker runtime and authentication details. The app uses Cloudflare D1, not Supabase. `.openai/hosting.json` retains logical bindings only; no existing private Site ID or credentials are exported.

## Source layout

- `app/fan-app.tsx`: fan interface and onboarding.
- `app/api/`: membership, number availability, and voting endpoints.
- `lib/membership.ts`: regions, number categories, reminder-date rules.
- `lib/platform/`: membership lifecycle, sessions, provider adapters, validation and staff workflows.
- `db/` and `drizzle/`: database schema and migrations.
- `public/join-qr.svg`: QR code pointing to the private preview’s onboarding URL; regenerate for the final public domain.
- `docs/CONTENT-SOURCES.md`: source audit and launch dependencies.

## Before public launch

1. Publish approved membership prices and term length in Admin → Membership pricing.
2. Configure phone/SMS credentials and the chosen payment-provider adapter.
3. Deploy the reminder scheduler with its secret and the final app origin.
4. Configure administrator identities and branch/scanner roles.
5. Run real-provider sandbox and end-to-end acceptance tests, then configure public fan access and the final domain.

The app uses D1; no Supabase dependency is present. The QR used in the mobile interface is generated from the current origin.

## Verification

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Tests use SQLite transactions behind a small D1-compatible harness. They cover concurrent ownership rules, callback idempotency, late payments, joining order, referral rewards, benefits and voting. Real provider delivery, device installation and production checkout still require their respective acceptance tests.

## Separate administration portal

Open `/admin` for the club office: membership desk, audited manual receipts, payment methods, fees, editable club profile and policies, news, branches, events, rewards, ballots, staff access and reminder/audit logs. See [Administrator guide](docs/ADMIN.md). Shared data updates the mobile fan app. Automatic payment and SMS integrations still require production configuration.
