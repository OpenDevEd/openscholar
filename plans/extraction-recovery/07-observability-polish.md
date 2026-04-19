# Plan 07 — Observability Polish: Per-Item Progress, ARIA, Error History UI

**Depends on:** 01, 02, 06. **Blocks:** nothing.

## Goal

The user can see what's happening at a glance. Current paper being processed. Current question being extracted. Per-item success/failure with expandable error history. Screen readers announce state changes. Tests assert on behavior via `data-*` and ARIA attributes (per project testing doctrine).

Closes gap #8 (per-item progress, ARIA) and the UI leg of #10 (error history display).

## Scope

**In scope**
- Real-time "now processing" indicator: paper title + question label.
- Per-paper status row in results view showing `pending | downloading | indexing | extracting | completed | failed` with optional spinner.
- Expandable "error history" per question: click → list of attempts with code, timestamp, message (reads `extractionPaperErrors` via `by_paper` index).
- ARIA: `role="status"` on progress bar, `aria-live="polite"` on status banner, `aria-label` on all status dots, `role="alert"` on failures.
- Progress breakdown: "47/100 papers · 89/500 questions · 3 retrying".
- Mixed-success callout on a completed-with-failures job.

**Out of scope**
- Redesign of the results table (scope creep).
- New visualizations.

## Design

### `now-processing` indicator

On the job detail header, a line below the progress bar:

```
Currently: "Attention is all you need" · Q3 "What dataset was used?"
```

Data source: `ctx.db.query("extractionResults").withIndex("by_job_status").filter("status=extracting").first()` → returns the oldest-started in-flight question. Cheap via index.

```ts
// convex/extraction/queries/nowProcessing.ts
export const getNowProcessing = query({
  args: { jobId },
  handler: async (ctx, { jobId }) => {
    // Use existing index or add one: by_job_and_status
    const result = await ctx.db.query("extractionResults")
      .withIndex("by_job_status", q => q.eq("jobId", jobId).eq("status", "extracting"))
      .order("asc")
      .first();
    if (!result) return null;
    const [paper, question] = await Promise.all([ ... ]);
    return { paperTitle: paper.title, questionLabel: question.label, startedAt: result.startedAt };
  },
});
```

Add index `extractionResults.by_job_status` if not already present.

### Per-paper status row

In the results tab (`components/extraction/results-table.tsx`), each paper row already shows status. Extend to show question-level progress:

```
[Paper title] [●●●●○] 4/5 completed · 1 retrying
```

Where `●●●●○` is an inline mini-bar. Data: aggregate over `extractionResults` for that paper.

`data-paper-status` and `data-question-progress` on the row so tests assert on semantic state.

### Error history expansion

For a failed question, clicking the error icon expands a panel:

```
Attempt 3 · 2026-04-19 14:32 · rate_limit
  Upstream capacity for this model is temporarily exhausted.

Attempt 2 · 2026-04-19 14:28 · rate_limit
  ...

Attempt 1 · 2026-04-19 14:27 · network
  ...
```

Data from `extractionPaperErrors` via `by_paper` index. Bounded: show latest 10, "Show more" pagination.

```ts
// convex/extraction/queries/errorHistory.ts
export const listPaperErrors = query({
  args: { paperId, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    return ctx.db.query("extractionPaperErrors")
      .withIndex("by_paper", q => q.eq("paperId", args.paperId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
```

### Progress breakdown

Header badge: `47/100 papers · 89/500 questions · 3 retrying`.

Data:
- papers: existing `processedPapers + failedPapers / totalPapers` counters.
- questions: `resultAnsweredAgg.count` (already exists, `convex/extraction/aggregates.ts`).
- retrying: questions with `attemptCount > 1 && status === "extracting"` — add a small aggregate or derive.

### ARIA / accessibility

Every piece of status info gets both text AND an ARIA attribute:

| Element | Role / Attr |
|---|---|
| Progress bar | `role="progressbar"` + `aria-valuenow`, `aria-valuemin=0`, `aria-valuemax=totalPapers` + `aria-label={jobName}` |
| Status dot | `aria-label={statusText}` (status is conveyed by text elsewhere too — dot is decorative but labeled) |
| Currently-processing banner | `role="status"` + `aria-live="polite"` + `aria-atomic="true"` |
| Failure callout | `role="alert"` (once per appearance, managed by React) |
| Paused banner | `role="status"` + `aria-live="polite"` |
| Error history panel | expandable `<details>` with `aria-expanded` or equivalent via Radix |

### Mixed-success summary

On a `completed` job with `failedQuestions > 0`:

```
Completed with partial success — 
  473 / 500 questions answered.
  27 failed: 15 rate limits, 8 PDF invalid, 4 context too long.
  [15 retryable] ← link to plan 05's retry flow
```

Group-by `code` over `extractionPaperErrors` for the job, or add a small `failuresByCode` materialized on `finalizeJob`. Go with on-demand query — bounded via `extractionPaperErrors.by_job` index.

## TDD sequence (pure logic only — `lib/extraction/failures-summary.ts`)

Only one pure-logic piece: the failures-by-code summarizer that feeds the mixed-success callout and the error-history side panel. Test-first.

```
R1 → G1   test: summarizeFailures([]) → {total:0, byCode:[]}
R2 → G2   test: single error → byCode:[{code, count:1, retryable}]
R3 → G3   test: multiple same-code errors → one entry with count:N
R4 → G4   test: multiple codes → sorted by count desc, ties broken by code asc
R5 → G5   test: total equals sum of counts
R6 → G6   test: each entry carries retryable flag from taxonomy (imports isRetryable)
R7 → G7   test: unknown code defaults to retryable:true, label falls back to code string
R8 → G8   test: pure — does not mutate input array
REFACTOR  memoize if the list-virtualization component re-renders it frequently
```

Queries, components, indexes, ARIA wiring — test-after. ARIA coverage is a smoke assertion set per component (`getByRole("progressbar")`, `getByRole("status")`, `toHaveAttribute("aria-live", "polite")`) — not driven red-first.

## Files touched

- `convex/schema.ts` — add index `extractionResults.by_job_status` if not present.
- `convex/extraction/queries/nowProcessing.ts` (new).
- `convex/extraction/queries/errorHistory.ts` (new).
- `convex/extraction/queries/mixedSuccessSummary.ts` (new).
- `components/extraction/now-processing.tsx` (new).
- `components/extraction/paper-question-progress.tsx` (new).
- `components/extraction/error-history.tsx` (new).
- `components/extraction/mixed-success-summary.tsx` (new).
- `app/extraction/[jobId]/page.tsx` — mount new components.
- `components/extraction/results-table.tsx` — per-row question progress.
- `components/extraction/job-list-item.tsx` — add `aria-label` on status dot.
- `messages/*.json` — keys for all new strings.
- Tests.

## Test plan

- **Convex** (`nowProcessing.test.ts`):
  - 0 in-flight → `null`.
  - 3 in-flight — returns the one with smallest `startedAt`.
  - No index scan (assert query uses index — run with `--explain` or snapshot).
- **Convex** (`errorHistory.test.ts`):
  - Paginate through 50 errors; `isDone` flips correctly.
  - Ordering: newest first.
- **UI** (`now-processing.test.tsx`):
  - Given mocked query → renders paper title + question label. `data-now-processing-paper` attr matches.
  - Null query → component renders nothing (no empty state — redundant with progress bar).
- **UI** (`error-history.test.tsx`):
  - Given 3 errors → renders 3 rows. Each has `data-error-code` attribute. Texts match localized taxonomy.
- **UI** (accessibility smoke via `@testing-library/jest-dom`):
  - Progress bar has `role="progressbar"` with `aria-valuenow/min/max`.
  - Status dot has `aria-label` matching the localized status.
  - Mixed-success summary has `role="region"` + `aria-labelledby`.
  - No assertions on CSS classes (per project doctrine).
- **Integration** (Playwright/e2e):
  - Start a job; during run, the now-processing banner updates visibly.
  - Failure → error history panel expands and lists attempts.

## Acceptance criteria

- [ ] Job detail page shows which paper + question is being processed right now.
- [ ] Each paper row shows per-question progress bar + counts.
- [ ] Failed questions have an expandable error history sourced from `extractionPaperErrors`.
- [ ] Screen-reader announcement of pause/resume/credit-exhaustion transitions via `aria-live`.
- [ ] Tests assert on `data-*` and ARIA attributes, not CSS classes.
- [ ] Mixed-success jobs show a breakdown of failure codes with counts.

## Known pitfalls

- **Sub-second churn**: `nowProcessing` query might fire rapidly during fast-finishing questions. Convex reactivity throttles re-renders, but still — cap the component re-render rate client-side (useDebounce 250ms) to avoid jitter.
- **Stale "currently processing"**: if all questions finish between two ticks of the subscription, the UI may show the last one briefly after completion. Accept; plan 06's completion toast overrides the impression of activity.
- **Error-history pagination UX**: if a single question has 100+ attempts (unlimited retries × flaky network), the panel becomes overwhelming. Cap the inline display at 10 and link out to a full log view (or: never exceed 10 — add a per-question retry cap after feedback from users).
