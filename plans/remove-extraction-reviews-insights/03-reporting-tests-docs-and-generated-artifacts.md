# Plan 03 — Reporting, Tests, Docs, and Generated Artifacts

## Goal

Finish the teardown by removing remaining report-builder coupling, deleting stale tests/docs, and regenerating Convex artifacts so no trace of the subsystem remains.

## Scope

In scope:

- Move surviving neutral helpers into `lib/extraction/analysis.ts` and delete the old `insights` module.
- Remove review overrides from report snapshot/export logic.
- Delete subsystem-only test files.
- Update old plan files and comments that still describe review/insight behavior.
- Regenerate Convex generated files and verify the removed API/table types disappear.

Out of scope:

- New reporting features.
- Broader extraction refactors unrelated to this subsystem.

## Design

Execution sequence:

1. Decide what, if anything, survives from the old `lib/extraction/insights.ts` module.
   - If report snapshots still need neutral helpers, move them to a non-insights module first.
   - Delete the rest of the insights module once imports are updated.
2. Remove report-builder inputs that depend on review records or review-state overlays.
3. Delete subsystem-only tests and update shared tests.
4. Edit stale plan docs/comments so repo documentation matches reality.
5. Run `npx convex dev` or equivalent codegen and verify `_generated` output no longer contains the removed modules/table types.

## TDD sequence

1. Update shared tests:
   - `tests/extraction-insights.test.ts`
   - `tests/export-extraction-options.test.ts`
   - `tests/plan-enforcement.test.ts`
2. Delete subsystem-only test files.
3. Refactor report builder / neutral helper placement.
4. Clean plan docs and comments.
5. Regenerate Convex output and run the final targeted sweep.

## Files touched

- Reporting/helper refactor:
  - `lib/extraction/analysis.ts`
  - `lib/extraction/report-builder.ts`
  - `convex/extraction/mutations/reports.ts`
  - `lib/extraction/evidence-policy.ts`
  - `convex/extraction/workpoolActions.ts`
  - `convex/extraction/debug_job_citations.ts`
- Delete tests:
  - `tests/extraction-insights-overview.test.tsx`
  - `tests/extraction-insights-question-panel.test.tsx`
  - `tests/summary-cards.test.tsx`
  - `tests/question-list-item.test.tsx`
  - `tests/stacked-answer-bars.test.tsx`
  - `tests/confidence-badge.test.tsx`
  - `tests/confidence-messages.test.ts`
  - `tests/question-status.test.ts`
  - `tests/extraction-i18n-coverage.test.ts`
  - `tests/answer-grouping.test.ts`
  - `tests/components/grouped-answer-row.test.tsx`
  - `convex/migrations/removeExtractionReviewsInsights.ts`
- Edit tests/docs:
  - `tests/extraction-insights.test.ts`
  - `tests/export-extraction-options.test.ts`
  - `tests/plan-enforcement.test.ts`
  - `plans/extraction-results-scale/00-README.md`
  - `plans/extraction-results-scale/01-truthful-counts-and-page-query.md`
  - `plans/extraction-results-scale/02-paper-list-projection.md`
  - `plans/extraction-results-scale/03-server-filters-sort-and-page-ui.md`
  - `plans/extraction-results-scale/PROMPTS.md`
  - `plans/chat-sources-toggle/00-README.md`
  - `plans/chat-sources-toggle/PROMPTS.md`
  - `convex/extraction/aggregates.ts`
  - `lib/animation-config.ts`
- Verify generated artifacts:
  - `convex/_generated/api.d.ts`
  - `convex/_generated/dataModel.d.ts`

## Migration stance

- No dead helper aliases or comments should survive.
- If a neutral helper survives, it must live under a neutral module name and no file may keep importing it from the deleted `lib/extraction/insights.ts`.

## Test plan

- `pnpm test tests/extraction-insights.test.ts`
- `pnpm test tests/export-extraction-options.test.ts`
- `pnpm test tests/plan-enforcement.test.ts`
- Re-run any extraction page/backend suites broken by helper moves.
- Regenerate Convex code and verify:
  - no `_generated` import/entry remains for `extraction/queries/insights`,
  - no `_generated` import/entry remains for `extraction/queries/reviews`,
  - no generated data model type remains for `extractionResultReviews`.

## Acceptance criteria

- `lib/extraction/insights.ts` is gone and surviving neutral helpers live under `lib/extraction/analysis.ts`.
- Report snapshot generation no longer consumes review records or review-state overrides.
- Subsystem-only tests are deleted.
- Internal plans/comments no longer describe deleted review/insight behavior.
- Convex generated files reflect the removal cleanly.

## Known pitfalls

- `buildRunDiff` still has to survive the subsystem teardown because report diff generation uses it; relocate it before deleting the old module.
- Do not trust stale generated files; they must be refreshed after schema/API removal or the repo will still advertise deleted surfaces.
