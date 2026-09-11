# SimbaOS

SimbaOS is a self-hostable operating system for Simba Sports Club membership, branches, payments and nationwide reporting.

The first MVP includes:

- Secure staff login with role-aware API permissions
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
2. Copy `.env.example` to `.env` and change all passwords/secrets.
3. Start the stack:

```bash
docker compose up -d --build
```

4. Open `http://localhost:8080` (or the server IP on your LAN).

The default development credentials are shown only for first-run convenience:

- Email: `admin@simbaos.local`
- Password: `SimbaOS123!`

**Change these in `.env` before any real deployment.**

## Hosting model

SimbaOS is not tied to a third-party SaaS database. The team owns the application and PostgreSQL database and can run them on:

- an office/on-premise server accessible on the club LAN,
- a VPS,
- a private cloud VM,
- or behind a reverse proxy / Cloudflare Tunnel.

The web app listens on port `8080` by default and can be placed behind the club's own domain and TLS proxy.

## Core API

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/dashboard`
- `GET|POST /api/branches`
- `GET|POST /api/members`
- `GET /api/members/:id`
- `POST /api/members/:id/payments`
- `GET /api/reports/branches`

## Next production modules

The database/API are structured so the next phase can add digital membership cards with QR verification, member photos, renewals, branch staff management, approvals, mobile-money/bank integrations, communications, supporter segmentation, match/event access, merchandise, and offline branch sync.
