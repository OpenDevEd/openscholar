# Plan 01 — Convex Data + API Removal

## Goal

Remove the backend review/insight API surface and the stored review data model so extraction results are no longer review-aware.

## Scope

In scope:

- Delete public queries `getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, `getReviewQueue`.
- Delete public mutation `setResultReviewState`.
- Remove review overlay shaping from shared extraction query helpers.
- Remove review-only projection fields from `extractionPapers`.
- Remove `extractionResultReviews` and its indexes from the schema.
- Add and run the data migration required before schema narrowing.
- Remove feature-flag rows and saved-view states that only exist for the deleted semantics.

Out of scope:

- UI/page cleanup beyond the minimum needed to unblock backend deletions.
- Report snapshot / run diff refactors beyond what is necessary to keep backend builds green.

## Design

Execution sequence:

1. Delete API exports and internal readers/writers so the app stops depending on review data.
2. Remove review-derived projection logic from `convex/extraction/listProjection.ts` and result-page query contracts.
3. Add migration logic to:
   - delete all `extractionResultReviews`,
   - unset `reviewedCount` and `needsFollowupCount` on `extractionPapers`,
   - sanitize `extractionSavedViews.filters.statusFilters` values `reviewed` and `needs-followup`,
   - delete `featureFlags` rows for `extraction.insights` and `extraction.reviewQueue`.
4. Narrow `convex/schema.ts` and validators only after the data is gone.
5. Regenerate Convex generated artifacts once schema/API cleanup lands.

Files touched:

- `convex/schema.ts`
- `convex/extraction/queries.ts`
- `convex/extraction/queries/_shared.ts`
- `convex/extraction/queries/results.ts`
- `convex/extraction/queries/insights.ts`
- `convex/extraction/queries/reviews.ts`
- `convex/extraction/mutations/results.ts`
- `convex/extraction/mutations.ts`
- `convex/extraction/mutations/internal/admin.ts`
- `convex/extraction/mutations/reports.ts`
- `convex/extraction/listProjection.ts`
- `convex/extraction/validators.ts`
- `convex/featureFlags/internal.ts`
- `lib/feature-flags/registry.ts`
- `convex/migrations/*` new migration file(s)

## TDD sequence

1. Update `convex/extraction/public-api-routing.test.ts` to remove deleted endpoints from the expected public surface.
2. Update `convex/extraction/queries-e2e.test.ts` to remove insight/review endpoint coverage and related flag seeding.
3. Update `convex/extraction/listProjection.test.ts` and `convex/extraction/queries/resultsPage.test.ts` to fail if review fields or review-only filters are still required.
4. Implement code removal in shared queries, projection logic, schema, and migrations.
5. Run generated-code refresh and re-run the targeted backend tests.

## Files touched

- Backend behavior:
  - `convex/extraction/queries.ts`
  - `convex/extraction/queries/_shared.ts`
  - `convex/extraction/queries/results.ts`
  - `convex/extraction/mutations/results.ts`
  - `convex/extraction/mutations.ts`
  - `convex/extraction/mutations/internal/admin.ts`
  - `convex/extraction/listProjection.ts`
  - `convex/extraction/validators.ts`
- Deletions:
  - `convex/extraction/queries/insights.ts`
  - `convex/extraction/queries/reviews.ts`
- Schema/data:
  - `convex/schema.ts`
  - `convex/migrations/*`
  - `convex/featureFlags/internal.ts`
  - `lib/feature-flags/registry.ts`

## Migration stance

- No long-lived compatibility path.
- Use a bounded migration window only to satisfy Convex schema validation.
- Do not narrow the schema while live data still contains `extractionResultReviews`, `reviewedCount`, or `needsFollowupCount`.

## Test plan

- `pnpm test convex/extraction/public-api-routing.test.ts`
- `pnpm test convex/extraction/queries-e2e.test.ts`
- `pnpm test convex/extraction/listProjection.test.ts`
- `pnpm test convex/extraction/queries/resultsPage.test.ts`
- Run the new migration in a dev deployment and verify:
  - `extractionResultReviews` is empty,
  - `extractionPapers` docs no longer carry review counters,
  - saved views no longer contain deleted status filters.

## Acceptance criteria

- No Convex public API entry remains for reviews/insights.
- No backend query attaches `reviewState`, `correctedAnswer`, `reviewedAt`, or `reviewedBy` to extraction results.
- `getJobResultsPage` no longer requires `reviewedCount` or `needsFollowupCount`.
- The schema no longer declares `extractionResultReviews`.
- Feature-flag defaults and persisted rows for `extraction.insights` / `extraction.reviewQueue` are gone.

## Known pitfalls

- `lib/extraction/report-builder.ts` and `convex/extraction/mutations/reports.ts` still depend on helpers in `lib/extraction/analysis.ts`; keep that neutral module while deleting subsystem-only code.
- Saved views can preserve removed filter values and break the results page unless sanitized.
- PM2 logs already show projection readiness errors that mention the review counters; plan 01 must remove those checks, not just stop writing the data.
