# Phase 30: Library Polish - Research

**Researched:** 2026-03-01
**Domain:** Mobile responsiveness, i18n completeness, toast feedback for destructive actions
**Confidence:** HIGH

## Summary

Phase 30 closes the final three v2.1 requirements (EXP-02, EXP-03, EXP-04) to make the library production-ready. The work spans three distinct domains: (1) mobile responsiveness for the library page and collection dialogs, (2) i18n completeness audit and fix, and (3) toast feedback on all destructive actions.

The codebase is already well-structured for all three tasks. The library page already uses Tailwind responsive utilities (`sm:`, `md:`, `lg:`) extensively, dialogs use Radix primitives with mobile-safe `max-w-[calc(100%-2rem)]`, and all 6 locale files already contain 62 matching `libraryPage` keys. The remaining work is primarily CSS refinement for mobile filter overflow, adding a few missing toast calls (success on remove, error handlers), and verifying no hardcoded English strings leaked into the code.

**Primary recommendation:** Three focused tasks: (1) mobile CSS pass on filters + dialogs, (2) i18n string audit with hardcoded string elimination, (3) toast feedback on the three destructive actions with both success and error paths.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXP-02 | Library page and collection dialogs are mobile responsive | Mobile audit findings (Section: Architecture Patterns) show filter grid overflow at `sm:grid-cols-4`, dialog widths, and header layout need mobile refinement |
| EXP-03 | All library and collection UI strings are translated for 6 locales via next-intl | i18n audit findings: all 6 locales have 62 matching keys, but one hardcoded English string exists in `library-page-client.tsx:160` ("Failed to remove item") |
| EXP-04 | Destructive actions show toast with feedback (success and error) | Toast audit: remove-from-library missing success toast; delete-collection and remove-from-collection missing error toasts; collection-picker remove missing error toast |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | v4 | Responsive utility classes | Already used project-wide; `sm:`, `md:`, `lg:` breakpoints |
| next-intl | ^4.8.2 | i18n with ICU message format | Already used for all UI strings via `useTranslations()` |
| sonner | ^2.0.7 | Toast notifications | Already used for success/error toasts throughout library |
| Radix Dialog | ^1.1.15 | Collection dialogs (Manager + Picker) | Already wraps both collection dialogs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| motion (Framer Motion) | ^12.23.12 | FilterSection animations | Already used in filter-section.tsx; no changes needed |
| showConfirmation | (internal) | Confirmation dialog for destructive actions | Already used for remove-from-library and delete-collection |

### Alternatives Considered
None -- all tools are already in the project. No new dependencies needed.

## Architecture Patterns

### Existing Project Structure (library components)
```
components/library/
├── library-page-client.tsx    # Main orchestrator (state, queries, handlers)
├── library-search-bar.tsx     # Search input with debounce
├── library-filters.tsx        # 4-column filter grid + sort controls
├── library-item-row.tsx       # List view row (expandable)
├── library-item-card.tsx      # Grid view card
├── library-item-skeleton.tsx  # Loading skeletons for both views
├── library-empty-state.tsx    # Empty/no-results states
├── collection-manager.tsx     # CRUD dialog for collections
└── collection-picker.tsx      # Assign items to collections dialog
```

### Pattern 1: Mobile Responsive Filter Grid
**What:** The filter grid uses `grid grid-cols-1 sm:grid-cols-4` which stacks to single column on mobile. Each FilterSection is a rounded card with icon, title, and controls.
**Current issue:** On narrow mobile viewports (< 640px), all 4 filter sections stack vertically taking significant vertical space. The sort controls and view toggle in Row 2 use `flex-wrap` which works but could be tighter.
**Fix approach:**
- Filters: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` -- give mobile 1-column, tablet 2-column, desktop 4-column
- Sort row: Already uses `flex items-center gap-2 flex-wrap` -- works on mobile
- Header: Already uses `flex items-center gap-3` -- verify export dropdown doesn't overflow on narrow screens

```tsx
// Before:
<div className="grid grid-cols-1 sm:grid-cols-4 gap-2">

// After:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
```

### Pattern 2: Mobile Dialog Handling
**What:** Both CollectionManager and CollectionPicker use Radix Dialog with `sm:max-w-md` / `sm:max-w-sm`.
**Current state:** The base Dialog component already has `max-w-[calc(100%-2rem)]` for mobile, which prevents edge overflow. This is already correct.
**Potential issues:**
- DropdownMenu inside CollectionManager list items: on touch devices, the three-dot menu trigger button needs adequate touch target size (minimum 44x44px per Apple HIG / 48dp per Material). Current `size="icon-xs"` may be too small.
- CollectionPicker checkbox labels: touch targets look adequate (full-width label element with `px-3 py-2` padding).

### Pattern 3: Toast Feedback on Destructive Actions
**What:** Every destructive action should show toast feedback for both success and error outcomes.
**Current state audit:**

| Action | Success Toast | Error Toast | Location |
|--------|--------------|-------------|----------|
| Remove from library | MISSING | Hardcoded English `"Failed to remove item"` | `library-page-client.tsx:158-160` |
| Delete collection | `t("collectionDeleted")` | MISSING (only `console.error`) | `collection-manager.tsx:103-109` |
| Remove from collection | `t("removedFromCollection")` | MISSING (only `console.error`) | `collection-picker.tsx:54-58` |

**Fix approach:** Use `toast.success(t(...))` for success and `toast.error(t(...))` for error. This matches the existing pattern used throughout the library components.

```tsx
// Pattern for fire-and-forget mutation with toast feedback:
mutationFn(args)
  .then(() => toast.success(t("successKey")))
  .catch((err) => {
    console.error("[Context] Failed:", err);
    toast.error(t("errorKey"));
  });
```

**Important:** For `removeFromLibrary`, the current code fires the mutation inside `showConfirmation.onConfirm`. The success toast should fire AFTER the mutation resolves, not immediately. The current pattern calls `setRating()` synchronously alongside the `.catch()` -- the success toast should be added via `.then()`.

### Pattern 4: i18n String Convention
**What:** All user-facing strings use `useTranslations("libraryPage")` and reference keys from `messages/{locale}.json`.
**Current state:** 62 keys in `libraryPage` namespace, identical across all 6 locales (en-US, en-GB, fr, hi, ja, zh).
**Issue:** One hardcoded English string at `library-page-client.tsx:160`: `toast.error("Failed to remove item")`.
**Fix:** Add new i18n keys for missing toast messages and replace hardcoded string.

### Anti-Patterns to Avoid
- **Hardcoded English strings in toast calls:** Always use `t("key")`, never raw strings.
- **Showing success toast before mutation resolves:** The mutation is async; show success in `.then()`, not before the promise resolves.
- **Adding new CSS breakpoint complexity to already-working components:** The list view row and grid card already handle responsive correctly. Do not refactor what works.
- **Over-engineering mobile filter layout:** A simple grid breakpoint change handles the filter stacking. No need for collapsible/accordion filter sections.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom notification system | `toast.success()` / `toast.error()` from sonner | Already integrated, handles stacking, dismissal, styling |
| Responsive layout | Custom viewport detection | Tailwind responsive utilities (`sm:`, `md:`, `lg:`) | Proven, zero JS, SSR-safe |
| i18n | String concatenation | `useTranslations()` from next-intl | Handles pluralization, interpolation, ICU format |
| Confirmation dialogs | Custom modal | `showConfirmation()` from `lib/confirmation.tsx` | Already used for remove + delete actions |

**Key insight:** All infrastructure is already in place. This phase is purely about filling gaps in the existing patterns, not introducing new systems.

## Common Pitfalls

### Pitfall 1: Mutation Success Toast Timing
**What goes wrong:** Showing success toast before the mutation actually succeeds, then the mutation fails silently.
**Why it happens:** Fire-and-forget pattern calls `.catch()` but never waits for success.
**How to avoid:** Use `.then(() => toast.success(...))` and `.catch(() => toast.error(...))` pattern.
**Warning signs:** Success toast appears even when Convex returns an error.

### Pitfall 2: i18n Key Mismatch Across Locales
**What goes wrong:** Adding new keys to en-US.json but forgetting one or more of the other 5 locale files.
**Why it happens:** 6 files to update manually.
**How to avoid:** After adding keys to en-US.json, programmatically verify all 6 files have identical key sets.
**Warning signs:** next-intl logs "missing message" warnings in console for non-English locales.

### Pitfall 3: Touch Target Size on Mobile
**What goes wrong:** Interactive elements (buttons, checkboxes, links) are too small for reliable touch interaction.
**Why it happens:** Desktop-first design with `size="icon-xs"` (likely < 32px).
**How to avoid:** Ensure all interactive elements have minimum 44x44px touch area (padding counts). The three-dot menu in CollectionManager list items is the highest-risk element.
**Warning signs:** Difficult to tap menu button on mobile devices.

### Pitfall 4: Filter Grid Overflow on Narrow Viewports
**What goes wrong:** Four filter cards in a row overflow or compress to unusable widths.
**Why it happens:** `sm:grid-cols-4` activates at 640px, but 4 FilterSection cards at ~150px each plus gaps exceeds available width.
**How to avoid:** Use `sm:grid-cols-2 lg:grid-cols-4` to give tablet a 2-column intermediate step.
**Warning signs:** Filter controls truncated, input fields too narrow to use on tablet (640-1024px).

### Pitfall 5: Delete Collection Success Toast Before Mutation
**What goes wrong:** In `collection-manager.tsx:107`, `toast.success(t("collectionDeleted"))` fires immediately inside `onConfirm`, before the `deleteCollection()` promise resolves. If the mutation fails, the user sees a success toast followed by no visible change.
**Why it happens:** The current code uses `.catch()` for error logging but shows success synchronously.
**How to avoid:** Move success toast into `.then()` callback.
**Warning signs:** Success toast on deletion even when Convex throws an error.

## Code Examples

### Example 1: Correct Mutation + Toast Pattern
```tsx
// Source: Derived from existing project patterns
const handleRemove = useCallback(
  (item: Doc<"libraryItems">) => {
    showConfirmation({
      title: t("removeConfirmTitle"),
      message: t("removeConfirmMessage", { title: item.title }),
      confirmText: t("removeButton"),
      cancelText: t("cancelButton"),
      variant: "destructive",
      onConfirm: () => {
        removeItem({ itemId: item._id })
          .then(() => {
            toast.success(t("removedFromLibrary"));
          })
          .catch((err) => {
            console.error("[Library] Failed to remove:", err);
            toast.error(t("removeFromLibraryError"));
          });
        setRating(item.openalexId, null);
      },
    });
  },
  [removeItem, setRating, t],
);
```

### Example 2: New i18n Keys to Add
```json
// Add to all 6 locale files under "libraryPage":
{
  "removedFromLibrary": "Removed from library",
  "removeFromLibraryError": "Failed to remove item",
  "deleteCollectionError": "Failed to delete collection",
  "removeFromCollectionError": "Failed to remove from collection",
  "addToCollectionError": "Failed to add to collection"
}
```

### Example 3: Mobile-Responsive Filter Grid Fix
```tsx
// Source: library-filters.tsx line 142
// Before:
<div className="grid grid-cols-1 sm:grid-cols-4 gap-2">

// After -- 2-column at sm, 4-column at lg:
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
```

### Example 4: Header Export Button Mobile Fix
```tsx
// Source: library-page-client.tsx line 231
// Current header: items may wrap poorly on narrow screens
// Fix: allow wrap and ensure export button sits below on mobile
<div className="flex items-center gap-3 mb-5 flex-wrap">
  <h1 className="text-2xl font-semibold tracking-tight">
    {t("title")}
  </h1>
  {/* ... badge ... */}
  {/* Export dropdown -- ml-auto pushes it right on desktop */}
  {exportItems && exportItems.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto">
          {/* ... */}
        </Button>
      </DropdownMenuTrigger>
      {/* ... */}
    </DropdownMenu>
  )}
</div>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind v3 config file | Tailwind v4 CSS-first (@import "tailwindcss") | Project uses v4 | Breakpoints are standard (sm:640, md:768, lg:1024) |
| Custom toast components | sonner ^2.x with Radix integration | Already in place | `toast.success()` and `toast.error()` are the correct API |
| next-intl v3 | next-intl ^4.8.2 | Project uses v4 | `useTranslations()` API unchanged |

**Deprecated/outdated:**
- None relevant -- all project dependencies are current.

## Open Questions

1. **Touch target sizing threshold**
   - What we know: Apple HIG recommends 44x44pt minimum; Material recommends 48dp. The `icon-xs` button variant is used for three-dot menus.
   - What's unclear: The exact pixel dimensions of `icon-xs` in this project's design system.
   - Recommendation: Inspect the button variant definition. If it's below 36px, add padding-based touch area expansion on mobile using `min-h-[44px] min-w-[44px]` on mobile or use a larger size variant on small screens.

2. **French locale accent characters**
   - What we know: The fr.json file has some strings without proper accents (e.g., "Gerer" instead of "Gerer", "Creer" instead of "Creer"). These appear to be missing diacritics.
   - What's unclear: Whether this is intentional (ASCII-safe) or an oversight.
   - Recommendation: Treat as an oversight and fix during the i18n pass. Proper French requires accents (Gerer -> Gerer, Creer -> Creer, etc.).

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all 9 library component files
- Direct codebase inspection of all 6 locale files (messages/*.json)
- Direct codebase inspection of toast system (lib/toast/*, components/ui/sonner.tsx)
- Direct codebase inspection of dialog component (components/ui/dialog.tsx)
- package.json for exact dependency versions

### Secondary (MEDIUM confidence)
- Tailwind v4 default breakpoints (sm:640px, md:768px, lg:1024px) -- standard, unchanged from v3
- Apple Human Interface Guidelines touch target recommendation (44x44pt) -- well-established standard

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools already in project, versions verified from package.json
- Architecture: HIGH - All patterns derived from direct codebase inspection
- Pitfalls: HIGH - All issues identified from actual code analysis, not hypothetical

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable domain, no moving targets)
