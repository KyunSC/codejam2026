# Loop D: workspace preferences (edit in place)

Branch `feature/workspace-preferences`. Builds `WORKSPACE_PREFS_PLAN.md`. One item per run; notes under each item. Prompt: `loops/loop-d-workspace-prefs.md`.

Checks for every commit (from `Brim/`): `npm run typecheck`, `npm run lint -- --ignore-pattern '.next/**'`, `npm run build`. (Plain `npm run lint` reports ~11,700 problems, all in a stale, gitignored `.next/` folder left from the Next.js version; CI never sees it. See questions.md.) Running app for curl checks: `PORT=3100 npm run dev`; stop it with `kill $(lsof -tiTCP:3100 -sTCP:LISTEN)` (never a pattern-based pkill: something else listens on 3000). Database: the local one in `.env.local`, read-only except item 1's migration.

- [x] 0. Commit WORKSPACE_PREFS_PLAN.md as it is. Create progress/workspace-prefs.md.
- [x] 1. Storage: user_preferences in db/schema.sql, db/migrations/001_user_preferences.sql, README line; migration applied twice.
  - Table added to `db/schema.sql` right after `users` (and the departments FK). Migration is the same statement with `IF NOT EXISTS`.
  - Applied to the local database twice: first run `CREATE TABLE`, second run a NOTICE "already exists, skipping". `\d user_preferences` shows the PK and the cascade FK to users.
  - Checked that the whole `schema.sql` still loads: ran it inside `BEGIN; CREATE SCHEMA …; SET LOCAL search_path …; \i db/schema.sql; ROLLBACK;` (17 tables created, schema gone after rollback). Nothing in the real schema changed except the migration.
  - README: the migration command sits under "Run", after "To start over…", reading DATABASE_URL from `.env.local` like `reset-db.sh` does.
- [x] 2. Shared model: src/lib/preferences.ts + scripts/check-preferences.ts.
  - `src/lib/preferences.ts`: TABS (with href/match/action, moved from `App.tsx`'s inline list; App still has its own copy until item 6), DASHBOARD_TILES and DASHBOARD_CARDS (permissions copied from `loadDashboard`), SECTIONS, TABLES, `preferencesSchema`, `DEFAULT_PREFERENCES`, `resolvePreferences`, `resetPage`, `migratePreferences`.
  - Column ids come from the real table headings, and match the plan's table. Filter values come from the pages' constants (`STATUSES`, `KINDS`, Payments `TABS`, the Vendors chips). Payments defaults to `scheduled` as today.
  - **Added beyond the plan: `sanitizePreferences(doc)`.** Reading is lenient: a stored document with an id or value the app no longer has would fail the strict schema, so `migratePreferences` sanitizes it (drops only the bad parts). Its result always passes `preferencesSchema`, so the app can edit and save it back without a 400.
  - **Schema strictness (the plan said both "stripped" and "rejected"):** unknown top-level keys are dropped; unknown ids or values inside lists and tables are refused with the field's path (e.g. `tables.invoices.pageSize`, `tabs.0.id`). A `filter` on a table with no filters, or a `pageSize` on an unpaged table, is refused as an unknown key. Duplicate ids are dropped, first wins; lists capped at 30.
  - **Locked items keep their default position**, as plan 1.2 says ("can't be dragged out of place"), unlike the prototype, where the Dashboard tab could move. So the Payments `totals` section can be hidden but not moved, since `list` is locked after it.
  - `scripts/check-preferences.ts`: 14 checks (node:assert): empty doc, forbidden tabs, stored order plus appended ids, unknown ids, locked items, landing page fallback (hidden and forbidden), a new column not in the stored order, invalid filter/page size, role-based tiles and cards, schema accept/refuse with paths, top-level key stripping, sanitize, resetPage. `npx tsx scripts/check-preferences.ts` → 14 passed.
- [x] 3. API: preferences.service.ts + /api/me/preferences (GET, PUT, DELETE); curl flow and audit rows checked.
  - `src/services/preferences.service.ts` (`getPreferences`, `savePreferences`, `resetPreferences`) and three routes in `src/server/routes/session.ts`, next to `/me/delegation`. Each route throws 401 without a user and always acts on the session user; no role gate.
  - Unchanged documents are compared with key-sorted JSON (array order counts): no write and no audit row. Validation errors name the field: `theme: Invalid option…`, `tables.invoices.pageSize: must be one of: 5, 10, 20`.
  - **Difference from the plan:** reset empties the row (`UPDATE … SET prefs='{}'`) instead of deleting it. Same effect for the user (no settings = defaults), the audit row is the same, and the app never issues a DELETE. A reset when nothing is stored writes nothing.
  - PUT reads `req.body` directly (not route()'s `body ?? {}`), so a JSON array is refused with 400 instead of being treated as an object.
  - Verified on port 3100 as the AP clerk (U004): GET → `{}` with defaults; PUT theme+pageSize → saved; identical PUT with keys reordered → no row; `theme: neon` → 400; `pageSize: 7` → 400; hiding `audit` (which a clerk can't see) → accepted, no effect on resolved tabs; array body → 400; DELETE → `{}`; second DELETE → nothing written; no cookie → 401 on GET and PUT.
  - `audit_events` for U004 after the run: exactly `preferences.update` ×2 (the two real changes), `preferences.reset` ×1, with `actor_role` ap_clerk, the org id, and before/after JSON.
  - Brim operator (`ops@brim.example`) GET works (defaults; audit rows would carry a null organization, which the table allows). `GET /api/session` and the users list show no preference fields.
- [ ] 4. Provider + appearance: src/web/preferences.tsx, data-* on <html>, globals.css, no-flash script in index.html.
- [ ] 5. Edit mode shell: @dnd-kit, src/web/customize/*, Customize button, Undo / Reset this page / Reset all / Esc.
- [ ] 6. Tabs and start page: tab bar from prefs, drag/hide/tray, house icon, Login.tsx to the start page.
- [ ] 7. Dashboard: tile ids, tiles and cards ordered/hidden/draggable, hidden parts not fetched, empty state.
- [ ] 8a. DataTable component + Invoices table.
- [ ] 8b. Raw table.
- [ ] 8c. Parsed table.
- [ ] 8d. Payments table.
- [ ] 8e. Vendors table.
- [ ] 8f. Audit table.
- [ ] 9. Default filters: URL, then prefs, then old default; "all" writes the parameter; ☆ while editing.
- [ ] 10. Rows per page: Invoices tables and Audit; RowsPerPage in edit mode.
- [ ] 11. Sections: Invoices cards; Payments totals hideable.
- [ ] 12. Wrap-up: README line, curl flow end to end, browser checklist notes.
