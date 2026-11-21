# Sim loop progress

Spec: `Not_Brim/BUILD_PLAN.md`. Every item: lint + typecheck, plus the tests named.
Status markers: `[x]` done, `needs key`, `blocked`. Attempts counts check runs that failed.

## Phase 0: scaffold
- [x] P0.1 Scaffold, deps, scripts, `.env.local.example`, gitignore, `npx playwright install chromium`, read Next docs and log differences. Attempts: 0
- [x] P0.2 `lib/types.ts` and `lib/config.ts`, Vitest smoke test, Playwright config, one trivial e2e loading `/`. Attempts: 0

## Step 1: generate → iframe → sliders
- [x] S1.1 `lib/prompts.ts` (system prompt verbatim + builders), Vitest. Attempts: 0
- [x] S1.2 `lib/model/*` (real, stand-in, index) and all fixtures, Vitest of stand-in + model selection. Attempts: 0
- [x] S1.3 NDJSON helpers and `lib/sim-html.ts`, Vitest. Attempts: 1
- [x] S1.4 `lib/bridge.ts` and `validateParams`, Vitest. Attempts: 0
- [x] S1.5 `/api/generate` and `/api/status`. Attempts: 0
- [x] S1.6 `useSimSession` (no repair), `SimFrame`, `ParamSliders`, `GenerationStatus`, teacher page with both badges. Attempts: 0
- [x] S1.7 Playwright: pendulum → ready with 4 sliders; slider → applied; /dev/fixture error pages. Attempts: 1
- [x] S1.8 `scripts/try-topics.ts` (stand-in run proves plumbing; real run needs key). Attempts: 1 — needs key: real run
- [x] S1.9 Step 1 report. Attempts: 1

## Step 2: errors + one repair
- [x] S2.1 `/api/repair` and full state machine. Attempts: 1
- [x] S2.2 Playwright: throws-broken → repaired → ready; throws-twice → failed. Attempts: 2
- [x] S2.3 Step 2 report (real repair rate needs key). Attempts: 1 — needs key: real repair rate

## Step 3: plain-language edits
- [ ] S3.1 `/api/edit` and "Ask for a change", slider values carried over. Attempts: 0
- [ ] S3.2 Playwright: pendulum → edit → ready, bob B default changed. Attempts: 0
- [ ] S3.3 Step 3 report. Attempts: 0

## Step 4: student links + homework
- [ ] S4.1 `lib/store.ts`, save on ready, `/api/sims`, Vitest. Attempts: 0
- [ ] S4.2 Homework via `model.homework` + share route, defaults validated. Attempts: 0
- [ ] S4.3 "Share with students" copy link + fallback, `/s/[id]` student page. Attempts: 0
- [ ] S4.4 Playwright: create → share → open → Run disabled → predict → Run → ready with homework question. Attempts: 0
- [ ] S4.5 Step 4 report. Attempts: 0

## Step 5: saved demos + polish
- [ ] S5.1 `data/demos/*.json` placeholders, "Saved demos" menu (no /api/generate), "Save as demo", `scripts/make-demos.ts` (needs key). Attempts: 0
- [ ] S5.2 Polish: screenshots 1920×1080 + 1280×720, text ≥ 20px, focus visible, clean console. Attempts: 0
- [ ] S5.3 Final: lint, typecheck, vitest, next build, e2e, grep .next/static; README; final summary. Attempts: 0

## Log
- P0.1: Next.js docs read (route handlers, route segment config, dynamic routes, streaming). Differences from what I expected:
  - Next 16.4.6 + React 19.3. Scaffold enables `cacheComponents` + `partialPrefetching`; with them on, `dynamic`/`runtime` exports are removed. Turned both off (see questions.md).
  - `params` in pages/routes is a Promise (`await params`, or `use(params)` in client pages). `RouteContext<'/x/[id]'>`, `PageProps`, `LayoutProps` are global generated types (need `next typegen`).
  - Edge runtime is deprecated; nodejs is the default.
  - Streaming from route handlers: plain Web `ReadableStream` in a `Response`.
  - The scaffold writes an AGENTS.md telling agents to read the bundled docs.
- P0.2: Vitest can't import `server-only` (it throws outside the react-server condition), so `vitest.config.ts` aliases it to `test/server-only-stub.ts`. Next still enforces it in the app.
- S1.2: SDK 1.12.0 types accept `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"` on `client.beta.messages.stream/create`, so nothing was dropped. The real model is constructed in a unit test (with a fake key) but never called.
- S1.2: eslint's react-hooks rule flags the spec's `useStandIn()` as a hook when called from `getModel()`. Imported it under an alias instead of renaming the spec's export.
- S1.2: Fixtures carry `<!-- hand-made fixture: NAME -->` on line 2 (after the doctype, so `extractHtml` keeps it). The stand-in reads that name to decide repair/edit outputs. Added `falling-broken` as falling's broken twin.
- S1.3: first run failed because no-sim's header comment contained the literal text "window.SIM", which satisfied validateHtml's static check. Reworded the comment; the fixture now fails validation as intended (and still fails the bridge's 3 s check when mounted directly).
- S1.4: BRIDGE_JS and the CSP meta are injected on one line, so error line/col numbers still match the generated document. Params are JSON round-tripped inside the iframe before posting (a SIM with functions in params would otherwise throw DataCloneError). `validateParams` falls back to the id when a label is missing.
- S1.6: The session also has a parent-side 8 s mount watchdog (a frozen sim script can stop the bridge from ever answering). Stream `error` events (API failures) go straight to `failed`; there's no code to repair.
- S1.6: Root font-size is 20px, so Tailwind `text-base` = 20px; no `text-sm`/`text-xs` is used.
- S1.7: first e2e run: throws-broken, bad-params and external-script lost their bridge messages on /dev/fixture. The page is server-rendered, so the iframe ran and posted before React hydrated and attached the listener (no-sim passed only because its error comes at 3 s). Fix in SimFrame: never server-render the iframe (useSyncExternalStore client check), and attach the message listener in a layout effect. Timings from load: throws-broken ~0.4 s, bad-params ~0.2 s, external-script ~0.2 s (CSP violation), no-sim ~3.5 s (the 3 s SIM wait + page load).
- S1.7: stand-in pendulum: create → ready in ~5 s (1.5 s thinking + 3 s writing + mount).
- S1.8: try-topics runs as a Playwright test (`scripts/playwright.scripts.config.ts`), because Node 20 can't run .ts and tsx isn't a listed dep. It reads one `[sim] run {json}` console line per run from useSimSession. Stand-in: all 3 reserved topics fall back to the pendulum fixture (as intended: no fixture covers them). First code ~1.5 s, interactive ~4.6 s.
- S2.1: one repair per run. `fail()` repairs from `run.attempted` (the last document we tried to mount, even one that failed validation); `giveUp()` is terminal. While repairing, the broken iframe is unmounted (srcdoc null) so no stale errors arrive. A failRef breaks the mount↔fail↔stream callback cycle.
- S2.2: first run failed. `viewRef` was updated inside the lazy setState updater, so a `ready` from the broken frame (queued just after its error) still saw "mounting" and overwrote "repairing". Fixed: `update()` now computes the next view synchronously from viewRef and then calls setView. Stand-in: throws-broken → ready ~9.8 s (two replays); throws-twice → failed ~9.9 s.
