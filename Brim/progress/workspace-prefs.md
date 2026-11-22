# Loop D: workspace preferences (edit in place)

Branch `feature/workspace-preferences`. Builds `WORKSPACE_PREFS_PLAN.md`. One item per run; notes under each item. Prompt: `loops/loop-d-workspace-prefs.md`.

Checks for every commit (from `Brim/`): `npm run typecheck`, `npm run lint`, `npm run build`. Running app for curl checks: `PORT=3100 npm run dev`. Database: the local one in `.env.local`, read-only except item 1's migration.

- [x] 0. Commit WORKSPACE_PREFS_PLAN.md as it is. Create progress/workspace-prefs.md.
- [ ] 1. Storage: user_preferences in db/schema.sql, db/migrations/001_user_preferences.sql, README line; migration applied twice.
- [ ] 2. Shared model: src/lib/preferences.ts + scripts/check-preferences.ts.
- [ ] 3. API: preferences.service.ts + /api/me/preferences (GET, PUT, DELETE); curl flow and audit rows checked.
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
