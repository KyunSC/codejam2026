# Live Sim

A big whiteboard shared by a student and Claude. The student types notes, handwrites with a pen, and places interactive simulations. When the student presses **Ask Claude**, Claude reads the whole board (handwriting included, from a picture of it) and answers on the board: it writes notes, adds simulation boxes, and changes the ones it made. Each simulation box is a fresh Canvas simulation Claude writes for the confusion ("Does a heavier pendulum swing faster?"), with sliders the app builds from it. Built from scratch for CodeJam 2026. The original single-simulation spec is in [BUILD_PLAN.md](BUILD_PLAN.md).

## Run it

```bash
npm install
npx playwright install chromium   # only needed for the tests and scripts
npm run dev                        # http://localhost:3000 opens a new board
```

Without a key the app runs the **offline stand-in**: it replays hand-made simulations from `fixtures/sims/` at a realistic pace, answers "Ask Claude" with a fixed reply note (plus a simulation when your words name a topic it has, like pendulums or falling objects), and the page shows an "Offline stand-in" badge. It can't read handwriting.

## Add the key

```bash
cp .env.local.example .env.local
# then set ANTHROPIC_API_KEY=... in .env.local (it's gitignored)
```

Restart `npm run dev`. The badge disappears and Ask Claude, generate, repair, edit and homework go to Claude (`claude-sonnet-5-5`, adaptive thinking, streaming). The key is only read on the server (`src/lib/config.ts`, `src/lib/model/real.ts`). The browser only learns whether the stand-in is active, through `GET /api/status`. `FAKE_MODEL=1` forces the stand-in even when a key is set.

## Use it

- **The board**: `/` makes a new board and opens it at `/b/<id>`. It saves itself (the "Saved" label). Scroll to pan, ctrl/cmd + scroll to zoom, or drag empty space with Select.
- **Note**: pick Note, click the board, type. **Pen**: pick Pen and write; strokes made close together form one handwriting item. **Select**: drag an item by its top bar, resize from the corner, and delete with × or the Delete key.
- **Add simulation**: describe a confusion in the toolbar. The box shows the stages and code as they stream, then runs the sim in a `sandbox="allow-scripts"` iframe (strict CSP, no network) with its sliders beside it.
- **Ask Claude**: optionally type a message, then press the button. Claude gets every item (who made it, where, its text, each sim's title, question and slider values) and a picture of the board, and answers with actions the page applies: add or update a note, add a simulation, change one of its simulations, move or delete its items. Claude can't change what the student made; skipped actions are listed under the button. Claude's items have blue borders.
- **In a simulation box**: one automatic repair if it breaks ("Fixing a glitch…"), then "Try again". **Change** asks for a plain-language edit (moved sliders keep their values). **Share with students** makes a homework variation and copies an unlisted homework link; students write a prediction before Run reveals the sim. **Save as demo** adds the sim to the demos.
- **Saved demos**: places a stored sim on the board instantly, with no model call.
- **Class predictions** appear under the sliders in each shared box. The count in the box header jumps to the panel. Reload or bookmark the board to return to it.
- Students can scan the share QR, add their name, predict before Run, and send a reflection afterward. Anyone with the homework link can submit and read answers. Older ID-only links open in practice mode.

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

- `src/lib/board.ts`: board items (note, ink, sim), their checks, the text Claude reads, and how Claude's actions apply. `src/lib/board-image.ts` draws the picture Claude reads.
- `src/components/BoardApp.tsx` and `src/components/board/`: the board, notes, handwriting and simulation boxes.
- `src/lib/useSimSession.ts`: the client state machine each simulation box runs (streaming → mounting → ready, with repairing and failed).
- `src/lib/bridge.ts`: the iframe bridge, CSP and `validateParams`.
- `src/lib/model/`: the real Claude model, the stand-in, and the selection between them.
- `src/app/api/*`: NDJSON routes for board-turn (Ask Claude), generate, repair and edit, plus boards, sims, share, demos and status.
- `data/boards.json` and `data/sims.json` (gitignored) store boards and saved sims; `data/demos/` (committed) holds the demos.
- `src/components/ClassPredictions.tsx` displays live answers from the prediction routes.
- `progress/`: the build log (`sim.md`), decisions (`questions.md`), the report (`report.md`) and screenshots.
