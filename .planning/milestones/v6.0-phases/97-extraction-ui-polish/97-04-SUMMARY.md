---
phase: 97-extraction-ui-polish
plan: 04
subsystem: extraction-ui
tags: [sidebar, navigation, job-history, dialog, progress-ring, cancel, export]
dependency_graph:
  requires:
    - "extraction i18n keys (Plan 01)"
    - "ExtractionDialog (Plan 02)"
    - "StatusBadge, PaperResultCard, results route (Plan 03)"
    - "getExtractionProgress query (Phase 93)"
    - "listUserExtractionJobs query (Phase 89)"
    - "cancelExtractionJob mutation (Phase 93)"
    - "getExtractionResultsForExport query (Plan 01)"
    - "export functions (Plan 01)"
  provides:
    - "ExtractionJobHistory component with status dots, progress, export, cancel"
    - "ExtractionJobsDialog wrapper component"
    - "ExtractionFooterButton in sidebar with SVG progress ring"
    - "Extraction nav item in sidebar"
    - "getCurrentPage extraction route detection"
    - "/extraction list page with job history and creation dialog"
  affects:
    - "components/extraction/extraction-job-history.tsx"
    - "components/extraction/extraction-jobs-dialog.tsx"
    - "components/app-sidebar.tsx"
    - "app/extraction/page.tsx"
    - "app/extraction/extraction-list-client.tsx"
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
tech_stack:
  added: []
  patterns:
    - "SVG progress ring with oklch stroke and CSS transition"
    - "ActiveJobProgress sub-component for isolated reactive query"
    - "AlertDialog cancel confirmation with destructive action"
    - "DropdownMenu export format picker with incomplete warning"
    - "Server component wrapper + client component route pattern"
key_files:
  created:
    - "components/extraction/extraction-job-history.tsx"
    - "components/extraction/extraction-jobs-dialog.tsx"
    - "app/extraction/page.tsx"
    - "app/extraction/extraction-list-client.tsx"
  modified:
    - "components/app-sidebar.tsx"
    - "messages/en-US.json"
    - "messages/en-GB.json"
    - "messages/zh.json"
    - "messages/fr.json"
    - "messages/hi.json"
    - "messages/ja.json"
decisions:
  - "ActiveJobProgress extracted as sub-component to isolate reactive getExtractionProgress queries per active job"
  - "Cancel dismiss button uses common.cancel i18n key since no goBack key exists in project"
  - "sidebar.extraction i18n key added to all 6 locales for nav item label"
  - "Export handler casts convex.query return to ExtractionExportData per Plan 03 pattern"
metrics:
  duration: "429s"
  completed: "2026-04-15"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 7
---

# Phase 97 Plan 04: Sidebar Integration, Job History Dialog, and Extraction List Page Summary

Sidebar footer button with SVG progress ring, Extraction nav item with FlaskConical icon, ExtractionJobsDialog with full job history (status dots, progress bars, export dropdown, cancel confirmation, results links), and /extraction list page with creation dialog trigger.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create ExtractionJobHistory and ExtractionJobsDialog components | 1ed15b1 | components/extraction/extraction-job-history.tsx, components/extraction/extraction-jobs-dialog.tsx |
| 2 | Wire sidebar integration and extraction list page | ee668b8 | components/app-sidebar.tsx, app/extraction/page.tsx, app/extraction/extraction-list-client.tsx, messages/*.json |

## What Was Built

### Task 1: ExtractionJobHistory and ExtractionJobsDialog

**ExtractionJobsDialog** (`components/extraction/extraction-jobs-dialog.tsx`):
- Thin dialog wrapper cloned from ScreeningJobsDialog per D-07
- FlaskConical icon in dialog title, i18n via useTranslations("extraction")
- Wraps ExtractionJobHistory with overflow-y-auto scrollable content area

**ExtractionJobHistory** (`components/extraction/extraction-job-history.tsx`):
- Job list using `useProtectedQuery(api.extraction.queries.listUserExtractionJobs, { limit: 10 })`
- Status dots with OKLCH colors (D-08): violet pulse for processing, green for completed, red for failed
- **ActiveJobProgress** sub-component with isolated `useProtectedQuery(getExtractionProgress)` per active job
- Progress bar using Progress component + papers counter + failed counter
- Export dropdown with CSV/JSON/XLSX via extraction export module, incomplete warning banner
- Cancel flow: X button on active jobs, AlertDialog confirmation with destructive action
- Results link to `/extraction/${job._id}` for completed/cancelled/failed jobs
- Loading state: 3 skeleton cards with animate-pulse
- Empty state: FlaskConical icon with message

### Task 2: Sidebar Integration and List Page

**Sidebar modifications** (`components/app-sidebar.tsx`):
- `ExtractionFooterButton` function: exact clone of ScreeningFooterButton with FlaskConical icon, SVG progress ring with `stroke="oklch(0.70 0.17 54)"`, CSS transition on stroke-dashoffset
- `getCurrentPage` updated with `if (pathname.includes("/extraction")) return "extraction"`
- Extraction NavItem with FlaskConical icon, href="/extraction", placed after History
- Extraction job progress data fetching via listUserExtractionJobs (limit 1) + computed progress percent
- ExtractionJobsDialog rendered with isExtractionJobsOpen state
- Auth gate: footer button directs unauthenticated users to sign-in

**List page** (`app/extraction/page.tsx` + `extraction-list-client.tsx`):
- Server component with generateMetadata using extractionTitle/extractionDescription
- Client component with ExtractionJobHistory for full job list
- "New Extraction Job" button opening ExtractionDialog (no pre-selected papers)

**i18n** (all 6 locales):
- `sidebar.extraction` key added for nav item label

## Deviations from Plan

None -- plan executed exactly as written.

## Verification Results

1. `npx tsc --noEmit`: Zero errors in plan files (10 pre-existing errors in unrelated files: mutations.test.ts, mutations.ts, prompt-delimiters.test.ts)
2. ExtractionFooterButton has SVG progress ring with `stroke="oklch(0.70 0.17 54)"`
3. getCurrentPage includes extraction route detection
4. ExtractionJobsDialog rendered in sidebar with open state management
5. /extraction page exists with server component and client component
6. All 6 locale files updated with sidebar.extraction key

## Known Stubs

None -- all components are fully wired to their data sources.

## Threat Surface Compliance

- T-97-11 (Cancel flow): AlertDialog confirmation prevents accidental clicks; cancelExtractionJob mutation verifies job ownership server-side
- T-97-12 (Export data): getExtractionResultsForExport checks ownership server-side; export functions are pure client-side utilities
- T-97-13 (Sidebar progress ring): Progress ring only displays data from auth-gated getExtractionProgress query; no mutation capability

## Self-Check: PASSED
