# Plan 02 — Virtualize Sources List + Strip Per-Row Motion

**Depends on:** 01 (stable row refs + single subscription). **Blocks:** 04 (measurement baseline for virtualized path).

## Goal

Replace the non-virtualized `sources-panel-list.tsx` with a `@tanstack/react-virtual` rendering path so only ~overscan+viewport rows exist in the DOM at once (~20 nodes instead of 1,000 at scale). Drop the per-row `motion.div layout="position"` + `AnimatePresence` wrapper (the biggest frame-time sink per the research). Preserve the full WAI-ARIA listbox contract, existing keyboard hook, optimistic mutation wiring, and row visual semantics.

Implements decisions **D3** (tanstack-virtual), **D4** (drop per-row motion layout), **D10** (React Compiler opt-out), **D11** (mobile sheet reuses the same list).

## Scope

**In scope**

- Install `@tanstack/react-virtual` (latest v3 — `3.13.x` as of 2026-04).
- Rewrite `components/extraction/chat/sources-panel/sources-panel-list.tsx` to use `useVirtualizer`.
- Add `'use no memo'` pragma at the top of the file per TanStack Virtual issues #736, #1119 (React Compiler over-memoizes the virtualizer return).
- Remove `AnimatePresence` wrapper and per-row `motion.div layout="position"` + `initial`/`animate`/`exit`.
- Keep the `motion.span` checkbox-pop (scale keyframes on toggle) — it's per-interaction, not per-row.
- Preserve every ARIA attribute, `data-*` attribute, and keyboard hook wiring currently on the list.
- Wire `useVirtualizer.scrollToIndex(activeIndex, { align: "auto" })` on active-descendant change so keyboard nav keeps the focused row in view.
- Verify the mobile `Sheet` variant inherits the change automatically via `SourcesPanelInner`.
- Behavior tests for virtualization-specific contracts: `data-virtualized="true"`, `data-visible-rows="N"`.

**Out of scope**

- Virtualizing the message list (D7 — not worth it given short messages + paginated ceiling).
- Changing the sort/filter pipeline (plan 03).
- Changing the keyboard contract (the hook is already correct).
- Any server changes.

## Design

### 1. Install

```bash
npm install @tanstack/react-virtual@^3.13.0
```

Verify at execution time: fetch `npm view @tanstack/react-virtual version` for the latest published 3.x. If v4 has shipped, **stop and re-research** — v4's API may differ.

### 2. Component file structure — `sources-panel-list.tsx`

The file keeps the same name, exports, and props. Internal implementation swaps to the virtualizer.

Top of file:

```tsx
// eslint-disable-next-line react-hooks/rules-of-hooks  -- required for `use no memo` directive; remove if TanStack/virtual fixes #1119.
'use no memo';
'use client';

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMutation } from 'convex/react';
// ... existing imports
```

The `'use no memo'` directive is a React Compiler escape hatch. It disables Compiler-generated memoization for this one file. Per TanStack/virtual#736 and #1119 (both open as of Jan 2026), the Compiler's auto-memoization breaks `useVirtualizer`'s internal mutable state. The directive is additive — Compiler-off on this file; every other file in the app remains optimized.

### 3. The virtualized list

```tsx
type Props = {
  rows: ReadonlyArray<ChatSourceRow>;        // from plan 01 — stabilized refs
  matches: ReadonlyMap<string, SearchMatch>;
  query: string;
  activeId: string | null;                    // from use-sources-panel-keyboard
  setActiveId: (id: string | null) => void;
  reduceMotion: boolean;
};

export function SourcesPanelList({ rows, matches, query, activeId, setActiveId, reduceMotion }: Props) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const activeIndex = useMemo(
    () => (activeId ? rows.findIndex((r) => `src-row-${r.chatPaperId}` === activeId) : -1),
    [rows, activeId],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 76,          // title 2 lines + meta row; snippet expands dynamically
    overscan: 8,
    getItemKey: (i) => rows[i]!.chatPaperId,
    // measureElement lets variable-height rows (with/without snippet) be measured post-mount.
    measureElement: (el) => el?.getBoundingClientRect().height,
  });

  // Keep the active descendant visible during keyboard navigation.
  useEffect(() => {
    if (activeIndex < 0) return;
    rowVirtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, rowVirtualizer]);

  // Mutations — unchanged from pre-virtualization code.
  const toggleChatPaper = useMutation(api.chat.chatPapers.toggleChatPaper)
    .withOptimisticUpdate((localStore, { chatPaperId, included }) => {
      const current = localStore.getQuery(
        api.chat.chatPapers.listChatSourcesWithInclusion,
        { jobId: rows[0]?.jobId ?? ('' as Id<'extractionJobs'>) },
      );
      if (!current) return;
      const patched = applyInclusionPatch(current, { [chatPaperId]: included });
      localStore.setQuery(
        api.chat.chatPapers.listChatSourcesWithInclusion,
        { jobId: rows[0]?.jobId ?? ('' as Id<'extractionJobs'>) },
        patched,
      );
    });

  const onToggle = useCallback(
    (chatPaperId: Id<'chatPapers'>, included: boolean) =>
      toggleChatPaper({ chatPaperId, included }),
    [toggleChatPaper],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={scrollParentRef}
      role="listbox"
      aria-multiselectable="true"
      aria-label={/* existing i18n key */ t('sourcesPanel.listLabel')}
      aria-activedescendant={activeId ?? undefined}
      tabIndex={0}
      data-virtualized="true"
      data-visible-rows={virtualItems.length}
      data-total-rows={rows.length}
      className="relative h-full w-full overflow-auto"
      // keyDown handlers come from use-sources-panel-keyboard — wired by parent
    >
      <div
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
      >
        {virtualItems.map((virtualItem) => {
          const row = rows[virtualItem.index]!;
          const match = matches.get(row.chatPaperId) ?? EMPTY_MATCH;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SourceRow
                row={row}
                match={match}
                query={query}
                isActiveDescendant={activeId === `src-row-${row.chatPaperId}`}
                onToggle={(included) => onToggle(row.chatPaperId, included)}
                reduceMotion={reduceMotion}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const EMPTY_MATCH: SearchMatch = { score: 0, field: null };
```

**Key properties:**

- `count: rows.length` — virtualizer renders only `overscan` (8) rows above/below the viewport.
- `estimateSize: () => 76` — initial height guess; `measureElement` refines post-mount. Rows with a match snippet are ~100px; without, ~60px. 76 is the weighted mean for a mixed corpus.
- `getItemKey: (i) => rows[i]!.chatPaperId` — stable IDs, critical for React reconciliation across scroll.
- `overscan: 8` — 8 rows above + 8 below the visible area. Tuned for smooth keyboard navigation; re-measure at plan 04's benchmark.
- `measureElement: (el) => el?.getBoundingClientRect().height` — needed for the "row with snippet vs without" height difference.
- `aria-activedescendant` flows from the keyboard hook unchanged; `scrollToIndex` effect keeps that row rendered and in view.
- `data-virtualized="true"` — behavioral contract exposed for tests.
- `data-visible-rows={virtualItems.length}` — test can assert that at N=1000, fewer than 30 rows (viewport+overscan) are rendered.

### 4. Motion reduction

**Before** (`sources-panel-list.tsx:145-206`):

```tsx
<AnimatePresence initial={false}>
  {rows.map((row, index) => (
    <motion.div
      key={row.chatPaperId}
      layout={reduceMotion ? false : 'position'}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <motion.span
        animate={row.included ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.18 }}
      >
        <Checkbox ... />
      </motion.span>
      <SourceRow ... />
    </motion.div>
  ))}
</AnimatePresence>
```

**After:** the absolute-positioned virtualized rows have no enter/exit (rows are always present logically; they only mount/unmount as the user scrolls). `AnimatePresence` wrapping is gone. `layout="position"` is gone (incompatible with absolute positioning + FLIP).

The checkbox pop `motion.span` moves **inside `SourceRow`** where it belongs:

```tsx
// source-row.tsx
import { motion, useReducedMotion } from 'motion/react';

// ... inside the row's render
<motion.span
  initial={false}
  animate={row.included ? { scale: [1, 1.18, 1] } : { scale: 1 }}
  transition={{ duration: reduceMotion ? 0 : 0.18 }}
  aria-hidden
>
  <Checkbox
    checked={row.included}
    onCheckedChange={(v) => onToggle(v === true)}
    data-paper-included={row.included}
  />
</motion.span>
```

Only one `motion.span` is rendered per visible row (~20 at most). The scale animation fires on the one row the user interacts with.

**Enter fade**: CSS-only via `@starting-style` — no JS animation. In the row component:

```tsx
<div
  className={cn(
    'source-row-enter',    // CSS class defined globally
    row.included ? 'opacity-100' : 'opacity-60',
  )}
>
```

In the global CSS (next to the existing `motion` utilities, e.g., in a `.source-row-enter` utility rule):

```css
.source-row-enter {
  animation: source-row-fade-in 140ms ease-out;
}
@keyframes source-row-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .source-row-enter { animation: none; }
}
```

This is strictly cheaper than `motion.div` + `AnimatePresence`: the browser compositor handles the animation; React never re-renders for the fade; no JS-layer reconciliation of "entering" vs "present" rows.

**Existing `useReducedMotion()` usage** in the row (for the checkbox pop) stays. Pattern matches the 18+ other callers in the repo (inventory agent confirmed).

### 5. Keyboard hook integration — unchanged contract

`use-sources-panel-keyboard.ts` already:

- Maintains `activeId` local state.
- Handles `↑`/`↓` to move active, `Space`/`Enter` to toggle active, `⌘A`/`Shift+⌘A`/`/`/`Esc`/`Shift+↑↓`.
- Returns `{ activeId, setActiveId, onKeyDown, listRef }`.

This plan's list **consumes** `activeId` and `setActiveId`; `onKeyDown` attaches to the listbox container (unchanged wiring from the current `sources-panel.tsx`).

The only new piece is the `useEffect` inside `SourcesPanelList` that calls `scrollToIndex(activeIndex, { align: 'auto' })` whenever `activeIndex` changes. Without this, pressing `↓` past the visible viewport would move `activeId` off-screen with no scroll follow-up — the focus ring would vanish.

### 6. Scroll restoration + filter changes

When `rows` changes (user filters / searches / sorts), the total height changes. TanStack Virtual re-measures automatically, but scroll position is preserved in pixels — so if the user was 300px scrolled, they might now be at a different logical position. Acceptable for v1. If this feels jarring at execution, add:

```tsx
useEffect(() => {
  // Reset scroll to top on rows length change (e.g., chip filter applied).
  // Optional — only if feedback indicates current behavior is bad.
  scrollParentRef.current?.scrollTo({ top: 0 });
}, [rows.length]);
```

Defer the decision to plan 04's manual QA pass.

### 7. Height of the scroll container

The `<div ref={scrollParentRef}>` needs an explicit height. In the desktop rail this is handled by its parent layout (`sources-panel.tsx` — a flex column with `flex-1` on the list region). In the mobile sheet it's handled by `SheetContent`'s fixed height. Verify both render paths give the list a bounded parent height — else `overflow-auto` will have nothing to constrain and the virtualizer will render all rows.

Verification step during execution: temporarily add `style={{ outline: '1px solid red' }}` to `scrollParentRef`'s div during dev, confirm it has a definite height in both desktop and mobile layouts. Then remove.

### 8. The mobile `Sheet` — free

`sources-panel-sheet.tsx` already mounts `<SourcesPanelInner jobId={jobId} />` inside a `<SheetContent className="w-[90vw] max-w-md p-0">` (`sources-panel-sheet.tsx:58-68`). `SourcesPanelInner` contains the `SourcesPanelList` we're rewriting. **No change needed** — the virtualization flows through for free. Verify at execution.

## TDD sequence (pure logic only)

**None.** There's no new pure logic in this plan. All changes are to React components and the virtualizer integration; tests are behavior-after.

## Files touched

### Modified

- `components/extraction/chat/sources-panel/sources-panel-list.tsx` — full rewrite of the list rendering (not the mutation wiring). Keep exports and props identical. Add `'use no memo'` pragma.
- `components/extraction/chat/sources-panel/source-row.tsx` — move the checkbox `motion.span` into this file; add the `source-row-enter` class.
- Global CSS (likely `app/globals.css` or `styles/globals.css` — grep to confirm) — add `.source-row-enter` keyframes + reduced-motion override.
- `tests/components/sources-panel/sources-panel-list.test.tsx` — extend with virtualization behavior assertions.
- `tests/components/sources-panel/sources-panel-sheet.test.tsx` — verify the sheet path renders the virtualized list.

### Dependencies

- **New:** `@tanstack/react-virtual@^3.13.0`.
- No other adds.

## Migration stance — **none**

No schema changes. Pure client-side refactor.

## Test plan

All assertions via `getByRole`, `getByText`, `data-*`. Never `.toHaveClass(...)`.

### Behavior (RTL — `sources-panel-list.test.tsx`)

- **virtualization flag exposed**: render with 3 rows → listbox has `data-virtualized="true"`.
- **visible-rows count reflects viewport**: mock `scrollParentRef.current.clientHeight = 300` and row height 76 → `data-visible-rows` ≤ 4 + overscan 8 = 12 (assert `<= 20` for robustness; JSDOM layout is unreliable for exact counts).
- **large-N DOM count**: render 1,000 rows → `document.querySelectorAll('[role="option"]').length` is ≤ 30 (viewport + overscan, not 1000). THIS IS THE KEY ASSERTION.
- **keyboard nav scrolls into view**: press `↓` 30 times (past viewport), assert the active row's `<div>` is still mounted in the DOM (virtualizer kept it in view).
- **filter change updates count**: render 100 rows → filter to 5 rows → `data-total-rows="5"`, `data-visible-rows` reduced accordingly.
- **row toggle still optimistic**: click a checkbox, assert `data-paper-included` flips before mutation resolves.
- **ARIA preserved**: assert `role="listbox"`, `aria-multiselectable="true"`, `aria-activedescendant` updates with keyboard nav.
- **data-paper-source preserved on every rendered row**.
- **reduced-motion disables checkbox pop**: mock `useReducedMotion()` → `true`, toggle a row, assert the `motion.span`'s resolved `transition.duration` is `0`. (May need a test-only `data-motion-duration` attribute for assertion — or assert by absence of `transform` in computed style. Use the former; cleaner contract.)

### Behavior (RTL — `sources-panel-sheet.test.tsx`)

- **mobile sheet renders virtualized list**: mock `useIsMobile() → true`, click trigger, assert the rendered SheetContent contains `[data-virtualized="true"]`.
- **closed-state badge**: verify the sheet trigger text uses `totalCount` / `includedCount` from context (set up via `<ChatPapersProvider>` in test, as per plan 01's fixture helper).

### Accessibility (axe)

- Run axe on the virtualized list with 500 rows → zero violations. The virtualized-only rendering still needs `aria-posinset` + `aria-setsize` on each `role="option"` for screen readers. Add them:

```tsx
<div
  role="option"
  aria-posinset={virtualItem.index + 1}
  aria-setsize={rows.length}
  ...
>
```

### Manual QA (documented in the plan's execution log, not automated)

- Scroll 1,000 rows with mouse wheel — smooth, no jank.
- Keyboard-nav through 100 rows with `↓` held — focus ring follows smoothly, no lag.
- Type in search — no typing lag (plan 03 will further smooth this via `useDeferredValue`).
- Toggle a row while scroll is mid-motion — no visual glitch.
- Reduced-motion on → no fade, no pop.
- Mobile sheet → open/close → scroll within the sheet.

## Acceptance criteria

- [ ] `@tanstack/react-virtual` installed at `^3.13.0` or latest 3.x.
- [ ] `sources-panel-list.tsx` rewritten with `useVirtualizer`; `'use no memo'` pragma present at the top.
- [ ] At `rows.length === 1000`, rendered DOM contains ≤ 30 `[role="option"]` elements (viewport + overscan).
- [ ] `AnimatePresence` removed from `sources-panel-list.tsx`.
- [ ] Per-row `motion.div layout="position"` removed.
- [ ] Checkbox pop (`motion.span scale`) moved into `source-row.tsx`, fires only on toggle.
- [ ] `.source-row-enter` CSS class added with `prefers-reduced-motion: reduce` override.
- [ ] `aria-activedescendant`, `aria-posinset`, `aria-setsize` correct per WAI-ARIA APG.
- [ ] Keyboard nav (`↑`/`↓`) scrolls the virtualized viewport to keep the active row visible.
- [ ] Mobile sheet renders the same virtualized list (inherited via `SourcesPanelInner`).
- [ ] Existing behavioral tests for `sources-panel-list`, `sources-panel-sheet`, `sources-panel.axe` remain green.
- [ ] Axe clean on the virtualized list at 500 rows.

## Known pitfalls

- **TanStack Virtual + React Compiler (#736, #1119)** — the `'use no memo'` pragma is the official workaround. If at execution a newer release of `@tanstack/react-virtual` has merged a Compiler-safe implementation, the pragma can be dropped. Check release notes before install.
- **`useVirtualizer` return value is an object that must be stable across renders** — React Compiler tries to memoize it; that's the bug. The pragma disables Compiler *for this file only*. Don't propagate `'use no memo'` elsewhere.
- **`measureElement` ref pattern** — `ref={rowVirtualizer.measureElement}` attaches a measurement ref that watches size changes. If the row wraps `SourceRow` in another ref (e.g., for focus), use a ref-forwarding pattern. Today `SourceRow` doesn't use a forwarded ref; verify this remains true.
- **Scroll container height required** — if the parent doesn't constrain height, the virtualizer falls back to rendering everything. Verify desktop rail + mobile sheet both supply definite height. Add a dev-time console.warn in the component:
  ```ts
  if (process.env.NODE_ENV === 'development' && scrollParentRef.current) {
    const h = scrollParentRef.current.clientHeight;
    if (h === 0) console.warn('SourcesPanelList: scroll parent has height 0 — virtualization will not work.');
  }
  ```
- **JSDOM measurement is unreliable** — tests that assert exact visible-row counts will flake. Assert on ranges (`≤ 30`, `>= 10`) or use the `data-total-rows` attribute instead of inferring from `querySelectorAll`.
- **`aria-activedescendant` + virtualization** — if the active row scrolls OUT of the viewport AND overscan, it's not in the DOM, so `aria-activedescendant={activeId}` points to a nonexistent element. Fix: the `scrollToIndex` effect keeps the active row in the DOM. But if a user filters so the active row is no longer in `rows`, `activeIndex` becomes `-1` and `activeId` becomes stale. The keyboard hook should reset `activeId` to null on `rows` length change (verify the current hook behavior; if not, this plan fixes it in `use-sources-panel-keyboard.ts` with a `useEffect` on rows length).
- **The `data-motion-duration` test contract** — adding a debug-only attribute purely to make a reduced-motion test pass smells off. Alternative: test the behavior indirectly via a spec like "render checkbox, confirm no `motion.span`'s `transition.duration` prop non-zero when reduced-motion is set" — mock `useReducedMotion` and assert via a spy on the mocked return. Decide during TDD phase.
- **Height estimate drift** — if 80%+ of rows have match snippets (unusual), `estimateSize: 76` underestimates, and the virtualizer over-renders during fast scroll. Tune in plan 04 based on benchmarks.
- **`scrollToIndex` during rapid keyboard nav** — holding `↓` may queue many `scrollToIndex` calls. TanStack handles this internally (each call cancels the last). Verify by observing — if scroll stutters, wrap in `requestAnimationFrame`.
- **Filter/sort changes reset visual state** — when rows change, the virtualizer re-measures. First paint after a filter may briefly show `estimateSize`-based heights before measurement corrects. Usually imperceptible; if noticeable, lower `estimateSize` closer to the true mean.
