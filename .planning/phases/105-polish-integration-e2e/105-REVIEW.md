---
phase: 105-polish-integration-e2e
reviewed: 2026-04-16T22:07:14Z
depth: standard
files_reviewed: 29
files_reviewed_list:
  - app/extraction/new/selector-page-client.tsx
  - app/extraction/new/zotero-item-row.tsx
  - app/globals.css
  - app/layout.tsx
  - components/extraction/add-to-extraction-button.tsx
  - components/extraction/extraction-basket-drawer.tsx
  - components/extraction/extraction-counter.tsx
  - components/extraction/job-metrics-panel.tsx
  - components/extraction/view-switcher.tsx
  - components/extraction/workbench-shell.tsx
  - components/extraction/workbench-toolbar.tsx
  - components/providers/reduced-motion-provider.tsx
  - convex/extraction/testing.ts
  - convex/extraction/testingMutations.ts
  - e2e/auth.spec.ts
  - e2e/extraction-workbench.spec.ts
  - e2e/fixtures/zotero-collections.json
  - e2e/fixtures/zotero-items.json
  - e2e/helpers/sign-in.ts
  - eslint.config.mjs
  - lib/time-units.ts
  - messages/en-GB.json
  - messages/en-US.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
  - package.json
  - tests/extraction/lint-rule.test.ts
  - tests/i18n/v7-key-parity.test.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 105: Code Review Report

**Reviewed:** 2026-04-16T22:07:14Z
**Depth:** standard
**Files Reviewed:** 29
**Status:** issues_found

## Summary

Phase 105 delivers its stated scope: GAP-03 lint rule (SC-1), dev-guarded Convex seed
action (SC-2 setup), E2E spec for the v7.0 workbench (SC-2), reduced-motion wiring via
`MotionConfig reducedMotion="user"` plus CSS fallback (SC-4), mobile polish (SC-3),
and i18n key parity across all six locales (SC-5, verified at 1,540 keys per locale
with zero missing/extra). The ESLint 9 flat config is correctly structured — later,
more-specific blocks override earlier rules for test exceptions, and subpath imports
(`eslint-config-next/core-web-vitals`, `.../typescript`) resolve correctly via the
package's `exports` map.

Production safety is preserved by the triple-condition dev guard in both
`convex/extraction/testing.ts` and `convex/extraction/testingMutations.ts`; the
mutation repeats the guard as defense-in-depth and refuses to run without
`E2E_CLERK_USER_EMAIL`. The V8/Node runtime split is correct per Convex guidelines
(`"use node";` file exports only actions, companion mutation lives in a V8 file).

However, the E2E spec (`e2e/extraction-workbench.spec.ts`) has multiple selector
correctness issues that will cause silent passes, flaky failures, or outright
timeouts. The most severe: the reduced-motion assertion relies on `getByRole("button",
{ name: /table view/i })`, but the workbench view switcher renders icon-only buttons
whose accessible name is the bare label "Table" / "Cards" / "Split" (from
`t("workbench.viewTable")`). The regex `/table view/i` will not match "Table", so the
click will time out well before the 150ms threshold is ever measured. Compounding
this, the evidence-drawer click test asserts `getByRole("dialog")` becomes visible
after clicking an evidence span — but `workbench-shell.tsx:132` explicitly discards
the `openEvidence` callback (`void openEvidence; // Prepared for CardView/SplitView
onEvidenceClick integration`), so no click handler is wired to evidence text. The
feature under test does not exist yet.

Additional warnings cover a stale/missing memoization in the export dropdown, an
inconsistent Tailwind selector between two Progress consumers, and a test that calls
`getByRole("searchbox")` against an `<Input type="text">` that never gets the
`searchbox` role, causing the "filtered export" assertion to silently export the
unfiltered superset.

## Warnings

### WR-01: E2E view-switcher selectors use regex that cannot match accessible names

**File:** `e2e/extraction-workbench.spec.ts:130, 134, 146, 148`
**Issue:** The test uses `page.getByRole("button", { name: /card view/i })`,
`/split view/i`, and `/table view/i`, but the workbench view switcher renders
`CompactIconToggleGroup` icon-only `<button>` elements whose only naming source is
`title={option.label}`, and the labels are `t("workbench.viewTable") → "Table"`,
`viewCard → "Cards"`, `viewSplit → "Split"`. Playwright's accessible-name
resolution does include `title` as a fallback, but the regex `/table view/i`
requires the substring "table view" which is never present. Result: every view-
switch click in the E2E spec times out waiting for a matching locator, including
the reduced-motion assertion that supposedly validates `<150ms` view-switch
latency. The elapsed time is never reached — the spec fails at the first `click()`
before `Date.now()` is sampled meaningfully.
**Fix:** Change the regex to match the actual label (e.g. `/^table$/i`,
`/^cards?$/i`, `/^split$/i`) OR add explicit `aria-label`s to the toggle buttons
in `components/view-mode-toggle.tsx:40-53` (strongly preferred — icon-only buttons
should not rely on `title` for their accessible name; this is a WCAG concern on
top of the test correctness issue):
```tsx
// components/view-mode-toggle.tsx around line 40
<button
  key={option.value}
  type="button"
  onClick={() => onChange(option.value)}
  aria-label={option.label}  // <-- ADD
  title={option.label}
  className={cn(...)}
>
  {option.icon}
</button>
```
Then the E2E regex can be `/^table view$/i` only if the label itself contains
"view". Today it does not, so prefer `{ name: t("workbench.viewTable") }` style
or simply `name: "Table"` / `name: "Cards"` / `name: "Split"` once `aria-label`
is present.

---

### WR-02: Evidence-drawer E2E assertion targets an unwired feature

**File:** `e2e/extraction-workbench.spec.ts:138-140`
**Issue:** The spec does:
```ts
await page.getByText("seeded evidence span").first().click();
await expect(page.getByRole("dialog")).toBeVisible();
await page.keyboard.press("Escape");
```
But `components/extraction/workbench-shell.tsx:132` contains
`void openEvidence; // Prepared for CardView/SplitView onEvidenceClick integration`.
The `openEvidence` callback that would open `EvidenceDrawer` is defined but never
passed to any child view, so the seeded evidence text has no click handler, the
drawer never opens, and the `getByRole("dialog")` assertion will either time out
or match an unrelated dialog that happens to be mounted (e.g., a still-open
Tooltip rendered via Radix Dialog). This couples a passing E2E run to incidental
DOM that may change independently.
**Fix:** Either (a) wire `openEvidence` through to `CardView` / `SplitView` as an
`onEvidenceClick` prop in the same phase, or (b) remove the drawer-open assertion
from the 105 E2E spec and move it to the phase that actually ships the click
handler. Minimal scope fix:
```tsx
// components/extraction/workbench-shell.tsx around line 203
<CardView
  table={table}
  questions={questions}
  onEvidenceClick={openEvidence}  // <-- wire up
/>
// ... and same for SplitView ...
// Then delete `void openEvidence;` on line 132.
```
If wiring is out of scope, delete the three assertion lines in the spec and
replace with a TODO comment pointing to the tracking issue.

---

### WR-03: `getByRole("searchbox")` never matches — filtered export test silently degrades to unfiltered

**File:** `e2e/extraction-workbench.spec.ts:163-166`
**Issue:** The test does:
```ts
const search = page.getByRole("searchbox");
if (await search.count() > 0) {
  await search.fill("Seeded Paper 1");
}
```
`components/extraction/workbench-toolbar.tsx:160` renders `<Input type="text"
value={searchInput} ... />`. `Input` (in `components/ui/input.tsx`) forwards
`type` verbatim to `<input>`. `type="text"` implies the implicit ARIA role
`textbox`, not `searchbox` — the `searchbox` role is only assigned when
`type="search"`. So `search.count()` always returns `0`, the fill is skipped, and
the subsequent `for (const format of ["csv", "json", "xlsx"])` loop exports the
unfiltered superset of rows. The test name ("export filtered subset to CSV,
JSON, XLSX") no longer reflects what is actually exercised — this is
false-positive coverage for the filter-to-export wiring (D-19).
**Fix:** Either (a) change the toolbar input to `<Input type="search" ...>` so
it adopts the `searchbox` role, or (b) change the test selector to target the
placeholder text instead:
```ts
// e2e/extraction-workbench.spec.ts line 163
const search = page.getByPlaceholder(/search papers/i);
await search.fill("Seeded Paper 1");
// Drop the if/count guard — fail loudly if the input is gone.
```
Option (a) is also an a11y win — search inputs should self-identify.

---

### WR-04: `Seeded Paper 0` visibility wait is non-deterministic in reduced-motion test

**File:** `e2e/extraction-workbench.spec.ts:145-154`
**Issue:** The reduced-motion timing assertion flow is:
```ts
await page.emulateMedia({ reducedMotion: "reduce" });
await page.getByRole("button", { name: /table view/i }).click();  // Table view now active
const start = Date.now();
await page.getByRole("button", { name: /split view/i }).click();  // Switch to Split
await page.getByText("Seeded Paper 0").first().waitFor({ state: "visible" });
const elapsed = Date.now() - start;
```
Even assuming WR-01 is fixed, the `Seeded Paper 0` text was ALREADY visible in
the Table view; when `activeView === "split"` renders, `Seeded Paper 0` is
visible from the previous Table render in the brief React transition window and
may remain visible across the switch. `waitFor({ state: "visible" })` resolves
immediately, and `elapsed` measures button-click latency, not view-switch
completion. The 150ms budget is not being validated as intended.
**Fix:** Assert on an element that is EXCLUSIVE to the split view (e.g. a
split-pane test id or the split-empty heading), or wait for the new view
container to become visible:
```ts
await page.getByTestId("split-view-pane").waitFor({ state: "visible" });
// OR, if a unique label exists:
await expect(page.getByText(t("workbench.splitEmptyHeading"))).toBeVisible();
```
Add a `data-testid` to the SplitView root if none exists; do the same for
`CardView` and `WorkbenchDataTable` so future motion budgets can target the
correct view.

---

### WR-05: `filteredPaperIds` rebuilt on every render, invalidating memoization of `handleExport`

**File:** `components/extraction/workbench-toolbar.tsx:106-108, 146`
**Issue:** `filteredPaperIds` is computed inline on every render
(`table.getFilteredRowModel().rows.map(...)`), producing a new array reference
each time. It is then listed in the dependency array of `handleExport`
(`useCallback(... , [jobId, convex, hasActiveFilters, filteredPaperIds, t])`),
which causes `handleExport` to be recreated on every render. Because
`handleExport` is eventually attached to `DropdownMenuItem onClick`, this is not
a correctness bug — but it defeats the purpose of `useCallback` and fires the
`useEffect` deps of anything else that memoizes on it downstream. In a hot
re-render path (search input typing updates `globalFilter` which re-renders the
toolbar), this adds measurable overhead.
**Fix:** Memoize the filtered IDs array:
```tsx
const filteredPaperIds = useMemo(
  () => table.getFilteredRowModel().rows.map((row) => row.original._id),
  [table, table.getState().columnFilters, table.getState().globalFilter],
);
```
Note: TanStack's `getFilteredRowModel()` is already memoized internally on its
inputs, so the outer `useMemo` only needs to re-run when filter state changes.
If the deps list feels brittle, a cheaper alternative is to compute the array
INSIDE `handleExport` at click time and drop it from the callback deps.

---

## Info

### IN-01: Non-English locales contain English strings for `extraction.*` keys added in earlier phases

**File:** `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json`
**Issue:** Key parity is met per SC-5 (all six locales have the same 1,540
flattened paths), and the curated French diacritic samples pass the D-25
tripwire. However, ~60-170 `extraction.*` string VALUES in fr/hi/ja/zh are
byte-for-byte identical to en-US — i.e., they were seeded but never translated.
Examples that surfaced in automated comparison:
  - `extraction.jobMetrics.title` — en-US "Job Metrics" == hi/ja/zh (not fr)
  - `extraction.jobCreation.title` — en-US "New Extraction Job" == fr/hi/ja/zh
  - `extraction.progress.papersCounter` — en-US "{processed} of {total}
    papers" == all non-English locales
  - `extraction.workbench.searchPlaceholder`, `paginationShowing`,
    `evidenceDrawerTitle`, `exportFilteredNote`, `exportButton` — all
    untranslated in fr/hi/ja/zh
This is NOT a phase 105 regression (the bulk of these predate the phase range
starting at `086a6a5e...`), and Phase 105's stated i18n scope is explicitly
"key parity" not "translation completeness". Calling it out here for the
downstream localization phase.
**Fix:** Track as deferred work in `.planning/ROADMAP.md` for a follow-up i18n
translation sweep. If desired now, run a translator pass on
`extraction.jobMetrics.*`, `extraction.jobCreation.*`, `extraction.progress.*`,
`extraction.results.*`, `extraction.export.*`, and `extraction.workbench.*`
against the French column (which is the most complete non-English locale) as a
template.

---

### IN-02: Duplicate `<ExtractionCounter />` mounts issue the same Convex subscription twice

**File:** `app/extraction/new/selector-page-client.tsx:62, 99`
**Issue:** The selector page mounts `<ExtractionCounter />` in both the sticky
header (line 62) and sticky footer (line 99). Each instance calls
`useProtectedQuery(api.extraction.queries.getExtractionLimit, {})`. Convex
React's `useQuery` dedupes identical subscriptions at the client level, so
there is only one WebSocket subscription in flight — no duplicate network
traffic. But the component still re-renders twice on every limit change and
computes the ratio twice. For a high-frequency counter this is negligible, but
it is inconsistent with DRY and will cost two subtree renders on every basket
mutation (since `papers.size` comes from Zustand and triggers both).
**Fix:** Either (a) lift the counter to a single sticky position on mobile (it
already is, via `min-h-[44px]`), or (b) memoize the shared data in a parent and
render a dumb presentational `<CounterDisplay count={...} limit={...} />` twice.
(a) aligns with Progressive Disclosure (one counter, sticky) — redundant
counters compete for attention. Low priority.

---

### IN-03: `JobMetricsPanel` uses `[&>div]` selector while `ExtractionCounter` uses `[&>[data-slot=progress-indicator]]`

**File:** `components/extraction/job-metrics-panel.tsx:92-94`
**Issue:** Two Progress consumers use different child-selector idioms:
  - `components/extraction/extraction-counter.tsx:52,55` uses
    `[&>[data-slot=progress-indicator]]:bg-...` (targets the documented
    data-slot API)
  - `components/extraction/job-metrics-panel.tsx:92-94` uses `[&>div]:bg-...`
    (targets the implementation detail that the indicator is the first `<div>`
    child)
Both work today because `components/ui/progress.tsx:22-26` renders the
indicator as a `<div>` with `data-slot="progress-indicator"`. If Radix ever
changes the internal element type (or if a sibling `<div>` is added to the
root), the `[&>div]` form will break silently with no type or lint error.
**Fix:** Align `job-metrics-panel.tsx` with the counter:
```tsx
if (rate >= 0.95) return "[&>[data-slot=progress-indicator]]:bg-[oklch(0.55_0.15_145)]";
if (rate >= 0.80) return "[&>[data-slot=progress-indicator]]:bg-[oklch(0.6_0.12_85)]";
return "[&>[data-slot=progress-indicator]]:bg-destructive";
```

---

### IN-04: Library and Collections tabs have no pre-seeded data guarantee for the stage-papers E2E test

**File:** `e2e/extraction-workbench.spec.ts:91-97`
**Issue:** The first test ("stage papers across 5 tabs") clicks
`page.getByRole("checkbox").first().check()` on the Library and Collections
tabs, but the seed fixture `seedCompletedJob(10, 3)` only inserts rows into
`extractionJobs`, `extractionPapers`, `extractionQuestions`, and
`extractionResults`. Nothing seeds the user's personal library (`library.*`
tables) or collections. On a fresh test user, both tabs render empty states
and `getByRole("checkbox")` resolves to zero elements, causing the click to
time out. The test passes only if the test user happens to already have
library entries from prior runs — a leaky dependency on shared state.
**Fix:** Either (a) extend the seed action to also populate library and
collection rows for the test user (preferred — one place for all E2E
fixtures), or (b) skip Library/Collections clicks and rely on Manual IDs +
Zotero mocks only. Option (a) sketch:
```ts
// convex/extraction/testingMutations.ts — new insert loops after papers:
await ctx.db.insert("library", {
  userId: user._id,
  openalexId: "W1234567",
  title: "E2E Library Paper",
  savedAt: now,
});
```
Add matching `returns` and adjust spec to assert against a known seeded title.

---

### IN-05: Zotero fixture `DOI: ""` vs missing `DOI` — two "no-DOI" encodings

**File:** `e2e/fixtures/zotero-items.json:34-38 (ITEM3333), 42-52 (ITEM4444)`
**Issue:** The fixture expresses "no DOI" two different ways:
  - `ITEM3333` has `"DOI": ""` (empty string)
  - `ITEM4444` has no `DOI` key at all
Both map to the same UI state (STATE 5, disabled checkbox with "No DOI" tooltip
per `zotero-item-row.tsx:46-62`), but only if the parser upstream normalizes
empty string to undefined. If any consumer checks `item.doi !== undefined`
instead of `item.doi && item.doi.length > 0`, `ITEM3333` will falsely be
treated as having a DOI and render an idle checkbox that, when clicked, will
send `onResolve(item.key, "")` to the resolver — a probable silent failure.
**Fix:** Normalize the fixture to a single encoding (drop the `DOI` key when
absent, matching Zotero's actual API behavior for items without DOIs):
```json
// ITEM3333 — remove the "DOI": "" line entirely
```
Alternatively, verify `lib/zotero/normalize.ts` (or equivalent) coerces `""` →
`undefined` and add a regression test in `tests/zotero/`.

---

### IN-06: `void openEvidence;` dead-code pattern in workbench shell

**File:** `components/extraction/workbench-shell.tsx:129-132`
**Issue:** The callback is defined and immediately discarded:
```tsx
const openEvidence = useCallback((props: EvidenceDrawerProps) => {
  setDrawerState({ open: true, props });
}, []);
void openEvidence; // Prepared for CardView/SplitView onEvidenceClick integration
```
`void x` is a convention for suppressing "declared but not read" lint errors
while preserving intent, but it is load-bearing dead code — the drawer
machinery mounted on lines 230-234 can never receive a state update through
any production code path. This violates the project rule "no dead/legacy
code; assume destructive cleanliness" (global CLAUDE.md Rule 3).
**Fix:** Either wire `openEvidence` to the views that need it (preferred —
see WR-02), or delete both the callback and the `EvidenceDrawer` mount until
the next phase brings in the click handler. Keeping dormant UI state that
cannot be entered accrues complexity debt.

---

_Reviewed: 2026-04-16T22:07:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
