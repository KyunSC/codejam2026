# Live Sim

A teacher types what a student is confused about ("Does a heavier pendulum swing faster?"). Claude writes a fresh interactive Canvas simulation, the class experiments with sliders the app builds from it, the teacher edits it in plain language, and students get a share link with a homework variation. Built from scratch for CodeJam 2026. The spec is in [BUILD_PLAN.md](BUILD_PLAN.md).

## Run it

```bash
npm install
npx playwright install chromium   # only needed for the tests and scripts
npm run dev                        # http://localhost:3000
```

Without a key the app runs the **offline stand-in**: it replays hand-made simulations from `fixtures/sims/` at a realistic pace, and the page shows an "Offline stand-in" badge. Everything works except real generation.

## Add the key

```bash
cp .env.local.example .env.local
# then set ANTHROPIC_API_KEY=... in .env.local (it's gitignored)
```

Restart `npm run dev`. The badge disappears and generate, repair, edit and homework go to Claude (`claude-sonnet-5-5`, adaptive thinking, streaming). The key is only read on the server (`src/lib/config.ts`, `src/lib/model/real.ts`). The browser only learns whether the stand-in is active, through `GET /api/status`. `FAKE_MODEL=1` forces the stand-in even when a key is set.

## Use it

- **Create simulation**: type the confusion and press Enter. You see the stages, the line count and the last lines of code as they stream, then "Interactive in X.Xs".
- **Sliders**: on the right, with live values. The sim runs in a `sandbox="allow-scripts"` iframe with a strict CSP and no network access.
- **If it breaks**: one automatic repair ("Fixing a glitch…"). If that fails too, a friendly message and "Try again".
- **Ask for a change**: plain-language edits. Sliders you moved keep their values; the rest take the new defaults.
- **Share with students**: makes a homework variation (a new question and new starting values) and copies a `/s/<id>` link. Students must write a prediction before Run reveals the sim.
- **Saved demos**: loads a stored sim instantly, with no model call. **Save as demo** adds the current one.

## Scripts

| Command | What |
| -- | -- |
| `npm run lint`, `npm run typecheck` | ESLint, then route typegen plus `tsc --noEmit` |
| `npm test` | Vitest (pure modules, stores, routes, stand-in) |
| `npm run e2e` | Playwright against its own dev server on :3100, in stand-in mode. Fails on any app console error |
| `npm run try-topics` | Runs three physics confusions (projectile, spring, collision) through the UI and writes time to first code, stream done, interactive, tokens and repairs into `progress/report.md`. Needs a key for real numbers; without one it only proves the plumbing |
| `npm run make-demos` | Regenerates `data/demos/pendulum.json` and `falling.json` with the real model, keeping only code that reached `ready`. Needs a key; skips itself otherwise, leaving the hand-made placeholders |

Both scripts start their own dev server on port 3100 (see `scripts/playwright.scripts.config.ts`), so stop anything else using that port first.

## Layout

- `src/lib/useSimSession.ts`: the client state machine (streaming → mounting → ready, with repairing and failed).
- `src/lib/bridge.ts`: the iframe bridge, CSP and `validateParams`.
- `src/lib/model/`: the real Claude model, the stand-in, and the selection between them.
- `src/app/api/*`: NDJSON routes for generate, repair and edit, plus sims, share, demos and status.
- `data/sims.json` (gitignored) stores saved sims; `data/demos/` (committed) holds the demos.
- `progress/`: the build log (`sim.md`), decisions (`questions.md`), the report (`report.md`) and screenshots.
