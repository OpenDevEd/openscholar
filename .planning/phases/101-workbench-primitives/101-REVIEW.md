---
phase: 101-workbench-primitives
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - lib/store/extraction-results-view.ts
  - lib/extraction/workbench-columns.tsx
  - tests/extraction-results-view-store.test.ts
  - tests/workbench-columns.test.ts
  - components/extraction/workbench-data-table.tsx
  - components/extraction/workbench-shell.tsx
  - components/extraction/workbench-toolbar.tsx
  - components/extraction/view-switcher.tsx
  - components/extraction/column-visibility-toggle.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 101: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Overall the phase 101 workbench primitives are well-structured. The architecture is sound: a single `useReactTable` instance owned by `WorkbenchShell`, column definitions hoisted at module scope to prevent re-render storms, Zustand persistence with a proper migration path, and a clean hydration guard pattern that avoids conditional hook ordering. Tests cover the store and column factory logic adequately.

The most notable issue is that the toolbar renders filter sections for "year" and "venue" columns that do not exist in the column definitions or the `WorkbenchPaper` data type. These are dead UI elements that will silently no-op. Two additional warnings address a missing keyboard accessibility concern on sortable headers and label/checkbox association in the column visibility popover.

## Warnings

### WR-01: Toolbar filters reference non-existent "year" and "venue" columns

**File:** `components/extraction/workbench-toolbar.tsx:121-161`
**Issue:** The toolbar renders `FilterSection` components for `"year"` (lines 121-140) and `"venue"` (lines 142-161) columns. However, `workbench-columns.tsx` defines only five static columns: `title`, `status`, `confidence`, `doi`, and `parsingSource`. Neither `year` nor `venue` exists in the `WorkbenchPaper` interface or the column definitions. `table.getColumn("year")` returns `undefined`, and all downstream calls (`.getFilterValue()`, `.setFilterValue()`) are swallowed by optional chaining. The filters render but do nothing -- they are dead UI that misleads users.
**Fix:** Either (a) remove the year and venue filter sections until those columns are added to the data model and column definitions, or (b) add `year` and `venue` fields to `WorkbenchPaper` and corresponding column definitions in `workbench-columns.tsx`. Option (a) is recommended if these fields are not yet available from the backend:
```tsx
// Remove lines 121-161 in workbench-toolbar.tsx (the year and venue FilterSection blocks)
// and re-add them when WorkbenchPaper gains year/venue fields.
```

### WR-02: Sortable table headers lack keyboard accessibility

**File:** `components/extraction/workbench-data-table.tsx:38-49`
**Issue:** Sortable column headers use `onClick` on a `<th>` element (via `TableHead`) but provide no `tabIndex`, `role="button"`, `onKeyDown`, or `aria-sort` attribute. Users navigating by keyboard cannot focus or activate the sort toggle. This conflicts with the project's stated goal of WCAG AAA accessibility (from CLAUDE.md: "Target WCAG AAA ... full reduced-motion support, extensive alt text, screen reader excellence").
**Fix:** Add keyboard support and ARIA attributes to sortable headers:
```tsx
<TableHead
  key={header.id}
  className={cn(
    "font-semibold",
    canSort && "cursor-pointer select-none group",
  )}
  tabIndex={canSort ? 0 : undefined}
  role={canSort ? "button" : undefined}
  aria-sort={
    sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : canSort ? "none" : undefined
  }
  onClick={
    canSort ? header.column.getToggleSortingHandler() : undefined
  }
  onKeyDown={
    canSort
      ? (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            header.column.getToggleSortingHandler()?.(e);
          }
        }
      : undefined
  }
>
```

### WR-03: Checkbox labels in column visibility popover are not associated with inputs

**File:** `components/extraction/column-visibility-toggle.tsx:46-56, 60-79`
**Issue:** The `<label>` elements for both the "Toggle all" checkbox (line 53) and individual column checkboxes (line 74) lack `htmlFor` attributes, and the `<Checkbox>` components lack corresponding `id` props. Screen readers cannot associate labels with their checkboxes. This is a WCAG 1.3.1 (Info and Relationships) and 4.1.2 (Name, Role, Value) violation.
**Fix:** Generate stable IDs and wire `htmlFor`/`id`:
```tsx
{/* Toggle all */}
<Checkbox
  id="col-toggle-all"
  checked={table.getIsAllColumnsVisible()}
  onCheckedChange={(value) => table.toggleAllColumnsVisible(!!value)}
/>
<label htmlFor="col-toggle-all" className="text-sm font-semibold">
  {t("workbench.toggleAll")}
</label>

{/* Individual columns */}
<Checkbox
  id={`col-toggle-${column.id}`}
  checked={column.getIsVisible()}
  onCheckedChange={(value) => column.toggleVisibility(!!value)}
/>
<label htmlFor={`col-toggle-${column.id}`} className="text-sm truncate">
  {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
</label>
```

## Info

### IN-01: Both "card" and "split" views receive the same `children` prop

**File:** `components/extraction/workbench-shell.tsx:134-161`
**Issue:** Lines 142 and 157 both render `{children}` as the content for the card and split views respectively. If a consumer passes `children`, the same content appears in both views with no way to differentiate. This is likely intentional as a placeholder (the fallback text says "Phase 103"), but it means a future consumer passing children will get identical card and split views unless the API changes.
**Fix:** No action needed now, but when Phase 103 implements card/split views, consider replacing the single `children` prop with named slots or a render-prop API (e.g., `renderCardView` / `renderSplitView`) to allow distinct content per view mode.

### IN-02: Hardcoded filter option labels in status filter

**File:** `components/extraction/workbench-toolbar.tsx:81-87`
**Issue:** The status filter `SelectItem` labels are hardcoded English strings ("Pending", "Parsing", etc.) rather than using the `t()` translation function. The confidence filter on lines 114-118 correctly uses `t()` for its labels. This inconsistency means the status filter will not be localized.
**Fix:** Use translation keys for consistency:
```tsx
<SelectItem value="pending">{t("progress.statusPending")}</SelectItem>
<SelectItem value="parsing">{t("progress.statusParsing")}</SelectItem>
<SelectItem value="extracting">{t("progress.statusExtracting")}</SelectItem>
<SelectItem value="completed">{t("progress.statusCompleted")}</SelectItem>
<SelectItem value="failed">{t("progress.statusFailed")}</SelectItem>
<SelectItem value="cancelled">{t("progress.statusCancelled")}</SelectItem>
```

### IN-03: Migration function accepts `unknown` but casts without validation

**File:** `lib/store/extraction-results-view.ts:33-42`
**Issue:** `migrateViewState` accepts `persistedState: unknown` and when `version >= 1`, casts it directly to the expected shape with `as` (line 38). If localStorage data is corrupted or manually tampered with, this could produce a store with missing or wrong-typed fields, leading to subtle runtime errors downstream. The version-0 fallback (line 37) is safe because it returns defaults.
**Fix:** Add lightweight runtime validation for the version-1 path:
```typescript
if (version < 1) return { columnVisibility: {}, activeView: "table" };
const state = persistedState as Record<string, unknown>;
const columnVisibility =
  state.columnVisibility && typeof state.columnVisibility === "object"
    ? (state.columnVisibility as Record<string, boolean>)
    : {};
const activeView =
  state.activeView === "table" || state.activeView === "card" || state.activeView === "split"
    ? state.activeView
    : "table";
return { columnVisibility, activeView };
```

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
