---
phase: 38-deletion-cascade-storage-cleanup
verified: 2026-03-02T00:00:00Z
status: passed
score: 6/6 must-haves verified
re_verification: false
---

# Phase 38: Deletion Cascade and Storage Cleanup Verification Report

**Phase Goal:** Fix deletion cascade gaps and add storage cleanup for extraction jobs
**Verified:** 2026-03-02
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Deleting an extraction job removes all extractionEvidenceUnits rows for every paper in the job — zero orphaned rows remain after deletion | VERIFIED | Step 1 of deleteExtractionInternal (line 974–989) queries extractionEvidenceUnits by_paper index, deletes up to BATCH_SIZE, then schedules self to continue |
| 2 | deleteExtractionInternal uses ctx.scheduler.runAfter(0, ...) instead of ctx.runMutation for all self-scheduling calls | VERIFIED | 8 calls to ctx.scheduler.runAfter within lines 968–1088; grep of same range for ctx.runMutation returns 0 results |
| 3 | Deletion order is: evidence units -> reviews -> results -> papers (with inline storage cleanup) -> questions -> saved views -> report snapshots -> run diffs -> job | VERIFIED | Steps 1–9 comments at lines 974, 991, 1004, 1017, 1037, 1048, 1059, 1070, 1082 match exactly this sequence |
| 4 | Papers with a storageId have ctx.storage.delete(paper.storageId) called during the papers step — storage errors are caught and logged but do not block DB cleanup | VERIFIED | Lines 1024–1029: if (paper.storageId) with try/catch; catch logs console.error and does not rethrow; ctx.db.delete(paper._id) is called unconditionally at line 1031 |
| 5 | deleteExtraction (public mutation) uses ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId }) instead of ctx.runMutation | VERIFIED | Lines 960–962: ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId: args.jobId }) |
| 6 | cleanupFailedPaperStorage internal mutation exists and deletes storage files for any paper in the job that has a storageId, then patches storageId to undefined | VERIFIED | Lines 1090–1114: internalMutation with args { jobId }, queries by_job with filter neq(storageId, undefined), calls ctx.storage.delete then ctx.db.patch({ storageId: undefined }) per paper with try/catch error isolation |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/extraction/mutations.ts` | Rewritten deleteExtraction, deleteExtractionInternal, and new cleanupFailedPaperStorage | VERIFIED | File exists at 2002 lines; all three functions present and substantive; contains ctx.scheduler.runAfter |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| deleteExtraction | deleteExtractionInternal | ctx.scheduler.runAfter(0, internal.extraction.mutations.deleteExtractionInternal, { jobId }) | WIRED | Line 960–962 contains exact call; scheduler pattern verified |
| deleteExtractionInternal | extractionEvidenceUnits | ctx.db.query('extractionEvidenceUnits').withIndex('by_paper', ...) | WIRED | Lines 980–988: query with by_paper index, deletion loop, and scheduler self-schedule |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DATA-01 | 38-01-PLAN.md | Deletion cascade includes extractionEvidenceUnits cleanup | SATISFIED | Step 1 of deleteExtractionInternal deletes extractionEvidenceUnits via by_paper index before papers are deleted |
| DATA-02 | 38-01-PLAN.md | Recursive runMutation replaced with scheduler.runAfter(0) batched deletion | SATISFIED | Zero ctx.runMutation calls in delete block (lines 949–1114); 8 scheduler.runAfter calls in deleteExtractionInternal; 1 in deleteExtraction |
| DATA-03 | 38-01-PLAN.md | Orphaned PDF storage cleanup covers failed papers and deleted jobs | SATISFIED | Inline ctx.storage.delete in Step 4 (cascade path); cleanupFailedPaperStorage internalMutation (standalone path) with storageId patch to undefined and per-paper error isolation |

No orphaned requirements: REQUIREMENTS.md confirms DATA-01, DATA-02, DATA-03 all map to Phase 38, all three are claimed by plan 38-01, and all three are implemented.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `convex/extraction/mutations.ts` | 1694, 1704, 1713, 1740, 1749, 1759, 1769, 1778, 1826, 1951 | ctx.runMutation calls | Info | These are in other mutations (finalizeJobIfDone, etc.) — NOT in the deletion code path. The plan scope was deletion only; these are pre-existing and out of scope. |

No blockers or warnings. The ctx.runMutation usages outside the deletion block are unrelated to this phase and do not affect goal achievement.

### Human Verification Required

None. All goal truths are verifiable programmatically. The deletion logic is pure database and scheduler operations with no visual or real-time behavior to assess.

### Commits Verified

| Commit | Message | Status |
|--------|---------|--------|
| 7ad499f | feat(38-01): rewrite extraction deletion with full cascade and scheduler pattern | VERIFIED — exists in git log |
| 476fd86 | feat(38-01): add cleanupFailedPaperStorage internal mutation | VERIFIED — exists in git log |

### Gaps Summary

No gaps. All 6 must-have truths are fully verified against the actual codebase:

- The deletion cascade now covers all 8 child entity types (extractionEvidenceUnits, extractionResultReviews, extractionResults, extractionPapers, extractionQuestions, extractionSavedViews, extractionReportSnapshots, extractionRunDiffs) in strict dependency order before deleting the job root (Step 9).
- Every self-scheduling call uses ctx.scheduler.runAfter(0, ...) — zero ctx.runMutation calls remain in the deletion code path.
- Storage cleanup is integrated inline during Step 4 (paper deletion) with per-paper try/catch error isolation.
- The standalone cleanupFailedPaperStorage mutation is fully implemented, job-scoped, patches storageId to undefined after successful deletion, and isolates errors per paper.
- TypeScript compilation passes with no errors in convex/extraction/mutations.ts.

---

_Verified: 2026-03-02_
_Verifier: Claude (gsd-verifier)_
