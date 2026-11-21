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
