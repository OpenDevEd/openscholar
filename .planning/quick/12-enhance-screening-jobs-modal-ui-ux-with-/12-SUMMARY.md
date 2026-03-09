---
phase: quick-12
plan: 01
subsystem: screening
tags: [ui, ux, screening, icons, collections]
dependency_graph:
  requires: [screening-queries, screening-job-history, screening-jobs-dialog]
  provides: [enhanced-job-history-ui]
  affects: [screening-jobs-dialog, translation-files]
tech_stack:
  added: []
  patterns: [lucide-icons, collection-link-navigation]
key_files:
  created: []
  modified:
    - convex/screening/queries.ts
    - components/screening/screening-job-history.tsx
    - components/screening/screening-jobs-dialog.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/ja.json
    - messages/zh.json
    - messages/hi.json
decisions:
  - Truncate questions display to 2 with +N more for readability
  - Use stopPropagation on collection link to avoid triggering job selection
metrics:
  duration: 2m 27s
  completed: 2026-03-09
---

# Quick Task 12: Enhance Screening Jobs Modal UI/UX Summary

Enhanced screening job history with richer data (questions, collection names, status icons) and collection navigation links.

## What Was Done

### Task 1: Extend listUserScreeningJobs query (ba3cb66)
- Added `questions` array, `targetCollectionId`, and `targetCollectionName` to the return shape
- Collection names resolved via `ctx.db.get()` in parallel using `Promise.all`
- Handles deleted collections gracefully (returns undefined name)

### Task 2: Redesign job history UI (262cc1f)
- Added Lucide status icons with color coding (green for completed, orange spinner for processing, red for failed)
- Each entry shows papers count, qualified count, screening questions (first 2 with +N more), and target collection
- Collection entries include an ExternalLink icon that navigates to `/library?col=<id>`
- Removed Card wrapper (dialog provides container), using `bg-muted/30 border-border/50 rounded-lg` entries
- Added `DialogDescription` to screening jobs dialog
- Updated all 6 translation files (en-US, en-GB, fr, ja, zh, hi)

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | ba3cb66 | feat(quick-12): extend listUserScreeningJobs to return questions and collection info |
| 2 | 262cc1f | feat(quick-12): redesign job history with icons, questions, and collection links |

## Verification

- Convex typecheck: PASSED
- Next.js build: PASSED
