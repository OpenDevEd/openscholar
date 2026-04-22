# Remove Extraction Reviews + Insights — Execution Prompts

Standing rules for every plan:

- Read `convex/_generated/ai/guidelines.md` before touching Convex code.
- No legacy compatibility paths in the final state.
- Respect Convex live-data sequencing: stop reads/writes first, then migrate/delete data, then narrow schema.
- Start with tests for the slice you are changing.

---

## Plan 01 — Convex Data + API Removal

```text
Execute `plans/remove-extraction-reviews-insights/01-convex-data-and-api-removal.md`.

Order:
1. Update the backend tests to remove the deleted public review/insight API expectations.
2. Remove review overlay shaping from shared extraction queries and results-page logic.
3. Remove `setResultReviewState`, `getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, and `getReviewQueue`.
4. Add and run the migration that deletes `extractionResultReviews`, unsets `reviewedCount` / `needsFollowupCount`, sanitizes saved views, and deletes the feature-flag rows.
5. Narrow schema/validators only after the data is gone.

Do not leave any query, mutation, validator, or projection field that still depends on manual review state.
```

## Plan 02 — Frontend, I18n, and Surface Removal

```text
Execute `plans/remove-extraction-reviews-insights/02-frontend-i18n-and-surface-removal.md`.

Order:
1. Update page tests first.
2. Delete the dedicated insights/review components and helper modules.
3. Remove the insights/review tabs and state from `app/extraction/[jobId]/page.tsx`.
4. Strip review badges and review-only status filters from the surviving results views.
5. Remove the locale keys used only by the deleted subsystem.

Do not keep hidden tabs, dormant feature flags, or placeholder copy for reviews/insights.
```

## Plan 03 — Reporting, Tests, Docs, and Generated Artifacts

```text
Execute `plans/remove-extraction-reviews-insights/03-reporting-tests-docs-and-generated-artifacts.md`.

Order:
1. Update the shared tests that still exercise report/insight helpers.
2. Move any neutral helpers into `lib/extraction/analysis.ts` if reports still need them.
3. Delete subsystem-only tests.
4. Clean stale plan docs/comments.
5. Regenerate Convex generated files and verify the deleted API/table types are gone.

Non-negotiable: the repo should not contain stale generated entries, stale plan references, or a helper module named `insights` that still exists only because cleanup stopped halfway.
```
