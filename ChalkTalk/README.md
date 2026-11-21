# Live Sim

A big whiteboard shared by a student and Claude. The student types notes, handwrites with a pen, and places interactive simulations. When the student presses **Ask Claude**, Claude reads the whole board and its changelog (handwriting included, from a picture of it) and works on the board through board tools: it writes and edits notes, adds simulation boxes, changes them and sets their sliders, and moves or removes items. The same tools are an MCP server, so Claude Code or Claude Desktop can work on a board too. Each simulation box is a fresh Canvas simulation Claude writes for the confusion ("Does a heavier pendulum swing faster?"), with sliders the app builds from it. Built from scratch for CodeJam 2026. The original single-simulation spec is in [BUILD_PLAN.md](BUILD_PLAN.md).

## Run it

```bash
npm install
npx playwright install chromium   # only needed for the tests and scripts
npm run dev                        # http://localhost:3000: your whiteboards
```

Without a key the app runs the **offline stand-in**: it replays hand-made simulations from `fixtures/sims/` at a realistic pace, answers "Ask Claude" with a fixed reply note (plus a simulation when your words name a topic it has, like pendulums or falling objects), and the page shows an "Offline stand-in" badge. It can't read handwriting.

## Add the key

```bash
cp .env.local.example .env.local
# then set ANTHROPIC_API_KEY=... in .env.local (it's gitignored)
```

Restart `npm run dev`. The badge disappears and Ask Claude, generate, repair, edit and homework go to Claude (`claude-sonnet-5-5`, adaptive thinking, streaming). The key is only read on the server (`src/lib/config.ts`, `src/lib/model/real.ts`). The browser only learns whether the stand-in is active, through `GET /api/status`. `FAKE_MODEL=1` forces the stand-in even when a key is set.

## Deploy (Vercel)

Set these in the Vercel project's Environment Variables, then redeploy:

| Variable | Needed for |
| -- | -- |
| `DATABASE_URL` | Boards, saved sims (homework links) and saved demos. A Postgres connection string, e.g. a Neon pooled URL with `?sslmode=require`. The app creates its `livesim_*` tables on first use. Without it the deployed app can't save and says so. |
| `ANTHROPIC_API_KEY` | Real Claude. Without it the app runs the offline stand-in. |

Vercel's filesystem is read-only and not shared between function instances, so the JSON files under `data/` only work locally. Locally, leave `DATABASE_URL` blank to keep using them. To run the Postgres store tests: `TEST_DATABASE_URL=postgres://… npm test`.

## Use it

- **My whiteboards** (`/`): the boards made or opened in this browser (there are no accounts; the list is kept in the browser), **New whiteboard**, and the **demo whiteboards**, which open as your own copy with their simulation already running. `/new` starts an empty board straight away.
- **The toolbox bar**: back to your boards, the board's title (click to rename), then **Select** (V), **Pen** (P, with colours), **Eraser** (E: removes the strokes it passes over), **Note** (N: click to place, then type), **Simulation** (S: a popup asks what to show, then the model writes it), and zoom out / reset / in. Scroll to pan, ctrl/cmd + scroll to zoom, or drag empty space with Select. With Select, drag an item by its top bar, resize from the corner, and delete with × or the Delete key.
- **Saving and changes from others**: the page sends only what changed, and the server applies it on top of the latest board, so changes Claude or an MCP client made meanwhile survive. The page checks for newer versions every two seconds. Every change goes into the board's **changelog** (who did what, newest last), which Claude reads.
- **Ask Claude**: optionally type a message, then press the button. Claude gets every item (who made it, where, its text, each sim's title, question and slider values), the changelog and a picture of the board, then acts through the board tools, seeing each tool's result, for up to six rounds. Steps that didn't work are listed under the button. Claude's items have blue borders.
- **In a simulation box**: one automatic repair if it breaks ("Fixing a glitch…"), then "Try again". **Change** asks for a plain-language edit (moved sliders keep their values). **Share with students** makes a homework variation and copies an unlisted homework link; students write a prediction before Run reveals the sim.
- **Class predictions** appear under the sliders in each shared box. The count in the box header jumps to the panel. Reload or bookmark the board to return to it.
- Students can scan the share QR, add their name, predict before Run, and send a reflection afterward. Anyone with the homework link can submit and read answers. Older ID-only links open in practice mode.

## MCP server

`POST /api/mcp` is an MCP server (Streamable HTTP, JSON replies, no sessions). Its tools: `create_board`, `list_demo_boards`, and the board tools Ask Claude uses, each taking a `board_id` (the 12 characters after `/b/` in a board's address): `get_board`, `get_changelog`, `add_note`, `update_note`, `add_sim`, `edit_sim`, `set_sliders`, `move_item`, `delete_item`, `rename_board`. Changes show up on an open board within a few seconds and are logged as Claude's. A simulation added this way is written by the browser that has the board open.

```bash
claude mcp add --transport http livesim http://localhost:3000/api/mcp
```

There's no sign-in: anyone with a board's id can change it, the same as anyone with its link.

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
- `src/lib/db.ts`: picks Postgres (`DATABASE_URL`) or the JSON files. Locally, `data/boards.json` and `data/sims.json` (gitignored) store boards and saved sims (with their predictions); `data/demos/` (committed) holds the shipped demos, and demos saved on a deployment go to Postgres.
- `src/components/ClassPredictions.tsx` displays live answers from the prediction routes.
- `progress/`: the build log (`sim.md`), decisions (`questions.md`), the report (`report.md`) and screenshots.
