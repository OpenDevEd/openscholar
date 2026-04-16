# Phase 101: Workbench Primitives - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Re-install `@tanstack/react-table@^8.21.3` and build the reusable headless primitives (`DataTable` wrapper shell, filter toolbar, view switcher, column visibility store) that Phase 103's 4-view workbench will consume. The shadcn `<Table />` primitive already exists at `components/ui/table.tsx`. This phase ships primitives only — no route pages, no data fetching, no view implementations.

Requirements: WB-01 (TanStack Table + shadcn Table primitive layer), WB-02 (column visibility persistence via Zustand store), WB-03 (sort/filter toolbar primitives for status/confidence/year/venue/answer), WB-10 (reuse v2.2 `FilterSection` as filter chrome).

</domain>

<decisions>
## Implementation Decisions

### DataTable Wrapper Architecture
- **D-01:** A `WorkbenchShell` component owns the single `useReactTable(...)` instance and passes the `table` object to child view components via props — not React context. The shell is always mounted on `/extraction/[jobId]` and the active view is swapped beneath it. This avoids context-based re-render propagation and keeps the `table` instance stable across view switches.
- **D-02:** The `useReactTable(...)` call receives `data`, `columns`, `state`, and `onStateChange` from the shell. Sorting and column filter state live in the shell's local state (driven by the toolbar). Column visibility state is pulled from the Zustand store (D-05). The shell never recomputes `useReactTable` options inline — all inputs are stable references.

### Column Definition Strategy
- **D-03:** Column definitions live in a dedicated `lib/extraction/workbench-columns.tsx` file, hoisted at module level (outside any component) to prevent recreation on every render. Static columns: title, authors (if available from query shape), year (from DOI resolution or paper metadata), DOI, status, confidence, parsingSource. Dynamic columns: one per extraction question (generated from `job.questions` array). Cell renderers for expensive cells (status badges, confidence badges) use `React.memo`.
- **D-04:** The column definition function signature is `createWorkbenchColumns(questions: ExtractionQuestion[])` — returns a `ColumnDef[]` array. The shell calls this once when the job's question list is loaded and memoizes the result via `useMemo` keyed on `questions`. This prevents the PITFALL 4 column-filter re-render storm at 1k rows.

### Column Visibility Persistence
- **D-05:** Create a Zustand store in `lib/store/extraction-results-view.ts` using the existing `create<T>()(persist(...))` pattern (NOT `createSidebarStore` — this store has a different shape). Store shape: `{ columnVisibility: Record<string, boolean>, activeView: "table" | "card" | "split", setColumnVisibility, toggleColumn, setActiveView }`. Persist key: `extraction-results-view`. Storage: `localStorage` (global user preference that persists across sessions, unlike the sessionStorage basket). The store is keyed globally — column visibility preferences apply across all jobs.

### Filter Toolbar Composition
- **D-06:** Create a `WorkbenchToolbar` component in `components/extraction/workbench-toolbar.tsx` that renders filter controls driving TanStack Table's `columnFilters` state. Each filter group is wrapped in the existing `FilterSection` primitive from `components/shared/filter-section.tsx` for consistent cross-page filter chrome (WB-10). Filter groups: status (dropdown), confidence (dropdown), year (range input), venue (text input), answer value (per-question text input).
- **D-07:** The toolbar is a horizontal bar above all views (not a sidebar). It includes the view switcher (D-08), column visibility toggle (popover with checkboxes), sort controls, and the filter groups. All filter/sort state changes update the `useReactTable` instance via the shell's `onStateChange` callback. The toolbar is view-agnostic — it works the same regardless of which view is active.

### View Switcher Pattern
- **D-08:** The view switcher is a segmented control (shadcn `ToggleGroup` or custom segmented control) in the toolbar with three options: `table`, `card`, `split`. The active view value is stored in the same Zustand store as column visibility (D-05, `activeView` field). View switches do NOT re-fetch data or re-create the `useReactTable` instance — only the rendering component beneath the shell changes.

### Claude's Discretion
- Exact Tailwind styling for the toolbar layout and segmented control
- Whether filter dropdowns use shadcn `Select` or `Popover` + `Command`
- Internal naming for sub-components within the toolbar
- Test file organization for column definitions and toolbar interactions
- Whether to expose a `useWorkbenchStore` hook or import the store directly
- Animation transitions between views (use existing `lib/animation-config.ts` presets)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### TanStack React Table
- TanStack Table v8 docs — column definitions, `useReactTable`, sorting/filtering/visibility APIs, memoization guidance

### Existing UI Primitives
- `components/ui/table.tsx` — shadcn Table primitive (Table, TableHeader, TableBody, TableRow, TableHead, TableCell) already installed
- `components/shared/filter-section.tsx` — `FilterSection` component with icon, title, isActive, onClear, children slot — reuse for WB-10
- `components/shared/filter-sidebar.tsx` — `FilterSidebar` chrome shell (reference only — workbench uses horizontal toolbar, not sidebar)
- `components/shared/sidebar-layout.tsx` — `SidebarLayout` responsive component (reference for split-view layout patterns)

### Existing Extraction Components
- `components/extraction/confidence-badge.tsx` — ConfidenceBadge for high/medium/low confidence display
- `components/extraction/status-badge.tsx` — StatusBadge for paper extraction status
- `components/extraction/paper-result-card.tsx` — Existing paper result card (Phase 103 card view may adapt)
- `components/extraction/tier-selector.tsx` — `ModelTier` type export
- `components/extraction/evidence-quote.tsx` — EvidenceQuote component (Phase 103 evidence drawer)

### Data Shape
- `convex/extraction/queries.ts:484-522` — `getExtractionResults` query return shape: `{ job: { _id, status, questions, totalPapers }, papers: [{ _id, title, openalexId, doi, status, parsingSource, results: [{ questionId, answer, confidence, evidenceStartChar, evidenceEndChar, reasoning, modelUsed, criticVerdict }] }] }`

### Store Patterns
- `lib/store.ts:1070-1095` — `createSidebarStore` factory with persist/migrate/hydration pattern (structural reference)
- `lib/store/extraction-basket.ts` — Extraction basket store (sessionStorage pattern from Phase 99)

### Extraction System
- `convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB` (1000) and `EXTRACTION_LIMITS_BY_TIER`
- `convex/extraction/validators.ts` — Shared extraction validators (status, confidence, parsingSource)

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), component naming (PascalCase), constant naming (SCREAMING_SNAKE_CASE)
- `.planning/codebase/STRUCTURE.md` — Directory layout for new files

### Prior Phase Context
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — Limit constants
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store pattern
- `.planning/phases/100-backend-wiring-tierselector-fix/100-CONTEXT.md` — TierSelector threading, error system

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/ui/table.tsx` — Full shadcn Table primitive already installed; Phase 101 wraps it with TanStack Table integration
- `components/shared/filter-section.tsx` — `FilterSection` with icon/title/isActive/onClear/children; reuse as filter group wrappers in toolbar (WB-10)
- `components/extraction/confidence-badge.tsx` — Renders high/medium/low badges; reuse as cell renderer in table columns
- `components/extraction/status-badge.tsx` — Renders paper status; reuse as cell renderer
- `lib/store.ts:1070` — `createSidebarStore` factory and `createSidebarDimensions` — structural template for persist pattern
- `lib/animation-config.ts` — Motion spring presets for view transition animations

### Established Patterns
- Zustand stores use `create<T>()(persist((set, get) => ({...}), { name, version, migrate, storage, partialize, onRehydrateStorage }))` pattern
- Components follow kebab-case file naming, PascalCase exports
- shadcn primitives are unstyled wrappers in `components/ui/` — feature components compose them in `components/extraction/`
- Filter state follows the URL-state-via-nuqs pattern on search/library pages — but workbench filters are client-side only (TanStack Table state), not URL state

### Integration Points
- `app/extraction/[jobId]/extraction-results-client.tsx` — Current results page that will be replaced/refactored to use WorkbenchShell in Phase 103
- `app/extraction/[jobId]/page.tsx` — Server component that loads the results client
- Phase 103 will import WorkbenchShell, WorkbenchToolbar, and column definitions to build the 4-view workbench
- Phase 103 will also add `@tanstack/react-virtual` for card-view virtualization (separate from this phase)

</code_context>

<specifics>
## Specific Ideas

- `@tanstack/react-table@^8.21.3` is the ONLY net-new runtime dependency for this entire milestone (v7.0). Install it in Phase 101.
- Do NOT install the shadcn `data-table` block — it's monolithic and fights the 4-view architecture where one `useReactTable` instance is shared across table/card/split views.
- Do NOT install `@tanstack/react-virtual` in this phase — that's Phase 103's card-view concern only.
- Column definitions must be hoisted outside components to avoid the PITFALL 4 re-render storm at 1k rows + debounced text filter.
- The `extraction-results-view` Zustand store uses `localStorage` (not sessionStorage) — column visibility and active view are global user preferences, not tab-scoped transient state like the basket.
- The workbench toolbar is horizontal (above the views), not a sidebar. The sidebar pattern is used on search/library pages — the workbench gets a different layout because it has 4 interchangeable views beneath a shared toolbar.
- TanStack Table v9 is explicitly rejected (still alpha). AG Grid Community is rejected (500KB bundle). react-data-grid is rejected (4-year beta).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 101-workbench-primitives*
*Context gathered: 2026-04-16*
