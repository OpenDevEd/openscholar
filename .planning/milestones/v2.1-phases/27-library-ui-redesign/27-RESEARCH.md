# Phase 27: Library UI Redesign - Research

**Researched:** 2026-02-28
**Domain:** React component refactoring, shared component extraction, UI/UX consistency
**Confidence:** HIGH

## Summary

The library page was built quickly in Phases 23-24, resulting in functional but visually inconsistent components compared to the polished search results page. The library filter bar uses inline controls with raw CSS classes (e.g., toggle-group container pattern with direct Tailwind), while the search sidebar uses a well-structured `FilterSection` wrapper component with consistent patterns: icon + title header, active state indicator (left gradient bar), clear button, motion animations, and rounded-xl card containers.

The key work is threefold: (1) Extract the search page's `FilterSection` component into a shared location and adapt it for the library's simpler filter needs, (2) Replace the library's inline view mode toggle with the existing `ViewModeToggleCompact` pattern or a shared variant, (3) Redesign library item cards (`LibraryItemRow`, `LibraryItemCard`) to use the search page's `CardContainer` pattern and visual language (rounded-2xl, backdrop-blur, hover elevation, gradient accents).

**Primary recommendation:** Refactor library components to reuse search page patterns (FilterSection, CardContainer, OA_COLORS) as shared components, keeping library-specific logic (Convex queries, nuqs params) intact.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILT-01 | User can filter library items by date saved (last week, last month, last year) | Library already has date saved presets (24-02). Redesign wraps them in FilterSection pattern for visual consistency. |
| FILT-02 | User can filter library items by publication year range | Library already has year range inputs (24-02). Redesign wraps them in FilterSection or elevates the UX to match search page's YearRangePicker popover style. |
| FILT-05 | User can switch between view modes (list-detail / grid) | Library already has list/grid toggle (24-02). Redesign aligns styling with ViewModeToggleCompact or extracts a shared variant. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.x | Component framework | Already in project |
| next-intl | 4.x | i18n translations | Already in project, all library strings translated |
| nuqs | 2.x | URL state management | Already used by library page (Phase 24-01) |
| motion/react | 12.x | Animations (FilterSection uses motion.div) | Already in project, search sidebar depends on it |
| tailwindcss | 4.x | Styling | Already in project |
| lucide-react | latest | Icons | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @/components/ui/* | shadcn/ui | Button, Select, Input, Tooltip, Badge | Already used across both pages |
| @/lib/utils (cn) | local | Class name merging | Used everywhere |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extracting FilterSection to shared | Copy-pasting search sidebar patterns | Copy-paste creates future maintenance burden; extraction is the correct approach |
| Keeping library's inline year inputs | Adapting search's YearRangePicker popover | YearRangePicker is tightly coupled to search store hooks (useCurrentSearchFormState, useUpdateSearchFilter); library uses nuqs. Simpler to keep library's year inputs but wrap in FilterSection. |

**Installation:**
No new packages needed. All dependencies already in project.

## Architecture Patterns

### Recommended Project Structure
```
components/
  shared/                    # NEW: Shared components between search and library
    filter-section.tsx       # Extracted from search-sidebar.tsx
    oa-status-badge.tsx      # Extracted OA_COLORS + badge rendering
  library/
    library-page-client.tsx  # Largely unchanged (orchestrator)
    library-filters.tsx      # REWRITTEN: Uses FilterSection wrappers
    library-item-row.tsx     # REDESIGNED: Uses CardContainer-like styling
    library-item-card.tsx    # REDESIGNED: Uses CardContainer pattern
    library-search-bar.tsx   # Minor styling alignment
    library-empty-state.tsx  # Largely unchanged
    library-item-skeleton.tsx # Updated to match new card layout
  paper-card/
    shared.tsx               # CardContainer already exported here
```

### Pattern 1: FilterSection Extraction
**What:** The search sidebar defines `FilterSection` as a local component inside `search-sidebar.tsx`. It needs to be extracted to a shared location so both search and library can import it.
**When to use:** Any filter panel UI that needs consistent visual treatment.
**Current location:** `components/search-sidebar.tsx` lines 93-163 (React.memo'd component).
**Key props:**
```typescript
interface FilterSectionProps {
  title: string;
  icon: React.ElementType;
  isActive: boolean;
  children: React.ReactNode;
  onClear?: () => void;
}
```
**Visual characteristics:**
- `rounded-xl` container with border
- Active state: `bg-sidebar-accent/80 border-border/60` + left gradient bar
- Inactive state: `bg-card/50 dark:bg-card/40 border-border/40`
- Header: icon + title + optional clear button
- Content area: `px-4 pb-4`

### Pattern 2: CardContainer Reuse
**What:** The search page's `PaperCard` uses `CardContainer` from `paper-card/shared.tsx` with sophisticated styling: rounded-2xl, backdrop-blur, hover elevation, gradient shadows.
**When to use:** Library item cards should use either `CardContainer` directly or adopt its class patterns.
**Current library card classes (grid):** `rounded-lg border border-border/50 bg-background/80 p-4` (minimal)
**Search page card classes:** `rounded-2xl border bg-background/80 dark:bg-background/60 border-border/60 backdrop-blur-xl backdrop-saturate-150 shadow-lg hover:-translate-y-0.5 hover:shadow-xl`

### Pattern 3: OA_COLORS Consolidation
**What:** The `OA_COLORS` constant is duplicated in both `library-item-card.tsx` and `library-item-row.tsx`. This should be extracted to a shared location.
**Where to put it:** Either `lib/constants.ts` or `components/shared/oa-status-badge.tsx`.

### Pattern 4: View Mode Toggle Alignment
**What:** The library has its own inline view mode toggle (list/grid with LayoutList/LayoutGrid icons) inside `library-filters.tsx`. The search page has `ViewModeToggleCompact` in `components/view-mode-toggle.tsx`.
**Key difference:** Search toggle reads from Zustand (`useUIStore`), library reads from nuqs URL params. These are different state management approaches. The visual pattern can be shared but the state hooks differ.
**Approach:** Keep the library's nuqs-driven state, but align the visual rendering to match the search toggle's styling exactly, or extract a "dumb" toggle component that accepts value/onChange props.

### Anti-Patterns to Avoid
- **Coupling library to search store hooks:** The library uses nuqs + Convex; the search uses Zustand + SWR. Don't introduce search-specific hooks into library components.
- **Over-extracting:** Not every search sidebar filter is relevant to the library. The library only needs rating, date saved presets, year range, sort, and view mode. Don't port the full search sidebar.
- **Breaking existing functionality:** The library's dual-path query (search vs browse), stale-while-revalidate, and nuqs URL state must remain intact. This is a visual redesign, not a data architecture change.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filter section container | Custom div with inline classes | Extract `FilterSection` from search-sidebar.tsx | Already proven pattern with active state, clear button, icon, animations |
| Card container styling | Inline Tailwind on each card | Use/adapt `CardContainer` from paper-card/shared.tsx | Consistent visual language, hover states, dark mode support |
| OA status colors | Duplicate `OA_COLORS` in each file | Shared constant in `lib/constants.ts` | Currently duplicated in 2 library components |
| View mode toggle visual | Inline buttons in filter bar | Extract presentational toggle from `ViewModeToggleCompact` pattern | Avoid styling divergence between search and library |

**Key insight:** The search page already solved all the visual design problems. The library just needs to consume those solutions instead of having its own parallel implementations.

## Common Pitfalls

### Pitfall 1: FilterSection Tight Coupling to Search Store
**What goes wrong:** FilterSection in search-sidebar.tsx uses `useTranslations("common")` which is fine, but the filter *panel* components (DateFilterPanel, RatingFilterPanel, etc.) are tightly coupled to `useCurrentSearchFormState()` and `useUpdateSearchFilter()` hooks. Don't try to reuse the panel components.
**Why it happens:** The search sidebar's filters manage state through a different mechanism (Zustand store-based form state) than the library (nuqs URL params).
**How to avoid:** Only extract the `FilterSection` *wrapper* component. Keep the library's filter content (star buttons, date presets, year inputs) as library-specific children.
**Warning signs:** Importing anything from `@/lib/hooks` that references search form state.

### Pitfall 2: Breaking Stale-While-Revalidate
**What goes wrong:** During redesign, accidentally removing the `isTransitioning` opacity class or the `lastResultsRef` pattern, causing jarring flash-of-empty during filter changes.
**Why it happens:** Focusing on visual changes without understanding the data flow.
**How to avoid:** Don't touch the query orchestration in `library-page-client.tsx`. Only modify the rendering layer.
**Warning signs:** Results area goes blank momentarily when toggling filters.

### Pitfall 3: Motion Import Without Need
**What goes wrong:** Importing `motion/react` in library components that don't need animations, increasing bundle size.
**Why it happens:** FilterSection uses `motion.div` for its container animation and active indicator.
**How to avoid:** If the library filter sections don't need entrance/exit animations, consider a simplified variant of FilterSection without motion dependencies, or accept the import since it's already in the shared bundle.

### Pitfall 4: View Mode State Mismatch
**What goes wrong:** Mixing Zustand-based view mode (search page) with nuqs-based view mode (library page), causing confusion about which is the source of truth.
**Why it happens:** The library explicitly chose nuqs for URL persistence (Phase 24-01), while the search page uses Zustand with localStorage persistence.
**How to avoid:** Keep these separate. The visual toggle can look identical, but the state source remains different for each page.

### Pitfall 5: OA_COLORS Not Matching Paper Card OpenAccessBadge
**What goes wrong:** Library defines its own `OA_COLORS` map with slightly different color tokens than what the paper card's `OpenAccessBadge` uses.
**Why it happens:** OA status rendering diverged between library (inline colored badge) and search (dedicated OpenAccessBadge component).
**How to avoid:** When consolidating, verify the color values match across both implementations. Consider using the `OpenAccessBadge` component from paper-card/shared.tsx if appropriate for the library context.

## Code Examples

### FilterSection Extraction Pattern
```typescript
// components/shared/filter-section.tsx
// Extracted from search-sidebar.tsx lines 93-163
import React from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface FilterSectionProps {
  title: string;
  icon: React.ElementType;
  isActive: boolean;
  children: React.ReactNode;
  onClear?: () => void;
}

export const FilterSection = React.memo(function FilterSection({
  title,
  icon: Icon,
  isActive,
  children,
  onClear,
}: FilterSectionProps) {
  const tc = useTranslations("common");
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "relative rounded-xl overflow-hidden transition-all duration-200",
        "border",
        isActive
          ? "bg-sidebar-accent/80 border-border/60"
          : "bg-card/50 dark:bg-card/40 border-border/40 hover:border-border/60"
      )}
    >
      {isActive && (
        <motion.div
          initial={false}
          animate={{ scaleY: 1 }}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-sm bg-gradient-to-b from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)]"
        />
      )}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4 transition-colors duration-200", isActive ? "text-sidebar-primary" : "text-muted-foreground")} />
          <span className={cn("text-sm font-medium transition-colors duration-200", isActive ? "text-sidebar-primary" : "text-foreground")}>{title}</span>
        </div>
        {isActive && onClear && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80">
            <X className="h-3 w-3 mr-1" />{tc("clear")}
          </Button>
        )}
      </div>
      <div className="px-4 pb-4">{children}</div>
    </motion.div>
  );
});
```

### Library FilterSection Usage
```typescript
// In library-filters.tsx (redesigned)
import { FilterSection } from "@/components/shared/filter-section";
import { Star, Calendar, ArrowUpDown, LayoutList } from "lucide-react";

// Rating filter wrapped in FilterSection
<FilterSection
  title={t("ratingFilter")}
  icon={Star}
  isActive={minRating !== undefined}
  onClear={minRating !== undefined ? () => onMinRatingChange(undefined) : undefined}
>
  {/* Existing star buttons */}
  <div className="flex items-center gap-1" role="group">
    {[1, 2, 3, 4, 5].map((starValue) => (/* ... existing star rendering ... */))}
  </div>
</FilterSection>
```

### Library Card Redesign Pattern
```typescript
// In library-item-card.tsx (redesigned)
// Adopt CardContainer styling pattern
<div className={cn(
  "relative group rounded-2xl border transition-all duration-200",
  "bg-background/80 dark:bg-background/60",
  "border-border/60 dark:border-border/40",
  "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]",
  "backdrop-blur-xl backdrop-saturate-150",
  "hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/30",
  "hover:border-primary/20 dark:hover:border-primary/30",
  "hover:shadow-xl hover:-translate-y-0.5",
  "p-4 flex flex-col gap-2"
)}>
  {/* Card content */}
</div>
```

### OA_COLORS Shared Constant
```typescript
// lib/constants.ts (addition)
export const OA_STATUS_COLORS: Record<string, string> = {
  gold: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  bronze: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  hybrid: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Library inline filter styling | FilterSection wrapper pattern | Phase 27 (this phase) | Visual consistency with search page |
| Duplicated OA_COLORS | Shared constant | Phase 27 (this phase) | Single source of truth |
| Separate view toggle implementations | Shared visual pattern, page-specific state | Phase 27 (this phase) | DRY toggle rendering |

**Deprecated/outdated:**
- Library's current inline filter bar styling (Phase 24-02) -- being replaced with FilterSection wrappers

## Open Questions

1. **How much FilterSection motion animation is appropriate for library?**
   - What we know: Search sidebar uses `motion.div` with initial/animate for FilterSection container and active indicator. Library page is simpler (no sidebar collapse/expand).
   - What's unclear: Whether the motion imports are justified for the library's simpler layout, or if a static variant would be better.
   - Recommendation: Use the motion variant since `motion/react` is already in the bundle from `LibraryItemRow` (AnimatePresence for expand/collapse). Consistency wins over minimal bundle savings.

2. **Should LibraryItemRow adopt CardContainer exactly or keep its flat list style?**
   - What we know: The search page uses CardContainer (rounded-2xl with shadow) for list-detail view. The library's list view uses flat rows with border-b separators -- more table-like.
   - What's unclear: Whether the library's list view should become card-based or remain flat.
   - Recommendation: Keep the flat row style for list view (it's appropriate for dense data browsing) but upgrade individual row hover states and metadata styling to match search page quality. Only apply CardContainer to grid view cards.

3. **Should the search sidebar's FilterSection be refactored in-place or should a new shared file be created?**
   - What we know: FilterSection is currently defined inline in search-sidebar.tsx and used only there.
   - What's unclear: Whether to move it out (potentially breaking the search sidebar) or create a new shared version.
   - Recommendation: Create `components/shared/filter-section.tsx` with the extracted component, then update search-sidebar.tsx to import from there. This ensures both pages use the exact same component.

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct examination of all relevant source files:
  - `components/search-sidebar.tsx` (FilterSection pattern, 1024 lines)
  - `components/library/library-filters.tsx` (current library filter implementation)
  - `components/library/library-page-client.tsx` (library page orchestrator)
  - `components/library/library-item-card.tsx` (grid view card)
  - `components/library/library-item-row.tsx` (list view row)
  - `components/paper-card/shared.tsx` (CardContainer, OA badges)
  - `components/view-mode-toggle.tsx` (ViewModeToggleCompact)
  - `components/year-range-picker.tsx` (search page year range)
  - `lib/library/search-params.ts` (nuqs parsers for library URL state)

### Secondary (MEDIUM confidence)
- `.planning/phases/24-advanced-filtering-url-state/24-02-SUMMARY.md` - Phase 24 Plan 02 explicitly documented "UI consistency with search results page needs full redesign (planned for next phase)" and "Library filter bar uses different component patterns than search sidebar FilterSection"

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project, no new dependencies
- Architecture: HIGH - Clear extraction patterns visible in existing code, straightforward refactoring
- Pitfalls: HIGH - All identified from direct code analysis of both pages' implementations

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable -- internal refactoring, no external dependency changes)
