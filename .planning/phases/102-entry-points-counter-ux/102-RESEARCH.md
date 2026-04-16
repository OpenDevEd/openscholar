# Phase 102: Entry Points & Counter UX - Research

**Researched:** 2026-04-16
**Domain:** React component composition, Zustand selectors, Radix UI Progress, i18n seeding, sidebar badge integration
**Confidence:** HIGH

## Summary

Phase 102 is a pure frontend-composition phase. Every backend piece already exists (basket store from Phase 99, `getExtractionLimit` reactive query from Phase 98, `EXTRACTION_LIMIT_EXCEEDED` error mapping from Phase 100). The work is creating two new components (`ExtractionCounter`, `AddToExtractionButton`), extending the `useAddToBasket` hook with cap-aware batch truncation, wiring a sidebar badge, and seeding i18n keys across 6 locale files.

The primary technical risk is ensuring all mount points (library actions, paper card variants x3, basket drawer header, sidebar nav badge) read the same reactive count from `useExtractionBasketStore(s => s.papers.size)` and the same limit from the `getExtractionLimit` Convex query, preventing PITFALL 7 (desync across sources). The secondary risk is the progress bar color transition -- no `--warning` CSS variable exists, so amber-based Tailwind classes must be used for the 80% threshold.

**Primary recommendation:** Build i18n keys first, then the two leaf components (`ExtractionCounter`, `AddToExtractionButton`) with self-contained data fetching, then wire mount points. Cap enforcement goes in the `useAddToBasket` hook (not the store) to keep the store logic simple and testable.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: `<ExtractionCounter>` in `components/extraction/extraction-counter.tsx`, consumes `useExtractionBasketStore(s => s.papers.size)` + `getExtractionLimit` reactive query. Uses shadcn `<Progress>` primitive.
- D-02: Progress bar thresholds computed from `count / limit`, NOT hardcoded against 1000.
- D-03: Counter mounted in basket drawer header and `/extraction/new` selector page (Phase 103 direct consumption).
- D-04: `<AddToExtractionButton>` in `components/extraction/add-to-extraction-button.tsx`. Standalone icon button (not dropdown).
- D-05: Button props: `{ paper: { rawId: string; title: string; doi: string | null }; source: BasketSource }`.
- D-06: Tooltip text i18n-keyed: "Add to extraction basket", "Already in basket", "Basket full -- remove N papers to continue".
- D-07: Library mount: inside `LibraryItemActions` (`components/library/library-item-shared.tsx:21`).
- D-08: Search mount: inside each PaperCard variant action toolbar (`paper-card/shared.tsx` area).
- D-09: No bookmarks mount -- bookmarks are keyword bookmarks, not per-paper.
- D-10: Sidebar badge via `badge={basketCount}` on Extraction NavItem at `components/app-sidebar.tsx:627`.
- D-11: Badge shows nothing for 0, number for 1-9, "9+" for >9.
- D-12: Cap-disabled state: all "add" buttons disable when `papers.size >= limit`.
- D-13: Single `useIsBasketFull` comparison point prevents desync.
- D-14: `useAddToBasket.addToBasket()` returns `{ added: number; dropped: number }` for cap-aware batch truncation.
- D-15: "First N fit" drop order. Toast uses `"info"` variant (not error).
- D-16: i18n keys seeded in all 6 locales under `extraction.counter` and `extraction.addButton` namespaces before UI work.

### Claude's Discretion
- Exact Tailwind color classes for yellow/red progress bar thresholds
- Whether to use `cn()` class merging or separate CSS classes for progress bar states
- Animation on badge count changes (pulse, scale, or none -- use `lib/animation-config.ts` presets)
- Test file organization (colocated vs `__tests__/`)
- Whether `useIsBasketFull` is a standalone hook or inline selector
- Exact icon choice for AddToExtractionButton (Plus/Check from lucide-react)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIM-04 | Always-visible "X / 1000" counter with progress bar (yellow at 80%, red at 100%) in basket drawer and `/extraction/new` | `ExtractionCounter` component reading `useExtractionBasketStore` + `getExtractionLimit` query; shadcn Progress primitive with conditional amber/destructive classes |
| LIM-05 | Cap-disabled checkboxes with tooltip in every source tab | `useIsBasketFull` hook/selector + `AddToExtractionButton` disabled state + Tooltip with i18n "Basket full" text |
| LIM-06 | Bulk-paste excess drop toast with exact counts | Extended `useAddToBasket.addToBasket()` returning `{ added, dropped }` + `toast.info()` from sonner |
| SEL-11 | `<AddToExtractionButton>` in library, search command centers; no page navigation | Standalone icon button component; mounts in `LibraryItemActions` and PaperCard action toolbars |
| SEL-12 | Sidebar nav badge with live basket count | `useExtractionBasketStore(s => s.papers.size)` wired to `badge` prop on Extraction NavItem |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Paper count display | Browser / Client | -- | Pure client-side: Zustand store `.papers.size` is local state |
| Extraction limit fetch | Frontend Server (SSR) via Convex reactive query | Browser / Client | `getExtractionLimit` is a Convex reactive query; client subscribes reactively |
| Cap enforcement on add | Browser / Client | -- | Hook-level truncation before store write; backend rejects as safety net (Phase 100) |
| Toast notifications | Browser / Client | -- | Sonner toast fires client-side on batch truncation |
| Sidebar badge rendering | Browser / Client | -- | Zustand selector drives NavItem badge prop |
| i18n key resolution | Browser / Client | -- | `next-intl` `useTranslations` reads from loaded locale bundle |

## Standard Stack

### Core (already installed -- no new dependencies)

| Library | Version | Purpose | Why Standard | Source |
|---------|---------|---------|--------------|--------|
| zustand | ^5.0.5 (installed 5.0.12) | Basket store, reactive count selectors | Already the app's global state layer | [VERIFIED: package.json] |
| radix-ui | ^1.4.3 | Progress, Tooltip primitives via shadcn wrappers | Already installed; `components/ui/progress.tsx` and `components/ui/tooltip.tsx` wrap Radix | [VERIFIED: package.json + source] |
| motion | ^12.23.12 (installed 12.38.0) | Badge count change animation (optional) | Already the app's animation library; `lib/animation-config.ts` has presets | [VERIFIED: package.json + source] |
| next-intl | ^4.8.2 (installed 4.9.1) | i18n string resolution via `useTranslations` | Already the app's i18n solution across all 6 locales | [VERIFIED: package.json] |
| lucide-react | ^0.487.0 (installed 1.8.0) | Plus, Check, Minus icons for AddToExtractionButton | Already used for all icons in the app | [VERIFIED: package.json] |
| sonner | ^2.0.7 | `toast.info()` for the bulk-paste drop notification | Already installed; `toast.success()` used elsewhere in codebase | [VERIFIED: package.json + codebase grep] |

### Supporting (no new libraries needed)

This phase requires zero new dependencies. All UI primitives, state management, i18n, animation, and toast infra are already in place.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `toast.info()` (sonner native) | `showStyledToast("info", ...)` (custom styled toast) | Custom styled toast only supports `"error"` type today; extending it for `"info"` adds scope. Direct `toast.info()` is simpler and already used in the codebase for success messages via `toast.success()`. |
| Inline amber/destructive classes | New `--warning` CSS variable | Adding a theme variable requires globals.css changes and dark mode tuning; the codebase already uses `amber-*` Tailwind classes for warning states (see `credit-balance-card.tsx`, `search-history-bookmark-form.tsx`). |

**Installation:** None needed.

## Architecture Patterns

### System Architecture Diagram

```
User clicks "Add to Extraction"
         |
         v
[AddToExtractionButton] -- reads --> [useExtractionBasketStore(s => s.papers.size)]
         |                              ^                     |
         | calls                        | reads               | reads
         v                              |                     v
[useAddToBasket hook]           [ExtractionCounter]    [Sidebar NavItem badge]
    |         |                    |          |
    | normalize+truncate           | reads    | reads
    v                              v          v
[extraction-basket store]    [getExtractionLimit query]
    (Zustand + sessionStorage)     (Convex reactive)
         |
         | (if batch truncated)
         v
  [toast.info("Added X; Y dropped")]
```

Data flow:
1. User action triggers `useAddToBasket.addToBasket()`.
2. Hook normalizes IDs, computes remaining capacity (`limit - papers.size`), truncates excess.
3. Hook returns `{ added, dropped }` -- caller fires toast if `dropped > 0`.
4. Store update triggers re-render of ALL subscribers: `ExtractionCounter`, `AddToExtractionButton` (toggle state), sidebar badge.
5. `ExtractionCounter` independently subscribes to `getExtractionLimit` for the denominator.

### Recommended Project Structure

```
components/extraction/
  extraction-counter.tsx          # NEW: "X / 1000" counter + progress bar
  add-to-extraction-button.tsx    # NEW: standalone icon button with tooltip
  extraction-basket-drawer.tsx    # MODIFIED: replace plain count with <ExtractionCounter>
  basket-source-section.tsx       # EXISTING (no changes)
  basket-empty-state.tsx          # EXISTING (no changes)

lib/hooks/
  use-add-to-basket.ts            # MODIFIED: cap-aware addToBasket returning { added, dropped }

components/
  app-sidebar.tsx                 # MODIFIED: wire badge={basketCount} on Extraction NavItem
  library/library-item-shared.tsx # MODIFIED: add <AddToExtractionButton> to LibraryItemActions
  paper-card/paper-card-list-detail.tsx  # MODIFIED: add button to action section
  paper-card/paper-card-list-simple.tsx  # MODIFIED: add button to quick actions group
  paper-card/paper-card-grid.tsx         # MODIFIED: add button to header actions group

messages/
  en-US.json  # MODIFIED: seed extraction.counter.* + extraction.addButton.* keys
  en-GB.json  # MODIFIED: same keys
  fr.json     # MODIFIED: same keys (French translations)
  ja.json     # MODIFIED: same keys (Japanese translations)
  zh.json     # MODIFIED: same keys (Chinese translations)
  hi.json     # MODIFIED: same keys (Hindi translations)
```

### Pattern 1: Self-Contained Component with Zustand + Convex Selectors

**What:** Components that read their own data via Zustand selectors and Convex reactive queries, requiring zero props for default behavior.
**When to use:** When a component is mounted in multiple locations and needs the same data everywhere.
**Example:**

```typescript
// Source: [VERIFIED: existing pattern in extraction-basket-drawer.tsx + convex/extraction/queries.ts]
"use client";

import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ExtractionCounter() {
  const t = useTranslations("extraction.counter");
  const count = useExtractionBasketStore((s) => s.papers.size);
  const limitData = useProtectedQuery(api.extraction.queries.getExtractionLimit, {});
  const limit = limitData?.limit ?? 1000;
  const ratio = limit > 0 ? count / limit : 0;

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">
        {t("label", { count, limit })}
      </span>
      <Progress
        value={ratio * 100}
        className={cn(
          "h-2",
          ratio >= 1 && "[&>[data-slot=progress-indicator]]:bg-destructive",
          ratio >= 0.8 && ratio < 1 && "[&>[data-slot=progress-indicator]]:bg-amber-500 dark:[&>[data-slot=progress-indicator]]:bg-amber-400",
        )}
      />
    </div>
  );
}
```

### Pattern 2: Cap-Aware Hook Extension

**What:** Extending `useAddToBasket` to enforce capacity limits at the hook level, returning structured results for caller feedback.
**When to use:** When the store should remain simple (no cap logic) but the consumer needs cap enforcement.
**Example:**

```typescript
// Source: [VERIFIED: existing use-add-to-basket.ts pattern + D-14 decision]
const addToBasket = useCallback(
  (input: AddToBasketInput | AddToBasketInput[]): { added: number; dropped: number } => {
    const inputs = Array.isArray(input) ? input : [input];
    const currentSize = useExtractionBasketStore.getState().papers.size;
    const remaining = Math.max(0, limit - currentSize);

    const entries: BasketEntry[] = [];
    for (const item of inputs) {
      if (entries.length >= remaining) break; // "first N fit"
      const normalized = normalizeOpenAlexId(item.rawId);
      if (normalized && !useExtractionBasketStore.getState().has(normalized)) {
        entries.push({
          openAlexId: normalized,
          title: item.title,
          doi: item.doi,
          source: item.source,
          addedAt: Date.now(),
        });
      }
    }

    if (entries.length > 0) add(entries);

    const validInputs = inputs.filter((i) => normalizeOpenAlexId(i.rawId) !== null).length;
    return { added: entries.length, dropped: Math.max(0, validInputs - entries.length) };
  },
  [add, limit],
);
```

### Pattern 3: Tooltip-Wrapped Icon Button with State Variants

**What:** A button that shows different icons and tooltips based on state (default, in-basket, at-cap).
**When to use:** When the same button position needs to communicate multiple states.
**Example:**

```typescript
// Source: [VERIFIED: existing icon button patterns in LibraryItemActions + D-04/D-06]
import { Plus, Check } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

// Inside the component render:
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", inBasket && "text-primary")}
      disabled={isAtCap && !inBasket}
      onClick={handleToggle}
    >
      {inBasket ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    {isAtCap && !inBasket
      ? t("basketFull")
      : inBasket
        ? t("inBasket")
        : t("add")}
  </TooltipContent>
</Tooltip>
```

### Anti-Patterns to Avoid

- **Per-source counters as truth:** Never compute a local count per mount point. All mount points MUST read `useExtractionBasketStore(s => s.papers.size)` as the single source of truth. This prevents PITFALL 7 (desync across sources). [VERIFIED: D-13 decision]
- **Hardcoding 1000:** Never write `const MAX = 1000`. Always read from `getExtractionLimit` query. This preserves per-tier-readiness for v7.1. [VERIFIED: D-02 decision]
- **Cap logic in store:** Keep the store simple (add/remove/has/clear). Cap enforcement lives in `useAddToBasket` hook. The store doesn't know about limits. [VERIFIED: D-14 decision context]
- **Silent truncation without feedback:** When batch-adding exceeds capacity, the dropped count MUST be communicated via toast. Silent drop is an explicit anti-feature. [VERIFIED: REQUIREMENTS.md "Silent truncation at the 1000-paper cap" in Out of Scope]
- **Inline styles for progress bar colors:** Use Tailwind classes with `cn()` utility, not inline `style` attributes. The project enforces this pattern consistently. [VERIFIED: codebase convention]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress bar | Custom `<div>` with width% | shadcn `<Progress>` (`components/ui/progress.tsx`) wrapping Radix ProgressPrimitive | Handles ARIA `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax` automatically [VERIFIED: source] |
| Tooltip | `title` attribute or custom hover div | shadcn `<Tooltip>` (`components/ui/tooltip.tsx`) wrapping Radix TooltipPrimitive | Handles keyboard focus, delay, portal rendering, arrow positioning [VERIFIED: source] |
| Toast | Custom notification DOM element | `toast.info()` from `sonner` | Already installed (v2.0.7), configured with `<Toaster>` in layout, used for `toast.success()` throughout codebase [VERIFIED: source + codebase grep] |
| Icon button | Raw `<button>` with inline SVG | shadcn `<Button variant="ghost" size="icon">` + lucide icon | CVA-based variants handle focus ring, disabled state, size classes consistently [VERIFIED: existing pattern in LibraryItemActions] |
| State management | React Context for basket count | `useExtractionBasketStore` Zustand selector | Already exists, persisted to sessionStorage, tested [VERIFIED: source + tests] |
| i18n string interpolation | Template literals | `useTranslations("ns")` with ICU message format `{count}` | next-intl handles pluralization, locale-specific formatting [VERIFIED: existing pattern] |

**Key insight:** Every UI primitive needed for this phase already exists in the project. The work is pure composition -- wiring existing primitives into new components and mounting them.

## Common Pitfalls

### Pitfall 1: Progress Bar Color Not Applying (Radix Indicator Specificity)

**What goes wrong:** Setting `className="bg-amber-500"` on `<Progress>` changes the track color, not the indicator (fill). The indicator is a nested `<ProgressPrimitive.Indicator>` with its own `bg-primary` class.
**Why it happens:** The shadcn Progress wrapper applies indicator styles internally via `data-slot="progress-indicator"`.
**How to avoid:** Target the indicator with the descendant selector `[&>[data-slot=progress-indicator]]`:
```typescript
className={cn(
  "h-2",
  ratio >= 1 && "[&>[data-slot=progress-indicator]]:bg-destructive",
  ratio >= 0.8 && ratio < 1 && "[&>[data-slot=progress-indicator]]:bg-amber-500",
)}
```
[VERIFIED: components/ui/progress.tsx uses `data-slot="progress-indicator"` on the indicator div]
**Warning signs:** Progress bar stays orange/primary color even when ratio >= 0.8.

### Pitfall 2: Stale Count in Cap-Aware Batch Add

**What goes wrong:** Using the hook's cached `count` (from `useExtractionBasketStore((s) => s.papers.size)`) to compute remaining capacity leads to stale reads during rapid batch additions.
**Why it happens:** Zustand selectors are reactive but the value is from the last render cycle. During `addToBasket()` execution, `.papers.size` might have changed if another add is in flight.
**How to avoid:** Read `useExtractionBasketStore.getState().papers.size` synchronously inside the callback, not the reactive `count` from the render.
**Warning signs:** Occasionally adding 1-2 more papers than the limit allows.

### Pitfall 3: Sidebar Store Import Creates Circular Dependency

**What goes wrong:** Importing `useExtractionBasketStore` in `app-sidebar.tsx` creates a dependency from the sidebar module into the extraction store.
**Why it happens:** `app-sidebar.tsx` (32KB) is the most heavily-imported component. Adding extraction imports could trigger circular module resolution.
**How to avoid:** Use a minimal import path: `import { useExtractionBasketStore } from "@/lib/store/extraction-basket"`. This file is standalone with no internal project imports except zustand. [VERIFIED: extraction-basket.ts has zero `@/` imports]
**Warning signs:** Next.js dev server errors about circular dependencies or module resolution.

### Pitfall 4: i18n Key Mismatch Across Locales

**What goes wrong:** Adding keys to `en-US.json` but forgetting one or more of the other 5 locale files.
**Why it happens:** 6 locale files must stay in sync. The project has `tests/extraction-i18n-coverage.test.ts` (mentioned in CONVENTIONS.md) but its exact scope may not cover the new namespaces automatically.
**How to avoid:** Seed ALL 6 locale files in a single plan step BEFORE any component work. Use the same key structure in each file. English text for non-EN locales is acceptable as a placeholder.
**Warning signs:** Runtime errors like "Missing key: extraction.counter.label" in non-English locales.

### Pitfall 5: Hydration Mismatch on Basket Count

**What goes wrong:** Basket count shows 0 on server render, then flashes to the real count after hydration (sessionStorage is client-only).
**Why it happens:** Zustand `persist` middleware rehydrates asynchronously from sessionStorage.
**How to avoid:** The store already has `_hasHydrated` flag. Components should check it before rendering count-dependent UI, OR accept the flash as acceptable (the sidebar badge already does this -- it simply doesn't render when count is 0). [VERIFIED: extraction-basket.ts `_hasHydrated` field + extraction-basket-drawer.tsx line 75 checks it]
**Warning signs:** React hydration warning about text content mismatch.

### Pitfall 6: Tooltip Wrapping Non-Focusable Element

**What goes wrong:** Wrapping a `<div>` with Tooltip causes the tooltip to not show on keyboard focus (only on mouse hover).
**Why it happens:** Radix TooltipTrigger requires a focusable element to trigger on keyboard.
**How to avoid:** Always use `asChild` on TooltipTrigger and wrap a `<Button>` or element with `tabIndex={0}`. [VERIFIED: tooltip.tsx uses Radix Tooltip primitive which requires focusable trigger]
**Warning signs:** Tooltip appears on hover but not on Tab focus.

## Code Examples

### ExtractionCounter Component (complete pattern)

```typescript
// Source: [VERIFIED: Progress from components/ui/progress.tsx, useProtectedQuery pattern from lib/auth/use-auth-query.ts]
"use client";

import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { Progress } from "@/components/ui/progress";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function ExtractionCounter({ className }: { className?: string }) {
  const t = useTranslations("extraction.counter");
  const count = useExtractionBasketStore((s) => s.papers.size);
  const limitData = useProtectedQuery(api.extraction.queries.getExtractionLimit, {});
  const limit = limitData?.limit ?? 1000;
  const ratio = limit > 0 ? count / limit : 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{t("label", { count, limit })}</span>
        {ratio >= 1 && (
          <span className="text-xs text-destructive font-medium">
            {t("limitReached")}
          </span>
        )}
        {ratio >= 0.8 && ratio < 1 && (
          <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
            {t("limitWarning")}
          </span>
        )}
      </div>
      <Progress
        value={Math.min(ratio * 100, 100)}
        className={cn(
          "h-2",
          ratio >= 1 && "[&>[data-slot=progress-indicator]]:bg-destructive",
          ratio >= 0.8 && ratio < 1 && "[&>[data-slot=progress-indicator]]:bg-amber-500 dark:[&>[data-slot=progress-indicator]]:bg-amber-400",
        )}
      />
    </div>
  );
}
```

### i18n Key Structure (en-US.json excerpt)

```json
{
  "extraction": {
    "counter": {
      "label": "{count} / {limit} papers",
      "limitReached": "Basket limit reached",
      "limitWarning": "Approaching basket limit"
    },
    "addButton": {
      "add": "Add to extraction basket",
      "remove": "Remove from basket",
      "inBasket": "Already in basket",
      "basketFull": "Basket full \u2014 remove papers to continue",
      "dropped": "Added {added} papers; {dropped} dropped \u2014 basket limit reached"
    }
  }
}
```

### Sidebar Badge Wiring

```typescript
// Source: [VERIFIED: app-sidebar.tsx NavItem at line 627, badge prop at line 81]
// In the sidebar component, add one line:
const basketCount = useExtractionBasketStore((s) => s.papers.size);

// Then at the NavItem (line 627):
<NavItem
  href="/extraction"
  icon={FlaskConical}
  label={ts("extraction")}
  isActive={currentPageValue === "extraction"}
  isCollapsed={isCollapsed && !isMobile}
  badge={basketCount > 0 ? basketCount : undefined}
  onClick={handleNavClick}
  index={4}
/>
```

### LibraryItemActions Mount Point

```typescript
// Source: [VERIFIED: library-item-shared.tsx structure at lines 21-73]
// Add the AddToExtractionButton alongside existing actions:
<div className="flex items-center gap-1 rounded-lg bg-background/90 shadow-sm backdrop-blur-sm">
  <AddToExtractionButton
    paper={{
      rawId: item.openAlexId, // from LibraryItem Doc
      title: item.title,
      doi: item.doi ?? null,
    }}
    source="library"
  />
  {doiUrl && (
    <a href={doiUrl} ...> {/* existing external link */} </a>
  )}
  <DropdownMenu> {/* existing dropdown */} </DropdownMenu>
</div>
```

### PaperCard Action Group Mount (list-simple variant example)

```typescript
// Source: [VERIFIED: paper-card-list-simple.tsx lines 143-169, quick actions group]
{/* Quick actions */}
<div role="group" className="hidden @md/card:flex items-center gap-1 flex-shrink-0" ...>
  <AddToExtractionButton
    paper={{
      rawId: result.id,
      title: result.title,
      doi: result.doi ?? null,
    }}
    source="search"
  />
  <TranslationToggle ... />
  <OpenAccessBadge ... />
  <DOIBadge ... />
  <DownloadMenuCompact ... />
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Radix UI separate packages (`@radix-ui/react-progress`) | Unified `radix-ui` package (1.4.3) | 2025 | Import from `radix-ui` not `@radix-ui/react-*` [VERIFIED: components/ui/progress.tsx imports from `radix-ui`] |
| Zustand v4 `create()` | Zustand v5 `create<T>()()` (double invocation) | 2024 | Already using v5 pattern in extraction-basket.ts [VERIFIED: source] |
| `framer-motion` package | `motion/react` package | 2024 | Already using `motion/react` in app-sidebar.tsx [VERIFIED: source line 50] |

**No deprecated patterns in the phase scope.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `LibraryItem` (Doc<"libraryItems">) has an `openAlexId` field accessible in `LibraryItemActions` | Code Examples - Library Mount | If the field name differs, the `rawId` prop mapping breaks. LOW risk -- the library stores OpenAlex items. |
| A2 | `toast.info()` from sonner renders an info-styled toast with the project's Toaster | Architecture Patterns | If sonner's `toast.info()` does not render through the `<Toaster>` configured in layout, the toast may not appear. LOW risk -- sonner's API docs confirm all toast types render through the same Toaster. |

## Open Questions

1. **LibraryItem openAlexId field name**
   - What we know: `LibraryItem` is `Doc<"libraryItems">` but the exact field for OpenAlex ID may be `openAlexId`, `id`, or `openAlexWorkId`.
   - What's unclear: Exact schema field name for the OpenAlex work ID on libraryItems.
   - Recommendation: Planner should verify by reading `convex/schema.ts` for the `libraryItems` table definition during plan execution.

2. **Info toast visual styling**
   - What we know: `toast.info()` from sonner works and renders through the `<Toaster>` component. The project has a custom `showStyledToast` only for error toasts.
   - What's unclear: Whether the default sonner info toast styling matches the project's aesthetic.
   - Recommendation: Use `toast.info()` directly. If styling feels inconsistent, it can be tuned later as polish.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (via vitest.config.ts) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/extraction-basket-store.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIM-04 | Counter reads count + limit, computes ratio, applies correct classes | unit | `npx vitest run tests/extraction-counter.test.tsx -x` | Wave 0 |
| LIM-05 | AddToExtractionButton disables at cap | unit | `npx vitest run tests/add-to-extraction-button.test.tsx -x` | Wave 0 |
| LIM-06 | addToBasket returns { added, dropped } when batch exceeds cap | unit | `npx vitest run tests/extraction-basket-cap.test.ts -x` | Wave 0 |
| SEL-11 | Button renders in library and search action areas | manual-only | Visual inspection -- mount point integration cannot be unit-tested without full page render | N/A |
| SEL-12 | Sidebar badge displays basketCount | unit | `npx vitest run tests/sidebar-basket-badge.test.tsx -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/extraction-basket-cap.test.ts tests/extraction-counter.test.tsx tests/add-to-extraction-button.test.tsx -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/extraction-basket-cap.test.ts` -- covers LIM-06 (cap-aware batch truncation logic)
- [ ] `tests/extraction-counter.test.tsx` -- covers LIM-04 (ratio computation, class application)
- [ ] `tests/add-to-extraction-button.test.tsx` -- covers LIM-05 (disabled state at cap)
- [ ] Framework already installed -- no additional setup needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A -- components use existing `useProtectedQuery` for auth-gated data |
| V3 Session Management | no | N/A -- sessionStorage basket is session-scoped, no sensitive data |
| V4 Access Control | no | N/A -- cap enforcement is UX-only; backend rejects over-limit via Phase 100 |
| V5 Input Validation | yes | `normalizeOpenAlexId()` validates and normalizes all incoming IDs [VERIFIED: lib/openalex/normalize.ts] |
| V6 Cryptography | no | N/A -- no secrets or encryption in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-side cap bypass (user modifies JS to skip truncation) | Tampering | Backend `createExtractionJob` mutation hard-rejects over-limit (Phase 100, LIM-07) [VERIFIED: error-resolver.ts EXTRACTION_LIMIT_EXCEEDED] |
| Tooltip XSS via paper title | Tampering | Radix Tooltip renders text content, not HTML. React JSX escapes by default. |

## Sources

### Primary (HIGH confidence)
- `lib/store/extraction-basket.ts` -- full store implementation reviewed
- `lib/hooks/use-add-to-basket.ts` -- hook API reviewed, Phase 102 noted as consumer
- `components/extraction/extraction-basket-drawer.tsx` -- current drawer structure reviewed
- `components/app-sidebar.tsx` -- NavItem interface (badge prop at line 81), Extraction NavItem at line 627
- `components/library/library-item-shared.tsx` -- LibraryItemActions structure reviewed
- `components/paper-card/*.tsx` -- all 3 variants reviewed for action mount points
- `components/ui/progress.tsx` -- Progress primitive with `data-slot` attribute confirmed
- `components/ui/tooltip.tsx` -- Tooltip primitive with Radix wrapping confirmed
- `components/ui/sonner.tsx` -- `showStyledToast` only supports `"error"` type; raw `toast.info/success` used elsewhere
- `convex/extraction/queries.ts:689-710` -- `getExtractionLimit` query returns `{ limit, plan }`
- `lib/toast/error-resolver.ts:105` -- `EXTRACTION_LIMIT_EXCEEDED` mapped
- `messages/en-US.json` -- `extraction.basket.*` namespace exists; `extraction.counter.*` and `extraction.addButton.*` do NOT exist yet
- `app/globals.css` -- no `--warning` CSS variable; `--destructive` at oklch hue 27
- `package.json` -- all dependency versions verified

### Secondary (MEDIUM confidence)
- Tailwind amber-* class usage pattern confirmed via grep across `components/` directory

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies; all libraries verified in package.json
- Architecture: HIGH -- all mount points read from source; existing patterns confirmed
- Pitfalls: HIGH -- each pitfall verified against actual source code (data-slot attributes, store implementation, sidebar imports)

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable -- no moving dependencies)
