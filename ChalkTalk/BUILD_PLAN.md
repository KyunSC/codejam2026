# Live Sim Teaching App: Build Plan

The spec for `loops/loop-sim.md`. A teacher types what a student is confused about, Claude writes a fresh interactive Canvas simulation, the class experiments with sliders the app builds, the teacher edits it in plain language, and students get a share link with a homework variation. CodeJam 2026: all code is written from scratch during the event.

The checklist at the end is the build order.

## Stack
- Scaffold: `ChalkTalk/` already holds this file and `loops/`, which `create-next-app` refuses to overwrite. From `ChalkTalk/`, scaffold into a temp folder and move it in:
  ```bash
  npx create-next-app@latest _scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --disable-git --yes
  rsync -a _scaffold/ ./ && rm -rf _scaffold
  ```
  Then `npm install` in `ChalkTalk/` to rebuild `node_modules` links after the move.
- Deps: `@anthropic-ai/sdk`, `server-only`. Dev deps: `vitest`, `@playwright/test` (then `npx playwright install chromium`). Nothing else without logging it.
- Scripts:
  - `test` (vitest run), `e2e` (playwright test), `typecheck` (tsc --noEmit)
  - `try-topics` (scripts/try-topics.ts via Playwright)
  - `make-demos` (scripts/make-demos.ts)
- `.env.local.example` contains `ANTHROPIC_API_KEY=`. The gitignore keeps `.env*` ignored and adds `!.env.local.example`. `data/sims.json` is ignored; `data/demos/` is committed.
- `src/lib/config.ts` imports `server-only` (so does `src/lib/model/real.ts`). Client code never imports it; the client learns stand-in mode from `GET /api/status`. It holds:
  - `MODEL = "claude-sonnet-5-5"`
  - `CHAT_EFFORT = "low"` (homework answers, tool turns) and `SIM_EFFORT = "medium"` (simulation generation)
  - `MAX_TOKENS = 32000`
  - `hasKey()` (true when the key is set and not blank)
  - `useStandIn()` (`!hasKey() || process.env.FAKE_MODEL === "1"`).

## Model layer (`src/lib/model/`)
`StreamEvent` is one of:
- `{type:"status", stage:"thinking"|"writing"}`
- `{type:"delta", text}`
- `{type:"done", stopReason, usage, ms}`
- `{type:"error", message}`

Routes stream these as NDJSON (`application/x-ndjson`, one JSON object per line).

`SimModel` interface:
- `generate(prompt)`, `repair(code, error)` and `edit(code, request)`, each returning `AsyncIterable<StreamEvent>`
- `homework({code, params, question})`, returning `Promise<{question, defaults: Record<string, number>}>`.

- **`real.ts`** follows the claude-api skill:
  - Calls `client.beta.messages.stream` with `model: MODEL`, `max_tokens: MAX_TOKENS`, `thinking: {type:"adaptive"}`, `output_config: {effort: SIM_EFFORT}`, and the system prompt as a text block with `cache_control: {type:"ephemeral"}`. It also sends `betas: ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`; if the SDK types reject them, drop them and log it.
  - A `content_block_start` of type thinking becomes `status: thinking`; of type text, `status: writing`. A `text_delta` becomes a `delta`. `finalMessage()` becomes `done`.
  - The `max_tokens` and `refusal` stop reasons become an `error`. SDK error classes are mapped to friendly messages.
  - `homework` uses structured output (`output_config.format`, a JSON schema of `{question: string, defaults: object}`). Never called tonight.
- **`standin.ts`** reads fixtures from `fixtures/sims/*.html`:
  - Sends `thinking` for about 1.5 s, then `writing`, then the fixture in about 40 chunks over about 3 s, then `done` with a fake `usage`.
  - Picks the fixture by keyword match on the prompt and falls back to `pendulum`.
  - Test hook, stand-in only: `[[fixture:NAME]]` in a prompt forces that fixture.
  - `repair()`: `X-broken` becomes `X`, and `throws-twice` returns `throws-twice-2`, which is also broken.
  - `edit()`: returns `NAME-edited` if it exists; otherwise it returns the same code with the first param's default value changed, which stays valid.
  - `homework()`: a deterministic question built from the title, and defaults moved one step from each current value, kept within range.
- **`index.ts`** has `getModel()`, which returns the stand-in when `useStandIn()` and the real model otherwise.

Fixtures (hand-made, each with a header comment saying so):
- `pendulum` (the example from the system prompt) and `pendulum-edited` (bob B twice as heavy)
- `falling` (two objects dropped, with an air-resistance slider) and its fixed twin
- `throws-broken` (throws on load) and `throws`, its fixed twin
- `no-sim` (never defines SIM)
- `bad-params` (`min > max`)
- `external-script` (a `<script src=https://…>`)
- `throws-twice` and `throws-twice-2`

## The simulation contract
Claude returns ONE self-contained HTML document: inline JS and CSS, Canvas 2D only, no external resources, at most 4 parameters, 60 fps. It defines this synchronously:
```js
window.SIM = {
  title: string,
  params: [{ id, label, min, max, step, value }],   // 1–4
  question: string,
  reset(values) { ... }   // values: { [id]: number }
};
```
The app renders the sliders itself, outside the iframe, and calls `reset()` through postMessage. Generated code never builds controls.

## System prompt (verbatim into `src/lib/prompts.ts` as `SYSTEM_PROMPT`)
```
You build interactive physics simulations for a live classroom. A teacher is projecting
your work on a screen mid-lesson and has described what a student is confused about.
Write ONE small, self-contained simulation that lets the class test the idea themselves.

# Output format
Reply with a single complete HTML document and nothing else. Start with <!DOCTYPE html>
and end with </html>. No markdown fences, no text before or after.

# Hard rules — the host app breaks if any is violated
1. Self-contained: all JS and CSS inline. No external scripts, stylesheets, fonts, images,
   imports, fetch/XHR, WebSockets, workers, storage APIs, or alert/confirm/prompt.
   Network access is blocked by the page's Content-Security-Policy.
2. Rendering: one full-window <canvas>, drawn with the Canvas 2D API only. No WebGL,
   no SVG, no other visible DOM elements.
3. No controls. Do not create buttons, sliders, inputs, or any UI, and do not handle
   mouse or keyboard input. The host app reads your parameter list and builds the
   sliders itself, outside your page.
4. Define window.SIM synchronously in a top-level <script> (not in onload or a timer):
     window.SIM = {
       title: string,     // ≤ 6 words, must not give away the answer
       params: [{ id, label, min, max, step, value }],   // 1 to 4 entries
       question: string,  // one prediction question for the class
       reset(values) {}   // values = { [id]: number } with every param id
     };
   - id: unique camelCase. label: plain words with units, e.g. "Ball B mass (kg)".
   - All numbers finite; min < max; step > 0; min ≤ value ≤ max.
   - reset(values) restarts the simulation from its initial state with those values. The
     host calls it every time a slider moves, so it must be cheap, safe to call any number
     of times, and must never start a second animation loop.
5. On load, call SIM.reset with the default values yourself and start animating. Use a
   single requestAnimationFrame loop for the life of the page.
6. Smooth 60 fps: clamp the frame delta to ≤ 1/30 s and advance the physics in fixed
   sub-steps (semi-implicit Euler or velocity Verlet) so results don't depend on frame
   rate. No unbounded loops; cap any trails/histories at ~300 points.
7. Size the canvas to innerWidth × innerHeight × devicePixelRatio, use
   ctx.setTransform(dpr,0,0,dpr,0,0), and handle 'resize'. Lay out the scene relative
   to the canvas size so it fits any aspect ratio from 4:3 to 21:9.

# Teaching design
- Target the misconception directly. If the confusion compares cases (heavier vs lighter,
  steep vs shallow), show both side by side, running simultaneously, identical except for
  the variable in question.
- Params are the knobs a curious student would want to turn. Usually 2–3, never more than
  4. Always include the variable the confusion is about.
- Use correct physics in SI units with a sensible pixels-per-metre scale. Simulate with
  real equations rather than scripted animation.
- Draw live measurements on the canvas so the class can check its prediction (period,
  max height, speed, time…), with units and 1–2 decimals.
- The question asks the class to predict a specific, observable outcome before touching
  a slider, e.g. "If we make bob B five times heavier, will it reach the bottom sooner,
  later, or at the same time?" Never answer it anywhere in the sim.

# Visual style (projected in a bright room, read from the back row)
- Background #f8fafc, text #0f172a, strokes ≥ 3px, large objects with margins; nothing
  clipped at the edges.
- Text in system-ui, ≥ 20px (CSS px after the dpr transform). Labels and readouts only.
- Compared objects get strong distinct colors (#2563eb, #dc2626, #16a34a, #d97706) and
  short labels ("A", "B").
- Do not draw the title or the question: the host app already shows them next to the
  canvas.

# Layout (text must never overlap anything)
- Split the canvas into fixed, non-overlapping bands computed from W and H before drawing:
  a top band for the legend, the scene in the middle, and a bottom band for readouts.
  Give each band enough height for its text lines (lines × ~1.4 × font size) plus padding.
- The scene, its axes and their tick labels stay inside the scene band. Scale the physics
  to fit that band, not the whole canvas.
- Put the legend on one row only if it fits the width; otherwise stack it. Measure text with
  ctx.measureText and place items from those widths, never at guessed offsets.
- Readouts go in a compact grid (one column per object), at most 3 rows. If the canvas is
  short, show fewer readouts rather than shrinking text below 20px or letting it
  spill past the edge.
- Labels that follow moving objects must not cover the readouts or the legend.

# Code style
Compact: aim for under 200 lines of JavaScript, plain ES2020, minimal comments.

# Example (format only; your simulations will be about other topics, designed
# for the teacher's specific confusion)
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#f8fafc}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c"></canvas><script>
const cv=document.getElementById('c'),ctx=cv.getContext('2d');let W=0,H=0;
function resize(){const d=devicePixelRatio||1;W=innerWidth;H=innerHeight;cv.width=W*d;cv.height=H*d;ctx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',resize);resize();
const g=9.81;let p,bobs,t;
function bob(mass,color,name){return{mass,color,name,th:p.angle*Math.PI/180,w:0,cross:null,period:null};}
window.SIM={
  title:'Two Pendulums, Two Masses',
  params:[
    {id:'massA',label:'Bob A mass (kg)',min:0.5,max:10,step:0.5,value:1},
    {id:'massB',label:'Bob B mass (kg)',min:0.5,max:10,step:0.5,value:5},
    {id:'length',label:'String length (m)',min:0.5,max:3,step:0.1,value:1.5},
    {id:'angle',label:'Release angle (°)',min:5,max:60,step:5,value:20}],
  question:'Bob B is five times heavier than bob A. Released together, which one completes a swing first?',
  reset(v){p=v;t=0;bobs=[bob(p.massA,'#2563eb','A'),bob(p.massB,'#dc2626','B')];}
};
function step(b,h){b.w+=-(g/p.length)*Math.sin(b.th)*h;const prev=b.th;b.th+=b.w*h;
  if(prev<0&&b.th>=0){if(b.cross!==null)b.period=t-b.cross;b.cross=t;}}
function draw(){ctx.clearRect(0,0,W,H);const s=H*0.65/3,py=H*0.08;
  bobs.forEach((b,i)=>{const px=W*(i?0.68:0.32),x=px+Math.sin(b.th)*p.length*s,y=py+Math.cos(b.th)*p.length*s;
    ctx.strokeStyle='#0f172a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();
    ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(x,y,12+8*Math.cbrt(b.mass),0,7);ctx.fill();
    ctx.fillStyle='#0f172a';ctx.textAlign='center';ctx.font='bold 26px system-ui';ctx.fillText(b.name+': '+b.mass+' kg',px,H-72);
    ctx.font='22px system-ui';ctx.fillText('Period: '+(b.period?b.period.toFixed(2)+' s':'measuring…'),px,H-38);});}
let last=performance.now();
function frame(now){const dt=Math.min((now-last)/1000,1/30);last=now;const n=8,h=dt/n;
  for(let i=0;i<n;i++){t+=h;bobs.forEach(b=>step(b,h));}draw();requestAnimationFrame(frame);}
SIM.reset(Object.fromEntries(SIM.params.map(q=>[q.id,q.value])));requestAnimationFrame(frame);
</script></body></html>
```

User-message builders (also in `prompts.ts`):
- **generate**: `Student confusion: "<prompt>"\nWrite the simulation.`
- **repair**: the current code in a fenced block, then `It failed with: <message> (line <l>, col <c>)` and `Fix it. Keep the contract exactly and return the full document.`
- **edit**: the current code, then `Teacher's request: "<request>"` and `Return the full updated document. Change only what was asked, keep the contract, and keep existing param ids unless the request needs new ones.`
- **homework**: the code, params and class question. It asks for a *different* prediction question about the same experiment, plus new default values within the existing ranges that make the homework a variation.

## HTML handling (`src/lib/sim-html.ts`)
- `extractHtml(raw)` strips any ``` fences and slices from the first `<!DOCTYPE` (or `<html`) through the last `</html>`.
- `validateHtml(html)` returns `{ok:true} | {ok:false, reason}`. It requires `window.SIM` and a `<canvas`, rejects `<script src`, `<link`, `@import`, `<iframe`, and `http(s)://` inside `src=`/`href=`/`url(`, and caps size at 150 KB.

## Bridge (`src/lib/bridge.ts`)
`buildSrcdoc(html)` inserts these right after `<head>` (creating one if missing), before any generated script:
- `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:">`
- `<script>BRIDGE_JS</script>`

`BRIDGE_JS` works like this:
- `post(m)` calls `parent.postMessage({__simBridge:true, ...m}, "*")`.
- Listeners for `error`, `unhandledrejection` and `securitypolicyviolation` post `{type:"error", message, line, col}`.
- On `DOMContentLoaded`, it polls every 50 ms for `window.SIM` with a `params` array and a `reset` function. It then posts `{type:"ready", title, params, question}`. If nothing appears within 3 s, it posts `{type:"error", message:"SIM was not defined within 3s"}`.
- A `message` listener, when `e.source === parent` and `data.type === "setParams"`, does `try { SIM.reset(data.values); post({type:"applied", values}) } catch (err) { post error }`.

The parent accepts a message only when `e.source === iframe.contentWindow && data.__simBridge`. `validateParams(raw)` is shared and pure. It requires 1–4 params, unique ids, finite numbers, `min < max` and `step > 0`. It clamps `value` and returns either `{ok, params}` or a reason.

## Session state machine (`src/lib/useSimSession.ts`)
States: `idle → streaming → mounting → ready`, with `repairing` and `failed`.
- **streaming**: read the NDJSON stream. Track the stage, the line count, the last 8 lines of code and the elapsed time.
- **mounting**: run `extractHtml` and `validateHtml`, then mount the iframe with a new React key. Wait for the bridge.
- A **failure** is any of:
  - a validation failure
  - an `error` before `ready`
  - an invalid params shape
  - an `error` within 2 s after `ready`
  - an `error` from a `setParams`

  On the first failure it goes to `repairing` (calls `/api/repair` once, overlay says "Fixing a glitch…") and then mounts again. A second failure leads to `failed`, with a friendly message, a "Try again" button, and no broken iframe visible.
- Errors more than 2 s after `ready` are only logged.
- Timing marks are submit, first delta, stream done and `ready`. The UI shows "Interactive in X.Xs" and the console logs all four.
- Generate, repair and edit all use this same machine. Edits carry slider values over when the param ids match.

## UI
**Teacher page (`/`)**: light, high-contrast, 20px+ text, readable from the back of a classroom.
- A large prompt textarea and a "Create simulation" button across the top.
- The sim panel takes about 70% of the width and fills the remaining height. A spinner overlay covers it, with `GenerationStatus` (stage, line count, code tail, seconds), until `ready`.
- A right column holds the title, the prediction question (large) and `ParamSliders` (big thumbs, live value plus unit from the label).
- Under the sim: an "Ask for a change" input (step 3) and a "Share with students" button (step 4).
- Badges: "Offline stand-in" when the stand-in is active (exposed through `GET /api/status` → `{standIn}`), and the timing badge.
- "Saved demos" menu (step 5).

**Student page (`/s/[id]`)**: the same sim panel and sliders, and the homework question. A "Predict before you run" textarea comes with a Run button that stays disabled until the prediction is typed. The sim is covered until Run.

## Storage + routes
- `src/lib/store.ts` has `saveSim`, `getSim`, `listSims` and `updateSim` over `data/sims.json`. Writes are atomic (tmp file + rename). A record holds `{id (nanoid-like from crypto.randomUUID), prompt, code, title, params, question, homework?, createdAt}`.
- Routes all use `runtime = "nodejs"` and `dynamic = "force-dynamic"`:
  - `POST /api/generate`, `POST /api/repair` and `POST /api/edit` (NDJSON)
  - `POST /api/sims` (save) and `GET /api/sims`
  - `POST /api/sims/[id]/share` (creates the homework if missing, returns `/s/[id]`)
  - `GET /api/status`
- Saving happens on the first `ready` of each generate or edit.

## Testing
- **Vitest**: pure modules (sim-html, bridge string builder, validateParams, NDJSON, store against a temp dir, stand-in model, model selection).
- **Playwright**: config `webServer: { command: "npm run dev -- -p 3100", env: { FAKE_MODEL: "1" }, url: "http://localhost:3100", reuseExistingServer: false }`, Chromium only.
  - The tests drive the real UI and wait for the bridge state through `data-state` attributes on the sim panel (`streaming|mounting|repairing|ready|failed`).
  - Dev-only page `/dev/fixture/[name]` mounts a fixture straight into `SimFrame` (returns 404 in production) for the bridge self-tests.

## Checklist (copied into `progress/sim.md`; every item: lint + typecheck, plus the tests named)
**Phase 0: scaffold**
- [ ] Scaffold with the command above, add the deps and scripts, `.env.local.example`, the gitignore rules and `npx playwright install chromium`. Read the Next docs on route handlers, streaming and dynamic params, and log the differences.
- [ ] `lib/types.ts` and `lib/config.ts`, plus a Vitest smoke test, a Playwright config and one trivial e2e test that loads `/`.

**Step 1: generate → iframe → sliders**
- [ ] `lib/prompts.ts` (system prompt verbatim plus builders), with Vitest coverage.
- [ ] `lib/model/*` (real, stand-in, index) and all fixtures, with Vitest coverage of the stand-in and model selection.
- [ ] NDJSON helpers and `lib/sim-html.ts`, with Vitest coverage.
- [ ] `lib/bridge.ts` and `validateParams`, with Vitest coverage.
- [ ] `/api/generate` and `/api/status`.
- [ ] `useSimSession` (no repair yet), `SimFrame`, `ParamSliders`, `GenerationStatus` and the teacher page with both badges.
- [ ] Playwright:
  - pendulum → `ready`, with 4 sliders
  - moving a slider produces `applied`
  - the `/dev/fixture` pages for `throws-broken`, `no-sim`, `bad-params` and `external-script` each show an error within 3 s.
- [ ] `scripts/try-topics.ts` runs "Why does a ball thrown at 45° go farther than one at 60°?", "Does a stiffer spring make the mass bounce faster or slower?" and "When a light ball hits a heavy ball, why does the light one bounce back?" through the UI. For each it records time to first code, stream done, time to interactive, tokens, and whether a repair happened, as a table in `report.md`. Run it in stand-in mode to prove the plumbing. **The real run needs a key.**
- [ ] Step 1 report.

**Step 2: errors + one repair**
- [ ] `/api/repair` and the full state machine (repairing, failed, the 2 s window, setParams errors).
- [ ] Playwright: `[[fixture:throws-broken]]` → repaired → `ready`. `[[fixture:throws-twice]]` → `failed`, with the friendly message and no iframe visible.
- [ ] Step 2 report. **The real repair rate needs a key.**

**Step 3: plain-language edits**
- [ ] `/api/edit` and the "Ask for a change" box, through the same machine, with slider values carried over.
- [ ] Playwright: pendulum → edit "make bob B twice as heavy" → `ready`, and bob B's default has changed.
- [ ] Step 3 report.

**Step 4: student links + homework**
- [ ] `lib/store.ts`, saving on `ready`, and `/api/sims`, with Vitest coverage.
- [ ] Homework through `model.homework` and the share route, with defaults validated against the ranges.
- [ ] "Share with students" copies the link (with a fallback that selects the text), and `/s/[id]` is the student page.
- [ ] Playwright: create → share → open the link → Run is disabled → type a prediction → Run → `ready`, showing the homework question.
- [ ] Step 4 report.

**Step 5: saved demos + polish**
- [ ] `data/demos/*.json` (2 hand-made placeholders: pendulum and falling) and the "Saved demos" menu, which loads instantly with no model call (Playwright checks there's no `/api/generate` request). Add "Save as demo" and `scripts/make-demos.ts` (**needs key**).
- [ ] Polish: Playwright screenshots at 1920×1080 and 1280×720 into `progress/screens/`. Check text is ≥ 20px, focus states are visible, and the console is clean on every e2e page.
- [ ] Final: lint, typecheck, vitest, `next build`, e2e, and a clean grep of `.next/static` for "ANTHROPIC" and "sk-ant". Write `ChalkTalk/README.md` (run, add the key, try-topics, make-demos) and the final summary in `report.md`.

