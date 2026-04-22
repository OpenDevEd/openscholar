# Plan 02 — Frontend, I18n, and Surface Removal

## Goal

Remove every user-facing review/insight surface from extraction and leave the page with only the surviving results/chat/reporting flows.

## Scope

In scope:

- Remove insights/review tabs and state from the extraction job page.
- Delete subsystem-only components and helper modules.
- Remove review badges and review-related result filters from surviving results views.
- Remove locale keys used only by the deleted surfaces.

Out of scope:

- Backend schema/data migration details from plan 01.
- Report-builder internals beyond what is needed to remove frontend imports/types.

## Design

Execution sequence:

1. Delete the dedicated surface components:
   - `components/extraction/insights-overview.tsx`
   - `components/extraction/insights-question-panel.tsx`
   - `components/extraction/disagreement-list.tsx`
   - `components/extraction/review-queue.tsx`
   - dependent visual helpers used only by those surfaces
2. Simplify `app/extraction/[jobId]/page.tsx`:
   - remove insights/review feature flags,
   - remove `insights` / `review` tab state,
   - remove selected-insight-question state,
   - remove tab buttons and panels.
3. Strip review semantics from results surfaces:
   - no per-paper reviewed counts,
   - no per-result review chips,
   - no `reviewed` / `needs-followup` options in status filters.
4. Remove review/insight-only locale strings from every message bundle.

## TDD sequence

1. Update `app/extraction/[jobId]/__tests__/page.test.tsx` to remove the deleted component mocks and tab assertions.
2. Delete subsystem-only component tests.
3. Update results-view tests and export-related tests to fail if review badges/filters/fields remain.
4. Implement the page/component/i18n cleanup.
5. Re-run the affected UI/unit tests.

## Files touched

- Page wiring:
  - `app/extraction/[jobId]/page.tsx`
  - `app/extraction/[jobId]/__tests__/page.test.tsx`
- Delete:
  - `components/extraction/insights-overview.tsx`
  - `components/extraction/summary-cards.tsx`
  - `components/extraction/question-list-item.tsx`
  - `components/extraction/insights-question-panel.tsx`
  - `components/extraction/disagreement-list.tsx`
  - `components/extraction/bar-visualization.tsx`
  - `components/extraction/stacked-answer-bars.tsx`
  - `components/extraction/review-queue.tsx`
  - `lib/extraction/reviews.ts`
  - `lib/extraction/question-status.ts`
  - `lib/extraction/answer-grouping.ts`
  - `lib/extraction/types.ts`
- Edit:
  - `components/extraction/results-views/table-view.tsx`
  - `components/extraction/results-views/card-view.tsx`
  - `components/extraction/results-views/split-view.tsx`
  - `components/extraction/status-filter.tsx`
  - `lib/extraction/status-filter-options.ts`
  - `lib/extraction/export.ts`
  - `lib/types/extraction.types.ts`
  - `messages/en-US.json`
  - `messages/en-GB.json`
  - `messages/fr.json`
  - `messages/hi.json`
  - `messages/ja.json`
  - `messages/zh.json`

## Migration stance

- No UI fallback or hidden tabs.
- Locale cleanup is part of removal, not follow-up.
- Any remaining imports/types that still refer to review-aware contracts must be rewritten, not shimmed.

## Test plan

- `pnpm test app/extraction/[jobId]/__tests__/page.test.tsx`
- `pnpm test tests/export-extraction-options.test.ts`
- Run surviving extraction component/unit tests affected by deleted imports.
- Manual smoke:
  - open `/extraction/[jobId]`,
  - confirm no review/insight tabs exist,
  - confirm results toolbar no longer offers review-only status filters,
  - confirm results rows/cards show no review badges.

## Acceptance criteria

- The extraction page renders with no insights/review tabs or feature-flag branches.
- No remaining component imports `lib/extraction/reviews.ts` or the deleted insights components.
- Results filtering exposes no `reviewed` or `needs-followup` option.
- Locale bundles contain no keys that are only used by the removed subsystem.

## Known pitfalls

- `components/extraction/results-toolbar.tsx` is not directly review-aware, but it hosts `StatusFilter`; verify its props/contracts after filter option removal.
- `lib/types/extraction.types.ts` currently exposes review fields used outside the deleted components; remove them only after surviving callers are updated.
