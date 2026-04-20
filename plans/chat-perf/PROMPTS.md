# Chat + Sources Panel Performance — Execution Prompts

One copy-paste prompt per plan, designed to be pasted into a fresh `/clear`'d Claude Code session. Each prompt is self-contained: the agent doesn't need to have seen the planning conversation.

**Before any prompt:** ensure you're on `dev` branch with a clean working tree; `git log -1` to confirm the previous plan's commits landed if chaining.

---

## Plan 01 — Unified Papers Provider + Per-Row Identity Preservation

```
Execute `plans/chat-perf/01-unified-papers-provider.md` from top to bottom. Follow the plan file's §TDD sequence for `lib/chat/stabilize-rows.ts` — Red → Green → Commit per test case. No implementation until all tests are written.

Then apply the migrations in §Files touched:
- widen `components/extraction/chat/papers-context.tsx` and introduce `ChatPapersProvider`
- add `lib/chat/use-skip-when-hidden.ts`
- hoist the provider to `components/extraction/chat/chat-job-view.tsx`
- remove the four redundant `useQuery` call sites (message-list, message-composer, sources-panel, sources-panel-sheet)
- wrap `SourceRow` in `React.memo` with identity comparator
- update tests that construct a fake `PapersContext` value — build a shared `tests/helpers/papers-context-fixture.ts` helper

Acceptance criteria are explicit in the plan file — tick every box before concluding. The most important behavioral assertion: `grep -rn "useQuery(api\\.chat\\.chatPapers\\.listChatSourcesWithInclusion" components/` returns exactly one match (inside papers-context.tsx).

Delegation rules:
- Before starting TDD: spawn one Explore agent to map `lib/chat/resolve-paper.ts` and confirm whether `resolvePaperFromRow` is already exported or if the logic is currently inlined in `message-list.tsx:304-324`. The plan's D2 assumes we can call a pure `resolvePaperFromRow(row)`; verify first.
- Before migrating consumers: spawn one Explore agent to enumerate every test file that mounts `<PapersContext.Provider value={...}>` — collect their fixture shape so the shared helper covers all call sites.
- Any web research needed (unlikely for this plan) → general-purpose agent.

Never add emojis. Never write CSS-class assertions. Never skip the `"use no memo"` or other React Compiler directives that the plan file calls out; if uncertain whether the Compiler is enabled, leave pragmas as defensive markers and note in the commit message.

Testing doctrine — non-negotiable: assert on `data-*`, ARIA, `getByRole`/`getByText`/`getByLabelText`. Never assert on className or Tailwind strings. See project root `CLAUDE.md`.

Convex doctrine: the `chatPapers` query is unchanged. Optimistic-update call sites remain as-is (they read/write the same Convex cache key the new provider subscribes to).

Commit discipline: one commit per TDD green, then one commit per consumer migration, then one commit for test-fixture helper, then one commit for the provider + hoist. Use message prefix `perf(chat-papers): [plan-01] <what>`.

Main-session protection: spawn subagents for anything beyond 3 file reads / 3 greps. The plan file has specific agent prompts; use them verbatim where applicable.
```

---

## Plan 02 — Virtualize Sources List + Strip Per-Row Motion

```
Execute `plans/chat-perf/02-virtualize-sources-list.md` top to bottom. Plan 01 must be committed on `dev` before starting.

Order of operations:
1. Install `@tanstack/react-virtual` at the latest 3.x. Verify first with `npm view @tanstack/react-virtual version` — if v4 has shipped, STOP and ask before proceeding (the plan is written against v3's API).
2. Rewrite `components/extraction/chat/sources-panel/sources-panel-list.tsx` per §3 of the plan. Include the `'use no memo'` pragma at the top. Preserve every ARIA / data-* attribute currently on the component.
3. Remove the `AnimatePresence` wrapper and per-row `motion.div layout="position"`.
4. Move the checkbox `motion.span` into `source-row.tsx` so it fires per-click, not per-row.
5. Add the `.source-row-enter` CSS class + keyframes + prefers-reduced-motion override to the global stylesheet. Grep first for where `@keyframes` blocks live to match the existing house style.
6. Confirm via dev-server inspection that the desktop rail and mobile sheet both give the scroll container a definite height.
7. Update `sources-panel-list.test.tsx` and `sources-panel-sheet.test.tsx` with the virtualization behavior contracts (`data-virtualized`, `data-visible-rows`, ≤30 DOM nodes at N=1000).

Delegation rules:
- Before coding: spawn one general-purpose agent to read the latest `@tanstack/react-virtual` v3 docs and return the current `useVirtualizer` API shape. The plan assumes specific property names — `getScrollElement`, `estimateSize`, `measureElement`, `overscan`, `getItemKey`, `getVirtualItems`, `getTotalSize`, `scrollToIndex` — verify these are still current.
- Before deleting motion code: spawn one Explore agent to grep for any test that asserts on `motion` props / `AnimatePresence` presence in `sources-panel-list.tsx`. Update or replace those tests.

Acceptance criteria in the plan file:
- At 1000 rows, `document.querySelectorAll('[role="option"]')` returns ≤ 30.
- Keyboard nav scrolls the virtualized viewport.
- `aria-activedescendant`, `aria-posinset`, `aria-setsize` correct.
- Axe clean.
- Mobile sheet inherits virtualization.

Commit discipline: one commit for the install, one for the rewrite, one for the motion cleanup + CSS, one for test updates. Prefix: `perf(chat-sources): [plan-02] <what>`.

Non-negotiable:
- No CSS-class assertions.
- No emojis.
- The `'use no memo'` pragma stays even if the Compiler turns out to be disabled (defensive — TanStack Virtual #1119 is still open).
- Keyboard hook (`use-sources-panel-keyboard.ts`) is NOT modified in this plan. The virtualized list consumes its return value; the hook itself is unchanged.

If you discover the scroll container has height 0 in desktop or mobile layouts, STOP — the virtualizer won't work. Trace up the flex/grid layout ancestors; confirm `h-full` or `flex-1` is effective.
```

---

## Plan 03 — Deferred Search + Verify Subscription Pause

```
Execute `plans/chat-perf/03-deferred-search-and-tab-pause.md` top to bottom. Plan 01 and 02 must be committed on `dev` before starting.

This is a small plan:
1. Modify `components/extraction/chat/sources-panel/use-sources-panel-state.ts` to `useDeferredValue(state.q)` and pass the deferred value into the filter/search pipeline; expose `isSearchStale`.
2. Bind `data-search-deferred` on the listbox container (inside `sources-panel-list.tsx`) and on the search input (inside `sources-panel-toolbar.tsx`) from `isSearchStale`.
3. Add `lib/chat/use-visibility-state.ts` and refactor `lib/chat/use-skip-when-hidden.ts` from plan 01 to delegate to it.
4. Extend `tests/components/chat-job-view.test.tsx` (created in plan 01) with the visibilitychange pause/resume integration test.
5. Add behavioral tests for `data-search-deferred` transitions in the toolbar / list test files.

Delegation rules:
- If uncertain how `nuqs`'s `useQueryStates` batches commits: spawn a general-purpose agent to read the `nuqs` docs and confirm whether per-keystroke state updates are batched.
- If `useDeferredValue` tests are flaky in JSDOM: don't fight — write integration-level assertions ("eager value always latest; list eventually settles") per the plan's §Test plan; skip tight-timing assertions.

Acceptance criteria:
- `state.q` binds the input (eager); deferredQuery drives the filter pipeline.
- `isSearchStale` exposed from the state hook.
- `data-search-deferred` on listbox + input.
- Visibility-pause test green.
- No new deps.
- No CSS-class assertions.

Commit discipline: one commit per file change. Prefix `perf(chat-sources): [plan-03] <what>`.

Do NOT introduce a web-worker for filtering. That's a plan 04 decision gated on measurement. Do NOT touch the weighted scorer or comparators.
```

---

## Plan 04 — Server Streaming Throttle + Measurement + Compiler Audit

```
Execute `plans/chat-perf/04-streaming-throttle-and-measurement.md`. Plans 01, 02, 03 must be on `dev` and verified.

Order:
1. Change `convex/chat/messages.ts:178` — `throttleMs: 100 → 250`. Verify the surrounding context matches the plan's reconstructed code block (read the file before editing). Deploy (`npx convex deploy` or via pm2). Commit.
2. Create `tests/perf/chat-perf.bench.ts` with the benches enumerated in the plan's §4. Create `tests/perf/fixtures/fake-rows.ts` that returns realistic `ChatSourceRow[]` of any N.
3. Create `vitest.perf.config.ts` per the plan. Add the `"test:perf"` script to `package.json`.
4. Run `npm run test:perf`; record results.
5. Audit React Compiler status — grep `next.config.*` and any babel config for `react-compiler` / `reactCompiler`. Document findings in `plans/chat-perf/MEASUREMENT.md`.
6. Verify `'use no memo'` on `sources-panel-list.tsx` — if Compiler is enabled, temporarily remove and confirm the virtualizer breaks; reinstate. If Compiler is disabled, document as defensive.
7. Write the full MEASUREMENT.md report: benchmarks (before/after where "before" is "plan set not applied" — for this run the before column is N/A because plans 01-03 are already landed; record the "after" column only for this first pass).
8. Manual QA pass at 1000 papers: open a chat, type in search, toggle rows, send a 500-word streaming prompt. Record observations in MEASUREMENT.md.

Delegation rules:
- Before editing messages.ts: spawn one Explore agent to read the full `streamText` / `saveStreamDeltas` block surrounding line 178 — confirm nothing adjacent changed since the plan was written.
- For React Compiler audit: spawn one general-purpose agent to grep project config files and report findings.

Acceptance criteria:
- `throttleMs: 250` deployed.
- `npm run test:perf` runs green.
- MEASUREMENT.md exists with real numbers.
- Perf budgets in the plan file are met (DOM nodes ≤ 30 at 1k; subscriptions count exactly 1; `stabilizeRowsById` ≤ 1ms/op).

Commit discipline: one commit for the throttle change + deploy, one for the bench suite, one for the Compiler audit + MEASUREMENT.md. Prefix `perf(chat-sources): [plan-04] <what>`.

Non-negotiable:
- Benches are local diagnostic tools, not CI gates. Do NOT add them to the default `npm test`.
- Do NOT roll back the throttle change unless the MEASUREMENT.md QA shows unacceptable perceived lag.
- Do NOT sprinkle `'use no memo'` across the codebase. Only the one file in plan 02 has it.

If measurement reveals a regression you didn't expect — an over-renderer the plan set missed, a slow selector, anything — stop, file the finding as a follow-up issue, and do NOT patch live. The purpose of this plan is to verify and document, not to ad-hoc optimize.
```

---

## General execution notes for all plans

- Project `CLAUDE.md` (root) is non-negotiable. Read it before the first commit of every plan.
- Convex patterns: read `convex/_generated/ai/guidelines.md` before touching anything under `convex/`.
- Branch: `dev`. Do not push to remote without explicit confirmation. Do not open a PR from inside these plans.
- pm2 runs `next dev` and `convex dev` — check logs via `pm2 logs` if something behaves unexpectedly during a run.
- Context hygiene: if your session accumulates >50 tool calls, pause, commit progress, write a one-line state summary, then paste the plan's prompt into a fresh session.
- Subagent discipline: >3 file reads or >3 greps → spawn an agent. The plans' §Delegation sections tell you when.
- Skill caveat: hooks may auto-suggest skills (`ai-sdk`, `chat-sdk`, `react-best-practices`, etc.). Invoke them only if the task genuinely requires them. The research for this plan set is already done; verified against primary sources via the four research/verification agents documented in the session that produced these files.
