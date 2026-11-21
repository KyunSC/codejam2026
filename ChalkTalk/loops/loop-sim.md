# Loop: live-sim teaching app (overnight, unattended)

Branch: `loop/sim` · Spec: `ChalkTalk/BUILD_PLAN.md` (all 5 steps, no pauses) · Runs without an Anthropic API key: the app uses a stand-in model that replays hand-made sims.

Before starting (5 minutes, then walk away):
- From the repo root, on `main`: `git switch -c loop/sim`. `BUILD_PLAN.md` and this file come along even if they aren't committed yet; the loop commits them with its first item.
- Do not create `ChalkTalk/.env.local`. With no key, the app runs the stand-in and shows an "Offline stand-in" badge.
- Keep the laptop plugged in with the lid open, on a connection that won't drop. The first items download npm packages and Chromium.
- Start Claude Code inside `tmux` under `caffeinate`, so the machine can't sleep and the loop survives an accidental terminal close:

  ```bash
  tmux new -s loop-sim
  caffeinate -is claude
  ```

  On Linux use `systemd-inhibit claude`; on Windows use PowerToys Awake or set sleep to "Never".
- In Claude Code, open `/config` and check that auto-compact is on. Then press shift+tab to switch to auto mode, so npm, npx, git and Playwright don't stall on permission prompts.
- Paste the block below, then detach with `Ctrl-b d`. Reattach in the morning with `tmux attach -t loop-sim`.

Paste the block below into Claude Code:

```
/loop You are building the live-sim teaching app in ChalkTalk/ on branch loop/sim, unattended overnight. Nobody will answer questions: decide, log, keep going.
CodeJam rules: write all code from scratch. Never copy from Brim/ or anywhere else, and never modify anything outside ChalkTalk/.
Spec: ChalkTalk/BUILD_PLAN.md. Its checklist order is the build order. If BUILD_PLAN.md or loops/loop-sim.md is untracked, commit them with the first item.
Before writing routes or pages, read the relevant guide in ChalkTalk/node_modules/next/dist/docs/: this Next.js may be newer than you know. Before writing any Anthropic SDK code, load the claude-api skill and follow it.
Each run:
1. Read ChalkTalk/progress/sim.md. If it is missing, create it from the spec's checklist, with Attempts: 0 on each item.
2. Take the first item that is neither ticked, "needs key" nor "blocked". Implement it.
3. Run the checks it names. Every item needs lint and typecheck; add vitest and playwright where listed.
4. Commit with a clear message, tick the item and log anything surprising.
When a step's last item is ticked, append that step's report to ChalkTalk/progress/report.md: what works, test results, stand-in timings, and what needs a key. Then go straight on to the next step.
No API key: treat ANTHROPIC_API_KEY as missing when it is unset or blank after trimming. The app then uses the stand-in model from the spec and shows an "Offline stand-in" badge. Write the real Claude path anyway and make it typecheck, but never call it. Mark anything that needs a real generation "needs key" in sim.md and questions.md.
Staying unstuck:
- If an item's checks still fail after 3 runs (count them in sim.md), revert its uncommitted changes. Mark it "blocked" with the last error in sim.md and questions.md, and move on. Later items may stub what it would have provided.
- Never use interactive commands. Pass --yes or explicit flags (create-next-app, npx), and never start an editor or a pager (git --no-pager, GIT_EDITOR=true).
- Never leave a dev server running. Playwright starts and stops its own server through webServer on port 3100. Before e2e, free that port if it's taken (lsof -ti :3100 | xargs kill).
- Give long commands a timeout. If npm or the Chromium download fails on the network, retry once, then mark the item blocked.
Hard rules:
- The key is read only in server code: src/lib/config.ts and src/lib/model/real.ts import "server-only", and the client learns stand-in mode only from GET /api/status. Never print, log or commit env values. .env.local stays gitignored; only .env.local.example is committed.
- The iframe is sandbox="allow-scripts" with no allow-same-origin, ever. Never loosen the sim contract to make a fixture pass.
- Stand-in fixtures are hand-written and marked "hand-made" in a header comment. None of them may be about projectile motion, springs or elastic collisions (those topics are reserved for the real-model test).
- Dependencies: only those the spec lists. If you need another, log it in questions.md and work around it.
- One commit per item on loop/sim. Never push, never force-push, never touch main, never rewrite history.
- If the spec doesn't cover a decision, write it in ChalkTalk/progress/questions.md, choose the simplest option that keeps the contract, and move on.
Stop the loop when every item is ticked, "needs key" or "blocked", and the final item's checks have been run. That means lint, typecheck, vitest, next build, playwright e2e, and no "ANTHROPIC" or "sk-ant" in .next/static. report.md must then have a section for each of the 5 steps and a summary listing every blocked and needs-key item.
```

In the morning:
- `ChalkTalk/progress/report.md`: what got built, test results per step, and the blocked and needs-key lists.
- `ChalkTalk/progress/questions.md`: decisions the loop made without you.
- `git log --oneline main..loop/sim`: one commit per item.
- To try it with a real model, put `ANTHROPIC_API_KEY=...` in `ChalkTalk/.env.local`, then run `npm run dev`. `npm run try-topics` times projectile motion, springs and elastic collisions end to end, and `npm run make-demos` replaces the placeholder demos with real ones.
