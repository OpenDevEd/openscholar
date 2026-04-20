# Plan 03 — Deferred Search + Verify Subscription Pause

**Depends on:** 01 (stable rows through context). **Blocks:** 04 (measurement baseline for typing latency).

## Goal

Keep typing in the sources-panel search input responsive at 1k rows by deferring the query that drives the filter/search pipeline, using React 19's `useDeferredValue`. Verify that the tab-visibility pause introduced in plan 01 works end-to-end (including reconnection). Small plan — single React pattern change plus a verification pass.

Implements decision **D5** (useDeferredValue on search), confirms **D9** (subscription pause) end-to-end.

## Scope

**In scope**

- Wrap `state.q` with `useDeferredValue` at its entry point into `useSourcesPanelState(rows)` — or, if the hook is the owner, defer inside the hook.
- Keep URL-sync via `nuqs` unchanged (the URL still updates per keystroke; the filter pipeline just uses the deferred value).
- Expose a `data-search-deferred` attribute when the deferred value lags the eager input — enables behavioral tests and makes the concurrent state visible for debugging.
- Verify the subscription pause: write a test that dispatches `visibilitychange` to `hidden`, asserts `useQuery` gets `"skip"`; dispatch back to `visible`, assert resubscription.
- Document a tiny `useVisibilityState()` helper (spin-off of plan 01's `useSkipWhenHidden` that returns the raw state, not the arg-or-skip).

**Out of scope**

- Web-worker filter (benchmarks in plan 04 will decide whether it's needed; current measure is that 1k rows + existing `runWeightedSearch` is fast enough with deferral).
- Changing the weighted scorer, snippet extractor, or sort comparators.
- Changing the keyboard hook.
- Touching message-list subscriptions beyond the visibility pause already in plan 01.

## Design

### 1. Where to put `useDeferredValue`

Three options:

**Option A — in the consumer (`sources-panel.tsx` or `sources-panel-toolbar.tsx`):** split the eager `q` (what the input shows) from the deferred `q` (what drives search). Pass deferred into the state hook.

**Option B — inside `useSourcesPanelState`:** the hook defers its own dependencies. Consumers keep the same API.

**Option C — at the search input only:** `useDeferredValue(state.q)` at the top of the list component, pass into the scorer call.

Chosen: **Option B**. Reasons:

- Everything that depends on search progress (visibleRows, matches) lives in the hook. Deferral must apply to all of them consistently.
- Consumers don't need to know about concurrent rendering.
- The eager `state.q` is still accessible (for the `<input value={state.q}>` binding), so the input remains controlled with zero perceived lag.
- Minimal blast radius — one file change in `use-sources-panel-state.ts`.

### 2. The change — `use-sources-panel-state.ts`

```ts
'use client';

import { useDeferredValue, useMemo } from 'react';
// ... existing imports (parseAsString, parseAsStringLiteral, useQueryStates, etc.)

export function useSourcesPanelState(
  rows: ReadonlyArray<ChatSourceRow>,
): SourcesPanelStateApi {
  const [state, setState] = useQueryStates(/* ...unchanged... */);

  // The eager query drives the <input value={...}>.
  // The deferred query drives the (expensive) filter+search pipeline.
  const deferredQuery = useDeferredValue(state.q);
  const isStale = deferredQuery !== state.q;

  const chipCounts = useMemo(() => computeChipCounts(rows), [rows]);

  const filteredByChip = useMemo(
    () => filterBySourceChip(rows, state.src),
    [rows, state.src],
  );

  const searched = useMemo(
    () => runWeightedSearch(filteredByChip, deferredQuery),  // ← uses deferred
    [filteredByChip, deferredQuery],
  );

  const visibleRows = useMemo(
    () => sortByComparator(searched, state.sort, state.dir),
    [searched, state.sort, state.dir],
  );

  const matches = useMemo(() => {
    const map = new Map<string, SearchMatch>();
    if (deferredQuery.trim().length === 0) return map;    // ← uses deferred
    for (const row of visibleRows) {
      map.set(row.chatPaperId, scoreSource(row, deferredQuery));
    }
    return map;
  }, [visibleRows, deferredQuery]);

  const totalCount = rows.length;
  const includedCount = useMemo(
    () => rows.reduce((n, row) => n + (row.included ? 1 : 0), 0),
    [rows],
  );

  return {
    state,           // state.q is the eager value — input binds to this
    setState,
    visibleRows,
    matches,
    chipCounts,
    totalCount,
    includedCount,
    isSearchStale: isStale,   // new — exposed for the `data-search-deferred` contract
  };
}
```

And in the panel's toolbar (or wherever the search input lives):

```tsx
const { state, setState, isSearchStale } = useSourcesPanelState(rows);

<Input
  type="search"
  value={state.q}                                      // eager
  onChange={(e) => setState({ q: e.target.value })}
  aria-label={t('sourcesPanel.searchPlaceholder')}
  data-search-deferred={isSearchStale ? 'true' : 'false'}
/>
```

And on the list container (already exposes `data-*`):

```tsx
<div role="listbox" data-search-deferred={isSearchStale ? 'true' : 'false'} ...>
```

**Why the `data-search-deferred` attribute** — it's the behavioral contract. A test can type "photo" fast, assert the attribute flips to `"true"` briefly, then settles to `"false"`. Human users see nothing (it's a test hook). No visual UI change proposed.

### 3. What deferral actually buys us

- `useDeferredValue` is NOT a fixed debounce. It tells React to render the eager value at a higher priority than the deferred-derived value. If the system can render both in one frame, it does. Only under pressure does deferred rendering lag.
- At 100 rows: no perceptible deferral — React can do both per keystroke at 60fps.
- At 1,000 rows with `runWeightedSearch` + `scoreSource` per row: typing a character triggers `useQueryStates.setState` (URL update + `state.q` commit). The eager input re-renders immediately at higher priority. The deferred pipeline queues as a lower-priority render and may be interrupted by subsequent keystrokes, so only the final character's state triggers the expensive filter.
- Net: typing stays responsive; the list "catches up" when the user pauses.

**This is not debounce.** Debounce waits a fixed time. `useDeferredValue` yields to new input automatically and renders as soon as the system has capacity. Better default.

### 4. The `useVisibilityState` companion helper

Plan 01 introduced `useSkipWhenHidden(args)` which returns `args | "skip"`. Some tests benefit from reading the boolean state directly (e.g., to assert "the subscription is paused when hidden"). Add the companion:

```ts
// lib/chat/use-visibility-state.ts
'use client';
import { useEffect, useState } from 'react';

export function useVisibilityState(): 'visible' | 'hidden' {
  const [state, setState] = useState<'visible' | 'hidden'>(() =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden'
      ? 'hidden'
      : 'visible',
  );
  useEffect(() => {
    const onChange = () =>
      setState(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return state;
}
```

Refactor `useSkipWhenHidden` from plan 01 to call this internally:

```ts
export function useSkipWhenHidden<T>(args: T): T | 'skip' {
  return useVisibilityState() === 'hidden' ? 'skip' : args;
}
```

Pure DRY — no new behavior; cleaner primitive set.

### 5. Verification: end-to-end pause / resume

The behavior test in plan 01 covered the unit-level pause. This plan adds the integration-level verification:

- Mount `<ChatJobView />` with a mocked `useQuery` that counts subscription registrations.
- Initial mount: subscription count = 1.
- Dispatch `visibilitychange` (hidden): `useQuery` spy observes `"skip"` arg; no new registration. Convex internally unsubscribes when args go to `"skip"`.
- Dispatch `visibilitychange` (visible): `useQuery` spy observes full args again; re-subscription.
- Assertion: no spurious double-subscriptions on the transition.

This test lives in `tests/components/chat-job-view.test.tsx` (extend the new file from plan 01).

### 6. Nothing else changes

The search scorer, snippet extractor, sort comparators, chip counts, keyboard hook, virtualizer, provider — untouched.

## TDD sequence

**None.** No new pure logic.

## Files touched

### New

- `lib/chat/use-visibility-state.ts` (small helper)

### Modified

- `lib/chat/use-skip-when-hidden.ts` — refactor to delegate to `useVisibilityState()` (cosmetic DRY).
- `components/extraction/chat/sources-panel/use-sources-panel-state.ts` — add `useDeferredValue`, expose `isSearchStale`.
- `components/extraction/chat/sources-panel/sources-panel-toolbar.tsx` — read `isSearchStale` from state, forward as `data-search-deferred`.
- `components/extraction/chat/sources-panel/sources-panel-list.tsx` — read `isSearchStale`, forward as `data-search-deferred` on the listbox container.
- `tests/components/chat-job-view.test.tsx` — extend with visibilitychange integration test (single new `it(...)` block).
- `tests/components/sources-panel/*.test.tsx` — add a test that typing quickly produces a window where `data-search-deferred="true"`, then settles to `"false"`.

### Dependencies

- **No new deps.** `useDeferredValue` is in React 19 (installed).

## Migration stance — **none**

Nothing server-side. Pure React change.

## Test plan

### Behavior (RTL — `sources-panel-toolbar.test.tsx` / `sources-panel-list.test.tsx`)

- **initial: data-search-deferred is "false"**: render with no input → `<input data-search-deferred="false">`.
- **typing: data-search-deferred flips true then false**: with 1000 rows mocked, type "a" in the search input — assert at one of the subsequent microtasks the list container has `data-search-deferred="true"`, then after a pending transition flush, `"false"`. (May need `act(() => /* microtask flush */)` + `await waitFor(...)`.)
- **eager input value never lags**: type "photo" rapidly; assert the `<input value>` always reflects the last typed character immediately. (Assert via `screen.getByRole('searchbox')` + `toHaveValue(...)`.)
- **filter result lags behind eager value under pressure**: with a very large mocked `runWeightedSearch` (slow filter), type fast — assert for some rendered-frame the list's `data-total-rows` corresponds to a query shorter than the input value. This is hard to reproduce deterministically in JSDOM; accept as optional.

### Behavior (RTL — `chat-job-view.test.tsx` — extension)

- **subscription pauses on tab hidden**: render `ChatJobView`; spy `useQuery`; dispatch `new Event('visibilitychange')` with `document.visibilityState = 'hidden'` stubbed; assert `useQuery` last-call args is `"skip"`.
- **resubscribes on tab visible**: flip back to `'visible'`; assert `useQuery` last-call args is the `{ jobId }` object again.
- **no spurious double-subscription**: across the two transitions, total `useQuery` invocation count grew by exactly 2 (one per transition, not three).

### Manual QA

- In a real browser: open a chat with 1000 mocked papers; type "photosynthesis" quickly in the search. Expect: input responds instantly; list updates when typing pauses; no stutter on input keypresses.
- Background the tab for 30 seconds; foreground; assert the sources list shows current state (Convex re-subscribes and catches up).

## Acceptance criteria

- [ ] `use-sources-panel-state.ts` uses `useDeferredValue` on the query; eager `state.q` still bound to the input.
- [ ] `isSearchStale` exposed from the hook.
- [ ] `data-search-deferred` attribute on the listbox container + search input reflects the deferral state.
- [ ] `useVisibilityState` helper exists; `useSkipWhenHidden` delegates to it.
- [ ] Visibility-pause integration test green.
- [ ] Toolbar / list tests green with the new `data-search-deferred` behavior.
- [ ] No changes to `runWeightedSearch`, `scoreSource`, `sortByComparator`, `filterBySourceChip`, `computeChipCounts`, `extractMatchSnippet` — they remain pure-green from the chat-sources-toggle plan set.
- [ ] No CSS-class assertions introduced.

## Known pitfalls

- **`useDeferredValue` interacts with React Compiler** — both can re-memoize the same derived values. The Compiler handles this correctly per the React docs, but if at execution a value that should update seems stuck, try a `'use no memo'` at the top of `use-sources-panel-state.ts`. Do NOT default to this — verify first.
- **`nuqs`'s `useQueryStates` may batch state updates**; typing "abc" fast could commit "abc" as a single state update. This is actually fine for our purpose — deferred-value still defers the downstream pipeline.
- **Testing `useDeferredValue` in JSDOM is flaky** — React's concurrent scheduling is hard to simulate. Prefer integration-level assertions ("eager input always shows latest input", "list eventually settles") over tight timing assertions.
- **`isSearchStale` is true for zero or one tick** — in low-load scenarios the deferred pipeline completes in the same render as the eager update, so the attribute never flips to `"true"`. This is correct. Tests should tolerate both outcomes: typing → attribute is either "true" transiently or "false" throughout, never inconsistent.
- **`document.visibilityState` mocking in JSDOM** — JSDOM does not fire `visibilitychange` on its own. Tests must stub `document.visibilityState` directly AND dispatch the event manually. Example:
  ```ts
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
  ```
- **`useSkipWhenHidden` + Convex's arg memoization** — the Convex client's arg memo (`client.ts:869`) uses `JSON.stringify(convexToJson(args))`. `"skip"` is a string; `{ jobId: "..." }` is an object. Toggling between them produces distinct keys, so resubscription works correctly. No action needed — just noting it.
