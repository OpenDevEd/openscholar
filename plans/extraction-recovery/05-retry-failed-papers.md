# Plan 05 — Retry Failed Items (Classification-Aware)

**Depends on:** 01 (taxonomy + `isRetryable`), 02 (per-question granularity). **Blocks:** nothing.

## Goal

Let the user retry only what failed, and only what's classified as retryable. `duplicateJob` (today's only option) reprocesses every paper and re-bills — a 100-paper job that had 5 failures costs 100 papers' worth of credits to "retry". After this plan, the user clicks one button and retries exactly those failures.

Retry works at the **question level** post-plan-02: a paper with 10 questions where only question 7 hit a 429 retries only question 7.

Classification: `insufficient_credits`, `rate_limit`, `network`, `provider_5xx`, `action_timeout`, `unknown`, `indexing_failed`, `aborted` are retryable. `pdf_invalid`, `paper_not_found`, `moderation`, `context_too_long`, `llm_content_refusal`, `schema_validation`, `auth` are not.

Closes gap #3 (retry granularity).

## Scope

**In scope**
- New public mutation `retryFailedQuestions(jobId)` — re-enqueues only retryable failures.
- Pure helper `getRetryablePaperQuestions(jobId)` used by both the mutation and the UI pre-check.
- UI: "Retry 5 failed" button on job detail when `retryable > 0` and job is in `completed` or `failed` or `creditsExhausted` status.
- UI: breakdown in the results tab — "5 retryable, 2 permanent".
- Per-question retry bumps `attemptCount`, appends to `extractionPaperErrors` on each further failure.
- Pre-retry credit check (small pre-flight: estimate = retryable × avg-per-question cost).
- PostHog: `extraction_retry_requested` with `retryable_count`, `permanent_count`.

**Out of scope**
- Auto-retry cron (manual retry only for now).
- Retry of an entire `cancelled` job (user would use "Duplicate" — existing flow). Retry only for completed-with-failures or credit-exhausted.

## Design

### Query: what's retryable?

```ts
// convex/extraction/queries/retry.ts
export const getRetryableSummary = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    // Iterate extractionResults (or extractionPapers for pre-plan-02 fallback)
    //   with lastError present, group by isRetryable(code).
    // Bounded: paginate if > 1000 results.
    return { retryableCount, permanentCount, permanentBreakdown: { [code]: count } };
  },
});
```

### Mutation: retry

```ts
// convex/extraction/mutations/retry.ts
export const retryFailedQuestions = mutation({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, { jobId }) => {
    // 1. Auth + ownership check (owner-only, screening parity).
    // 2. Job must be in {completed, failed, creditsExhausted}; else throw.
    // 3. Collect retryable result IDs.
    // 4. Pre-flight credit check for retry: estimate = retryable × avg-per-q.
    //    If insufficient → throw classified insufficient_credits.
    // 5. For each retryable result: reset result.status to "pending", result.billed=false (it was never debited).
    //    Wait — that's wrong: if billed=true, we already paid. Only reset those where status="failed" and billed is false.
    // 6. Flip job.status back to "extracting" (non-terminal).
    // 7. Start a new workflow to re-enqueue only those specific (paperId, questionId) pairs — OR
    //    send an event into the existing (paused) workflow. Post-plan-06 we have awaitEvent scaffold.
    //    Pre-plan-06: start a fresh secondary workflow keyed off remaining IDs.
    // 8. PostHog event.
  },
});
```

### Integration with plan 06 (pause/resume)

After plan 06: retry and resume share machinery.
- `retryFailedQuestions` = flip status to `extracting` + send `resume:${jobId}` event.
- The workflow's question-fan-out loop already skips questions with `result.status === "completed"` (idempotency from plan 02).
- For failed questions: reset `result.status` to `pending` first, then resume, and they'll be picked up naturally.

Pre-plan-06: start a new workflow called `runRetryWorkflow(jobId, retryableIds)` that re-enqueues those specific pairs. Less elegant but works.

**Recommended shipping order**: ship plan 06 first if retry is wanted soon, so there's no throwaway code.

### UI

In `app/extraction/[jobId]/page.tsx`, when job status is `completed|failed|creditsExhausted`:

```tsx
<RetrySummary jobId={jobId} />
// Renders: "5 retryable · 2 permanent (2 × PDF invalid)"
// With button: [Retry 5 failed] — shown only if retryableCount > 0
```

Clicking opens a confirmation dialog showing the pre-flight estimate ("This will cost ~12 credits. Continue?"). Use same banner pattern as plan 03's preflight.

Permanent failures get their own UI affordance: a dismissible "These 2 papers cannot be retried" callout listing the codes ("Invalid PDF", "Paper not found") so user understands.

### Attempt counter semantics

Each retry bumps `result.attemptCount`. Unlimited while credits last (user's call). No global cap.

The `extractionPaperErrors` table from plan 01 accumulates one row per failed attempt. Plan 07's UI exposes this as an expandable "history" under each failed question.

## TDD sequence (pure logic only — `lib/extraction/retry-summary.ts`)

The classification summarizer is the brains of the retry UX. Drive it entirely by tests before the mutation or UI lands.

```
R1 → G1   test: summarizeRetryable([])
          → {retryableCount:0, permanentCount:0, permanentBreakdown:{}}
R2 → G2   test: only completed results, no errors
          → all zeros (nothing to retry)
R3 → G3   test: one retryable error (e.g. rate_limit)
          → {retryableCount:1, permanentCount:0, permanentBreakdown:{}}
R4 → G4   test: one permanent error (e.g. pdf_invalid)
          → {retryableCount:0, permanentCount:1, permanentBreakdown:{pdf_invalid:1}}
R5 → G5   test: mixed — 2 rate_limit + 1 network + 1 pdf_invalid + 1 moderation
          → {retryableCount:3, permanentCount:2, permanentBreakdown:{pdf_invalid:1, moderation:1}}
R6 → G6   test: permanentBreakdown entries sorted by count desc then code asc
R7 → G7   test: unknown code (not in taxonomy) falls into retryable bucket
          (forward-compat: never trap the user on a code we haven't classified)
R8 → G8   test: completed results with lastError present are ignored
          (a result can have a stale lastError from a prior failed attempt; only the latest status counts)
R9 → G9   test: summarizer is pure (same inputs → same outputs, no mutation of inputs)
REFACTOR  extract the retryable predicate into a single source — must import isRetryable from plan-01's taxonomy
```

Then wire the mutation, workflow integration, and UI — test-after.

## Files touched

- `convex/extraction/queries/retry.ts` (new).
- `convex/extraction/mutations/retry.ts` (new).
- `convex/extraction/workflow.ts` — post-plan-06: handle retry event; pre-plan-06: new `runRetryWorkflow`.
- `components/extraction/retry-summary.tsx` (new).
- `components/extraction/retry-confirm-dialog.tsx` (new) — reuses preflight banner.
- `app/extraction/[jobId]/page.tsx` — mount `RetrySummary`.
- `messages/*.json` — keys `extraction.retry.summary`, `.retryButton`, `.confirmDialog.*`, `.permanent.title`, `.permanent.body.{code}` for each permanent code.
- Tests: `convex/extraction/retry.test.ts`, `components/extraction/retry-summary.test.tsx`.

## Test plan

- **Unit** (`lib/errors/taxonomy.test.ts`, already exists post-plan-01): `isRetryable` table covers every code.
- **Convex** (`retry.test.ts`):
  - Seed: 3-paper × 5-Q job, 2 completed, 10 results with statuses: 8 completed + 5 failed (2× rate_limit, 1× pdf_invalid, 1× moderation, 1× network) + 2 pending.
  - `getRetryableSummary` → `{ retryableCount: 3 /* 2 rate_limit + 1 network */, permanentCount: 2 /* pdf_invalid, moderation */ }`.
  - `retryFailedQuestions` → only 3 results flip to pending; job to extracting; 2 permanent untouched.
  - Insufficient credits for retry → throws `insufficient_credits`, no state changes.
  - Retry on non-retryable-only job → throws "nothing to retry".
- **UI** (`retry-summary.test.tsx`):
  - Renders with `data-retryable-count="3"` + `data-permanent-count="2"`.
  - Button label via `getByRole("button", { name: /retry 3/i })`.
  - Confirmation dialog shows estimate and "Continue" calls mutation.
  - When `retryableCount=0`, button is not rendered.
- **Integration**: retry a credit-exhausted job after topping up → job resumes, only failed questions re-run, no double-billing on already-completed.

## Acceptance criteria

- [ ] Retry does not re-charge already-billed (completed) questions.
- [ ] Retry only touches `isRetryable === true` codes.
- [ ] Permanent failures have a distinct UI treatment with per-code messaging.
- [ ] Retry mutation passes all ownership + status preconditions.
- [ ] Attempt count bumps and `extractionPaperErrors` accumulates on subsequent failures.
- [ ] A full retry cycle: cancel → resume (via retry) → complete works end-to-end.

## Known pitfalls

- **Race with resume**: if user clicks Retry on a `creditsExhausted` job while also clicking Resume (plan 06), Convex mutation OCC serializes them. Make both mutations idempotent w.r.t. `job.status === "extracting"`.
- **Partial question resets**: if a result has `billed=true` but `status=failed`, that's a logic bug (we billed for a failure). Tests must cover this not happening. Add invariant assertion in `finalizePaper`: `status=failed ⇒ billed=false`.
- **Classification drift**: if taxonomy (plan 01) misclassifies a recoverable error as permanent, the user has no escape. Mitigation: admin override mutation `adminForceRetryAll(jobId)` gated by user.role, for support.
- **"Nothing to retry" messaging**: distinguish `retryable=0, permanent=0` (job was fully successful) from `retryable=0, permanent=N` (all failures are permanent). Two different UI strings.
