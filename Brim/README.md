# Brim AP

Accounts payable for Brim business card customers: an Express API over Postgres, and a React app built with Vite.

- `src/server` — the Express app: routes under `/api`, which check the role and call the services.
- `src/services` — business rules and permissions.
- `src/lib` — database, auth, permissions, shared helpers.
- `src/web` — the React app; it reaches the server only through `/api`.
- `scripts` — database reset and the dataset loader, which calls the API.

## Setup

Needs Node 24 (`mise install` reads `mise.toml`) and a local Postgres.

```bash
npm install
createdb brim_ap
cp .env.example .env.local   # then fill it in: SESSION_SECRET, and ANTHROPIC_API_KEY for extraction
./scripts/reset-db.sh        # loads db/schema.sql into the database named in DATABASE_URL
```

The server checks `.env.local` at startup and exits naming any missing setting.

## Run

```bash
npm run dev
```

Express serves the API and, in development, the React app through Vite on http://localhost:3000.

Load the dataset (with the server running):

```bash
npx tsx scripts/ingest.ts setup     # organization, people, vendors, POs, contracts
npx tsx scripts/ingest.ts history   # past invoices, approvals and payments
npx tsx scripts/ingest.ts inbox     # poll the simulated AP inbox
```

To start over, run `./scripts/reset-db.sh` again before `setup`.

A database created before workspace preferences needs their table. Add it without a reset (safe to run again):

```bash
psql "$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"')" -f db/migrations/001_user_preferences.sql
```

For production: `npm run build`, then `npm start`.

## Signing in

Sign-in is by email only, with no password (demo). The login page lists the demo accounts. The Brim operator account, `ops@brim.example`, creates organizations and runs setup.

## Customizing the workspace

Each person can tailor their own workspace: press **Customize** in the header, then drag or hide tabs, dashboard tiles and cards, Invoices sections and table columns; star a filter as a table's default; pick rows per page. **Workspace options** sets the start page, theme, density, accent and text size. Changes save to the signed-in user (`GET/PUT/DELETE /api/me/preferences`, stored in `user_preferences`) and follow them to any browser. Preferences only rearrange what the user's role already allows; they never grant access.

## Sealed invoices

`brim_ap_dataset/sealed_invoices.txt` lists 15 incoming files held back as a stand-in for the judges' hidden batch. The inbox poll skips the emails that carry them unless the server runs with `INCLUDE_SEALED=1`. Don't open those files. See `AGENTS.md`.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

CI (`.github/workflows/brim-ci.yml`) runs these and loads `db/schema.sql` into Postgres.
