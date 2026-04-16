---
phase: 100-backend-wiring-tierselector-fix
plan: 02
subsystem: extraction
tags: [error-routing, i18n, toast-resolver, extraction-limit, dialog-migration]
dependency_graph:
  requires: [tier-field-schema, tier-aware-cascade]
  provides: [extraction-limit-error-code, toast-resolver-mapping, dialog-error-migration]
  affects: [convex/lib/errors.ts, lib/toast/error-resolver.ts, components/extraction/extraction-dialog.tsx, convex/extraction/mutations.ts, messages/en-US.json, messages/en-GB.json, messages/fr.json, messages/ja.json, messages/zh.json, messages/hi.json]
tech_stack:
  added: []
  patterns: [resolveToastError-based-error-routing, tToast-separate-namespace-hook]
key_files:
  created: []
  modified: [convex/lib/errors.ts, lib/toast/error-resolver.ts, convex/extraction/mutations.ts, components/extraction/extraction-dialog.tsx, messages/en-US.json, messages/en-GB.json, messages/fr.json, messages/ja.json, messages/zh.json, messages/hi.json]
decisions:
  - "Added tToast = useTranslations('toast') in ExtractionDialog for correct namespace scoping (t is scoped to 'extraction')"
  - "Removed unused getErrorMessage import after catch block migration"
metrics:
  duration: 214s
  completed: "2026-04-16T08:56:19Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 10
---

# Phase 100 Plan 02: Wire Error System and Migrate ExtractionDialog Summary

EXTRACTION_LIMIT_EXCEEDED error code wired end-to-end from ErrorCode union through toast resolver mapping to 6-locale i18n keys, with ExtractionDialog catch block migrated from inline string-matching to standard resolveToastError pattern.

## Changes Made

### Task 1: Extend error code, toast resolver, and i18n keys

**Commit:** 1860ab1

1. **convex/lib/errors.ts** -- Added `| "EXTRACTION_LIMIT_EXCEEDED"` to the ErrorCode union after the existing extraction error codes
2. **lib/toast/error-resolver.ts** -- Added `"extractionLimitExceeded"` and `"extractionJobAlreadyActive"` to ToastErrorMessageKey union; added `EXTRACTION_LIMIT_EXCEEDED: "extractionLimitExceeded"` and `EXTRACTION_JOB_ALREADY_ACTIVE: "extractionJobAlreadyActive"` to MESSAGE_KEY_BY_CODE mapping
3. **messages/{en-US,en-GB,fr,ja,zh,hi}.json** -- Added `extractionLimitExceeded` (with {limit} and {excess} ICU placeholders) and `extractionJobAlreadyActive` toast keys in all 6 locales

### Task 2: Migrate ExtractionDialog error handling and wire tier + hard-reject

**Commit:** d6c1c01

1. **convex/extraction/mutations.ts** -- Changed `VALIDATION_ERROR` to `EXTRACTION_LIMIT_EXCEEDED` in the paper count over-limit throw; enriched error message to include submitted count (`You submitted ${args.papers.length}`)
2. **components/extraction/extraction-dialog.tsx** -- Passed `tier` to `createJob` call; replaced 15-line inline string-matching catch block with 3-line `resolveToastError` + `getToastMessageKeyForErrorCode` pattern; added `tToast` hook for toast namespace; removed unused `getErrorMessage` import

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed i18n namespace scoping for toast keys**
- **Found during:** Task 2 (code review after implementing catch block)
- **Issue:** Plan specified `t(\`toast.\${messageKey}\`)` but `t` is scoped to `useTranslations("extraction")`, which would resolve to `extraction.toast.extractionLimitExceeded` -- a nonexistent key. The established pattern in `use-app-toast.ts` uses a separate `useTranslations("toast")` hook.
- **Fix:** Added `const tToast = useTranslations("toast")` and used `tToast(messageKey)` instead of `t(\`toast.\${messageKey}\`)`
- **Files modified:** components/extraction/extraction-dialog.tsx
- **Commit:** d6c1c01

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Separate tToast hook for toast namespace | Matches established pattern in use-app-toast.ts; t is scoped to "extraction" and cannot reach root "toast" keys |
| Remove getErrorMessage import | No longer referenced after catch block migration; avoids unused import lint warning |

## Known Stubs

None -- all wiring is complete and functional. The i18n keys include {limit} and {excess} ICU placeholders for future Phase 102 integration when error data fields are parsed by the resolver.

## Self-Check: PASSED
