# Plan 01 — Unified Papers Provider + Per-Row Identity Preservation

**Depends on:** nothing (foundation). **Blocks:** 02 (virtualization consumes stable rows), 03 (deferred search consumes context rows), 04 (measurement baseline).

## Goal

Collapse four parallel subscriptions to `api.chat.chatPapers.listChatSourcesWithInclusion` into **one**, hoisted to `ChatJobView`. Expose a widened `PapersContext` value. Stabilize per-row object identity across Convex transitions via a pure `stabilizeRowsById` helper so `React.memo(Row, (a, b) => a.row === b.row)` cuts per-toggle re-renders from N → ~1.

Implements decisions **D1** (single subscription), **D2** (ref stability), **D11** (mobile sheet reads from provider, not its own query).

## Scope

**In scope**

- New pure helper `lib/chat/stabilize-rows.ts` — id-indexed ref-stabilizer with shallow-compare predicate.
- Widen `components/extraction/chat/papers-context.tsx`:
  - Value gains: `rows: ChatSourceRow[]`, `rowsById: ReadonlyMap<Id<"chatPapers">, ChatSourceRow>`, `totalCount: number`, `includedCount: number`.
  - Value keeps: `papersByPosition`, `jobId` (citation pill contract preserved).
  - Rename exported component from implicit provider pattern to **`ChatPapersProvider`** (named wrapper).
- Mount `ChatPapersProvider` at the top of `components/extraction/chat/chat-job-view.tsx`, wrapping the two-column layout.
- Remove `useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, ...)` from:
  - `components/extraction/chat/message-list.tsx:299` — replace with `usePapersContext()`.
  - `components/extraction/chat/message-composer.tsx:37` — replace with `usePapersContext()`; derived counts (`totalSources`, `includedSources`, `hasNoSourcesIncluded`) come from context directly.
  - `components/extraction/chat/sources-panel/sources-panel.tsx:55` — replace with `usePapersContext()`.
  - `components/extraction/chat/sources-panel/sources-panel-sheet.tsx:34` — replace with `usePapersContext()`; closed-state badge uses context's `totalCount` / `includedCount`.
- `withOptimisticUpdate` callers (`sources-panel.tsx:87-101`, `sources-panel-list.tsx:61-77`, `sources-panel-toolbar.tsx:97`, `sources-panel-extension-banner.tsx:39`, `message-composer.tsx:55-76`, `paper-citation.tsx:111`) remain **untouched** — `localStore.getQuery` / `localStore.setQuery` on `listChatSourcesWithInclusion` still works because the provider subscribes to the same query.
- `useSkipWhenHidden` helper (new, `lib/chat/use-skip-when-hidden.ts`) — returns `"skip"` when `document.visibilityState === "hidden"`, else returns the passed args. Wired into the provider's `useQuery` call.
- Tests: TDD the pure helper. Test-after for the provider's behavior contract (via behavioral assertions on `data-papers-rows`, `data-papers-included-count`, etc.).

**Out of scope**

- Virtualization (plan 02).
- `useDeferredValue` on search (plan 03).
- Server throttle change (plan 04).
- Any change to `chatPapers` Convex schema or mutations (none needed).
- Any change to the optimistic-update helpers (`lib/chat/chat-papers-selection.ts`).

## Design

### 1. The pure helper — `lib/chat/stabilize-rows.ts`

Signature:

```ts
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Reuses the previous row object when structural fields are unchanged.
 * Preserves React.memo identity across Convex transitions that return
 * fresh object trees for structurally-equal data.
 *
 * Pure. Input array is not mutated. Output array length === input length.
 */
export function stabilizeRowsById(
  prev: ReadonlyArray<ChatSourceRow> | undefined,
  next: ReadonlyArray<ChatSourceRow>,
): ChatSourceRow[] {
  if (prev === undefined || prev.length === 0) return next.slice();

  const prevById = new Map<Id<"chatPapers">, ChatSourceRow>();
  for (const row of prev) prevById.set(row.chatPaperId, row);

  const out: ChatSourceRow[] = new Array(next.length);
  for (let i = 0; i < next.length; i += 1) {
    const incoming = next[i]!;
    const old = prevById.get(incoming.chatPaperId);
    out[i] = old && rowsStructurallyEqual(old, incoming) ? old : incoming;
  }
  return out;
}

export function rowsStructurallyEqual(a: ChatSourceRow, b: ChatSourceRow): boolean {
  // Identity fast path (same object).
  if (a === b) return true;

  // Fields that affect what the row renders or how it sorts/filters/searches.
  // Add fields here if `ChatSourceRow` grows — the shallow compare must cover
  // every field read by the row renderer or any downstream memo.
  return (
    a.chatPaperId === b.chatPaperId &&
    a.sourceId === b.sourceId &&
    a.position === b.position &&
    a.included === b.included &&
    a.sourceType === b.sourceType &&
    a.title === b.title &&
    a.year === b.year &&
    a.doi === b.doi &&
    a.openalexId === b.openalexId &&
    a.abstract === b.abstract &&
    // authors is `readonly string[]` — shallow compare by length + element.
    sameStringArray(a.authors, b.authors) &&
    // Optional fields — normalize undefined vs null vs missing.
    (a.bucketKey ?? null) === (b.bucketKey ?? null)
  );
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

**Why this is pure-logic and not a hook**: it takes `prev`/`next` and returns a new array. The provider owns the `prev` via `useRef`, hands it in, and replaces on return. Pure function → trivial TDD → zero React churn.

**Why shallow compare, not deep**: `abstract` can be thousands of characters. Shallow compare on primitive fields + length-+-element compare on `authors` is O(k) per row with small constants. `stabilizeRowsById(prev, next)` is O(N) total. At 1k rows this is sub-millisecond.

### 2. The tab-visibility pause helper — `lib/chat/use-skip-when-hidden.ts`

```ts
"use client";
import { useEffect, useState } from "react";

/**
 * Returns `"skip"` when the document is hidden, else `args`.
 * Causes Convex `useQuery(fn, hidden ? "skip" : args)` to unsubscribe
 * while the tab is backgrounded, saving subscription cost per the T3 Chat
 * post-mortem (news.convex.dev/how-convex-took-down-t3-chat-june-1-2025-postmortem).
 *
 * No re-subscription churn on visible→hidden→visible: Convex's arg-memo
 * (client.ts:869, `JSON.stringify(convexToJson(...))`) keys on structural
 * identity, so toggling between `"skip"` and an object with identical content
 * does not cause spurious re-registrations.
 */
export function useSkipWhenHidden<T>(args: T): T | "skip" {
  const [hidden, setHidden] = useState(() =>
    typeof document !== "undefined" && document.visibilityState === "hidden",
  );

  useEffect(() => {
    const onChange = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return hidden ? ("skip" as const) : args;
}
```

SSR-safe: the initial state only reads `document.visibilityState` when `document` exists. On the server this falls through to `false` (not hidden).

### 3. The provider — `components/extraction/chat/papers-context.tsx`

Before (current, 23 lines):

```ts
export type PapersContextValue = {
  papersByPosition: ReadonlyMap<number, ResolvablePaper>;
  jobId: Id<"extractionJobs">;
};

export const PapersContext = createContext<PapersContextValue | null>(null);
// + usePapersContext() throws if outside provider
```

After:

```tsx
"use client";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResolvablePaper } from "@/lib/chat/resolve-paper";
import { resolvePaperFromRow } from "@/lib/chat/resolve-paper";
import { stabilizeRowsById } from "@/lib/chat/stabilize-rows";
import { useSkipWhenHidden } from "@/lib/chat/use-skip-when-hidden";

export type PapersContextValue = {
  jobId: Id<"extractionJobs">;
  rows: ReadonlyArray<ChatSourceRow>;              // stabilized by id
  rowsById: ReadonlyMap<Id<"chatPapers">, ChatSourceRow>;
  papersByPosition: ReadonlyMap<number, ResolvablePaper>;
  totalCount: number;
  includedCount: number;
  isLoading: boolean;                              // true while Convex is fetching
};

const PapersContext = createContext<PapersContextValue | null>(null);

export function usePapersContext(): PapersContextValue {
  const ctx = useContext(PapersContext);
  if (!ctx) {
    throw new Error(
      "usePapersContext must be used within ChatPapersProvider",
    );
  }
  return ctx;
}

export function ChatPapersProvider({
  jobId,
  children,
}: {
  jobId: Id<"extractionJobs">;
  children: ReactNode;
}) {
  const skipArgs = useSkipWhenHidden({ jobId });
  const raw = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, skipArgs);

  const prevRef = useRef<ChatSourceRow[] | undefined>(undefined);
  const rows = useMemo(() => {
    if (raw === undefined) return prevRef.current ?? [];
    const stable = stabilizeRowsById(prevRef.current, raw);
    prevRef.current = stable;
    return stable;
  }, [raw]);

  const rowsById = useMemo(() => {
    const map = new Map<Id<"chatPapers">, ChatSourceRow>();
    for (const row of rows) map.set(row.chatPaperId, row);
    return map;
  }, [rows]);

  const papersByPosition = useMemo(() => {
    const map = new Map<number, ResolvablePaper>();
    for (const row of rows) map.set(row.position, resolvePaperFromRow(row));
    return map;
  }, [rows]);

  const totalCount = rows.length;
  const includedCount = useMemo(
    () => rows.reduce((n, r) => n + (r.included ? 1 : 0), 0),
    [rows],
  );

  const value = useMemo<PapersContextValue>(
    () => ({
      jobId,
      rows,
      rowsById,
      papersByPosition,
      totalCount,
      includedCount,
      isLoading: raw === undefined,
    }),
    [jobId, rows, rowsById, papersByPosition, totalCount, includedCount, raw],
  );

  return (
    <PapersContext.Provider value={value}>{children}</PapersContext.Provider>
  );
}

export { PapersContext };   // keep named export for tests that render with a fake value
```

**Key properties:**

- `rows` reference is **stable when contents are stable**. Typing in the search input does not mutate rows → consumers that only read `rows` do not re-render.
- `rows` is the same array reference that downstream row components' `React.memo` will compare against.
- `papersByPosition` reconstruction is O(N) per `rows` identity change — cheap, and only fires when rows actually change (thanks to D2).
- `resolvePaperFromRow` is an existing function in `lib/chat/resolve-paper.ts` — this plan does not modify it. Grep first; if the current code inlines the resolution in `message-list.tsx:304-324`, extract to the helper as part of this plan.
- `raw === undefined` (loading) keeps `prevRef.current` so we render the last-good list during tab-visibility transitions.

### 4. Consumer migrations

**`message-list.tsx`** — remove local `useQuery` + `papersByPosition` build:

```tsx
// BEFORE (around line 299)
const chatSources = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
const papersByPosition = useMemo(() => { /* build map */ }, [chatSources]);
const papersContextValue = useMemo(() => ({ papersByPosition, jobId }), [papersByPosition, jobId]);

return (
  <PapersContext.Provider value={papersContextValue}>
    <Conversation>...</Conversation>
  </PapersContext.Provider>
);

// AFTER
// Remove the useQuery, the useMemo, and the Provider — the provider now lives in
// ChatJobView. MessageList just renders the Conversation; PaperCitation reads
// context from up the tree.
return <Conversation>...</Conversation>;
```

**`message-composer.tsx`** — reads counts from context:

```tsx
// BEFORE
const chatSources = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId: job._id });
const totalSources = chatSources?.length ?? 0;
const includedSources = chatSources?.filter((r) => r.included).length ?? 0;
const hasNoSourcesIncluded = chatSources !== undefined && includedSources === 0;

// AFTER
const { totalCount: totalSources, includedCount: includedSources, isLoading } =
  usePapersContext();
const hasNoSourcesIncluded = !isLoading && includedSources === 0;
```

**`sources-panel/sources-panel.tsx`** — pulls rows from context:

```tsx
// BEFORE (inside SourcesPanelInner around line 55)
const rawRows = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
const rows = rawRows ?? [];

// AFTER
const { rows, isLoading } = usePapersContext();
// The `rows` variable is the stabilized array; pass directly to useSourcesPanelState(rows).
```

**`sources-panel/sources-panel-sheet.tsx`** — badge reads counts from context:

```tsx
// BEFORE (line 34-36)
const rows = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
const total = rows?.length ?? 0;
const included = rows?.filter((r) => r.included).length ?? 0;

// AFTER
const { totalCount: total, includedCount: included } = usePapersContext();
```

### 5. The mount point — `components/extraction/chat/chat-job-view.tsx`

```tsx
// BEFORE (simplified)
export function ChatJobView({ job, threadId }: Props) {
  useChatShortcuts();
  return (
    <TwoColumnLayout>
      <SourcesPanel jobId={job._id} />
      <div>
        <ChatHeader job={job} threadId={threadId} />
        <MessageList threadId={threadId} jobId={job._id} chatModelId={...} />
        <MessageComposer job={job} threadId={threadId} />
      </div>
    </TwoColumnLayout>
  );
}

// AFTER
export function ChatJobView({ job, threadId }: Props) {
  useChatShortcuts();
  return (
    <ChatPapersProvider jobId={job._id}>
      <TwoColumnLayout>
        <SourcesPanel jobId={job._id} />
        <div>
          <ChatHeader job={job} threadId={threadId} />
          <MessageList threadId={threadId} jobId={job._id} chatModelId={...} />
          <MessageComposer job={job} threadId={threadId} />
        </div>
      </TwoColumnLayout>
    </ChatPapersProvider>
  );
}
```

The provider wraps every chat-surface descendant, including `ChatHeader` (which mounts `SourcesPanelSheet` per `chat-header.tsx:81`).

### 6. The `PaperCitation` consumer — unchanged contract

`paper-citation.tsx:104` calls `usePapersContext()` and destructures `{ papersByPosition, jobId }`. Both fields remain on the widened value. **No change required.** Tests that mount `<PapersContext.Provider value={{ papersByPosition, jobId }}>` (currently at `tests/components/paper-citation.test.tsx:43`, `tests/a11y/paper-citation.axe.test.tsx:40`, `tests/components/chat-citation-render.test.tsx:66`) must be updated to include the new required fields: `rows`, `rowsById`, `totalCount`, `includedCount`, `isLoading`. Since those fields are just for other consumers, test fixtures can pass `rows: [], rowsById: new Map(), totalCount: 0, includedCount: 0, isLoading: false`. Citation pill behavior is unaffected.

### 7. Row memo wiring (groundwork for plan 02)

Although the virtualized renderer is plan 02's job, this plan **does** wrap `SourceRow` in `React.memo` with an identity comparator so that D2's ref-stability pays off immediately even in the non-virtualized current list:

```tsx
// components/extraction/chat/sources-panel/source-row.tsx
export const SourceRow = memo(SourceRowImpl, (prev, next) => {
  return (
    prev.row === next.row &&
    prev.match === next.match &&
    prev.query === next.query &&
    prev.isActiveDescendant === next.isActiveDescendant &&
    prev.onToggle === next.onToggle
  );
});
```

`onToggle` is passed from `sources-panel-list.tsx:61-93`; must be wrapped in a `useCallback` with stable deps (`jobId`, `toggleChatPaper` mutation ref) there. Grep confirms it currently is (stable reference across renders); no change needed if already `useCallback`'d.

## TDD sequence (pure logic only)

### `lib/chat/stabilize-rows.test.ts`

```
R1 → G1   empty prev, empty next → []
R2 → G2   undefined prev, non-empty next → structural copy of next (new array, same element refs)
R3 → G3   identical prev & next (same rows, same refs) → every element ref preserved
R4 → G4   one row's `included` flipped → that row gets new ref, all other rows preserve prev ref
R5 → G5   one row's `position` changed → that row gets new ref, others preserved
R6 → G6   one row's `title` changed → new ref for that row
R7 → G7   row removed from next → removed row absent; surviving rows preserve prev refs
R8 → G8   row added to next → new row is next's object ref, old rows preserve prev refs
R9 → G9   row reordered (same data, different position array index) → if its fields match
             the prev row at the same id, ref is preserved; position is a field though,
             so if position changed, new ref (see R5). Encode: reorder-with-equal-position
             preserves; reorder-with-changed-position does not. Add both test cases.
R10→ G10  authors array: same content, different ref → rows considered equal (ref preserved)
R11→ G11  authors array: different content same length → rows considered not equal (new ref)
R12→ G12  authors array: different length → not equal
R13→ G13  pure — neither prev nor next mutated after call
R14→ G14  N=1000 rows, zero changes → output reuses all 1000 prev refs (identity check)
R15→ G15  N=1000 rows, one change → 999 prev refs preserved, 1 new ref (identity check)
REFACTOR  extract `rowsStructurallyEqual` as own export if it's not already; re-run green.
```

**Plan 01 Phase A (TDD):** the test suite above. Red → green → commit per green.

**Plan 01 Phase B (test-after):** provider, consumer migrations, sheet badge, tab-visibility helper.

## Files touched

### New files

- `lib/chat/stabilize-rows.ts` + `.test.ts` (pure, TDD)
- `lib/chat/use-skip-when-hidden.ts` (small hook, test-after)

### Modified

- `components/extraction/chat/papers-context.tsx` — widen value, add `ChatPapersProvider` wrapper, consume `useQuery` + `useSkipWhenHidden` + `stabilizeRowsById`.
- `components/extraction/chat/chat-job-view.tsx` — mount `<ChatPapersProvider jobId={job._id}>` around the layout.
- `components/extraction/chat/message-list.tsx` — remove `useQuery`, remove local `papersByPosition` / `papersContextValue` / `<PapersContext.Provider>` wrapper; `PaperCitation` pills already read from context.
- `components/extraction/chat/message-composer.tsx` — replace `useQuery` with `usePapersContext()`; counts come from `totalCount` / `includedCount`.
- `components/extraction/chat/sources-panel/sources-panel.tsx` — replace `useQuery` with `usePapersContext()` in `SourcesPanelInner`.
- `components/extraction/chat/sources-panel/sources-panel-sheet.tsx` — replace `useQuery` with `usePapersContext()` for the closed-state badge.
- `components/extraction/chat/sources-panel/source-row.tsx` — wrap `SourceRow` in `React.memo` with identity comparator (groundwork for plan 02).
- `lib/chat/resolve-paper.ts` — **only** if the current row-to-resolvable conversion is inlined in `message-list.tsx:304-324`; if so, extract to a `resolvePaperFromRow(row)` named export. Grep first.
- Tests that render a fake `PapersContext` value (`tests/components/paper-citation.test.tsx:43`, `tests/a11y/paper-citation.axe.test.tsx:40`, `tests/components/chat-citation-render.test.tsx:66`, `tests/components/message-composer.test.tsx` if it mocks `useQuery`, `tests/components/sources-panel/*.test.tsx` for the various panel tests) — update fixture to include the new required fields. Make a shared `tests/helpers/papers-context-fixture.ts` exporting a `fakePapersContext(overrides)` helper.

### Dependencies

- **No new deps.** `convex/react` already present.

## Migration stance — **none**

No schema changes. No mutation changes. Provider hoisting is a pure client-side refactor. Dev data untouched.

## Test plan

### Unit (pure — covered in TDD sequence above)

- `stabilizeRowsById` — 15 cases including large-N identity-preservation check.

### Behavior (RTL — `tests/components/papers-context.test.tsx`, new)

- **provider exposes rows from useQuery**: mock `useQuery` to return `[row1, row2, row3]`, render `<ChatPapersProvider jobId>`, a test consumer reads `usePapersContext().rows`, assert exactly those rows (by content).
- **provider stabilizes rows across identical updates**: mock `useQuery` to return the same rows twice with new object refs, assert consumer's `rows` reference is identical on re-render.
- **provider propagates included/total counts**: 3 rows, 2 included → consumer sees `totalCount: 3, includedCount: 2`.
- **provider sets isLoading true before first result**: `useQuery` returns `undefined` → `isLoading: true`, `rows: []`.
- **`useSkipWhenHidden` returns `"skip"` when document hidden**: mock `document.visibilityState`, assert the `useQuery` spy is called with `"skip"`.
- **`useSkipWhenHidden` resumes on visibility change**: dispatch a `visibilitychange` event, assert `useQuery` is re-called with the original args.

### Behavior (RTL — existing files that changed)

All of the below use existing fixture helpers; all changes are "replace `useQuery` mock with a `ChatPapersProvider` render wrapper". Assertions on behavior do not change.

- **`sources-panel-list.test.tsx`**: wrap renders in `<ChatPapersProvider value={fakePapersContext({ rows: [...] })}>`; existing assertions on `data-paper-included`, `role="option"`, etc., unchanged.
- **`sources-panel.axe.test.tsx`**: same wrap. Axe assertions unchanged.
- **`sources-panel-sheet.test.tsx`**: wrap; assert the mobile-trigger text comes from context counts.
- **`message-composer.test.tsx`**: wrap; existing send-disabled-when-zero behavior still passes.
- **`paper-citation.test.tsx`** / **`paper-citation.axe.test.tsx`** / **`chat-citation-render.test.tsx`**: extend the existing `<PapersContext.Provider value={...}>` fixture to include new required fields.

### Behavior (new — `tests/components/chat-job-view.test.tsx`, new file if it doesn't exist)

- **mounting ChatJobView mounts ChatPapersProvider**: render `<ChatJobView job={...} threadId={...} />` with `useQuery` mocked to return 3 rows; assert a descendant test component reading `usePapersContext()` sees `rows.length === 3`.
- **a single `useQuery` call per mount**: spy on `useQuery` — after mounting ChatJobView, assert it was called **exactly once** for `listChatSourcesWithInclusion`. (This is the single most important behavioral assertion of this plan.)

### Integration (full chat tree render)

- **typing in the sources search does not re-render unchanged rows**: use `@testing-library/react` with a render-count spy on `SourceRow`. Type one character in the search field; assert that rows whose `row` reference did not change did NOT re-render. (Granularity note: React-render counting is fragile; prefer a `data-render-count` attribute on each row, incremented in a `useEffect`, then read counts before/after typing. Reset via `remount`.)

### No perf benchmark here — plan 04 owns benchmarks

## Acceptance criteria

- [ ] `lib/chat/stabilize-rows.ts` exists, all 15 TDD tests green.
- [ ] `lib/chat/use-skip-when-hidden.ts` exists with SSR-safe initial state.
- [ ] `ChatPapersProvider` mounts at `ChatJobView` wrapping the layout.
- [ ] `grep -rn "useQuery(api\.chat\.chatPapers\.listChatSourcesWithInclusion" components/` returns **exactly one** hit — inside `papers-context.tsx`.
- [ ] `usePapersContext()` is called from `message-list.tsx`, `message-composer.tsx`, `sources-panel.tsx`, `sources-panel-sheet.tsx`, `paper-citation.tsx` (the original consumer — unchanged).
- [ ] `PaperCitation` tests still pass with updated fixture.
- [ ] `SourceRow` is `memo()`'d with identity comparator.
- [ ] Behavioral test confirms `useQuery` is called once per `ChatJobView` mount.
- [ ] Behavioral test confirms typing in search does not cause `SourceRow` re-renders for rows whose underlying `row` reference is stable.
- [ ] Tab-visibility pause verified: dispatching `visibilitychange` to `hidden` causes `useQuery` to receive `"skip"`.
- [ ] All existing behavioral tests green.
- [ ] No CSS-class assertions introduced.

## Known pitfalls

- **Provider placement must be above `ChatHeader`.** `ChatHeader` mounts `SourcesPanelSheet`, which now reads context. If the provider is placed inside the main content column instead of wrapping `TwoColumnLayout`, the mobile sheet will throw "usePapersContext must be used within ChatPapersProvider". Verify the mount site covers `ChatHeader` too.
- **`resolvePaperFromRow` extraction may be gratuitous.** If `message-list.tsx:304-324`'s inlined resolver is not a one-liner, don't extract — keep it inline in the provider `useMemo`. Over-extraction for its own sake violates rule #3 ("no speculative abstraction").
- **`rowsById` vs `papersByPosition`** — both derived, both rebuilt on rows-identity change. They are NOT both needed if no consumer reads `rowsById`; grep after wiring. If nothing reads it, drop it from the value. (Prediction: `rowsById` is useful in plan 03 for O(1) row lookup during keyboard navigation; keep for now but revisit at plan 03's time.)
- **SSR hydration — `useSkipWhenHidden`**: initial state reads `document.visibilityState` under a `typeof document !== "undefined"` guard. On the server the fallback is `false`. If the hydration pass mismatches (unlikely since Convex is client-only), add `suppressHydrationWarning` on the nearest root — but this is not expected to be an issue because `ChatJobView` is already a client component.
- **Tests that directly mock `useQuery`** — if a test spies on `useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, ...)` at the component level, it will now get `"skip"` or `{ jobId }` from the provider. Migrate these tests to mock the provider instead (via `fakePapersContext` fixture) — don't mock `useQuery` downstream of the provider.
- **Optimistic-update call sites still call `localStore.getQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId })`** — this reads from Convex's shared cache, not from our provider. Remains correct. The provider is a subscription on the same cache key; writes and reads via `localStore.*` are seen by the provider's `useQuery` and propagated into our stabilized `rows`.
- **`sources-panel-sheet.tsx`'s `useIsMobile()` gate** — the sheet early-returns `null` on desktop (per inventory at `sources-panel-sheet.tsx:40`). Because `usePapersContext()` is called unconditionally at the top of the component, the throw-if-missing guard is hit only when the sheet is actually mounted (mobile). Fine.
- **React Compiler interaction** — `ChatPapersProvider` uses `useRef` + `useMemo` together in a pattern the Compiler may try to re-memoize. Verify at execution time. If the Compiler over-memoizes the `prevRef.current = stable` assignment away, add `'use no memo'` to the provider file. Plan 04 verifies.
