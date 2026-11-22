# Brim AP

Accounts payable for Brim business card customers: an Express API over Postgres, and a React app built with Vite.

- `src/server` — the Express app: routes under `/api`, which check the role and call the services.
- `src/services` — business rules and permissions.
- `src/lib` — database, auth, permissions, shared helpers.
- `src/web` — the React app; it reaches the server only through `/api`.
- `scripts` — database reset and the dataset loader, which calls the API.

## Run

```bash
npm run dev
```

Express serves the API and, in development, the React app through Vite on http://localhost:3000.

Load the dataset (with the server running):

```bash
./scripts/reset-db.sh && npx tsx scripts/ingest.ts setup && npx tsx scripts/ingest.ts history && npx tsx scripts/ingest.ts inbox
```
