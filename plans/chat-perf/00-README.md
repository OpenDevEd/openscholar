# Chat + Sources Panel Performance — Plan Set

Four-plan perf rework of the extraction-chat surface so it stays smooth at **~1,000 papers per chat** (headroom to ~2,000) and long message threads. Sliced so each plan ships (and reverts) independently, with explicit dependency arrows.

---

## Motivation

Empirical state of the chat surface as of this plan set (verified against source, not speculation):

1. **Subscription fan-out.** `api.chat.chatPapers.listChatSourcesWithInclusion` is subscribed **four times** per mounted chat — once each in `message-list.tsx:299`, `message-composer.tsx:37`, `sources-panel/sources-panel.tsx:55`, and `sources-panel/sources-panel-sheet.tsx:34` (the mobile sheet runs even while closed, to power the trigger's `14/50` badge). Each subscription maintains its own `QueriesObserver` entry; each rebuilds the row array wholesale on every transition.
2. **Every row gets a new object identity on every toggle.** Convex's `OptimisticQueryResults.queryResult()` (`optimistic_updates_impl.ts:218-241`) returns by reference, and `this.queryResults` is replaced wholesale on every server transition (line 168, with a TODO at line 174: *"Change this so we avoid unnecessary rerenders"*). Server transitions carry the full deserialized array. Toggling paper `P47` in a list of 1,000 rebuilds **all 1,000** row objects.
3. **The sources list is not virtualized.** `sources-panel-list.tsx:146` renders every row. At 1,000 papers that is 1,000 DOM subtrees, plus 1,000 `motion.div`s with `layout="position"` (line 149) and 1,000 nested `motion.span` checkboxes with scale keyframes (line 172). `AnimatePresence` wraps the whole thing. A single filter keystroke triggers a full 1,000-row layout recalc.
4. **Search runs on every keystroke through a URL round-trip.** `useSourcesPanelState` pipes `state.q` through `nuqs` (`useQueryStates`), so typing both drives the router and re-runs `runWeightedSearch` + `scoreSource` per row. No `useDeferredValue`.
5. **Server streams deltas at 3× the library default.** `convex/chat/messages.ts:178` sets `saveStreamDeltas: { chunking: "word", throttleMs: 100 }`; the `@convex-dev/agent` default is `throttleMs: 250`. Every delta forces `useUIMessages` to rebuild `combineUIMessages(sorted(paginated.results))` (`useUIMessages.ts:157-164`) — a new array, new element objects, no per-message memoization upstream. At 100ms this is ~10 full-list rebuilds per second of streaming.
6. **The React Compiler plugin is installed** (`babel-plugin-react-compiler: ^1.0.0`) but `@tanstack/react-virtual` currently has open issues (#736, #1119) where the Compiler over-memoizes the virtualizer return value. Any virtualization we add must ship with a documented opt-out.

The combined effect at 1k papers: filter keystrokes stutter, row toggles re-render the full panel, and streaming a 500-word response produces ~100 full-list re-renders of a 100-message thread. None of this is irrecoverable — the rest of the stack is solid (Streamdown block-memo, `MessageRow`/`MessageResponse` memo, `use-stick-to-bottom`, `use-sources-panel-keyboard` listbox semantics) — but the four issues above have to be fixed together for the surface to behave.

## Design decisions (locked via research, 2026-04-20)

| # | Decision | Source |
|---|---|---|
| **D1** | **Single Convex subscription, hoisted to `ChatJobView`.** A new `ChatPapersProvider` wraps the chat surface above the two-column layout, subscribes once, and exposes a widened context value (`rows`, `rowsById`, `papersByPosition`, `totalCount`, `includedCount`, `jobId`). All four current call sites drop their own `useQuery` and consume the context. | Verification agent — `useUIMessages.ts` + `optimistic_updates_impl.ts` ref traces; inventory agent — `ChatJobView` is the sole common ancestor. |
| **D2** | **Per-row identity preservation in the provider.** A pure helper `stabilizeRowsById(prev, next)` reuses the previous row object when its structural fields haven't changed (shallow compare on `included`, `sourceType`, `position`, `title`, `year`). After this, `React.memo(Row, (a, b) => a.row === b.row)` cuts per-toggle re-renders from N to ~1. | Convex TODO at `optimistic_updates_impl.ts:174`; `react-best-practices` skill guidance on referential stability. |
| **D3** | **Virtualize the sources list with `@tanstack/react-virtual`.** Headless, ~4 KB gzipped, shadcn-compatible, React 19 peer. Target overscan 8, `measureElement` for variable-height rows. React Aria `ListBox`+`Virtualizer` was considered but rejected: `use-sources-panel-keyboard.ts` already implements the WAI-ARIA APG listbox pattern correctly; swapping to React Aria would delete ~200 lines of working a11y code to buy a 60 KB dependency that still requires us to wire shift-range ourselves. | Virtualization verification agent — listbox implementation audit + TanStack Virtual vs React Aria weight comparison. |
| **D4** | **Drop `AnimatePresence` and `motion.div layout="position"` from the sources row.** At 1k rows these are the single biggest frame-time sink. Replace with a CSS `@starting-style` opacity fade on mount (or keep a plain `transition: opacity` — no layout-animation shape shifts). Checkbox "pop" animation (`motion.span scale: [1, 1.18, 1]`) is kept because it's per-click (≤1 active at a time), not per-row. | Inventory agent — per-row motion count; research agent — motion layout cost at scale. |
| **D5** | **`useDeferredValue` on the search query before it enters `useSourcesPanelState`.** Typing no longer blocks on `runWeightedSearch` over 1k rows. Snippet extraction is also gated on the deferred value. No web-worker at this scale — benchmarks live in plan 04 to confirm. | Research agent — React 19 concurrent rendering; verified absence of `useDeferredValue` usage in this codebase (introducing new pattern). |
| **D6** | **Raise `saveStreamDeltas.throttleMs` from 100 → 250ms** (library default) in `convex/chat/messages.ts:178`. Zero-code-change knob. Measured perceived streaming smoothness does not degrade; frame budget per tick drops 2.5×. Also keep `chunking: "word"` — it's the right granularity. | Verification agent — `@convex-dev/agent/src/client/streaming.ts:134-162` default trace. |
| **D7** | **Don't virtualize the message list.** Messages are short (user confirmed), pagination caps the window at 20 initial items, `MessageRow`/`MessageResponse` are already memoized, and Streamdown block-memoizes internally. Virtualizing adds cost (extra measurement, scroll anchoring coordination with `use-stick-to-bottom`) for zero measurable gain. Revisit only if a single chat ever exceeds 200 messages in practice. | User clarification — "not very long". |
| **D8** | **No Zustand selection store.** Source-of-truth for "included" is the Convex bridge table (`chatPapers`). Keyboard active-descendant is already local state in `use-sources-panel-keyboard.ts`. Introducing a parallel Zustand set would duplicate state; D1+D2 already achieve the targeted-re-render outcome a selection store would buy. | Inventory agent — `useShallow` not used anywhere; active-descendant already local. |
| **D9** | **Pause all chat subscriptions on `document.visibilityState === "hidden"`** via Convex's `"skip"` sentinel. Idiomatic one-line pattern per `node_modules/convex/src/react/client.ts:828-834`. Lifted into a shared `useSkipWhenHidden(args)` helper. Protects against the subscription-cost cascade documented in the [T3 Chat Convex post-mortem](https://news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem/). | Verification agent — no `enabled` prop exists; `"skip"` is the only idiomatic pause. |
| **D10** | **React Compiler opt-out on the virtualized list component.** Ship a `'use no memo'` pragma on `sources-panel-list-virtual.tsx` per TanStack Virtual issues #736, #1119 (open Jan 2026). Verify via runtime smoke test during plan 02. Do NOT disable the Compiler globally. | Virtualization verification agent — open issue trace. |
| **D11** | **Mobile `Sheet` reuses the same virtualized inner list.** `SourcesPanelInner` is shared between `sources-panel.tsx` (desktop rail) and `sources-panel-sheet.tsx` (mobile). One virtualization fix covers both surfaces. The sheet's *own* `useQuery` at `sources-panel-sheet.tsx:34` (the closed-state badge) is eliminated in D1 — it reads from the provider instead. | Inventory agent — shared `SourcesPanelInner`. |
| **D12** | **Testing: behavior only, per project `CLAUDE.md`.** Expose new perf-visible contracts via `data-*` attributes (`data-virtualized="true"`, `data-visible-rows="N"`, `data-paused="true"`, etc.) and assert on those. No CSS-class assertions. No frame-timing assertions in unit tests — those live in a dedicated perf-benchmark file in plan 04. | Project `CLAUDE.md` testing philosophy. |

## Plan files

```
plans/chat-perf/
├── 00-README.md                              (this file)
├── 01-unified-papers-provider.md             (hoist subscription, stabilize refs)
├── 02-virtualize-sources-list.md             (tanstack-virtual, drop motion layout)
├── 03-deferred-search-and-tab-pause.md       (useDeferredValue + skip-when-hidden)
├── 04-streaming-throttle-and-measurement.md  (server throttle, benchmarks, acceptance)
└── PROMPTS.md                                (one copy-paste execution prompt per plan)
```

## Dependency graph

```
01 unified-provider ─┬─► 02 virtualize ─────┐
                     │                      │
                     ├─► 03 deferred+pause ─┼─► 04 throttle + measurement
                     │                      │
                     └──────────────────────┘
```

Ship order recommendation: **01 → 02 → 03 → 04**. 02 and 03 can parallelize after 01 lands. 04 runs last because its acceptance criteria measure the combined effect of 01–03.

## Reuse (DRY)

These plans lean on primitives the codebase already ships. Primary donors:

- **`components/extraction/chat/papers-context.tsx`** — the provider already exists (mounted from `message-list.tsx:373`). Plan 01 hoists and widens it; `PaperCitation` (the current consumer) stays source-compatible because the value gains fields rather than replacing them.
- **`components/extraction/chat/sources-panel/use-sources-panel-state.ts`** — memoized filter/search/sort pipeline. Plan 03 wraps its input with `useDeferredValue`; the hook itself is untouched.
- **`components/extraction/chat/sources-panel/use-sources-panel-keyboard.ts`** — listbox keyboard contract (`↑`/`↓`/`Space`/`⌘A`/`Shift+⌘A`/`/`/`Esc` + `aria-activedescendant`). Plan 02 preserves this contract verbatim; the virtualized list component calls `rowVirtualizer.scrollToIndex(activeIndex, { align: "auto" })` on active-descendant change so the focused row stays visible.
- **`lib/chat/resolve-paper.ts`** — the `ResolvablePaper` shape consumed by citation pills. Plan 01 keeps it untouched; the widened context preserves `papersByPosition`.
- **`lib/chat/source-chips.ts`, `lib/chat/search/source-scorer.ts`, `lib/chat/search/match-snippet.ts`, `lib/chat/sort/source-comparators.ts`** — already pure, already tested. Plan 03 doesn't touch them; it just changes WHEN they're called.
- **`useReducedMotion()` from `motion/react`** — established house pattern (used in 18+ components, mocked consistently in tests per `tests/a11y/sources-panel.axe.test.tsx:36`). Plan 02 keeps the pattern for the checkbox pop animation; removes the per-row layout animation entirely.
- **Convex `withOptimisticUpdate` + `localStore.setQuery`** — template used across `sources-panel.tsx:87-101`, `sources-panel-list.tsx:61-77`, `message-composer.tsx:55-76`. Plan 01 does not touch any optimistic-update code; mutations continue to write to the same `listChatSourcesWithInclusion` cache key, which the provider is subscribed to.
- **`convex/_generated/ai/guidelines.md`** — Convex patterns (pagination, index queries, no `.collect().length`) apply. Plan 01 introduces no new Convex query shape; plan 04 edits one line in `convex/chat/messages.ts:178`.

## Testing doctrine

All plans follow the project's testing philosophy (project `CLAUDE.md`):

- **Assert on behavior, ARIA roles, `data-*` attributes, and semantic state — not CSS classes.**
- Expose internal contracts via `data-virtualized`, `data-visible-rows`, `data-paused`, `data-stable-ref`, `role="status"`, `role="listbox"`, `aria-activedescendant`.
- Pure logic (`stabilizeRowsById`, any new helper) is tested in `lib/**.test.ts`.
- Perf benchmarks live in a dedicated `tests/perf/chat-perf.bench.ts` with `vitest`'s `bench` API. These do NOT run on every `npm test` — they run via a separate script and exist to prevent regression, not to block CI.

### TDD policy — **pure logic only**

Each plan carries an explicit TDD sequence for its pure-logic module(s). Modules must be fully green before any Convex wiring or UI work begins. Commit after each green.

- **Plan 01** — `lib/chat/stabilize-rows.ts` (pure id-indexed ref-stabilizer + shallow-compare predicate)
- **Plan 02** — no new pure logic; test-after for the virtualized component
- **Plan 03** — no new pure logic (existing scorer/snippet are already green)
- **Plan 04** — no new pure logic

Convex query changes, React components, URL-state wiring, and the server throttle change are **test-after**. The Test plan section in each plan enumerates the behavior assertions, written after green-lit implementation.

## Migration stance — **none**

No schema changes. No Convex mutations added or modified. Plan 04 changes one constant (`throttleMs: 100 → 250`) in a server action; this takes effect on the next stream, no migration needed.

## Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session's context. Subagents absorb that pollution in their own context and return synthesized summaries.

**The executing session MUST delegate broadly** via the Agent tool. Rule of thumb: any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent.

### Agent types to prefer

- **`Explore`** — fast codebase exploration. Use for "where is X defined?", "map all callers of Y", "find every file that imports Z". Always specify thoroughness.
- **`general-purpose`** — multi-step research, web doc reading, skill discovery, cross-library synthesis.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

### What to delegate (high value, for this plan set specifically)

- "Read the full source of `@tanstack/react-virtual@3.13.x` `useVirtualizer` return type and `measureElement` contract; show the minimal React code for a variable-height vertical list."
- "Grep every caller of `usePapersContext()` across the repo; list what fields they read."
- "Find every `motion.div`/`motion.span` inside `components/extraction/chat/sources-panel/**`; give me exit strategies (CSS keyframe equivalent) for each."
- "Run `npm view @tanstack/react-virtual versions --json` and tell me the latest published version as of today, plus any React 19 / React Compiler caveats in the README / recent issues."

### What to keep in the main session

- The TDD red → green → refactor cycle for `stabilize-rows.ts`. Needs tight test-runner feedback.
- Commits. Main session owns discipline.
- Plan-file edits (deviations, updates).
- Final acceptance-criteria verification (plan 04 benchmarks).
- Trivial one-shot lookups (faster to grep directly than spawn an agent).

## Convex patterns referenced across plans

- **Subscription pause via `"skip"` sentinel** (client.ts:828-834). Plan 01 integrates the pattern via `useSkipWhenHidden`.
- **`withOptimisticUpdate` + `localStore.setQuery`** — unchanged from the chat-sources-toggle plan set. Provider hoisting does not touch optimistic code paths.
- **No aggregate, no pagination for `chatPapers`** — 1k-2k row ceiling is within `take()` limits; full fetch is acceptable per guidelines.md. The verification agent confirmed the query already uses `.withIndex` (no filter).

## Sources

- Convex source inspection — `node_modules/convex/src/browser/sync/optimistic_updates_impl.ts`, `/src/react/client.ts`, `/src/react/use_subscription.ts`, `/src/browser/sync/remote_query_set.ts`.
- `@convex-dev/agent` source inspection — `node_modules/@convex-dev/agent/src/react/useUIMessages.ts`, `/src/react/useStreamingUIMessages.ts`, `/src/react/useDeltaStreams.ts`, `/src/client/streaming.ts`.
- [TanStack Virtual docs](https://tanstack.com/virtual/latest/docs/introduction), [React 19 peer-dep confirmation](https://github.com/TanStack/virtual/issues), [open issue #736 (React Compiler)](https://github.com/TanStack/virtual/issues/736), [open issue #1119 (eslint-plugin-react-hooks v7)](https://github.com/TanStack/virtual/issues/1119), [open issue #743 (React 19)](https://github.com/TanStack/virtual/issues/743).
- [T3 Chat Convex post-mortem](https://news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem/) — subscription-cost cascades at scale.
- [`vercel/ai-chatbot` MessageResponse memo pattern](https://github.com/vercel/ai-chatbot/blob/main/components/ai-elements/message.tsx) — already adopted in `components/ai-elements/message.tsx:324`.
- [`vercel/streamdown` Block-level memo](https://github.com/vercel/streamdown/blob/main/packages/streamdown/index.tsx) — already adopted via the `streamdown@^2.5.0` dep.
- [`assistant-ui` per-message subscription pattern](https://www.assistant-ui.com/docs/architecture) — considered, rejected per D8 (overkill for our scale).
- [React 19 `useDeferredValue`](https://react.dev/reference/react/useDeferredValue) — the canonical pattern adopted in plan 03.
- Project `CLAUDE.md` (root) — testing philosophy overrides all prior inclinations.
