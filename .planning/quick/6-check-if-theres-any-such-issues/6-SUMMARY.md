---
phase: quick-6
plan: 1
subsystem: validators
tags: [audit, validators, schema]
dependency_graph:
  requires: []
  provides: [validator-schema-parity-confirmed]
  affects: [convex/lib/validators.ts, convex/extraction/validators.ts]
tech_stack:
  added: []
  patterns: [schema-validator-parity-audit]
key_files:
  created: []
  modified: []
decisions:
  - All existing validators already match schema exactly; no changes needed
metrics:
  duration: 45s
  completed: "2026-03-06T10:34:35Z"
---

# Quick Task 6: Audit Schema vs Validators Summary

All 12 named document validators are in perfect sync with convex/schema.ts -- no field mismatches found.

## Audit Results

### convex/lib/validators.ts (4 validators)

| Table | Validator | Schema Fields | Validator Fields | Status |
|-------|-----------|--------------|-----------------|--------|
| users | userValidator | 10 | 10 (+2 system) | MATCH |
| credits | creditsValidator | 5 | 5 (+2 system) | MATCH |
| subscriptions | subscriptionValidator | 16 | 16 (+2 system) | MATCH |
| creditTransactions | creditTransactionValidator | 11 | 11 (+2 system) | MATCH |

### convex/extraction/validators.ts (8 validators)

| Table | Validator | Schema Fields | Validator Fields | Status |
|-------|-----------|--------------|-----------------|--------|
| extractionJobs | extractionJobValidator | 18 | 18 (+2 system) | MATCH |
| extractionQuestions | extractionQuestionValidator | 6 | 6 (+2 system) | MATCH |
| extractionPapers | extractionPaperValidator | 22 | 22 (+2 system) | MATCH |
| extractionResults | extractionResultValidator | 11 | 11 (+2 system) | MATCH |
| extractionResultReviews | extractionResultReviewValidator | 10 | 10 (+2 system) | MATCH |
| extractionSavedViews | extractionSavedViewValidator | 8 | 8 (+2 system) | MATCH |
| extractionReportSnapshots | extractionReportSnapshotValidator | 7 | 7 (+2 system) | MATCH |
| extractionRunDiffs | extractionRunDiffValidator | 9 | 9 (+2 system) | MATCH |

### Tables Without Validators (by design, not audited)

- billingCustomers, stripeEventLogs, auditLogs, apiKeys, zoteroConnections, zoteroOAuthTokens, extractionEvidenceUnits, extractionWorkflowTemplates, extractionJobStats, libraryItems, collections, libraryItemCollections

## Deviations from Plan

None -- all validators were already in sync. The only historical mismatch (libraryItemCount missing from userValidator) was already fixed in quick-5.

## Verification

- `npx convex typecheck` passes with no errors
- Field-by-field comparison confirmed all 12 validators match their schema counterparts

## Self-Check: PASSED

No files were modified, no commits were made. Audit confirmed full parity.
