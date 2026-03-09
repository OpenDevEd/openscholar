# Phase 81: Export UI - Research

**Researched:** 2026-03-09
**Domain:** React UI for screening export with format selection, loading states, warnings, and i18n
**Confidence:** HIGH

## Summary

Phase 81 adds an export button to completed screening job cards in the job history, with a dropdown for format selection (CSV, JSON, XLSX), loading feedback, incomplete job warnings, and full i18n across 6 locales. The backend export functions (`exportScreeningToCSV`, `exportScreeningToJSON`, `exportScreeningToXLSX`) and the Convex query (`getScreeningResultsForExport`) are already implemented in Phases 79-80.

The main UI work is in `components/screening/screening-job-history.tsx`, which renders job cards. An export button needs to be added to each card. The project already has two export UI patterns to follow: `components/download-menu.tsx` (DropdownMenu with format options) and `components/extraction/export-dialog.tsx` (Dialog with RadioGroup). For screening, the simpler DropdownMenu pattern is the right choice -- no configuration options needed, just format selection.

The key technical challenge is fetching export data on-demand (not reactively). Convex's `useQuery` is reactive and subscribes to data changes. For export, we need to fetch once when the user clicks. The recommended approach is to use `useQuery` with conditional "skip" args -- pass the jobId only when the user initiates export, then call the export function when data arrives. Alternatively, use the Convex client directly via `useConvex()` hook which returns the ConvexReactClient with a `.query()` method for imperative one-shot queries.

**Primary recommendation:** Add export dropdown directly to job cards in `screening-job-history.tsx`. Use `useConvex()` from `convex/react` for imperative data fetching on button click. Follow the `DownloadMenu` dropdown pattern. Add translation keys to all 6 locale files under `screeningDialog`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | Export button on completed screening job cards in job history | Add to `screening-job-history.tsx` job card render; show only when `job.status` is `completed`, `cancelled`, `creditsExhausted`, or `failed` (any non-pending/processing status with results) |
| UI-02 | Select CSV, JSON, XLSX from dropdown; selected format downloads immediately | Use `DropdownMenu` component (already used in `download-menu.tsx`); three `DropdownMenuItem` entries; call `exportScreeningToCSV/JSON/XLSX` on click |
| UI-03 | Loading indicator while export file is being generated | `useState` for `isExporting` boolean; show `Loader2` spinner on the export button while data is being fetched and file generated |
| UI-04 | Descriptive filenames including job date and status | Already implemented in `lib/screening/export.ts` via `buildFilename()` -- format: `screening-export-{YYYY-MM-DD}-{status}.{ext}` |
| UI-05 | Warning when exporting from cancelled or incomplete jobs | Show inline warning text or tooltip when `job.status` is not `completed`; warn that results may be partial |
| UI-06 | Export UI translated across all 6 locales | Add keys to `screeningDialog` namespace in all 6 message files: en-US, en-GB, fr, ja, zh, hi |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next-intl | (project version) | i18n translations | Project standard for all UI text |
| convex/react | (project version) | Data fetching (useConvex for imperative query) | Project standard for Convex queries |
| lucide-react | (project version) | Icons (Download, Loader2, AlertTriangle) | Project standard icon library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @/components/ui/dropdown-menu | local | DropdownMenu, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuContent | Format selection dropdown |
| @/components/ui/button | local | Button component | Export trigger button |
| @/lib/screening/export | local | exportScreeningToCSV/JSON/XLSX, ScreeningExportData | Called on format selection |
| @/convex/_generated/api | local | api.screening.queries.getScreeningResultsForExport | Convex query reference |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DropdownMenu | Dialog with RadioGroup (like extraction export) | Dialog adds friction; screening export has no options beyond format, so dropdown is simpler and more direct |
| useConvex().query() imperative | useProtectedQuery with conditional skip | useConvex() is cleaner for one-shot fetch; avoids reactive subscription overhead |
| Inline export button in card | Separate export dialog | Inline is simpler UX -- one click to format, immediate download |

**Installation:**
```bash
# No new dependencies needed -- all UI components and export functions already exist
```

## Architecture Patterns

### Recommended Project Structure
```
components/screening/
  screening-job-history.tsx   # MODIFY: Add export dropdown to job cards
messages/
  en-US.json                  # MODIFY: Add export translation keys
  en-GB.json                  # MODIFY: Add export translation keys
  fr.json                     # MODIFY: Add export translation keys
  ja.json                     # MODIFY: Add export translation keys
  zh.json                     # MODIFY: Add export translation keys
  hi.json                     # MODIFY: Add export translation keys
```

### Pattern 1: Imperative Convex Query with useConvex()
**What:** Use `useConvex()` hook to get the Convex client and call `.query()` for one-shot data fetching
**When to use:** When data should be fetched on user action (button click), not reactively
**Example:**
```typescript
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";

function MyComponent() {
  const convex = useConvex();

  const handleExport = async (jobId: Id<"screeningJobs">, format: string) => {
    setIsExporting(true);
    try {
      const data = await convex.query(
        api.screening.queries.getScreeningResultsForExport,
        { jobId }
      );
      if (!data) return;

      if (format === "csv") exportScreeningToCSV(data);
      else if (format === "json") exportScreeningToJSON(data);
      else await exportScreeningToXLSX(data);
    } finally {
      setIsExporting(false);
    }
  };
}
```

### Pattern 2: Export Dropdown on Job Card (DownloadMenu pattern)
**What:** DropdownMenu with Download icon trigger and format menu items
**When to use:** Export with format selection on card-level actions
**Example (adapted from download-menu.tsx):**
```typescript
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="icon-xs" disabled={isExporting}>
      {isExporting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => handleExport(job._id, "csv")}>
      {t("exportCSV")}
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => handleExport(job._id, "json")}>
      {t("exportJSON")}
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => handleExport(job._id, "xlsx")}>
      {t("exportXLSX")}
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Pattern 3: Incomplete Job Warning
**What:** Show warning text when exporting from non-completed jobs
**When to use:** When `job.status` is `cancelled`, `failed`, or `creditsExhausted`
**Example:**
```typescript
const isIncomplete = job.status !== "completed";
// In dropdown, before format items:
{isIncomplete && (
  <div className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
    <AlertTriangle className="h-3 w-3 shrink-0" />
    {t("exportIncompleteWarning")}
  </div>
)}
```

### Pattern 4: Stopping Event Propagation
**What:** Export button is inside a clickable job card; must prevent card click when interacting with export
**When to use:** Any interactive element inside a clickable parent
**Example:**
```typescript
<div onClick={(e) => e.stopPropagation()}>
  <DropdownMenu>...</DropdownMenu>
</div>
```
**Note:** The card already uses this pattern for the Accordion section (line 209 in current code).

### Anti-Patterns to Avoid
- **Using useProtectedQuery for export data:** It creates a reactive subscription. Export needs one-shot imperative fetch. Use `useConvex().query()` instead.
- **Showing export button on pending/processing jobs:** These jobs have no results yet. Only show for statuses that have results (completed, cancelled, failed, creditsExhausted).
- **Forgetting stopPropagation:** The export dropdown is inside a clickable card. Without stopPropagation, clicking export will also trigger onSelectJob.
- **Blocking UI during XLSX generation:** The dynamic import of ExcelJS takes time. The loading state must cover the full async operation including import + workbook generation + download.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Format dropdown UI | Custom select/popover | `DropdownMenu` from `@/components/ui/dropdown-menu` | Consistent with existing download-menu.tsx pattern |
| Export file generation | New export logic | `exportScreeningToCSV/JSON/XLSX` from `lib/screening/export.ts` | Phase 80 already built and tested these |
| Data fetching for export | Custom fetch logic | `useConvex().query()` from `convex/react` | Standard Convex imperative query pattern |
| Translation framework | Custom i18n | `useTranslations` from `next-intl` | Project standard i18n approach |
| Loading spinner | Custom animation | `Loader2` icon with `animate-spin` class | Consistent with existing loading patterns (e.g., processing status icon) |

## Common Pitfalls

### Pitfall 1: Card onClick Firing When Clicking Export
**What goes wrong:** Clicking the export dropdown also triggers the card's `onSelectJob` handler
**Why it happens:** Event bubbles up from the dropdown to the card's onClick
**How to avoid:** Wrap the export dropdown in a `<div onClick={(e) => e.stopPropagation()}>` -- the codebase already does this for the Accordion section
**Warning signs:** Clicking export also opens/selects the job

### Pitfall 2: Showing Export for Jobs with No Results
**What goes wrong:** Export button appears on pending/processing jobs that have no screening results
**Why it happens:** Not checking job status before rendering export button
**How to avoid:** Only show export when `!isInProgress` (status is not pending/processing)
**Warning signs:** Clicking export on processing job returns null from query

### Pitfall 3: Missing Loading State for XLSX
**What goes wrong:** User clicks XLSX export, nothing happens for 1-2 seconds (ExcelJS dynamic import), then file downloads
**Why it happens:** No loading indicator during the async XLSX generation
**How to avoid:** Set `isExporting` state before the async call, clear it in finally block. Disable the dropdown trigger while exporting.
**Warning signs:** No visual feedback when clicking XLSX export

### Pitfall 4: Missing Translations Cause Runtime Errors
**What goes wrong:** `t("exportCSV")` returns the key path instead of translated text, or throws in strict mode
**Why it happens:** Translation key added to en-US but not to other 5 locale files
**How to avoid:** Add all new keys to ALL 6 locale files (en-US, en-GB, fr, ja, zh, hi) in the same commit
**Warning signs:** Raw key paths showing in non-English locales

### Pitfall 5: Export Query Returns Null
**What goes wrong:** `getScreeningResultsForExport` returns null, export function crashes
**Why it happens:** Auth failure or job not found/not owned
**How to avoid:** Check for null return before calling export functions. Show a toast or do nothing gracefully.
**Warning signs:** TypeError when trying to access `.job` on null

## Code Examples

### Export Handler with Loading State
```typescript
// Source: Derived from project patterns (useConvex + screening export functions)
const [exportingJobId, setExportingJobId] = useState<string | null>(null);
const convex = useConvex();

const handleExport = async (
  jobId: Id<"screeningJobs">,
  format: "csv" | "json" | "xlsx"
) => {
  setExportingJobId(jobId);
  try {
    const data = await convex.query(
      api.screening.queries.getScreeningResultsForExport,
      { jobId }
    );
    if (!data) return;

    if (format === "csv") {
      exportScreeningToCSV(data);
    } else if (format === "json") {
      exportScreeningToJSON(data);
    } else {
      await exportScreeningToXLSX(data);
    }
  } catch (error) {
    console.error("Export failed:", error);
  } finally {
    setExportingJobId(null);
  }
};
```

### Translation Keys Structure
```json
// Added to screeningDialog namespace in all 6 locale files
{
  "exportButton": "Export",
  "exportCSV": "Download as CSV",
  "exportJSON": "Download as JSON",
  "exportXLSX": "Download as Excel",
  "exportIncompleteWarning": "This job did not complete. Results may be partial.",
  "exportLoading": "Preparing export..."
}
```

### Export Button Placement in Job Card
```typescript
// Inside the Header Row div, after the date, before the Stats Row
// Only shown for non-in-progress jobs
{!isInProgress && (
  <div onClick={(e) => e.stopPropagation()}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={exportingJobId === job._id}
          title={t("exportButton")}
        >
          {exportingJobId === job._id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {isIncompleteJob && (
          <div className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>{t("exportIncompleteWarning")}</span>
          </div>
        )}
        <DropdownMenuItem onClick={() => handleExport(job._id, "csv")}>
          {t("exportCSV")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport(job._id, "json")}>
          {t("exportJSON")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport(job._id, "xlsx")}>
          {t("exportXLSX")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
)}
```

## State of the Art

No changes needed. This phase uses only existing project UI components and patterns.

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | DropdownMenu for format selection | Established in download-menu.tsx | Same pattern reused |
| N/A | useConvex() for imperative queries | Available since Convex 1.x | Standard Convex pattern for non-reactive data fetching |

## Open Questions

1. **Whether to show export on failed jobs (status: "failed")**
   - What we know: Failed jobs may have partial results (some papers processed before failure). The query returns whatever results exist.
   - What's unclear: Whether exporting zero results is useful
   - Recommendation: Show export button for all non-in-progress statuses. If results are empty, the export will just have headers (CSV/XLSX) or an empty results array (JSON), which is harmless.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (node environment for pure logic; jsdom for component tests if needed) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/export-screening-ui.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | Export button rendered on completed job cards, not on pending/processing | manual-only | Visual inspection in browser | N/A |
| UI-02 | Format dropdown with CSV/JSON/XLSX items triggers correct export function | manual-only | Visual inspection + functional test in browser | N/A |
| UI-03 | Loading spinner shown during export generation | manual-only | Visual inspection in browser | N/A |
| UI-04 | Filenames include date and status | unit (already tested) | `npx vitest run tests/export-screening.test.ts` | Yes (Phase 80) |
| UI-05 | Warning shown for incomplete jobs | manual-only | Visual inspection in browser | N/A |
| UI-06 | Translation keys present in all 6 locale files | unit | `npx vitest run tests/export-screening-ui.test.ts -t "translations"` | Needs creation |

### Sampling Rate
- **Per task commit:** `npm test` (full suite to catch regressions)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + manual visual verification

### Wave 0 Gaps
- [ ] `tests/export-screening-ui.test.ts` -- verify translation keys exist in all 6 locale files (simple JSON key check, no DOM rendering needed)

## Sources

### Primary (HIGH confidence)
- `components/screening/screening-job-history.tsx` -- current job card component (will be modified)
- `components/screening/screening-jobs-dialog.tsx` -- parent dialog hosting job history
- `components/download-menu.tsx` -- existing DropdownMenu export pattern
- `components/extraction/export-dialog.tsx` -- existing Dialog export pattern (not recommended for screening but shows RadioGroup approach)
- `lib/screening/export.ts` -- Phase 80 export functions (already implemented)
- `convex/screening/queries.ts:190-260` -- getScreeningResultsForExport query
- `lib/auth/use-auth-query.ts` -- useProtectedQuery pattern (not recommended for export, but shows project auth-query patterns)
- `messages/en-US.json:1527-1587` -- existing screeningDialog translation keys
- `vitest.config.ts` -- test configuration with environment matching

### Secondary (MEDIUM confidence)
- Convex `useConvex()` hook -- standard Convex React pattern for imperative client access; documented in Convex docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all components and libraries already exist in project
- Architecture: HIGH -- adapting existing DownloadMenu pattern; straightforward React state management
- Pitfalls: HIGH -- based on direct code analysis of event propagation, async loading, and i18n patterns

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- only internal UI patterns, no external dependency changes)
