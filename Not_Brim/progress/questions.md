# Decisions made without a human

Each entry: the question, what the loop chose, why.

## P0.1 Scaffold folder name
The spec's `_scaffold` folder name is rejected by create-next-app ("name cannot start with an underscore"). Used `scaffold-tmp` instead, then rsync'd it in and renamed the package to `live-sim`.

## P0.1 cacheComponents is on by default
create-next-app (Next 16.4.6) writes `cacheComponents: true` + `partialPrefetching: true`. With Cache Components on, the `runtime` and `dynamic` route segment exports are rejected, but the spec requires `runtime = "nodejs"` and `dynamic = "force-dynamic"` on every route. Chose: turn cacheComponents/partialPrefetching off (previous caching model), keep the spec's exports.

## P0.1 Running the .ts scripts
Node here is v20.20, which has no `--experimental-strip-types`, and `tsx` isn't an allowed dependency. Chose: `try-topics` and `make-demos` run through Playwright's own TS runner with `scripts/playwright.scripts.config.ts` (it starts its own server on port 3100). `make-demos` calls the app's HTTP API instead of importing server-only modules.

## P0.1 Typecheck script
`LayoutProps`/`PageProps`/`RouteContext` are generated types, so `typecheck` is `next typegen && tsc --noEmit`.

## P0.1 Fonts
Dropped the scaffold's `next/font/google` (Geist) so builds don't need the network; the app uses system-ui like the sims. Root font size is 20px for back-row readability.
## S1.2 Which fixture is "falling"'s fixed twin?
The spec says "`falling` ... and its fixed twin". Read as: `falling-broken` (throws on load) repairs to `falling`, matching the `X-broken → X` rule.

## S1.2 How does the stand-in know which fixture it is repairing/editing?
Each fixture has a `<!-- hand-made fixture: NAME -->` comment; `repair()`/`edit()` read it. Code with no marker is returned unchanged by repair and gets the first-default bump on edit.

## S1.2 Real-model homework schema
`defaults` is an object whose properties are generated from the sim's param ids (all required, additionalProperties false), since structured outputs need closed objects. It's still `{question: string, defaults: object}`.
## S1.6 Carrying slider values over on edit vs. "bob B's default has changed"
Carrying every matching value over would hide the edited default (massB stays 5). Chose: carry over only values the teacher moved away from the previous defaults; untouched sliders take the new defaults.

## S1.6 Stream errors before any code
A model/API error in the stream (no code yet) goes to `failed` directly; repair only applies to code that was produced and then failed.

## S1.6 Mount watchdog
Not in the spec. If the bridge never answers within 8 s of mounting (e.g. an infinite loop freezes the iframe), it counts as a failure. The bridge's own 3 s SIM check still fires first in normal cases.

## S1.8 needs key: real try-topics run
The stand-in run proves the plumbing (table in report.md). Run `npm run try-topics` with ANTHROPIC_API_KEY set in `.env.local` to measure Claude. The script overwrites the table between its markers.

## S1.8 How the scripts run
Node 20 has no TS stripping and tsx isn't in the dep list, so `scripts/*.ts` are Playwright tests run with `scripts/playwright.scripts.config.ts` (its own dev server on :3100). Timings come from a `[sim] run {...}` console line the session logs on every ready/failed.

## S2.3 needs key: real repair rate
The stand-in only proves the repair plumbing. The real first-draft failure rate and repair success rate come from `npm run try-topics` with a key (the "Repaired" column).

## S3.1 "Try again" after a failed edit
The spec only gives "Try again". Chose: it re-runs the last action. For an edit, that is the same request on the snapshot taken before the edit; the previous sim isn't restored automatically.

## S4.1 "Saving happens on the first ready"
If a sim reaches ready, then fails within the 2 s window and is repaired, the run gets a second ready. Chose: save on every ready of a generate or edit run (a new record each time), so the share button always points at the code on screen. The extra records are harmless.

## S4.3 "The sim is covered until Run"
Chose: don't mount the iframe until Run (the panel shows a message instead). This is simpler than an overlay over a running sim and stops students peeking or interacting early. After Run the prediction stays visible, read-only.

## S4.4 Checkout switched under the loop
Another session stashed loop/sim's uncommitted changes and checked the shared checkout out to `main`. The loop now works in the worktree `/Users/sunnychen/Developer/PersonalProjects/codejam2026-loop-sim` (branch loop/sim). Nothing on main was touched. Left in place: `stash@{0}` (already re-applied and committed here, so it can be dropped), and untracked leftovers in the main checkout's `Not_Brim/` (node_modules, data/, e2e/student.spec.ts, test-results/).

## S5.1 needs key: make-demos
`npm run make-demos` (with a key in `.env.local`) generates the pendulum and falling confusions through the UI and saves exactly the code that reached `ready` to `data/demos/{pendulum,falling}.json`. Without a key it skips, so the hand-made placeholders stay.

## S5.1 Demo storage and "Save as demo"
Not specified. Chose: one JSON per demo in data/demos/<slug>.json (slug from the title, or given explicitly by make-demos), validated (html, params, slug) both on read and on save. Files that fail validation are hidden from the menu.

## Vercel storage: `pg` dependency added
The deployed app (Vercel) returned HTTP 500 on every save: the JSON-file stores write under the project folder, which is read-only there, and /tmp isn't shared between instances. Chose: Postgres through `pg` (node-postgres) when `DATABASE_URL` is set, the JSON files otherwise. `pg` is the driver Brim's Prisma adapter already uses. Tables are created on first use (`livesim_boards`, `livesim_sims`, `livesim_demos`), prefixed so they can share a database with Brim.
