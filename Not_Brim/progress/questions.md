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
