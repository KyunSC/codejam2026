# Sim loop progress

Spec: `Not_Brim/BUILD_PLAN.md`. Every item: lint + typecheck, plus the tests named.
Status markers: `[x]` done, `needs key`, `blocked`. Attempts counts check runs that failed.

## Phase 0: scaffold
- [x] P0.1 Scaffold, deps, scripts, `.env.local.example`, gitignore, `npx playwright install chromium`, read Next docs and log differences. Attempts: 0
- [ ] P0.2 `lib/types.ts` and `lib/config.ts`, Vitest smoke test, Playwright config, one trivial e2e loading `/`. Attempts: 0

## Step 1: generate → iframe → sliders
- [ ] S1.1 `lib/prompts.ts` (system prompt verbatim + builders), Vitest. Attempts: 0
- [ ] S1.2 `lib/model/*` (real, stand-in, index) and all fixtures, Vitest of stand-in + model selection. Attempts: 0
- [ ] S1.3 NDJSON helpers and `lib/sim-html.ts`, Vitest. Attempts: 0
- [ ] S1.4 `lib/bridge.ts` and `validateParams`, Vitest. Attempts: 0
- [ ] S1.5 `/api/generate` and `/api/status`. Attempts: 0
- [ ] S1.6 `useSimSession` (no repair), `SimFrame`, `ParamSliders`, `GenerationStatus`, teacher page with both badges. Attempts: 0
- [ ] S1.7 Playwright: pendulum → ready with 4 sliders; slider → applied; /dev/fixture error pages. Attempts: 0
- [ ] S1.8 `scripts/try-topics.ts` (stand-in run proves plumbing; real run needs key). Attempts: 0
- [ ] S1.9 Step 1 report. Attempts: 0

## Step 2: errors + one repair
- [ ] S2.1 `/api/repair` and full state machine. Attempts: 0
- [ ] S2.2 Playwright: throws-broken → repaired → ready; throws-twice → failed. Attempts: 0
- [ ] S2.3 Step 2 report (real repair rate needs key). Attempts: 0

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
