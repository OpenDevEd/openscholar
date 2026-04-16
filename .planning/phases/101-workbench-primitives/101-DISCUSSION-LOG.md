# Phase 101: Workbench Primitives - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 101-workbench-primitives
**Areas discussed:** DataTable wrapper architecture, Column definition strategy, Filter toolbar composition, View switcher pattern
**Mode:** --auto (all decisions auto-selected)

---

## DataTable Wrapper Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Shell component with props | WorkbenchShell owns useReactTable, passes table object via props to child views | ✓ |
| React context provider | Wrap views in a TableContext that provides the table instance | |
| Hook-based sharing | Custom hook that creates and shares the table instance via ref | |

**User's choice:** [auto] Shell component with props (recommended default)
**Notes:** Simpler than context, avoids re-render propagation. Shell is always mounted — no provider boundary issues. Consistent with the single-owner-passes-down pattern used elsewhere in the codebase.

---

## Column Definition Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Hoisted module-level columns | Columns defined outside component in dedicated file, React.memo cell renderers | ✓ |
| Inline columns with useMemo | Columns defined inside component, memoized with useMemo | |
| Column factory hook | useWorkbenchColumns() hook that returns memoized columns | |

**User's choice:** [auto] Hoisted module-level columns (recommended default)
**Notes:** Prevents PITFALL 4 re-render storm at 1k rows. Static columns hoisted at module level; dynamic question columns generated via createWorkbenchColumns(questions) and memoized in the shell.

---

## Filter Toolbar Composition

| Option | Description | Selected |
|--------|-------------|----------|
| Horizontal toolbar with FilterSection wrappers | Reuse FilterSection for each filter group in a horizontal bar above views | ✓ |
| Sidebar filter panel | Reuse FilterSidebar (sidebar layout) for workbench filters | |
| Inline filter chips | Filter chips directly in the toolbar without FilterSection wrappers | |

**User's choice:** [auto] Horizontal toolbar with FilterSection wrappers (recommended default)
**Notes:** Reuses existing FilterSection primitive per WB-10 requirement. Horizontal layout differentiates workbench from search/library sidebar patterns. Toolbar is view-agnostic — works the same for table, card, and split views.

---

## View Switcher Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented control in toolbar + Zustand persistence | ToggleGroup with table/card/split, activeView stored in extraction-results-view store | ✓ |
| Tab-based switcher | shadcn Tabs component as the view container | |
| Dropdown selector | Select dropdown for view mode | |

**User's choice:** [auto] Segmented control in toolbar + Zustand persistence (recommended default)
**Notes:** Segmented control is more discoverable than dropdown. Zustand persistence means view preference survives navigation. Stored in same store as column visibility for single source of truth.

---

## Claude's Discretion

- Toolbar Tailwind styling and segmented control design
- Filter dropdown component choice (Select vs Popover+Command)
- Internal sub-component naming
- Test file organization
- View transition animations

## Deferred Ideas

None — discussion stayed within phase scope.
