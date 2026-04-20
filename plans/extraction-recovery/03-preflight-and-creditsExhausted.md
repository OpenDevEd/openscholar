# Plan 03 — Pre-Flight Credit Check + `creditsExhausted` Status

**Depends on:** 01 (taxonomy). **Blocks:** 06.

## Context / dependencies

- **Credits-balance reuse**: this plan consumes `checkBalance` from `convex/credits/queries.ts:81-119` (returns `{hasEnough, free, paid, total, required, deficit}`) — do not hand-roll the credits-table read. Same call pattern used by `components/screening/screening-dialog.tsx:212`.
- **No other billing helpers to reuse**: `lib/billing/` currently only contains `lib/billing/entitlements.ts`, which handles plan entitlements (not credits). There is no shared preflight helper beyond `checkBalance` to reuse.
- **Workpool 0.3.2**: this plan has no workpool dependency; safe on 0.3.2.
- **`deductCredits` line anchor**: if a downstream section (or a later plan revision) cites a line range inside `convex/credits/internal.ts` (e.g., `:1459-1516`), TODO: re-anchor during execution — that file may have drifted. Do not delete the reference; flag it.

## Goal

Before the job is even created, check the user has enough credits. If not, block with the same UX screening uses — inline balance display and a "Buy Credits" CTA that deep-links to the billing page. If credits run out **mid-job**, transition the job to a new **non-terminal** `creditsExhausted` status that plan 06 will allow to resume automatically.

Closes gaps #1 (no pre-flight), #2 (credit exhaustion handling), #9 (top-up CTA).

## Scope

**In scope**
- Pre-flight credit estimate + check in `startJob`.
- Pre-submission balance display in `job-creator.tsx` (mirror of screening's dialog).
- New status value `creditsExhausted` on `extractionJobs.status` (non-terminal semantically — resumable).
- State-machine transitions updated.
- Workpool skip logic: if job is `creditsExhausted`, skip processing (same as screening).
- Credit-exhaustion detection in `extractOneQuestion` (from plan 02): catch `insufficient_credits` from `deductCredits`, transition job status, stop further dispatches.
- PostHog analytics: `extraction_job_credits_exhausted`, `extraction_job_blocked_preflight`.

**Out of scope**
- Actual resume mechanism (plan 06 — they share wiring, but the status transition is a precondition).
- Job-level cost aggregation (plan 04 — the estimate computation here is *estimated*, not actual).

## Design

### Pre-flight estimate (accuracy > simplicity)

Screening uses `ESTIMATED_CREDITS_PER_PAPER = 4.5` (constant). For extraction, estimate is driven by:
- Number of papers
- Number of questions per paper
- Whether PDFs are enabled (adds indexing cost)
- Source type (history/library/zotero → mostly abstracts; upload/PDF → indexing + more tokens)

```ts
// lib/extraction/cost-estimate.ts  (new, pure)
export function estimateExtractionCredits(args: {
  papers: number;
  questions: number;
  usePdfs: boolean;
  avgPaperKind: "abstract" | "pdf";   // derived from source breakdown
}): { low: number; mid: number; high: number } {
  // Calibrated empirically from `creditTransactions` history:
  //   - indexing: ~X credits per paper (PDFs only)
  //   - extraction LLM: ~Y credits per (question, paper) for abstract papers
  //   - extraction LLM: ~Z credits per (question, paper) for PDF papers
  // Return {low, mid, high} to let the UI show "~240 credits (200–290)".
}
```

Constants live in `lib/extraction/cost-estimate.ts` with a comment pointing at a one-off SQL-style audit that derives them from `creditTransactions.metadata.billingType === "extraction_llm"` and `"embedding"`. Re-tune quarterly.

Pre-flight computes `mid`; block when `totalAvailable < high` (conservative — better block than fail mid-run).

### Schema changes

`extractionJobs.status`:
```ts
status: v.union(
  v.literal("pending"),
  v.literal("downloading_pdfs"),
  v.literal("indexing"),
  v.literal("extracting"),
  v.literal("paused"),             // added by plan 06
  v.literal("creditsExhausted"),   // added here
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
),
```

`extractionJobs` gains (as part of this plan):
```ts
estimatedCredits: v.optional(v.object({ low: v.number(), mid: v.number(), high: v.number() })),
```

### State-machine transitions (`convex/extraction/stateMachine.ts`)

Add `creditsExhausted` to `JOB_STATUSES` (`convex/extraction/stateMachine.ts:17-25`). Extend `VALID_JOB_TRANSITIONS` (`:38-54`) to make it non-terminal with outgoing edges to `extracting` (on resume / retry with credits), `cancelled`, and `failed`. Incoming edges: from `downloading_pdfs | indexing | extracting`. NOT terminal (diverges from screening's semantics deliberately — user wants resume).

### Terminal statuses

`convex/extraction/stateMachine.ts` does not export a dedicated `TERMINAL` constant — terminal-ness is implicit (a status whose `VALID_JOB_TRANSITIONS` entry maps to `[]`). `creditsExhausted` must have a non-empty outgoing list (see above) so it is **NOT** terminal. `completed|failed|cancelled` remain terminal (empty outgoing lists).

Skip logic in workpool actions: treat `creditsExhausted|paused` as "skip-and-return", NOT as terminal. When the job resumes, a new workflow step re-dispatches.

### Rationale: deliberate divergence from screening

Screening currently treats `creditsExhausted` as terminal (see `convex/screening/mutations.ts:183` using `TERMINAL_STATUSES.includes`). Plan 03 deliberately diverges: for extraction, `creditsExhausted` is NON-terminal — the user can top up credits and resume. A reviewer who greps for `creditsExhausted` will find screening treating it as terminal; this split is intentional.

### Pre-flight check in `startJob`

`convex/extraction/mutations/jobs.ts:61-180`:

Gate the pre-flight inside the `if (args.mode === "extraction")` branch of `startJob` (post-`df532e6`). Insert between the question-length validator end at `:110` and `const now` at `:112`.

```ts
// After all input validation, before workflow.start:
if (args.mode === "extraction") {
  const { papers, questions } = await expandedCounts(ctx, args);
  const estimate = estimateExtractionCredits({ papers, questions, usePdfs, avgPaperKind });
  const balance = await ctx.runQuery(api.credits.queries.checkBalance, {
    requiredAmount: estimate.high,
  });
  // Same pattern as components/screening/screening-dialog.tsx:212
  if (!balance.hasEnough) {
    throw createTaxonomyError("insufficient_credits", {
      needed: estimate.high, available: balance.total, deficit: balance.deficit,
    });
  }
  // persist estimate on the job document
}
```

### Mid-run detection in `extractOneQuestion`

Catch the `insufficient_credits` error from the per-question `deductCredits` call. Mirror screening (`convex/screening/workpoolActions.ts:170-197`):

```ts
} catch (error) {
  const classified = classifyUnknownError(error);
  if (classified.code === "insufficient_credits") {
    await ctx.runMutation(internal.extraction.jobs.updateJobStatus, {
      jobId, status: "creditsExhausted",
      error: { ...classified, at: Date.now() },
    });
    // Pool: don't hard-cancel; let remaining in-flight finish. Plan 06's pause primitive does the rest.
    await captureServerEvent(userClerkId, "extraction_job_credits_exhausted", {
      job_id: jobId, attempt: attemptCount, questions_remaining: remaining,
    });
  }
  throw error;  // workpool marks this question failed; it'll retry after resume.
}
```

Workpool already has a 3× retry — on `creditsExhausted`, we want to stop dispatching, not keep retrying. Handled by: workpool skip-guard at the top of `extractOneQuestion` that reads `job.status` and early-returns for `creditsExhausted|paused`.

### Pre-submission UI (`components/extraction/job-creator.tsx`)

Add a balance-check row at the bottom of step 3 (Extraction mode, after the question builder) — same pattern as `components/screening/screening-dialog.tsx:411-440`.

Reactive: as the user adds/removes questions or changes sources, the estimate updates live.

```tsx
{draftJob.mode === "extraction" && (
  <ExtractionPreflightBanner
    estimate={estimate}        // from lib/extraction/cost-estimate.ts
    balance={credits}          // from Convex query
  />
)}
```

`ExtractionPreflightBanner` is a new component in `components/extraction/`:
- Shows `"~240 credits · you have 500"` when `balance >= high`.
- Shows red background + `"Need ~240 credits, you have 50"` + `<Button onClick={() => router.push("/settings/billing#topup-section")}>Buy Credits</Button>` when short.
- Has `data-preflight-ok={ok}` + `role="status"` for tests.

### In-job CTA for `creditsExhausted`

In `app/extraction/[jobId]/page.tsx` header, when `job.status === "creditsExhausted"`:
- Warning banner: "Extraction paused — out of credits."
- Two buttons: "Buy Credits" (deep link to `/settings/billing#topup-section`) + "Resume" (plan 06's mutation, disabled until `available >= remainingEstimate`).
- Secondary: "Cancel remaining papers".

Banner gets `role="alert"` + `data-job-status="creditsExhausted"`.

## TDD sequence (pure logic only — `lib/extraction/cost-estimate.ts`)

The estimator is the one piece that must be correct before any Convex wiring. Get it green before touching `startJob`.

```
R1 → G1   test: estimateExtractionCredits({papers:0, questions:5, usePdfs:false, avgPaperKind:"abstract"})
          → {low:0, mid:0, high:0}
R2 → G2   test: estimateExtractionCredits({papers:0, questions:0, ...}) → {0,0,0}  (bivariate zero)
R3 → G3   test: 10 papers × 5 Qs × abstracts
          → mid === 10 * 5 * ABSTRACT_Q_CREDIT_MID
          (constant named in source; test imports and multiplies to prove no magic number drift)
R4 → G4   test: same shape with usePdfs:true, avgPaperKind:"pdf"
          → mid === 10 * INDEX_PDF_CREDIT + 10 * 5 * PDF_Q_CREDIT_MID
R5 → G5   test: invariant high ≥ mid ≥ low for every sampled shape
R6 → G6   test: monotonic in papers (papers=20 → strictly higher than papers=10, same other args)
R7 → G7   test: monotonic in questions
R8 → G8   test: usePdfs:true with avgPaperKind:"abstract" uses PDF path
          (guard: if PDFs enabled, treat as PDF even if source sniff says abstract)
R9 → G9   test: widening factor — high is always ≥ 1.2 × mid when papers > 0
          (conservative block threshold)
REFACTOR  extract constants to exported `EXTRACTION_COST_CONSTANTS` for re-tuning script
```

After green, wire into `startJob`, schema, UI banner — test-after.

## Files touched

- `lib/extraction/cost-estimate.ts` (new) + `.test.ts` (new).
- `convex/schema.ts` — `extractionJobs.status` union + `estimatedCredits` field.
- `convex/extraction/stateMachine.ts` — transition table update.
- `convex/extraction/validators.ts` — status validator update.
- `convex/extraction/mutations/jobs.ts` — `startJob` pre-flight.
- `convex/extraction/workpoolActions.ts` — mid-run detection (after plan 02's split).
- `convex/extraction/mutations/internal/jobs.ts` — new `updateJobStatus` internal mutation (if it doesn't exist; screening has one at `convex/screening/mutations.ts`).
- `components/extraction/job-creator.tsx` — preflight banner.
- `components/extraction/preflight-banner.tsx` (new).
- `app/extraction/[jobId]/page.tsx` — in-job CTA for `creditsExhausted`.
- `messages/*.json` — new keys: `extraction.preflight.sufficient`, `.insufficient`, `.buyCredits`, `extraction.creditsExhausted.title`, `.body`, `.resume`, `.cancelRemaining`.
- `convex/extraction/mutations.test.ts` — pre-flight tests.
- `components/extraction/preflight-banner.test.tsx` — behavior tests.

## Test plan

- **Unit** (`lib/extraction/cost-estimate.test.ts`): 
  - 10 papers × 5 Qs × abstracts → expected range. 
  - 10 papers × 5 Qs × PDFs → higher range.
  - Zero papers → zero.
- **Convex** (`convex/extraction/jobs.test.ts`):
  - `startJob` with 100 papers, user has 10 credits → throws `insufficient_credits`. Job not created.
  - `startJob` with 100 papers, user has 10000 credits → created; `job.estimatedCredits` persisted.
- **Convex** (`convex/extraction/creditsExhausted.test.ts`):
  - Simulate mid-run `deductCredits` throwing `AI_INSUFFICIENT_CREDITS` → `job.status === "creditsExhausted"`, `job.error.code === "insufficient_credits"`, PostHog event captured.
  - Subsequent calls to `extractOneQuestion` for the same job return early (skip-guard).
- **UI** (`preflight-banner.test.tsx`):
  - Sufficient: banner has `data-preflight-ok="true"`, no button.
  - Insufficient: `data-preflight-ok="false"`, `role="status"`, `getByRole("button", { name: /buy credits/i })` present.
  - Click Buy Credits → navigates to `/settings/billing#topup-section`. (Use mocked `next/navigation`.)
- **UI** (job detail page):
  - Job with status `creditsExhausted` shows `role="alert"` banner, `data-job-status="creditsExhausted"`, Resume + Buy Credits + Cancel buttons.

## Acceptance criteria

- [x] Pre-flight block trips for insufficient credits with structured `insufficient_credits` error and no `extractionJobs` row created. (convex/extraction/mutations/jobs.ts + preflight.test.ts "throws INSUFFICIENT_CREDITS")
- [x] Job-creator shows live-updating balance vs estimate with "Buy Credits" CTA wired. (components/extraction/job-creator.tsx + preflight-banner.tsx + extraction-preflight-banner.test.tsx)
- [x] Mid-run credit exhaustion transitions job to `creditsExhausted` (non-terminal) and stops dispatching new questions. (convex/extraction/workpoolActions.ts handleCreditsExhaustionAndRethrow + skip-guard + creditsExhausted.test.ts)
- [x] Job detail page surfaces a banner with Resume + Buy Credits for `creditsExhausted` jobs. (app/extraction/[jobId]/page.tsx + components/extraction/credits-exhausted-banner.tsx + credits-exhausted-banner.test.tsx)
- [x] Resume button is disabled until the user's balance >= remaining estimate (computed live). Disabled-pre-plan-06 state shipped — plan 06 will wire the onResume mutation. (credits-exhausted-banner.tsx: `canResume = Boolean(onResume) && hasEnoughToResume`)
- [x] All existing extraction tests pass. (214 files / 2392 tests green on full run; TS strict-mode clean.)

## Follow-ups (out of scope for plan 03)

- `scripts/audit-extraction-cost.ts` — derive constants from `creditTransactions.metadata.billingType`. Flagged in plan 03 "Known pitfalls"; current constants are conservative over-estimates per the in-source TODO.
- `duplicateJob` / `startJobFromTemplate` preflight parity — the plan scoped the preflight to `startJob` only; the other two entrypoints still skip the check. Track as a follow-up before plan 05 (retry-failed-papers) lands, since retry also creates a new job.
- Remaining-estimate gate for the Resume button — pre-plan-04 the banner uses a flat `minCreditsToResume=1`. Upgrade to `estimate - sum(creditsAgg for this job)` once plan 04's aggregate ships.

## Known pitfalls

- **Estimate accuracy drift**: the constants in `cost-estimate.ts` must be re-tuned. Include a scripted audit (`scripts/audit-extraction-cost.ts`) that reads `creditTransactions` and computes actual per-paper / per-question median.
- **Race on mid-run detection**: multiple `extractOneQuestion` calls in flight may each observe `insufficient_credits` and each try to patch `job.status` → Convex mutation OCC handles; `updateJobStatus` should be idempotent (only flip `running → creditsExhausted`).
- **"Remaining estimate" for Resume button**: use `estimate - sum(creditsAgg for this job)` (plan 04's aggregate gives us this for free). Before plan 04 lands, ship Resume-button enablement as "always enabled when status=creditsExhausted and available >= 1 credit" — polish later.
