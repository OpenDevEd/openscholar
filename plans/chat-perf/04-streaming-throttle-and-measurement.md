# Plan 04 — Server Streaming Throttle + End-to-End Measurement + React Compiler Opt-out Verification

**Depends on:** 01, 02, 03 (all three must be in for end-to-end measurement to be meaningful). **Blocks:** nothing (terminal plan).

## Goal

Raise the Convex streaming throttle from 100ms → 250ms (library default). Record quantitative perf measurements at 1k rows to validate the plan set's design decisions and catch regressions. Verify the React Compiler opt-out applied in plan 02 is actually firing (and do a broader audit for other files where the Compiler may be over-memoizing Convex-driven hooks).

Implements decisions **D6** (server throttle 100→250ms), **D10** verification (React Compiler opt-out verified), closes the plan set.

## Scope

**In scope**

- One-line change in `convex/chat/messages.ts:178`: `throttleMs: 100` → `throttleMs: 250`. Ship a deploy; measure.
- Add a perf benchmark suite under `tests/perf/chat-perf.bench.ts` using `vitest`'s `bench()` API. These do NOT run on the default `npm test` — they run via `npm run test:perf` (new script).
- Verify the `'use no memo'` pragma in `sources-panel-list-virtual.tsx` is effective. If the React Compiler is NOT actually enabled in `next.config.js` (the `babel-plugin-react-compiler` dep is present but may not be wired), document that and leave the pragma as insurance.
- Sweep audit: read `next.config.js` (or `next.config.ts` / `.mjs`) and the babel/swc config to confirm the compiler status.
- Document the measurement baseline: what were filter keystroke / row toggle / streaming tick times before and after plans 01-03.
- Document one perf budget per acceptance criterion so regressions can be caught.

**Out of scope**

- Any further component refactors — all plans before this one did them.
- Opting out of the React Compiler on other files (only do this if the measurement shows a concrete regression, to avoid cargo-cult pragmas).
- Tuning the virtualizer's `estimateSize` / `overscan` beyond what measurement calls for.
- Web-worker filter (measurement should confirm it's not needed at 1k; only consider if we ever go to 5k+).

## Design

### 1. The server throttle change

File: `convex/chat/messages.ts:178`.

Current code (reconstructed from verification agent — read the file to confirm exact surrounding):

```ts
// ...
saveStreamDeltas: {
  chunking: 'word',
  throttleMs: 100,
},
// ...
```

Target:

```ts
saveStreamDeltas: {
  chunking: 'word',
  throttleMs: 250,   // library default; was 100, 2.5x more frequent than needed.
},
```

Deploy: `npx convex deploy` (or via pm2's `dev:convex` watcher). No client change needed.

Why 250ms specifically: it's the `@convex-dev/agent` default (verified in `node_modules/@convex-dev/agent/src/client/streaming.ts:134-162`). Written by the library maintainers who know their streaming pipeline. If the streaming feels "laggy" after deploy, try 200ms before 150ms — every 50ms saved is a render tick we don't have to pay for.

**Perceptible effect**: the assistant's text appears in slightly chunkier increments (4× per second instead of 10×). Given messages are "not very long" (user confirmation), this is imperceptible for the human reader but a 2.5× reduction in `useUIMessages` full-list rebuilds.

### 2. React Compiler status audit

Commands (run at plan execution time, not now):

```bash
# Check next.config for reactCompiler flag
grep -r 'reactCompiler' next.config.{js,ts,mjs}

# Check for babel config that includes react-compiler
cat babel.config.{js,mjs,json} 2>/dev/null
cat .babelrc{,.json,.js} 2>/dev/null

# Check package.json scripts / swc.config
grep -E 'react-compiler|reactCompiler' package.json
```

**Three possible outcomes:**

1. **Compiler is enabled** — `next.config.js` has `experimental.reactCompiler = true` (or equivalent). The `'use no memo'` pragma in plan 02 is necessary and active. Continue to D10 verification.
2. **Compiler is NOT enabled** — plugin is installed but unwired. The pragma in plan 02 is defensive. Document in this plan's execution log: "Compiler not wired as of plan 04; pragma retained for the day it is." No further action.
3. **Ambiguous** — next.config is generated or wrapped. Investigate via agent and document the finding.

### 3. React Compiler opt-out verification (if enabled)

If outcome (1), verify the pragma is doing its job:

- Temporarily remove the `'use no memo'` from `sources-panel-list-virtual.tsx`.
- Run the dev server; scroll the sources list.
- Observe (via React DevTools profiler or console warnings): do we see the virtualizer's internal state getting stuck? Does the scroll break?
- If yes → the pragma is working when present; reinstate it.
- If no → the Compiler's interaction with this version of `@tanstack/react-virtual` is fine; the pragma is superfluous but harmless. Decision: keep it anyway as a defensive forward-compat marker (issue #1119 is still open).

Document the result in this plan's commit message.

### 4. Benchmark suite — `tests/perf/chat-perf.bench.ts`

```ts
import { bench, describe } from 'vitest';
import { stabilizeRowsById } from '@/lib/chat/stabilize-rows';
import { runWeightedSearch } from '@/lib/chat/search/source-scorer';
import { sortByComparator } from '@/lib/chat/sort/source-comparators';
import { makeFakeRows } from './fixtures/fake-rows';

describe('stabilizeRowsById @ N=1000', () => {
  const prev = makeFakeRows(1000);
  const nextSame = prev.slice();                          // same content, identity-stable already
  const nextOneChanged = prev.map((r, i) =>
    i === 500 ? { ...r, included: !r.included } : r,
  );

  bench('zero changes — fully stable', () => {
    stabilizeRowsById(prev, nextSame);
  });

  bench('one row changed', () => {
    stabilizeRowsById(prev, nextOneChanged);
  });
});

describe('runWeightedSearch @ N=1000', () => {
  const rows = makeFakeRows(1000);
  bench('short query (3 chars)', () => {
    runWeightedSearch(rows, 'pho');
  });
  bench('long query (12 chars)', () => {
    runWeightedSearch(rows, 'photosynth');
  });
  bench('no match', () => {
    runWeightedSearch(rows, 'zzzzzz');
  });
});

describe('sortByComparator @ N=1000', () => {
  const rows = makeFakeRows(1000);
  bench('added asc', () => {
    sortByComparator(rows, 'added', 'asc');
  });
  bench('title asc', () => {
    sortByComparator(rows, 'title', 'asc');
  });
  bench('inContext desc', () => {
    sortByComparator(rows, 'inContext', 'desc');
  });
});
```

Run via:

```bash
npx vitest bench --config vitest.perf.config.ts
```

Create `vitest.perf.config.ts` (new) with:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    include: ['tests/perf/**/*.bench.ts'],
    globals: false,
  },
});
```

Add the script to `package.json`:

```json
"test:perf": "vitest bench --config vitest.perf.config.ts"
```

**What we expect to see** (approximate, for a baseline; re-measure locally):

| Benchmark | Target |
|---|---|
| `stabilizeRowsById` zero changes @ N=1000 | < 0.5ms/op |
| `stabilizeRowsById` one change @ N=1000 | < 0.5ms/op |
| `runWeightedSearch` short query @ N=1000 | < 5ms/op |
| `sortByComparator` @ N=1000 | < 2ms/op |

If any is >> the target, that's the next perf issue to hunt.

### 5. End-to-end render benchmarks (optional, harder to automate)

Set up a Playwright trace benchmark:

```ts
// tests/perf/chat-perf.e2e.ts  (separate file, manual invocation)
test('sources panel handles 1000 papers', async ({ page }) => {
  await page.goto('/chat/mock-chat-1000');
  const start = Date.now();
  await page.fill('input[type="search"]', 'photo');
  await page.waitForSelector('[data-search-deferred="false"]');
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(250);                          // target: < 250ms
});
```

Requires a Convex seed that creates a job with 1000 chat papers. Gate on availability of the seed; if not trivial to set up, defer to a later plan.

### 6. Measurement report template

After running the benchmarks, commit the following as `plans/chat-perf/MEASUREMENT.md`:

```md
# Chat-Perf Measurement Report (YYYY-MM-DD)

## Environment
- Machine: <MBP spec>
- Node: <version>
- React: 19.2.x
- Next: 16.2.x
- @tanstack/react-virtual: 3.13.x
- convex: 1.35.x
- @convex-dev/agent: 0.6.x

## Benchmarks (vitest bench)

| Benchmark | Before plan set | After plan set | Δ |
|---|---|---|---|
| stabilizeRowsById zero changes @ 1k | N/A (new) | 0.xx ms/op | — |
| stabilizeRowsById one change @ 1k   | N/A (new) | 0.xx ms/op | — |
| runWeightedSearch 3 chars @ 1k       | N/A       | x.xx ms/op | — |
| sortByComparator title asc @ 1k      | N/A       | x.xx ms/op | — |

## Manual scroll / type tests at 1000 papers

| Action | Before | After |
|---|---|---|
| Filter keystroke — input-to-list-settle | Nms | Nms |
| Row toggle — click-to-settled | Nms | Nms |
| Scroll 1000-row list | Stutter / smooth | Smooth |
| Streaming 500-word response | Stutter / smooth | Smooth |

## React Compiler status
- enabled: yes/no (where)
- 'use no memo' on sources-panel-list-virtual: <necessary / defensive>

## Convex subscription count at mount (React DevTools)
- Before plan 01: 4 subscriptions to listChatSourcesWithInclusion
- After plan 01: 1

## Notes
...
```

### 7. Perf budgets (documented acceptance criteria)

For future regression guards:

- **`stabilizeRowsById` @ N=1000, zero changes**: ≤ 1ms/op (budget 2×)
- **`runWeightedSearch` 3-char query @ N=1000**: ≤ 10ms/op
- **DOM nodes for 1k-paper sources list**: ≤ 30 `[role="option"]` elements
- **Subscriptions to `listChatSourcesWithInclusion` per ChatJobView mount**: exactly 1
- **Streaming server throttle**: 250ms (library default)

## TDD sequence

**None.** No new pure logic.

## Files touched

### New

- `tests/perf/chat-perf.bench.ts`
- `tests/perf/fixtures/fake-rows.ts` (exports `makeFakeRows(n)` for benches)
- `vitest.perf.config.ts`
- `plans/chat-perf/MEASUREMENT.md` (post-execution)

### Modified

- `convex/chat/messages.ts:178` — `throttleMs: 100 → 250`
- `package.json` — add `"test:perf": "vitest bench --config vitest.perf.config.ts"` script

### Audited, possibly modified

- `next.config.{js,ts,mjs}` — read to determine Compiler status; modify only if a concrete regression is observed
- `sources-panel-list.tsx` — verify `'use no memo'` effectiveness; leave or remove based on audit

### Dependencies

- **No new deps.** `vitest` already present (it ships `bench`).

## Migration stance — **none**

Server deploy for the throttle change. No schema, no mutation shape change.

## Test plan

### Benchmarks (vitest bench — `npm run test:perf`)

- Enumerated in §4 above. Run before and after plan 01's changes to show deltas in the MEASUREMENT.md report.

### Manual QA (documented in MEASUREMENT.md)

- Open a chat at 1000 papers; type "photo" in search; measure time-to-settle via DevTools Performance tab.
- Toggle 10 rows in rapid succession; confirm no cumulative jank.
- Send a prompt that produces a 500-word streamed response; observe smoothness.
- Background the tab for 1 minute; foreground; confirm re-subscription happened (Network tab).
- Mobile: repeat all of the above at `< md` viewport.

## Acceptance criteria

- [ ] `convex/chat/messages.ts:178` changed to `throttleMs: 250` and deployed.
- [ ] `tests/perf/chat-perf.bench.ts` exists and runs green via `npm run test:perf`.
- [ ] `vitest.perf.config.ts` exists.
- [ ] `package.json` has a `"test:perf"` script.
- [ ] `plans/chat-perf/MEASUREMENT.md` written with real numbers for the listed benchmarks + manual QA observations.
- [ ] React Compiler status documented (enabled? where?) in MEASUREMENT.md.
- [ ] `'use no memo'` pragma on `sources-panel-list-virtual.tsx` verified as either necessary (Compiler enabled) or defensive (Compiler off) — note in MEASUREMENT.md.
- [ ] Behavioral test suite (from plans 01/02/03) still green.
- [ ] No perf budget regression: DOM nodes ≤ 30 at 1k rows; subscriptions count exactly 1.

## Known pitfalls

- **The throttle change is persistent** — once deployed it affects all live chats. If it feels too laggy for human readers (unlikely given "messages are not very long"), roll back with a single-line revert and redeploy.
- **`vitest bench`** is not as stable as `tinybench` directly — numbers are indicative, not absolute. Run benches multiple times; report median.
- **`makeFakeRows` generator** must produce realistic row shapes (authors arrays, optional abstracts, variable title lengths). Bias toward "realistic" over "worst-case" — the goal is to measure actual production patterns.
- **React Compiler investigation may reveal the Compiler is disabled** — if so, the `'use no memo'` pragma in plan 02 is a defensive no-op. Keep it. TanStack/virtual#1119 is still open and will bite the day someone flips the Compiler on.
- **Playwright perf tests are flaky on CI** — do not gate CI on them. They exist for local investigation.
- **Measurement numbers will differ across machines** — the report is a local snapshot, not a universal baseline. Re-run on the target deployment hardware if you want production-representative numbers.
- **Over-tuning `estimateSize` / `overscan`** — these knobs in plan 02 were set conservatively. Adjusting them based on benchmark deltas is valid; adjusting them to optimize a specific microbenchmark that doesn't reflect production usage is not. The criterion: does mouse scroll at 1000 rows feel smooth? If yes, leave alone.
- **`throttleMs: 250` + `streamdown` block memo** — streamdown already memoizes blocks, so the user doesn't notice the throttle change. If the measurement shows regressions in "first token visible" time, that would indicate something else is wrong — not the throttle change.
- **No SSR concerns** — all changes here are either server-constant (Convex action) or client-side test infrastructure. Nothing to hydrate.
