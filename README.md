# SimbaOS

SimbaOS is a self-hostable operating system for Simba Sports Club membership, branches, payments and nationwide reporting.

The first MVP includes:

- Secure staff login with branch-scoped, role-aware permissions
- Staff account management: create, edit, suspend, transfer and reset passwords
- Nationwide branch registry
- Member registration and searchable member database
- Automatic Simba member numbers
- Membership/payment ledger
- HQ dashboard with live totals
- Branch-level membership reporting
- Audit log foundation
- Health endpoint for application/database status
- Responsive web UI for desktop, tablet and mobile
- Docker Compose deployment with PostgreSQL so the club can host the system itself

## Run it locally or on a club server

1. Install Docker and Docker Compose.
2. Copy `.env.example` to `.env` and set a real value for every variable:

```bash
cp .env.example .env
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -hex 32      # JWT_SECRET
```

   Choose your own `ADMIN_PASSWORD` of at least 12 characters. Compose will not start
   while `POSTGRES_PASSWORD`, `JWT_SECRET` or `ADMIN_PASSWORD` is unset, and the
   application refuses to boot in production if any of them is still a placeholder.

3. Start the stack:

```bash
docker compose up -d --build
```

4. Open `http://localhost:8080` (or the server IP on your LAN) and sign in with the
   `ADMIN_EMAIL` and `ADMIN_PASSWORD` you set in `.env`.

The administrator account is created from `.env` on first boot only. Changing
`ADMIN_PASSWORD` afterwards does not rotate an account that already exists.

## Hosting model

SimbaOS is not tied to a third-party SaaS database. The team owns the application and PostgreSQL database and can run them on:

- an office/on-premise server accessible on the club LAN,
- a VPS,
- a private cloud VM,
- or behind a reverse proxy / Cloudflare Tunnel.

The web app listens on port `8080` by default and can be placed behind the club's own domain and TLS proxy.

## Development and tests

```bash
npm ci
npx playwright install chromium   # optional, for the browser suite
createdb simbaos_test
SIMBAOS_TEST_DATABASE_URL=postgres://simbaos:simbaos@localhost:5432/simbaos_test npm test
```

`npm test` runs two suites against the real server: `test/smoke.mjs` covers the configuration
gate, the crash-resistance of the API, member-number allocation, branch scoping, staff
management and the core registration flow; `test/ui.mjs` drives the interface in Chromium as
an HQ admin, a branch registrar and a viewer, and is skipped when Playwright is absent.

The suites drop and recreate the schema they point at, so they refuse to run against a
database whose name does not look like a test database.

GitHub Actions runs the same suite plus a Docker image build on every push.

## Roles and scope

| Role | Sees | May do |
| --- | --- | --- |
| `super_admin` | Everything nationwide | Everything, including other super admins |
| `hq_admin` | Everything nationwide | Branches, members, payments, staff below super admin |
| `branch_admin` | Its own branch only | Members and payments in its branch; registrars and viewers in its branch |
| `registrar` | Its own branch only | Register members and record payments in its branch |
| `viewer` | Its own branch only | Read only |

Branch-scoped accounts cannot read, register or take payment for a member in another branch,
and their dashboard, branch list and reports cover their own branch alone. An account with a
branch role but no branch assigned is refused rather than treated as nationwide.

Role, branch and suspension are read from the database on every request, so a change takes
effect on the next request rather than when the signed-in session expires.

## Core API

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/me`
- `POST /api/me/password`
- `GET /api/dashboard`
- `GET|POST /api/branches`
- `GET|POST /api/members`
- `GET /api/members/:id`
- `POST /api/members/:id/payments`
- `GET /api/reports/branches`
- `GET|POST /api/users`
- `PATCH /api/users/:id`
- `POST /api/users/:id/password`

## Next production modules

The database/API are structured so the next phase can add membership validity periods and
renewals driven by payment, digital membership cards with QR verification, member photos,
approvals, mobile-money/bank integrations, communications, supporter segmentation,
match/event access, merchandise, and offline branch sync.

Membership currently has no validity period: a payment is recorded against a member but does
not extend anything, and `status` is set at registration and never recalculated. Until that
lands, "active members" means "registered members".
