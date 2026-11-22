# Brim AP

Accounts payable for Brim business card customers: an Express API over Postgres, and a React app built with Vite.

- `src/server` — the Express app: routes under `/api`, which check the role and call the services.
- `src/services` — business rules and permissions.
- `src/lib` — database, auth, permissions, shared helpers.
- `src/web` — the React app; it reaches the server only through `/api`.
- `scripts` — database reset, the loader for Harborline's existing records, and `bank.ts`, which plays the bank outside the app.

## Run

```bash
npm run dev
```

Express serves the API and, in development, the React app through Vite on http://localhost:3000.

Every loaded account, and the Brim employee `ops@brim.example`, gets the password in `DEMO_PASSWORD` in `.env.local`.

Load Harborline's existing records, then poll the AP inbox (the last step needs the server running):

```bash
./scripts/reset-db.sh && npx tsx scripts/ingest.ts setup && npx tsx scripts/ingest.ts history && npx tsx scripts/ingest.ts inbox
```

A database created before workspace preferences needs their table. Add it without a reset (safe to run again):

```bash
psql "$(sed -n 's/^DATABASE_URL=//p' .env.local | tr -d '"')" -f db/migrations/001_user_preferences.sql
```

## Customizing the workspace

Each person can tailor their own workspace: press **Customize** in the header, then drag or hide tabs, dashboard tiles and cards, Invoices sections and table columns; star a filter as a table's default; pick rows per page. **Workspace options** sets the start page, theme, density, accent and text size. Changes save to the signed-in user (`GET/PUT/DELETE /api/me/preferences`, stored in `user_preferences`) and follow them to any browser. Preferences only rearrange what the user's role already allows; they never grant access.

## Payments and the bank

Releasing a payment sends it to the bank: its instruction goes to `BANK_DIR/outbox`. The bank answers with statement lines and virtual card charges in `BANK_DIR`; outside the app, `scripts/bank.ts` gives those answers for every instruction due by the business date:

```bash
npx tsx scripts/bank.ts
```

The app takes those in every minute and settles each payment a line confirms.

## Agents (MCP)

Employees can let an AI agent work in the app for them. The MCP server is at `/mcp` (Streamable HTTP).

1. Log in, open the Account tab, and create a token under Agent access. It is shown once.
2. Add the server to your agent, for example Claude Code:

```bash
claude mcp add --transport http brim-ap http://localhost:3000/mcp --header "Authorization: Bearer brim_…"
```

The agent acts as you: it is offered only the tools your role allows, the same rules apply as in the website, and every action it takes is marked "agent" in the audit log. Revoke the token on the Account page to cut it off. The same token also works as `Authorization: Bearer` on the REST API.
