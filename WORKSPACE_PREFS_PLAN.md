# Workspace preferences: implementation plan

Branch: `feature/workspace-preferences`

Every signed-in user can customize their workspace **where it sits**. They click **Customize** in the header, and the workspace enters edit mode. They drag tabs, dashboard tiles, page sections and table columns where they want them, hide what they don't use, choose the filter each table opens on and how many rows it shows, and set their start page, theme, density, text size and accent colour. Then they click **Done**. Everything is saved to their profile on the server, so it follows them to any browser or device.

This is "approach C" from the prototypes. The team compared three options (buttons on a settings page, a drag list on a settings page, edit in place) and chose edit in place. The full prototype covers every page; ask the author to share it, since the link is private: https://claude.ai/artifact/2Q3avRurWprxavrcDRK2wz

> **Timing.** `AGENTS.md` sets a code freeze at **Sunday 2026-11-22, 12:00pm**. This feature is not on the critical path. If any of it goes in before the freeze, ship phases 1–6 only (storage, API, appearance, edit mode with tabs, dashboard), which make a complete demo on their own. Table columns, default filters and sections (phases 7–9) come after.

---

## 1. How it works for the user

### 1.1 Entering and leaving edit mode

- **Customize** (pencil icon) sits in the workspace header next to the user's name, on every page.
- Clicking it shows an **edit bar** under the tabs. It is sticky with the header and has:
  - **Customizing {page}** and a one-line hint saying what can change on this page.
  - **Workspace options**: opens a panel for start page, theme, density, text size, accent and "Reset all customizations".
  - **Undo**: steps back through this session's changes.
  - **Reset this page**: puts the current page back to defaults. Hidden on pages with nothing to customize.
  - **Done**. Esc also leaves edit mode, unless a drag is in progress.
- Edit mode **stays on while the user switches tabs**, so they can set up several pages in one go.
- Changes apply and save as they happen. There is no Save button.

### 1.2 One visual language on every page

| Signal | Means | Where |
| -- | -- | -- |
| Dashed outline + grip (⠿) | Drag to move. Keyboard: focus it, Space to pick up, arrows to move, Space to drop | Tabs, tiles, cards, sections, column headings |
| × | Hide it | Same as above, except locked items |
| "Hidden …" tray of `+ Name` chips | Bring a hidden item back | Under each area that has hidden items |
| ☆ / ★ beside a filter | Make this the filter the table opens on | Tables with filters |
| Rows per page `5 · 10 · 20` | How many rows the table shows | Tables with paging |
| House icon on a tab | The start page | Tab bar, in edit mode |

Locked items show no × and can't be dragged out of place: the Dashboard tab, and each table's first column (its id or link).

### 1.3 What can be customized, page by page

These are the app's real screens, which differ a little from the prototype mock.

| Page | Customizable in v1 |
| -- | -- |
| All workspace pages | Tab order and hidden tabs; start page and appearance (Workspace options) |
| Dashboard | Tile order and visibility; card order and visibility (Pending approval, Spend by department, Delegate) |
| Invoices | Section order and visibility (Raw, Parsed, Invoices). Raw table: columns, default kind filter, rows per page. Parsed table: columns, rows per page. Invoices table: columns, default status filter, rows per page |
| Payments | Show or hide the status totals tiles. Table columns. Default status filter (today it's `scheduled`). The list isn't paged, so it has no rows-per-page control |
| Vendors | Table columns. Default status filter. The list isn't paged |
| Audit | Table columns; rows per page (20 · 50 · 100). Its filters are dropdowns, so they get no default in v1 |
| Settings, and detail pages (`/invoices/:id`, `/payments/:id`, `/vendors/:id`, intake forms) | Nothing. The edit bar says "Nothing on this page can be customized. You can still move and hide the tabs." |
| Brim operations layout | Workspace options only (appearance), since it has a single nav link |

### 1.4 Not in v1

- Organization-wide defaults set by a controller. The data model leaves room for them (section 3.4).
- Customizing detail pages (invoice detail panels and so on).
- Column widths, sorting preferences, and saved filter sets beyond one default per table.
- Language switching (EN/FR UI).

---

## 2. Design decisions

1. **Own table, not columns on `users`.** `userFromSession` and the user routes run `SELECT * FROM users`, so a column there would leak into `GET /api/session`, the `/users` list every org member can read, and `before_json` on every `user.update` audit row. A separate `user_preferences` table keeps them private to their owner.
2. **One JSONB document per user, validated with zod.** Preferences change shape often, and nothing queries inside them. A `version` field allows migrating old documents on read. The zod schema lives in `src/lib/preferences.ts`, shared by the server and the React app.
3. **Store only what the user changed.** The server stores a partial document; `resolvePreferences(stored, user)` merges it over the defaults on every read. A later change to a default reaches everyone who never touched that setting.
4. **Resolve against permissions and the current UI on read.** Unknown ids are dropped, new tabs, tiles or columns are appended visible, locked items are forced back in place, and anything the role can't open is filtered out by `can(user, …)`. Preferences never grant access: routes and services keep their own checks.
5. **Audit the change.** `AGENTS.md`: every mutation writes its audit row in the same transaction. Saves are debounced (400 ms) and the server skips both the write and the audit row when the document didn't change, so a run of drags makes one or a few rows.
6. **The URL wins over the default filter.** Filters live in the query string today. A table's saved default applies only when its query parameter is absent. "All" links must now write the parameter explicitly (`?status=all`) so they still mean all when the default is something else.
7. **Server is the source of truth; localStorage is a cache.** The app caches the last resolved preferences under `brim:prefs:<user_id>`, so theme and density apply on first paint without a flash. Every localStorage read and write is in `try/catch`.
8. **`@dnd-kit` for dragging, not SortableJS.** The prototype used SortableJS, which moves DOM nodes itself and fights React's reconciliation. `@dnd-kit/core` + `@dnd-kit/sortable` keep React in charge of the DOM. They come with pointer, touch and keyboard sensors and screen-reader announcements, and support grid (tiles), horizontal (tabs, columns) and vertical (cards, sections) lists.
9. **Edit mode is UI state, not a preference.** Whether edit mode is on, whether Workspace options is open, and the undo stack live in a React context and reset on reload. Only the results are saved.

---

## 3. Data model

### 3.1 Schema (`db/schema.sql`)

Add after `users`:

```sql
-- Each user's workspace preferences: only the settings they changed, merged over defaults in code (src/lib/preferences.ts).
CREATE TABLE user_preferences (
  user_id    text PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

No row means all defaults. Users are soft-deleted (`status='terminated'`), so the cascade only matters for a hard reset.

### 3.2 Existing databases

There's no migration tool: `./scripts/reset-db.sh` rebuilds from `schema.sql`. So that teammates don't have to reset and re-ingest, also add `db/migrations/001_user_preferences.sql` with the same statement as `CREATE TABLE IF NOT EXISTS`, and a line in `README.md`:

```bash
psql "$DATABASE_URL" -f db/migrations/001_user_preferences.sql
```

CI loads `schema.sql` into a clean Postgres, so the new table is covered there.

### 3.3 Document shape (version 1)

```ts
type Ordered<Id extends string> = { id: Id; visible: boolean }[];

type StoredPreferences = Partial<{
  // Workspace options
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  accent: "red" | "blue" | "green" | "purple" | "gold";
  textSize: "normal" | "large";
  landingPage: TabId;

  // Tab bar
  tabs: Ordered<TabId>;

  // Dashboard
  dashboard: { tiles?: Ordered<TileId>; cards?: Ordered<CardId> };

  // Page sections
  sections: { invoices?: Ordered<"raw" | "parsed" | "invoices">; payments?: Ordered<"totals" | "list"> };

  // Tables
  tables: Partial<Record<TableId, { columns?: Ordered<string>; filter?: string; pageSize?: number }>>;
}>;
```

Ids:

| Kind | Ids |
| -- | -- |
| Tabs | `dashboard` (locked), `invoices`, `payments`, `vendors`, `audit`, `settings` |
| Tiles | `raw_new`, `parsed_review`, `my_approvals`, `approved_unscheduled`, `to_release`, `vendors_pending`, `bank_changes` |
| Cards | `pending`, `spend`, `delegate` |
| Tables | `raw`, `parsed`, `invoices`, `payments`, `vendors`, `audit` |

Columns, from today's table headings (first one locked; trailing action columns such as Extract or Release are always last and never customizable):

| Table | Column ids | Filter values (default) | Page sizes (default) |
| -- | -- | -- | -- |
| `raw` | `id`, `kind`, `from`, `received`, `status` | `all`, `email`, `pdf`, `form` (`all`) | 5, 10, 20 (5) |
| `parsed` | `id`, `vendor`, `number`, `date`, `total`, `flags` | none | 5, 10, 20 (5) |
| `invoices` | `id`, `vendor`, `number`, `date`, `total`, `department`, `status`, `waiting_on` | `all`, `pending_approval`, `approved`, `scheduled`, `paid`, `rejected` (`all`) | 5, 10, 20 (5) |
| `payments` | `id`, `invoice`, `vendor`, `method`, `amount`, `scheduled`, `paid`, `prepared_released`, `status` | `scheduled`, `released`, `outstanding`, `settled`, `all` (`scheduled`) | none (not paged) |
| `vendors` | `vendor`, `category`, `location`, `gst_hst`, `pays_by`, `invoices`, `status`, `warnings` | `all`, `active`, `pending_review`, `on_hold` (`all`) | none (not paged) |
| `audit` | `id`, `when`, `who`, `action`, `on`, `links`, `note` | none in v1 | 20, 50, 100 (20) |

The zod schema checks every id and value against these lists, caps each list at 30 entries, and de-duplicates them. A full document stays well under 8 KB.

### 3.4 Room for org defaults later

`resolvePreferences` merges in layers: `DEFAULTS ← orgDefaults (v2) ← user stored`. In v1 the middle layer is empty. A later `organization_preferences` table plugs in without changing the API.

---

## 4. Shared module: `src/lib/preferences.ts`

Everything both sides need, and nothing that touches the database or React:

- `TABS`: the one list of workspace tabs, `{ id, href, label, match, action?, locked? }`, moved out of `WorkspaceLayout` in `App.tsx`. `action` is the `can()` permission that shows the tab.
- `DASHBOARD_TILES`, `DASHBOARD_CARDS`: ids, labels and the permission each needs, taken from today's `loadDashboard` conditions.
- `SECTIONS`: per page, the section ids and labels.
- `TABLES`: per table, column ids, labels and which one is locked, plus the allowed filter values with their default, and the allowed page sizes with their default. **Labels and ids only.** Cell rendering stays in the React pages (section 6.5).
- `preferencesSchema` (zod) and `DEFAULT_PREFERENCES`.
- `resolvePreferences(stored, user): ResolvedPreferences`. It merges, filters by `can()`, appends missing ids, pins locked items, falls back to `/dashboard` for a landing page that's hidden or not allowed, and swaps invalid filter or page-size values for the table default.
- `resetPage(stored, pageId): StoredPreferences`: the stored document minus that page's keys (dashboard → `dashboard`; invoices → `sections.invoices` and `tables.raw|parsed|invoices`; and so on). Used by **Reset this page**.
- `migratePreferences(doc, version)`: no-op at v1, the hook for later shapes.

---

## 5. Server

### 5.1 Service: `src/services/preferences.service.ts`

```ts
export async function getPreferences(user: User): Promise<{ stored: StoredPreferences; resolved: ResolvedPreferences }>;
export async function savePreferences(user: User, input: unknown): Promise<{ stored; resolved }>;
export async function resetPreferences(user: User): Promise<{ stored; resolved }>;
```

- `getPreferences`: one `SELECT prefs, version FROM user_preferences WHERE user_id=$1`, migrate, resolve.
- `savePreferences`: `preferencesSchema.safeParse(input)`; on failure throw `ValidationError` naming the first issue's path. Inside `tx`: `SELECT … FOR UPDATE`, compare to the new document (stable JSON). If it differs, `INSERT … ON CONFLICT (user_id) DO UPDATE SET prefs=…, version=1, updated_at=now()` plus `writeAudit(c, { organizationId: user.organization_id, actor: user, action: "preferences.update", entityType: "user_preferences", entityId: user.user_id, before, after })`.
- `resetPreferences`: same transaction pattern; deletes the row; audit action `preferences.reset`.

Save replaces the whole document. The client always sends everything it has, so the server has no partial-merge logic to get wrong.

### 5.2 Routes: `src/server/routes/session.ts`

Next to the existing `/me/delegation` routes:

| Method | Path | Body | Returns |
| -- | -- | -- | -- |
| `GET` | `/api/me/preferences` | — | `{ stored, resolved }` |
| `PUT` | `/api/me/preferences` | `StoredPreferences` | `{ stored, resolved }` |
| `DELETE` | `/api/me/preferences` | — | `{ stored: {}, resolved }` |

Each throws `UnauthorizedError` when there's no user. There's no role gate: every signed-in user, Brim employees included, owns their preferences. They always act on the session user, never on a `user_id` from the request.

### 5.3 Audit page

`preferences.update` and `preferences.reset` rows show in the organization audit log. If they're noisy, `AuditFilters.tsx` can leave them out by default without hiding them from the API.

---

## 6. Web app

### 6.1 New dependency

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

The lockfile pins the exact versions.

### 6.2 Preferences provider: `src/web/preferences.tsx`

```tsx
type PrefsCtx = {
  prefs: ResolvedPreferences;      // always complete: defaults until loaded
  stored: StoredPreferences;
  loading: boolean;
  update: (fn: (s: StoredPreferences) => StoredPreferences) => void;  // optimistic; pushes undo; debounced save
  undo: () => void; canUndo: boolean;
  resetPage: (pageId: PageId) => void;
  resetAll: () => Promise<void>;
  saveState: "idle" | "saving" | "saved" | "error";
};
```

- Mounted in `main.tsx` inside `SessionProvider`. It reloads when `user?.user_id` changes, drops back to defaults on logout, and clears the undo stack on sign-in.
- First render uses the localStorage cache for that user, then `GET /api/me/preferences`.
- `update` pushes the current `stored` onto the undo stack (max 60), applies the change, re-resolves locally with the shared `resolvePreferences`, and debounces a full-document `PUT` by 400 ms. On error it keeps the local state and sets `saveState: "error"`; the edit bar shows "Couldn't save · Retry".
- An effect sets appearance on `<html>`: `data-theme` (removed for `system`), `data-density`, `data-accent`, `data-text-size`.

### 6.3 Edit mode: `src/web/customize/`

| File | What |
| -- | -- |
| `EditMode.tsx` | Context `{ editing, setEditing, optionsOpen, setOptionsOpen }`, mounted in `WorkspaceLayout` and `BrimLayout`, so it survives route changes inside a layout. Esc handler (closes options first, then edit mode; ignored while dragging) |
| `EditBar.tsx` | The sticky bar from 1.1. Its page title and hint come from `pageFor(pathname)`, a small table mapping routes to page ids, labels and hints. Detail routes map to "nothing to customize" |
| `WorkspaceOptions.tsx` | Start page select (visible tabs only), theme / density / text size segmented controls, accent swatches, "Reset all customizations" with an inline second-click confirm |
| `Sortable.tsx` | `SortableArea` wraps `DndContext` + `SortableContext` with pointer, touch and keyboard sensors and the right strategy (`horizontal`, `vertical`, `grid`). `SortableItem` renders children with the dashed outline, grip and drag listeners when editing, and plain children otherwise. Takes `handle` for cards and sections, so only the header starts a drag and buttons inside stay clickable. On drop it calls `update` with `arrayMove` |
| `HideButton.tsx`, `HiddenTray.tsx` | The × button, and the "Hidden …" tray of `+ Name` chips |
| `DefaultFilterStar.tsx` | ☆/★ toggle beside a filter chip, shown only while editing |
| `RowsPerPage.tsx` | Segmented page-size control, shown only while editing |

Accessibility:
- Every drag also works from the keyboard through the dnd-kit keyboard sensor, with announcements set to plain text ("Picked up Payments tab. Position 3 of 6.").
- × and tray chips are real buttons with labels.
- After hiding an item, focus moves to the next item. After restoring one, focus moves to the restored item.
- The edit bar is a labelled region, and its save indicator is `aria-live="polite"`.

### 6.4 Tabs, start page, header (`App.tsx`, `pages/Login.tsx`)

- `WorkspaceLayout` builds the tab bar from `prefs.tabs` (ordered, filtered by role and hidden list). While editing, the bar is a horizontal `SortableArea`: each tab is draggable, and has × unless locked. A `HiddenTray` sits below the tabs. Clicking a tab still navigates in edit mode.
- Header: a **Customize** button in both layouts. The `EditBar` renders inside the sticky `<header>` under the tabs.
- Start page: `Login.tsx` navigates to `/dashboard` after sign-in. After `refresh()`, it fetches preferences and navigates to `prefs.landingPage` instead. The house icon marks that tab while editing.

### 6.5 Tables: `DataTable` and column definitions

This is the biggest refactor. Today each page writes `<Table head={[…]}>` and its own `<Td>` cells. Customizable tables move to column definitions:

```tsx
type Column<Row> = { id: string; render: (row: Row) => React.ReactNode; className?: string };  // label and locked flag come from TABLES in src/lib/preferences.ts

<DataTable
  table="invoices"                 // TableId: reads prefs.tables.invoices
  rows={rows}
  rowKey={(r) => r.invoice_id}
  columns={INVOICE_COLUMNS}        // Column<InvoiceRow>[] declared next to the page
  trailing={(r) => <ExtractButton … />}   // optional, never customizable
  empty="No invoices."
/>
```

- `DataTable` orders and filters columns by `prefs.tables[table].columns`. While editing, it renders the header row as a horizontal `SortableArea` (the locked first column stays put) with × on each heading, and a `HiddenTray` of columns under the table.
- It reuses the existing `.tbl` styles, so tables look the same outside edit mode.
- Tables to convert: Invoices (`raw`, `parsed`, `invoices`), Payments (`payments`), Vendors (`vendors`), Audit (`audit`). Detail-page tables keep `<Table>` unchanged.

### 6.6 Default filters and rows per page

- **Default filter.** Each converted page reads its filter as `sp.get(param) ?? prefs.tables[t].filter` instead of today's hard-coded fallback (`"all"`, or `"scheduled"` on Payments). Filter links always write the parameter, including `all`.
  - While editing, each filter chip (and each Payments totals tile, which is a filter) shows a ☆. Clicking it saves the default and navigates to that filter.
- **Rows per page.** `PAGE_SIZE` in `components/ui.tsx` stays as the fallback. Invoices and Audit pass `prefs.tables[t].pageSize` to the API `size` parameter and to `Pager`, and include it in their `useLoad` keys so a change reloads. While editing, `RowsPerPage` shows in the table footer next to the pager.

### 6.7 Dashboard (`pages/Dashboard.tsx`)

- Give each tile its id (section 3.3) in `loadDashboard`, then order and filter with `prefs.dashboard.tiles`. While editing, the tiles are a grid `SortableArea` with × on each.
- Render the three cards in `prefs.dashboard.cards` order, as a vertical `SortableArea` dragged by the card header.
- Skip the fetch for anything hidden. A hidden `spend` card means no `/department-spend` call.
- If everything is hidden: "Your dashboard is empty. Click Customize to bring tiles and cards back."

### 6.8 Sections (`pages/Invoices.tsx`, `pages/Payments.tsx`)

- Invoices renders its three `Card`s from `prefs.sections.invoices`, as a vertical `SortableArea` dragged by the card header. Hidden sections skip their fetch.
- Card titles lose their "1. / 2. / 3." prefixes, since the order is now the user's.
- Payments: the totals tiles row (`totals`) can be hidden. The list (`list`) is locked. A two-item list doesn't need reordering.

### 6.9 CSS (`src/web/globals.css`)

- **Theme.** Change dark mode from `@media (prefers-color-scheme: dark) { :root {…} }` to the same dark tokens under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and under `:root[data-theme="dark"]`. Write the dark tokens once, in a shared selector list.
- **Accent.** Add `--accent: var(--red)` and use it for the decorative reds: the `.btn--solid` shadow, the `.link` underline, the `.tabs` and `.wtabs` current markers, and the edit bar border. Semantic reds (`.flag--blocking`, `.chip--red`, `--flag`) stay red. `[data-accent="blue"] { --accent: var(--blue) }`, and so on.
- **Density.** `[data-density="compact"]` lowers padding on table cells, `.card`, `main`, and the minimum heights of `.btn` and `.input`.
- **Text size.** `[data-text-size="large"]` sets `html { font-size: 112.5% }`. Tailwind sizes are rem-based, so they scale with it.
- **Edit mode.** `.is-editing` styles: dashed outline and grab cursor on sortable items, the grip, `.x-btn`, `.tray`, `.star`, drag overlay and placeholder. Plus `prefers-reduced-motion` handling for drag animations.
- **No flash.** A small inline script in `index.html` reads the cached appearance from localStorage, inside `try/catch`, and sets the `data-*` attributes before the bundle loads.

---

## 7. Build order (one commit each)

| # | Phase | Main files | Done when |
| -- | -- | -- | -- |
| 1 | Storage | `db/schema.sql`, `db/migrations/001_user_preferences.sql`, `README.md` | `reset-db.sh` succeeds; the migration is idempotent on an existing DB |
| 2 | Shared model | `src/lib/preferences.ts` | `resolvePreferences` handles: empty doc, unknown ids, forbidden tabs, hidden landing page, a new column not in the stored order, an invalid filter or page size |
| 3 | API | `src/services/preferences.service.ts`, `src/server/routes/session.ts` | curl flow in section 8 passes; one audit row per real change, none for a no-op |
| 4 | Provider + appearance | `src/web/preferences.tsx`, `main.tsx`, `index.html`, `globals.css` | Theme, density, accent and text size apply (set temporarily through the console or a stub) and survive reload and a second browser |
| 5 | Edit mode shell + tabs | `npm i @dnd-kit/*`, `src/web/customize/*`, `App.tsx`, `pages/Login.tsx` | Customize / Done / Esc work; tabs drag, hide and come back; Workspace options sets start page and appearance; Undo and Reset all work; sign-in lands on the start page |
| 6 | Dashboard | `pages/Dashboard.tsx` | Tiles and cards drag and hide; hidden cards aren't fetched; Reset this page works |
| 7 | `DataTable` + columns | `components/DataTable.tsx`, `pages/Invoices.tsx`, `pages/Payments.tsx`, `pages/Vendors.tsx`, `pages/Audit.tsx` | Outside edit mode, the six tables look exactly as before; in edit mode, columns drag, hide and come back |
| 8 | Default filters + rows per page | Same pages, `components/ui.tsx` | ☆ sets the default; a fresh visit opens on it; `?status=all` still shows all; page size changes reload the list |
| 9 | Sections | `pages/Invoices.tsx`, `pages/Payments.tsx` | Invoices sections reorder and hide; Payments totals hide |
| 10 | Docs | `README.md`, `AGENTS.md` if a rule changes | — |

Phases 1–6 make a complete demo by themselves. Phase 7 is the largest (six tables to convert) and can be split one table per commit.

---

## 8. Verification

There are no automated tests yet, so check by hand and with the repo's checks.

**Every phase** (from `Brim/`):

```bash
npm run typecheck && npm run lint && npm run build
```

**API smoke test** (server running, dataset `setup` loaded):

```bash
J='-H content-type:application/json'
curl -s -c /tmp/c $J -d '{"email":"<an ap_clerk email from the login page>"}' localhost:3000/api/session >/dev/null
curl -s -b /tmp/c localhost:3000/api/me/preferences                                    # defaults, stored {}
curl -s -b /tmp/c -X PUT $J -d '{"theme":"dark","tables":{"invoices":{"pageSize":10}}}' localhost:3000/api/me/preferences
curl -s -b /tmp/c -X PUT $J -d '{"theme":"neon"}' localhost:3000/api/me/preferences      # 400 naming theme
curl -s -b /tmp/c -X PUT $J -d '{"tables":{"invoices":{"pageSize":7}}}' localhost:3000/api/me/preferences   # 400 naming pageSize
curl -s -b /tmp/c -X PUT $J -d '{"tabs":[{"id":"audit","visible":false}]}' localhost:3000/api/me/preferences  # accepted; no effect for a clerk
curl -s -b /tmp/c -X DELETE localhost:3000/api/me/preferences
curl -s localhost:3000/api/me/preferences                                              # 401 without a cookie
```

Then check `audit_events` has one `preferences.update` per real change, `preferences.reset` for the delete, and nothing for a repeated identical PUT.

**In the browser**, the prototype's tasks, as an `ap_clerk`, an `approver` and a `controller_admin`:

1. Make Invoices the start page; sign out and in; land on Invoices.
2. On Invoices, move the Invoices section above Raw; hide the Raw "Received" column.
3. On Payments, star `released` as the default; leave and come back; it opens on Released. Click "all": all payments show.
4. On Invoices, set 10 rows per page; paging shows 10.
5. Compact density and large text; nothing overflows at 375 px width.
6. Do 1–4 with the keyboard only (Tab, Space, arrows), then on a phone or the touch emulator.
7. Open the app in a private window: the server copy applies, not localStorage.
8. Change a controller to `employee` in Settings → Users, then sign in as them. Payments, Vendors and Audit are gone, a start page that pointed at them falls back to Dashboard, and nothing errors.
9. Stop the server mid-drag: the edit bar shows "Couldn't save · Retry", and Retry works once it's back.
10. Detail pages and Settings: the edit bar says nothing can be customized, and tabs still can.
11. Brim operator (`ops@brim.example`): Customize shows Workspace options only.

---

## 9. Risks and edge cases

| Risk | Handling |
| -- | -- |
| Converting six tables to `DataTable` changes how they look or behave | Phase 7's done-when is "looks exactly as before outside edit mode"; convert one table per commit and compare side by side |
| Drag conflicts with clicks (tabs navigate, chips filter, buttons in card headers) | dnd-kit activation distance (5 px) for the pointer sensor and press delay for touch; cards and sections drag only by their header, with buttons excluded |
| Esc both cancels a drag and leaves edit mode | Leave edit mode on Esc only when no drag is active |
| User hides the tab of the page they're on | Stay on the page; the tab comes back from the tray. The URL still works, since preferences never block routes |
| Stale client sends an old shape | zod rejects unknown ids and values with a 400 naming them; `version` plus `migratePreferences` cover renames |
| Two browser tabs saving at once | Last write wins (full-document PUT). Acceptable for personal settings |
| Audit noise from dragging | 400 ms debounce, and no write or audit row for an unchanged document |
| Preferences treated as permissions | Never: resolution only filters what `can()` already allows; routes keep their gates |
| Dark tokens drift between the media query and `[data-theme=dark]` | One shared selector list, not two copies |
| Sealed invoices | Not touched by this feature; no new code reads `emails.json` or `incoming_invoices/` |

---

## 10. Open questions for the team

1. **Columns:** drag the column headings (as prototyped), or add a "Columns" menu with checkboxes in edit mode as well? A menu is easier to find for hiding and restoring; dragging is still needed to reorder.
2. **Org defaults:** should a controller be able to set organization-wide defaults (section 3.4) in v1, or later?
3. **Audit log:** should preference changes show in the audit UI by default, or be filtered out unless asked for? They're recorded either way.
4. **First-time hint:** should the Customize button get a one-time "New: customize your workspace" pointer?
