# Plan 05 - Results Read Model

## Goal

Make results page/export reads use small indexed list rows instead of scanning and JS-filtering full paper documents.

## Scope

In:
- `convex/extraction/listProjection.ts`
- `convex/extraction/queries/results.ts`
- `convex/extraction/queries/jobs.ts`
- New `extractionPaperListRows` table validators/schema
- Export flow if needed to avoid live full-corpus subscriptions
- Results page tests

Out:
- Frontend redesign. Keep UI behavior stable.

## Design

Move denormalized fields currently on `extractionPapers` into `extractionPaperListRows`:

- `jobId`
- `paperId`
- `processable`
- `status`
- `title`
- `sortTitle`
- `publicationYear`
- `doi`
- `isOpenAccess`
- `avgConfidence`
- `hasErrors`
- `hasPdfSource`
- `pdfContentUsed`
- `questionAnswerTokens`
- `searchText`
- `completedAt`
- `updatedAt`

Indexes/search:

- `by_job_and_processable`
- `by_job_and_processable_and_sortTitle`
- `by_job_and_processable_and_avgConfidence`
- `by_job_and_processable_and_status`
- search index on `searchText` with `jobId` and `processable`.

`getJobResultsPage` reads list rows, applies only filters that cannot be indexed after bounded indexed/search retrieval, slices, then loads payloads for page paper IDs only.

Export should be point-in-time or action-driven, not a large live subscription.

## TDD Sequence

R1. Projection rebuild writes one list row per processable paper with the expected fields.

R2. Results page returns the same public item shape while reading payloads only for page paper IDs.

R3. Search uses the list-row search index.

R4. Sort by title/confidence uses list-row indexes or bounded list-row reads.

R5. Export does not use the live page query as an unbounded subscription.

R6. Job details no longer return full papers unless the route needs them.

## Files Touched

- `convex/extraction/validators.ts`
- `convex/schema.ts`
- `convex/extraction/listProjection.ts`
- `convex/extraction/queries/results.ts`
- `convex/extraction/queries/jobs.ts`
- `convex/extraction/queries/resultsPage.test.ts`
- `convex/extraction/rebuild-job-list-projection.test.ts`
- Frontend export caller only if required

## Migration Stance

Destructive. List rows are rebuilt from current paper/task/payload state by an admin helper in dev. No old paper projection fallback.

## Test Plan

- `npx vitest run convex/extraction/queries/resultsPage.test.ts`
- `npx vitest run convex/extraction/rebuild-job-list-projection.test.ts`
- `npx vitest run convex/extraction/queries-e2e.test.ts`
- `npx tsc --noEmit`

## Deployability Gate

Backend:

```
npx pm2 logs convex --lines 5 --nostream
```

Frontend if touched:

```
npx pm2 logs next --lines 5 --nostream
```

Next must show recent `✓ Compiled` and no `Module not found`, `Type error`, or `Failed to compile`.

## Acceptance Criteria

- Results page no longer scans `extractionPapers.by_job_processable` for the full job before slicing.
- Export is not a large live subscription.
- Public result item shape remains covered by tests.
- No explicit `any`.

## Known Pitfalls

- Convex `.filter()` does not push predicates to storage.
- Search index fields must live on the table being searched.
- Do not store unbounded answer arrays on list rows.
