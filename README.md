# ZariKhata

**Your Agro Business, Accounts & Stock in One Place.**

An agrochemical shop management system: inventory, credit sales to farmers,
supplier payables, cash/bank accounting, and reports. Runs as a web app -
the frontend on Cloudflare Pages, the API and MySQL on Oracle Cloud's Always
Free tier.

## Architecture

```
  Browser
     |  https
     v
  Cloudflare Pages  ---->  Oracle Always Free VM  ---->  MySQL HeatWave
  (React, static)   https  (Caddy -> Express API)  VCN   (Always Free)
```

Caddy terminates TLS and proxies to the API on localhost; the database has no
public IP and is reachable only over the private VCN subnet. See
`docs/DEPLOYMENT.md` for the full step-by-step.

The interface ships in both light and dark, switchable from the top bar (or
left to follow the operating system). Both are hand-built palettes rather than
one inverted into the other - see `brand/README.md`.

## Repository layout

| Path | What |
|---|---|
| `backend/` | Express + TypeScript + Prisma API. Business logic, auth, reports, backup/restore, tests. |
| `frontend/` | React + Vite + TypeScript UI, deployed to Cloudflare Pages. |
| `brand/` | Brand identity: the mark, colour scale, type stack, icon exports. See `brand/README.md`. |
| `docs/` | `DEPLOYMENT.md` (deploying to Cloudflare Pages + Oracle Cloud). |
| `docker-compose.yml` | Local dev MySQL. Production uses Oracle MySQL HeatWave. |

## Local development setup

### Prerequisites
- Node.js 20+
- Docker (for local MySQL) — or your own MySQL 8 server
- `mysql-client` / `default-mysql-client` package if you want to run `npm run backup` / `npm run restore` locally (not required for normal development)

### 1. Install and start the database

```bash
docker compose up -d
```

Starts a MySQL 8 container on port 3306 (database `zarikhata`, user `zarikhata` / `zarikhata_dev_password`).

### 2. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set SESSION_SECRET to a random 48+ char string, e.g.:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm install
npx prisma migrate deploy
npm run dev
```

Backend runs on http://localhost:4000. To add demo data for manual testing:

```bash
OWNER_USERNAME=owner OWNER_PASSWORD=ChangeMe123! OWNER_NAME="Shop Owner" \
SHOP_NAME="My Shop" SEED_DEMO_DATA=true npx tsx prisma/seed.ts
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Opens on http://localhost:5173, talking to the backend at `http://localhost:4000` by default.

### 4. Tests

```bash
cd backend
npm test
```

Runs against a separate, auto-migrated `zarikhata_test` database.

## Data safety

- Business data lives in MySQL HeatWave, which takes automatic backups.
  For a copy you control, see `backend/src/backup/` for `npm run backup` (mysqldump → gzip →
  checksum → retention policy) and `npm run restore` (safe by default:
  restores into a fresh verification database and checks row counts,
  never overwrites the live database without `--overwrite-existing`).
- Run `npm run reconcile --workspace backend` at any time to independently
  recompute every balance (stock, farmer receivables, supplier payables,
  cash/bank) from source transactions and flag any drift.

## Accounting model

Transaction-ledger-based with verifiable derived balances (not full
double-entry bookkeeping) — see the top of `backend/prisma/schema.prisma`
for the full rationale.

## Status

Built and tested locally: automated backend test suite plus manual browser
testing of the full UI. `docs/DEPLOYMENT.md` covers the production deployment
to Cloudflare Pages and Oracle Cloud Always Free.