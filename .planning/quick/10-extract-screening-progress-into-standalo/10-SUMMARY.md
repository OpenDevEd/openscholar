---
phase: quick-10
plan: 01
subsystem: screening
tags: [ui, dialog, sidebar, i18n]
key-files:
  created:
    - components/screening/screening-jobs-dialog.tsx
  modified:
    - components/screening/screening-dialog.tsx
    - components/app-sidebar.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json
decisions:
  - "Button-based sidebar nav item instead of NavItem Link since Screening opens a dialog, not a route"
  - "Close config dialog on successful submit rather than switching to progress mode"
metrics:
  duration: "4m 11s"
  completed: "2026-03-09"
  tasks_completed: 2
  tasks_total: 2
---

# Quick Task 10: Extract Screening Progress into Standalone Dialog

Standalone ScreeningJobsDialog accessible from sidebar, decoupled from config dialog which now closes on submit.

## Completed Tasks

| # | Task | Commit | Key Changes |
|---|------|--------|-------------|
| 1 | Create ScreeningJobsDialog and add sidebar entry | 4f005ee | New dialog component with progress+history, button-based sidebar nav with tooltip, i18n across 6 locales |
| 2 | Remove progress mode from screening config dialog | 12d954f | Removed activeJobId/isProgressMode/handleNewScreening, dialog closes on submit, removed unused imports |

## Key Changes

### ScreeningJobsDialog (NEW)
- Dialog with `selectedJobId` state for viewing individual job progress
- Shows `ScreeningProgress` when a job is selected, always shows `ScreeningJobHistory`
- Resets selection when dialog closes
- Uses ScrollArea for content, DialogFooter with Close button

### Sidebar Entry
- Button-based nav item between Library and History (not a Link since it opens a dialog)
- Matches NavItem styling: flex items-center gap-3 px-3 py-2.5 rounded-lg
- Framer Motion animations matching existing sidebar patterns
- Tooltip with label when sidebar is collapsed
- ListChecks icon

### Config Dialog Simplification
- Removed: `activeJobId` state, `isProgressMode`, `handleNewScreening`, ScreeningProgress/ScreeningJobHistory imports
- On submit success: closes dialog (`onOpenChange(false)`) + shows toast
- Dialog is now configure-only

### i18n
- `common.screening`: added across all 6 locales
- `screeningDialog.jobsDialogTitle`: added across all 6 locales

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- TypeScript compiles clean (`npx tsc --noEmit` passes)
- search-command-footer.tsx verified to need no changes (uses boolean open state, unaffected)
