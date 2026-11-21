# Live Sim build report

## Step 1: generate → iframe → sliders

**What works (stand-in mode, no key):**
- The teacher page: type a confusion and press "Create simulation". Status streams (thinking → writing, with a line count, the last lines of code and the seconds). The sim mounts in a `sandbox="allow-scripts"` iframe (no allow-same-origin) with a CSP meta and the injected bridge. The title, the question and the sliders appear on the right.
- The "Offline stand-in" badge, from `GET /api/status`. The "Interactive in X.Xs" badge on ready.
- Sliders post `setParams` and the sim answers `applied`.
- Bridge errors are caught for runtime throws (throws-broken), a missing `window.SIM` (no-sim, at 3 s), bad param ranges (bad-params, through `validateParams`) and external scripts (external-script, through the CSP `securitypolicyviolation`).
- The real Claude path (`src/lib/model/real.ts`) typechecks: streaming, adaptive thinking, cached system prompt, friendly errors. It is never called.

**Tests:** lint clean, typecheck clean, Vitest 74/74, Playwright e2e 6/6 (smoke, pendulum → ready with 4 sliders plus applied, and 4 fixture error pages).

**Stand-in timings (local dev server):** first code ~1.5 s, stream done ~4.6 s, interactive ~4.6 s. The fixture error pages: throws-broken ~0.4 s, bad-params ~0.2 s, external-script ~0.2 s, no-sim ~3.5 s.

**Surprise fixed:** bridge messages from a server-rendered iframe arrived before hydration attached the listener. SimFrame now renders client-only and listens in a layout effect.

**Needs a key:** the real `npm run try-topics` (the table below is stand-in plumbing only; the 3 reserved topics fall back to the pendulum fixture).

<!-- try-topics:start -->
### try-topics (stand-in: plumbing only, not real timings, 2026-11-21T15:32:29Z)

| Confusion | Outcome | Title | First code | Stream done | Interactive | Tokens in / out | Repaired |
| -- | -- | -- | -- | -- | -- | -- | -- |
| Why does a ball thrown at 45° go farther than one at 60°? | ready | Two Pendulums, Two Masses | 1.6 s | 4.6 s | 4.6 s | 2614 / 600 | no |
| Does a stiffer spring make the mass bounce faster or slower? | ready | Two Pendulums, Two Masses | 1.5 s | 4.6 s | 4.6 s | 2615 / 600 | no |
| When a light ball hits a heavy ball, why does the light one bounce back? | ready | Two Pendulums, Two Masses | 1.5 s | 4.6 s | 4.6 s | 2618 / 600 | no |
<!-- try-topics:end -->

## Step 2: errors + one repair

**What works (stand-in):**
- `POST /api/repair` (NDJSON) sends the failing document plus the error, with line and col, to `model.repair`.
- The session machine is `idle → streaming → mounting → ready`, with `repairing` and `failed`.
  - Any failure of produced code triggers exactly one repair: validation, a bridge error before ready, a bad params shape, an error within 2 s of ready, an error from a `setParams`, or the 8 s mount watchdog. The overlay says "Fixing a glitch…" and the broken iframe is removed.
  - A second failure goes to `failed`: a friendly message, the technical detail in small print, a "Try again" button, and no iframe.
  - Model or API errors with no code to repair go straight to `failed`.
  - Errors more than 2 s after ready are only logged.

**Tests:** lint and typecheck clean. Vitest 75/75 (adds the /api/repair route). Playwright e2e 8/8, adding `[[fixture:throws-broken]]` → repairing → ready and `[[fixture:throws-twice]]` → repairing → failed, with no iframe and "Try again".

**Stand-in timings:** throws-broken reaches ready in ~9.8 s and throws-twice fails in ~9.9 s (two 4.5 s replays plus mounts).

**Surprise fixed:** a stale `ready` from the broken frame could overwrite `repairing`, because the state ref was updated lazily inside React's updater. It is now synchronous.

**Needs a key:** the real repair rate (how often Claude's first draft needs a repair, and how often the repair works). Run `npm run try-topics` with a key; its "Repaired" column records it.

## Step 3: plain-language edits

**What works (stand-in):**
- `POST /api/edit` (NDJSON) sends the current document plus the teacher's request to `model.edit`.
- The "Ask for a change" box under the sim, enabled only when a sim is ready, runs through the same machine as generate: streaming, mounting, one repair, then failed.
- Slider values carry over by param id, but only the ones the teacher moved. Untouched sliders take the edited sim's new defaults, so "make bob B twice as heavy" visibly changes bob B.
- "Try again" after a failed edit retries the same request on the sim as it was before the edit.

**Tests:** lint and typecheck clean. Vitest 76/76 (adds /api/edit). Playwright e2e 9/9, adding pendulum → move the length slider to 2 → edit "make bob B twice as heavy" → ready. Bob B's default goes from 5 to 10 and its max from 10 to 20, length stays 2, and the question changes.

**Stand-in timings:** an edit round trip takes ~4.6 s to interactive.

**Needs a key:** how well real edits keep the contract and the param ids (the stand-in just swaps in `pendulum-edited`, or bumps the first default).

## Step 4: student links + homework

**What works (stand-in):**
- `src/lib/store.ts` stores records in `data/sims.json` (gitignored), with atomic tmp+rename writes serialised in-process and 12-hex-char ids from `crypto.randomUUID`.
- Every ready of a generate or edit saves through `POST /api/sims`, which re-validates the html and params. `GET /api/sims` lists summaries.
- `POST /api/sims/[id]/share` makes the homework once through `model.homework`, validates it (defaults clamped, snapped to the step grid, unknown ids dropped, missing ones filled), stores it and returns `/s/[id]`.
- "Share with students" copies the absolute link, or shows it selected when the clipboard is blocked.
- `/s/[id]` shows the homework question and a "Predict before you run" box. Run stays disabled until something is typed. The sim isn't mounted until Run, and then starts from the homework defaults. An unknown id gives a 404.

**Tests:** lint and typecheck clean. Vitest 82/82: the store against a temp dir (including 20 concurrent saves) and validateHomework. Playwright e2e 11/11, adding create → share → open the link → Run disabled → predict → Run → ready with the homework question and moved defaults, plus the unknown-link 404.

**Stand-in timings:** share (stand-in homework) is instant. The student Run reaches ready in ~1 s (no model call).

**Surprise:** another session stashed the loop's work and switched the shared checkout to `main`. The loop moved to its own worktree, `../codejam2026-loop-sim`.

**Needs a key:** the quality of real homework variations (a different question plus sensible new defaults).

## Step 5: saved demos + polish

**What works (stand-in):**
- `data/demos/pendulum.json` and `falling.json` are hand-made placeholders (copied from the fixtures, `handMade: true`, shown as "(placeholder)"). The "Saved demos" menu loads one to ready in ~0.3 s with zero `/api/generate`, `/api/repair` or `/api/edit` requests. A loaded demo is also saved as a sim, so it can be shared.
- "Save as demo" writes `data/demos/<slug>.json` after validating it.
- `npm run make-demos` regenerates both demos through the UI, keeping only code that reached `ready`. It skips itself in stand-in mode.
- Polish:
  - Screenshots at 1920×1080 and 1280×720 are in `progress/screens/` (teacher idle, streaming and ready; student before and after Run; failed).
  - Every visible text element is ≥ 20px. Key controls fit in both viewports; a compact mode applies below 820px tall.
  - Tab reaches every control with a ≥ 2px amber focus ring.
  - Every e2e test fails on any app console error or page error.

**Final checks:**
- lint clean, typecheck clean.
- Vitest 85/85.
- `next build` OK, 12 routes.
- Playwright e2e 17/17.
- `grep -r "ANTHROPIC\|sk-ant" .next/static` → 0 matches.
- `next start`: `/dev/fixture/*` → 404 in production, `/api/status` → `{"standIn":true}`.

**Needs a key:** `npm run make-demos`.

## Final summary

All 25 checklist items are ticked. **No items are blocked.**

**Needs key** (built, typechecked and run in stand-in mode; never called with a real key):
- **S1.8**: the real `npm run try-topics` run (projectile, spring and collision confusions), for real time to first code, stream done, interactive, tokens and repairs. The table above is stand-in plumbing only.
- **S2.3**: the real repair rate (from the try-topics "Repaired" column).
- **S5.1**: `npm run make-demos` to replace the hand-made demo placeholders with real output.
- More generally, the real Claude path in `src/lib/model/real.ts` (streaming generate, repair and edit; structured-output homework) has never run. The quality of real edits and homework variations is untested.

**To try it with a key:** put `ANTHROPIC_API_KEY` in `.env.local`, then `npm run dev`, `npm run try-topics` and `npm run make-demos`.

**Notes:**
- Mid-run, another session stashed the loop's work and switched the shared checkout to `main`. The loop continued in the worktree `../codejam2026-loop-sim`.
- At the user's request, all sim commits were then moved onto a new local branch `not_brim` (from `origin/not_brim`); `loop/sim` is untouched.
- Nothing was pushed.
- Decisions the spec didn't cover are in `progress/questions.md`.

