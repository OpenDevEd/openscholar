# Plan 04 — Schema Teardown And Verification

**Depends on:** 01, 02, 03. **Blocks:** none.

## Goal

Delete the obsolete workflow-era schema and APIs from screening, align tests and queries with the new execution model, and verify the refactor against runtime contention signals.

## Scope

**In scope**

- Remove job counter fields from `screeningJobs`.
- Remove obsolete internal screening mutations and queries that only existed for workflow-era orchestration.
- Remove dead imports, comments, and docs that still describe workflow/pending/counter behavior.
- Update tests and helper seeders to the new schema.
- Verify the new design against local tests and current Convex runtime signals.

**Out of scope**

- new product features
- unrelated screening UX redesign

## Design

### 1. Delete obsolete schema fields

Remove from `screeningJobs`:

- `processedPapers`
- `failedPapers`
- `qualifiedPapers`
- `workflowId`

Any query or test still reading them after plans 02 and 03 is wrong and should be updated, not accommodated.

### 2. Delete obsolete workflow-era APIs

Candidates expected to go away by the end of this plan:

- `updateJobStatus`
- `enqueueScreeningPaper`
- `finalizeScreeningJobIfDone`
- `setJobWorkflowId`
- `getPendingResults`
- screening workflow module itself if fully dead

Delete dead code rather than leaving “unused for now” helpers behind.

### 3. Make test seeders match the new model

Current screening tests seed jobs with now-obsolete counter fields. Update seeders and expectations so tests describe the real architecture:

- stable job header
- row-local result truth
- aggregate-backed progress
- scheduled follow-up finalization

### 4. Verify against runtime behavior, not just unit tests

After implementation:

- run screening tests
- check `pm2` logs if useful
- run `npx convex insights --details`

The verification target is not perfect zero contention everywhere; it is removal of the known screening hot-document and workflow-orchestration contention patterns.

## TDD sequence

### Phase A — pure logic only if needed

If a small cleanup helper emerges, test it first. Otherwise skip Phase A and keep this plan test-after.

### Phase B — destructive cleanup and verification

1. Remove dead schema fields.
2. Remove dead APIs and dead files.
3. Update tests and seeders.
4. Regenerate or update any affected generated artifacts if required by the repo workflow.
5. Run verification.

## Files touched

- `convex/schema.ts`
- `convex/screening/mutations.ts`
- `convex/screening/queries.ts`
- `convex/screening/workflow.ts` if not already deleted
- `convex/screening/*.test.ts`
- any generated or referenced artifacts required by the repo

## Migration stance

Fully destructive.

- no old fields
- no old status variants
- no old workflow references
- no compatibility reads

If a dev deployment has incompatible screening rows, wipe them.

## Test plan

### Test-after

- full screening test suite
- any aggregate helper tests introduced in plan 02
- cancellation tests after `workId`-based behavior
- completion/finalization tests after deferred side effects
- manual runtime verification via Convex insights and logs

## Acceptance criteria

1. `screeningJobs` no longer stores workflow ids or live counters.
2. No screening code path references the removed workflow orchestration layer.
3. No screening code path references removed counter fields.
4. Screening tests are green after destructive cleanup.
5. Post-refactor runtime signals no longer show screening-side hot-doc contention on `screeningJobs` caused by per-paper completion writes.

## Known pitfalls

- Do not forget helper seeders in tests; they are the most likely place for dead field references.
- Do not stop after schema cleanup if comments/docs still describe the old model.
- Verify that public query return types still match what the frontend consumes after field deletion.
- The aggregate-backed model may still show some workpool component contention under high concurrency; this plan only succeeds if the screening app tables are no longer architected as hot shared-write sinks.
