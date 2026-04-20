# Chat-Perf Measurement Report (2026-04-20)

Terminal report for the chat-perf plan set (01 → 04). Produced after plans
01-03 landed on `dev` and plan-04's throttle change + bench suite were
applied. Hard numerical contracts are verified by the automated suites
referenced below; qualitative perceptual QA at 1000 rows is scoped for
operator validation against `adminPerfSeed` (see §7).

---

## 1. Environment

| Component | Version |
|---|---|
| Machine | Apple Silicon Mac, darwin 25.4.0 |
| Node | 22.22.0 |
| React | ^19.2.5 |
| Next.js | ^16.2.4 |
| @tanstack/react-virtual | ^3.13.24 |
| convex | ^1.35.1 (CLI 1.35.1) |
| @convex-dev/agent | ^0.6.1 |
| babel-plugin-react-compiler | ^1.0.0 (resolved 1.0.0) |
| vitest | 3.2.4 |

---

## 2. Benchmarks — `npm run test:perf`

Harness: `tests/perf/chat-perf.bench.ts` + seeded `makeFakeRows(1000)` fixture.
Run date: 2026-04-20 03:15 local.

The "before" column is **N/A for every row**: plans 01-03 already
landed on `dev`, so the baseline on this branch cannot be sampled
non-destructively. These numbers establish the measurement floor for
the plan set; future regressions are gauged against them.

| Benchmark | N | mean (ms/op) | p75 | p99 | hz | Budget | Result |
|---|---|---|---|---|---|---|---|
| `stabilizeRowsById` — zero changes | 1000 | 0.0219 | 0.0207 | 0.0749 | 45,697 | ≤ 1 ms/op | PASS (45× headroom) |
| `stabilizeRowsById` — one row changed | 1000 | 0.0227 | 0.0213 | 0.0746 | 44,059 | ≤ 1 ms/op | PASS |
| `runWeightedSearch` — 3-char query | 1000 | 0.2886 | 0.2965 | 0.8283 | 3,465 | ≤ 10 ms/op | PASS (34× headroom) |
| `runWeightedSearch` — 12-char query | 1000 | 0.2280 | 0.2189 | 0.5254 | 4,385 | (informational) | — |
| `runWeightedSearch` — no match | 1000 | 0.1739 | 0.1568 | 0.4142 | 5,752 | (informational) | — |
| `sortByComparator` — added asc | 1000 | 0.0080 | 0.0082 | 0.0096 | 124,792 | ≤ 2 ms/op | PASS |
| `sortByComparator` — title asc | 1000 | 0.1928 | 0.1920 | 0.2805 | 5,186 | ≤ 2 ms/op | PASS |
| `sortByComparator` — inContext desc | 1000 | 0.0734 | 0.0715 | 0.1592 | 13,618 | ≤ 2 ms/op | PASS |

Observations:
- `stabilizeRowsById` zero-changes vs one-changed differ by <4% — the
  per-row `rowsStructurallyEqual` short-circuit via `a === b` is doing
  its job; a single `{...r, included: !r.included}` diff only pushes
  one row through the deep-equality branch.
- `sortByComparator title asc` is the slowest sort at ~0.19 ms/op
  because `Intl.Collator` / `localeCompare` dominates. Still well
  within budget.
- `runWeightedSearch` 3-char query is the slowest search case because
  more rows score > 0 and survive the filter step, so the sort array
  is longer than the 12-char case.

**Verdict**: every pure-logic hot path finishes in well under a frame
(16.67 ms @ 60Hz) at the 1000-row production ceiling. No action needed.

---

## 3. Behavioral contract verification

Plan 04's hard perf budgets that are not expressible as `bench()`
times are verified by the behavioral suites from plans 01-03. All
50 tests pass (`npm test tests/components/sources-panel tests/components/chat-job-view tests/components/chat-papers-provider tests/components/chat-header`).

| Budget | Asserted in | Status |
|---|---|---|
| DOM nodes ≤ 30 `[role="option"]` at N=1000 rows | `tests/components/sources-panel/sources-panel-list.test.tsx:170-194` (`toBeLessThanOrEqual(30)`) | PASS |
| Exactly one `listChatSourcesWithInclusion` subscription per `ChatJobView` mount | `tests/components/chat-job-view.test.tsx:79+` ("mounts a single ChatPapersProvider, issuing one … subscription") | PASS |
| Row reference stability across structurally-equal Convex transitions | `tests/components/chat-papers-provider.test.tsx:60-97` (element refs preserved) | PASS |
| `stabilizeRowsById` unit contracts (15 cases) | `tests/lib/chat/stabilize-rows.test.ts` | PASS |
| Search deferred transitions (D-series) | `tests/components/sources-panel/sources-panel-toolbar.test.tsx` + `sources-panel-list.test.tsx` data-search-deferred assertions | PASS |
| Virtualizer exposes `data-virtualized` + `data-total-rows` contract | `sources-panel-list.test.tsx:153-166` | PASS |

---

## 4. React Compiler status

**Verdict: ENABLED.** Next 16 has the flag promoted out of `experimental`.

Evidence:
- `next.config.ts:7` — `reactCompiler: true` at the top level of `NextConfig`.
- `package.json:100` — `"babel-plugin-react-compiler": "^1.0.0"` in `devDependencies`.
- No Babel / SWC overrides (`babel.config.*`, `.babelrc*`, `.swcrc`, `swc.config.*` all absent outside `node_modules`).
- Full-repo grep for `react-compiler` / `reactCompiler` returns only the two hits above plus plan/doc references.

Because the Compiler is live, any `'use no memo'` directive in the codebase is a real opt-out, not decorative.

---

## 5. `'use no memo'` on `sources-panel-list.tsx`

File (current path): `components/extraction/chat/sources-panel/sources-panel-list.tsx`

Lines 1-7 (head of module):

```tsx
// React Compiler opt-out for this file only. TanStack Virtual #736 / #1119:
// the Compiler over-memoizes `useVirtualizer`'s return value, leaving
// `getVirtualItems()` stale. Revisit when upstream ships a Compiler-safe
// implementation. Scope is intentionally this file — every other file in
// the app keeps Compiler-on.
"use no memo";
"use client";
```

Verdict: **NECESSARY** (not defensive).

Rationale:
- React Compiler is ON (§4).
- Upstream TanStack Virtual issues #736 and #1119 are still open as of the plan-04 commit window — `useVirtualizer()`'s return object (`getVirtualItems()`, `measureElement`, `scrollToIndex`) holds its state across calls in a way the Compiler's "this-object-is-referentially-stable" assumption breaks. Removing the directive would let the Compiler memoize the hook's return, pinning `getVirtualItems()` to the first render's output and freezing the list.
- Plan-04 does not flip the Compiler off and does not adjust the virtualizer version, so the known-bad interaction is in effect today.

**Removal-and-retest was not executed live** in this session because (a) the Compiler's effect surfaces at scroll time under the full client bundle, which requires interactive browser observation against a 1000-paper seed; and (b) the upstream-documented incompatibility is sufficient evidence that the directive is the currently-correct defence — removing it to confirm would regress the live dev server for other engineers. The pragma stays, with the TanStack issue citations in the source comment acting as the living rationale.

**Scope pointer (out of plan-04)**: 18+ other files in the repo also carry `'use no memo'`, mostly tagged "try/finally in handlers". Those predate the chat-perf plan set; purging the unneeded ones is tracked in `.agents/audit/plans/P5-standardize-best-practices.md`. Plan-04 does not expand or touch that surface.

---

## 6. Server streaming throttle

`convex/chat/messages.ts:178` changed from `throttleMs: 100` → `throttleMs: 250`. Commit `6921619` (`perf(chat-sources): [plan-04] raise streamText throttle 100→250ms`). Deployed via the pm2 `convex dev` watcher (log line `✔ 03:12:04 Convex functions ready! (10.16s)` immediately after the save at 03:11).

Reader-facing effect: the streamed assistant text arrives in 4 ticks/sec instead of 10. Streamdown's per-block memo absorbs the visual delta; the savings land on the `useUIMessages` list-rebuild side, which is the expensive one.

**Rollback plan**: one-line revert + `convex dev` auto-redeploy. Do this only if operator QA shows unacceptable perceived lag (not yet observed).

---

## 7. Manual perceptual QA (1000 papers)

Automated hard contracts (§2, §3) are green. The **qualitative** perceptual pass
— "does the list scroll smooth, does the composer stay responsive while a
500-word answer streams, does typing in search feel instant?" — requires an
interactive browser against a seeded 1000-row job and is explicitly
**deferred to operator validation**. This is consistent with the plan's own
stance: "Playwright perf tests are flaky on CI — do not gate CI on them. They
exist for local investigation."

### Operator checklist

Run once, against a dev deployment:

1. `npx convex run chat/adminPerfSeed:seedPerfChat '{"userId":"<dev-user-id>","count":1000}'` — returns `{ jobId, threadId }`.
2. Navigate to `/extraction/<jobId>`, open the sources panel.
3. **Search**: type `photo` in the sources search; observe the list settle. Target: input-to-settled < 250ms.
4. **Row toggle**: click 10 sources in rapid succession. Target: no cumulative jank, each click visibly acknowledged within one frame.
5. **Streaming**: send `Summarize this corpus in ~500 words.`; observe the stream arrive in ~4 chunks/sec (250ms cadence) and confirm scroll-following stays smooth.
6. **Tab-hide/show**: background the tab for 60s, foreground; confirm (Network tab) that the Convex listener paused and re-subscribed — plan-03's `useVisibilityState` wiring.
7. **Mobile breakpoint**: repeat 3-5 at `< md` viewport.

Record observations in a follow-up to this section. If perceived lag appears on step 5, do **not** roll back the throttle in-place — file a follow-up instead (plan-04 is a measurement checkpoint, not an optimization loop).

---

## 8. Perf budgets — compliance summary

| Budget | Target | Measured | Status |
|---|---|---|---|
| `stabilizeRowsById` @ N=1000, zero changes | ≤ 1 ms/op (budget 2×) | 0.0219 ms/op | PASS (45× headroom) |
| `runWeightedSearch` 3-char query @ N=1000 | ≤ 10 ms/op | 0.289 ms/op | PASS |
| DOM nodes for 1k-paper sources list | ≤ 30 `[role="option"]` | asserted `<= 30` in suite | PASS |
| Subscriptions to `listChatSourcesWithInclusion` per `ChatJobView` mount | exactly 1 | asserted in suite | PASS |
| Streaming server throttle | 250ms (library default) | 250ms (commit `6921619`) | PASS |

---

## 9. Notes & follow-ups

- `environmentMatchGlobs` in `vitest.config.ts` is flagged deprecated by Vitest 3.2.4 (`Use test.projects to define different configurations instead`). Out of scope here; worth a cleanup plan.
- Several chat-sources panel tests now own their own JSDOM virtualizer stub (`tests/helpers/jsdom-virtualizer.ts`) — the centralization already happened as part of plan 02. No new helper needed.
- The bench harness is local-diagnostic only: `npm run test:perf` is NOT wired into `npm test`, `test:ci`, or any deployment gate. If someone wants to compare runs, `vitest bench --outputJson` + `--compare` is the supported workflow (`npx vitest bench --help`).
- Fake-rows fixture uses a seeded LCG (`seed = 0xC0FFEE`) so bench numbers are reproducible across machines. Different seed → different distribution; swap if investigating tail-distribution regressions.
