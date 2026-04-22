# Remove Extraction Reviews + Insights — Plan Set

Three-plan teardown of the extraction reviews/insights subsystem so the final state has:

1. no review queue UI,
2. no insights UI,
3. no review overlay fields in extraction results,
4. no review-only projection fields or review table in Convex,
5. no dead feature flags, tests, locale keys, or plan references.

---

## Motivation / gap audit

Grounded state as of 2026-04-22:

1. `app/extraction/[jobId]/page.tsx` still mounts two dedicated surfaces behind feature flags: `InsightsOverview` / `InsightsQuestionPanel` and `ReviewQueue`.
2. `convex/extraction/queries/insights.ts`, `convex/extraction/queries/reviews.ts`, and `convex/extraction/mutations/results.ts` expose a real public API for the subsystem: `getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, `getReviewQueue`, and `setResultReviewState`.
3. Manual review state is persisted in `extractionResultReviews`, and the result surface still injects review overlay fields (`reviewState`, `correctedAnswer`, `reviewedAt`, `reviewedBy`) into shared data contracts.
4. The paper list projection still carries review-only counters (`reviewedCount`, `needsFollowupCount`), and PM2 logs show `getJobResultsPage` still expects them.
5. The subsystem is not isolated. It leaks into exports, result cards/table badges, report snapshot generation, feature flags, tests, locale files, and old plan docs.

## Locked design decisions

| # | Decision | Why |
|---|---|---|
| D1 | 2026-04-22: remove the subsystem completely, not hide it behind flags. | User explicitly wants no legacy and no dead code. |
| D2 | Use a destructive end state, but respect Convex live-data sequencing during execution. | Final state should be clean; transient migration steps are still required because schema must match stored data. |
| D3 | Delete review/insight API surfaces before narrowing schema. | Prevents new writes/reads against soon-to-be-removed data. |
| D4 | Remove review-derived filtering/export behavior instead of preserving compatibility shims. | No legacy semantics should remain after cleanup. |
| D5 | Treat report-builder coupling as a refactor boundary. | `lib/extraction/analysis.ts` contains the neutral helpers used by report snapshot / run diff code after the subsystem teardown. |
| D6 | Clean plans/tests/messages in the same effort. | A “complete removal” is not done if internal docs and fixtures still describe deleted behavior. |

## Plan-file inventory

```text
plans/remove-extraction-reviews-insights/
├── 00-README.md
├── 01-convex-data-and-api-removal.md
├── 02-frontend-i18n-and-surface-removal.md
├── 03-reporting-tests-docs-and-generated-artifacts.md
└── PROMPTS.md
```

## Dependency graph

```text
01 convex/data/api removal ─► 02 frontend/i18n/surface removal ─► 03 reports/tests/docs/generated artifacts
            └──────────────────────────────────────────────────────────────────────────────────────────────►
```

Recommended ship order: `01 -> 02 -> 03`.

## Reuse / DRY notes

Reuse existing project primitives instead of introducing one-off cleanup logic:

- `convex/migrations/` should own data deletion/unset work.
- `convex/extraction/mutations/internal/admin.ts` already owns job cleanup/rebuild patterns and should be updated, not bypassed.
- `lib/extraction/report-builder.ts` already centralizes report snapshot shaping; only its review/insight coupling should be removed or extracted.
- Existing extraction page and results-view tests remain the canonical verification surface after removing tabs/badges.
- Existing plan folders under `plans/extraction-results-scale/` and `plans/chat-sources-toggle/` should be edited in place to remove stale references rather than duplicated.

## Testing doctrine

- Start with tests for each slice before or alongside the first implementation step.
- Assert on observable behavior only: removed tabs, removed API routes, removed status filters, removed export fields, updated generated API surface.
- Do not write class-string assertions.
- Run the relevant Convex/unit/page test subsets for each plan, then a final targeted sweep after codegen.

## Migration stance

- Final state is destructive: no legacy flags, no fallback readers, no deprecated review fields.
- Execution still requires a two-step Convex-safe teardown:
  1. Remove readers/writers and data dependencies from code.
  2. Delete `extractionResultReviews`, unset `reviewedCount` / `needsFollowupCount`, sanitize saved views and feature-flag rows, then narrow schema.
- Do not leave compatibility branches after migration completes.

## Delegation policy

- Subagents were used for bounded exploration only:
  - backend/schema/migration sweep,
  - frontend/page/i18n sweep,
  - tests/plans/generated-artifact sweep.
- Execution prompts below assume one agent owns one numbered plan at a time.
- Do not split ownership of the same file across agents in the same wave.

## Grounding sources

- Source:
  - `convex/_generated/ai/guidelines.md`
  - `convex/schema.ts`
  - `convex/extraction/queries.ts`
  - `convex/extraction/queries/_shared.ts`
  - `convex/extraction/queries/insights.ts`
  - `convex/extraction/queries/reviews.ts`
  - `convex/extraction/queries/results.ts`
  - `convex/extraction/mutations/results.ts`
  - `convex/extraction/mutations/reports.ts`
  - `convex/extraction/mutations/internal/admin.ts`
  - `convex/extraction/listProjection.ts`
  - `app/extraction/[jobId]/page.tsx`
  - `components/extraction/results-views/*`
  - `components/extraction/insights-overview.tsx`
  - `components/extraction/insights-question-panel.tsx`
  - `components/extraction/review-queue.tsx`
  - `lib/extraction/analysis.ts`
  - `lib/extraction/report-builder.ts`
  - `lib/extraction/export.ts`
  - `lib/feature-flags/registry.ts`
  - `messages/*.json`
  - `plans/extraction-results-scale/*`
  - `plans/chat-sources-toggle/*`
- Runtime confirmation:
  - PM2 `next` logs show `getJobResultsPage` still expects `reviewedCount` and `needsFollowupCount`.
- Docs:
  - `node_modules/next/dist/docs/index.md`
  - [Convex production safe changes](https://docs.convex.dev/production)
  - [Convex schema validation](https://docs.convex.dev/database/schemas)
  - [Convex data dashboard table deletion](https://docs.convex.dev/dashboard/deployments/data)
  - [Intro to Migrations](https://stack.convex.dev/intro-to-migrations)
