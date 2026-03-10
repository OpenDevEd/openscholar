---
phase: quick-13
plan: 01
subsystem: extraction
tags: [feature-flags, ui, extraction]
dependency_graph:
  requires: []
  provides: [review-queue-disabled, report-builder-disabled]
  affects: [app/extraction/[jobId]/page.tsx]
tech_stack:
  added: []
  patterns: [feature-flag-hardcode]
key_files:
  modified:
    - lib/extraction/feature-flags.ts
decisions:
  - Hardcode flags to false rather than deleting code, enabling trivial one-line re-enable per flag
metrics:
  duration: "< 5 minutes"
  completed: "2026-03-10"
  tasks_completed: 1
  files_modified: 1
---

# Quick Task 13: Disable Review Queue and Report Builder Summary

**One-liner:** Hardcoded `reviewQueue` and `reportBuilder` feature flags to `false` in `lib/extraction/feature-flags.ts`, hiding both broken tabs from the extraction page for all users.

## What Was Done

Set `reviewQueue: false` and `reportBuilder: false` in `lib/extraction/feature-flags.ts`. Both flags were previously env-driven (`!== "false"` pattern), defaulting to enabled. The `enabled`, `pdf`, and `insights` flags remain env-driven and unaffected.

The extraction job detail page at `app/extraction/[jobId]/page.tsx` already gates both tab buttons and their rendered content behind these flags — no page changes were needed.

## Tasks

| # | Name | Commit | Status |
|---|------|--------|--------|
| 1 | Set reviewQueue and reportBuilder feature flags to false | 6588d1b | Done |

## Verification

- `grep -n "reviewQueue\|reportBuilder" lib/extraction/feature-flags.ts` confirms both set to `false`
- `npx tsc --noEmit` exits 0 with no errors
- Review Queue and Report Builder tabs will not appear on any `/extraction/[jobId]` page

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `lib/extraction/feature-flags.ts` modified with both flags set to `false`
- [x] Commit 6588d1b exists
- [x] TypeScript compilation passes

## Self-Check: PASSED
