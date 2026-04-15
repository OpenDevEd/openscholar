# Phase 96: Eval Loop & Quality Sampling - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Prevent model regressions and surface production quality drift by maintaining a 20-case hand-labeled golden set, running `vitest-evals` + `autoevals` with CI gating at 95% recall / 98% citation validity, sampling one production answer per hour into a `qualityChecks` table via the existing critic infrastructure, and exposing a 7-day rolling pass-rate trend query. Flagged `unsupported` samples land in a human-review queue that doubles as the golden-set growth pipeline.

</domain>

<decisions>
## Implementation Decisions

### Golden Set Structure (EVAL-01)
- **D-01:** Create `tests/evals/screening-golden.ts` as a typed const array of 20 hand-labeled case objects. Each case: `{ paperId: string, paperBodyText: string, question: string, expectedAnswer: string, expectedVerdict: "include" | "exclude" | "insufficient_evidence", expectedSourceSpan: { startChar: number, endChar: number }, parsingSource: "pmc" | "arxiv" | "unpdf" | "gemini" | "abstract_only" }`.
- **D-02:** Distribution: at least 7 include, 7 exclude, 6 insufficient_evidence cases. Parsing source coverage: at least 3 PMC, 3 arXiv, 3 PDF-fallback (unpdf/gemini). This satisfies EVAL-01's requirement for include/exclude/insufficient cases spanning at least 3 parsing sources.
- **D-03:** Paper body text in the golden set is real text excerpted from actual papers (not synthetic). Keep excerpts under 10K characters to keep eval test runtime fast while still exercising real extraction.
- **D-04:** The golden set file exports a typed `SCREENING_GOLDEN_SET` const and a TypeScript interface `GoldenCase` for reuse in both the eval test runner and future golden-set promotion logic.

### Eval Test Runner (EVAL-02, EVAL-03)
- **D-05:** Create `tests/evals/screening-eval.test.ts` using `vitest-evals` test runner with `autoevals` Factuality scorer. Gate the entire test file with `describe.skipIf(process.env.RUN_EVALS !== '1')` so normal `pnpm test` skips evals.
- **D-06:** Install `vitest-evals` and `autoevals` as devDependencies (`pnpm add -D vitest-evals autoevals`).
- **D-07:** The eval test iterates over `SCREENING_GOLDEN_SET`, calls `extractAnswers()` (the pure async function from `convex/extraction/extract.ts`) with each case's paper body text and question, then scores the result using:
  - `autoevals` Factuality scorer — compares extracted `answer` against `expectedAnswer`
  - Custom citation-substring-match scorer — uses `fastest-levenshtein` (already installed) to verify the returned `evidence_quote` substring-matches the expected source span at >=0.85 similarity (same threshold as runtime Levenshtein guard from Phase 92)
- **D-08:** After all cases are scored, the test asserts two aggregate thresholds: `recallOnInclude >= 0.95` (fraction of include cases correctly identified) and `citationValidityRate >= 0.98` (fraction of cases with valid citation grounding). These fail the test on violation, blocking CI merge per EVAL-03.
- **D-09:** No changes to `vitest.config.ts` needed — `tests/evals/` is already covered by the existing `tests/**/*.test.ts` include pattern. The `describe.skipIf` gate handles the conditional execution.

### CI Gating (EVAL-03)
- **D-10:** Add a CI job (GitHub Actions) that runs `RUN_EVALS=1 pnpm test tests/evals/` as a separate workflow job. This job only triggers on PRs that change files in `convex/extraction/**` or `lib/extraction/**` — uses `paths` filter in the workflow YAML.
- **D-11:** The CI job is a required status check for merge. A deliberately-failing canary test in the eval suite verifies the gate works (a test case with intentionally wrong expected answer that's skipped in normal runs but could be enabled to verify CI blocks).

### Hourly Production Sampling Cron (EVAL-04)
- **D-12:** Add a new hourly cron entry in `convex/crons.ts`: `crons.interval("quality sampling", { hours: 1 }, internal.extraction.qualitySampling.sampleAndCheck)`. Follows the established cron pattern (7 existing crons, all hourly or daily).
- **D-13:** Create `convex/extraction/qualitySampling.ts` module with an internal action `sampleAndCheck` that:
  1. Queries `extractionResults` for completed answers (non-null `criticVerdict`)
  2. Counts total eligible results, picks a random one via `Math.floor(Math.random() * count)` with offset
  3. Checks the `by_answerId` index on `qualityChecks` to skip answers already sampled in the last 7 days
  4. Loads the paper's bodyText from `extractionPapers`
  5. Re-runs the critic pass using `buildCriticPrompt` from `lib/ai/core/prompts.ts` and the same OpenRouter model tier
  6. Writes `{ answerId, verdict, judgeModel, timestamp }` to the `qualityChecks` table via an internal mutation
- **D-14:** If no completed results exist yet, the action early-returns silently — no error, no log noise.
- **D-15:** The `qualityChecks` table schema: `{ answerId: v.id("extractionResults"), verdict: v.string(), judgeModel: v.string(), timestamp: v.number(), reviewStatus: v.string() }` with indexes `by_answerId` and `by_timestamp`.

### Quality Trend Query (EVAL-05)
- **D-16:** Create `getQualityTrend` public query in `convex/extraction/queries.ts` that returns `{ supported: number, unsupported: number, partial: number, total: number, passRate: number }` aggregated over the last 7 days from `qualityChecks` rows using the `by_timestamp` index.
- **D-17:** Auth-gated with the same `getCurrentUser(ctx)` pattern used by all other extraction queries. Returns `null` for unauthenticated requests.
- **D-18:** `passRate` is computed as `supported / total` (0 if no checks exist). This is the metric surfaced in the UI dashboard.

### Human-Review Queue (EVAL-06)
- **D-19:** The `qualityChecks.reviewStatus` field uses values `"pending"` | `"reviewed"` | `"promoted"`. Samples with `verdict === "unsupported"` automatically get `reviewStatus: "pending"`. Supported/partial samples get `reviewStatus: "reviewed"` (no action needed).
- **D-20:** Create `getReviewQueue` public query in `convex/extraction/queries.ts` that returns pending review items — quality checks with `reviewStatus === "pending"`, joined with the answer and paper data for context.
- **D-21:** Golden-set growth is a developer workflow, not a UI flow for MVP. A developer reviews flagged items in the queue, manually adds confirmed cases to `tests/evals/screening-golden.ts`, and commits. The `reviewStatus` gets updated to `"promoted"` (added to golden set) or `"reviewed"` (dismissed) via a mutation.
- **D-22:** Create `updateReviewStatus` mutation for marking items as `"reviewed"` or `"promoted"`. Auth-gated.

### Claude's Discretion
- Exact wording of the Factuality scorer prompt configuration for `autoevals` — follow library defaults.
- Whether the random sampling uses a simple offset query or samples from recent results only (last 30 days) to avoid repeatedly sampling old data.
- CI workflow YAML structure — whether to add to existing workflow or create a dedicated `evals.yml`.
- Test fixture excerpts for the 20 golden set cases — use representative real paper text.
- Whether `getReviewQueue` includes pagination or returns all pending items (likely few — simple `.collect()` with a reasonable bound is fine).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Tables
- `convex/schema.ts` lines 410-501 — Current extraction tables. `extractionJobs` already has `recallOnInclude: v.optional(v.number())` placeholder. New `qualityChecks` table must be added.
- `convex/extraction/validators.ts` — Extraction validators. New validators needed for `qualityChecks` fields.

### Critic Infrastructure (Phase 92 — reuse for sampling)
- `convex/extraction/extract.ts` lines 141-170 — `criticOutputSchema` Zod schema, critic invocation within `extractSingleAnswer`. Reuse same schema and prompt pattern for hourly sampling.
- `lib/ai/core/prompts.ts` — `buildCriticPrompt` function. Used by both runtime critic and hourly sampling cron.

### Extraction Pipeline
- `convex/extraction/extract.ts` line 463 — `extractAnswers()` pure async function. Called directly from eval tests (not through Convex action layer).
- `convex/extraction/queries.ts` — Existing queries including `getExtractionJobMetrics` (already returns `citationValidityRate` and `recallOnInclude`). New `getQualityTrend` and `getReviewQueue` queries go here.
- `convex/extraction/mutations.ts` lines 370-460 — `saveResult` and job finalization. `citationValidityRate` computed here. `recallOnInclude` needs population logic from Phase 96.

### Cron Infrastructure
- `convex/crons.ts` — 7 existing cron jobs. New hourly quality-sampling cron follows same pattern.

### Test Infrastructure
- `vitest.config.ts` — Current config with `tests/**/*.test.ts` include pattern (already covers `tests/evals/`).
- `tests/setup.ts` — Test setup file.
- `convex/extraction/extract.test.ts` — Existing extraction tests. Reference for test patterns.

### Levenshtein Verification (Phase 92)
- `convex/extraction/extract.ts` — Runtime `fastest-levenshtein` usage for citation grounding. Same library reused in eval's citation-substring-match scorer.

### Requirements
- `.planning/REQUIREMENTS.md` — EVAL-01 through EVAL-06 define exact scope.
- `convex/_generated/ai/guidelines.md` — Convex API patterns and conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/extraction/extract.ts:extractAnswers` — Pure async function callable from eval tests. No Convex context needed.
- `convex/extraction/extract.ts:criticOutputSchema` — Zod schema for critic verdict. Reuse in hourly sampling action.
- `lib/ai/core/prompts.ts:buildCriticPrompt` — Critic prompt builder. Reuse in hourly sampling action.
- `fastest-levenshtein` (already installed) — Reuse in custom citation-substring-match scorer for eval tests.
- `convex/crons.ts` — 7 existing crons provide exact pattern for hourly quality-sampling cron.
- `convex/extraction/queries.ts:getExtractionJobMetrics` — Already returns `citationValidityRate` and `recallOnInclude`. Quality trend is a new complementary query.

### Established Patterns
- Cron registration: `crons.interval("name", { hours: 1 }, internal.module.function)`.
- Auth + ownership guard: `getCurrentUser(ctx)` + job ownership check before returning data.
- Internal action for background work: `internalAction` with `"use node"` for external API calls.
- Typed returns with explicit validators: `returns: v.object(...)` — no `v.any()`.
- `describe.skipIf(condition)` for conditional test execution in vitest.

### Integration Points
- `convex/schema.ts` — Add `qualityChecks` table with indexes.
- `convex/crons.ts` — Add hourly quality-sampling cron entry.
- `convex/extraction/queries.ts` — Add `getQualityTrend` and `getReviewQueue` queries.
- New file: `convex/extraction/qualitySampling.ts` — Sampling action + write mutation.
- New file: `tests/evals/screening-golden.ts` — 20-case golden set.
- New file: `tests/evals/screening-eval.test.ts` — Eval test runner with vitest-evals + autoevals.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond what REQUIREMENTS.md EVAL-01 through EVAL-06 prescribe. The requirements are precise: 20-case golden set, vitest-evals + autoevals with Factuality and citation-substring-match scorers, 95%/98% CI thresholds, hourly cron sampling 1 answer, `qualityChecks` table with verdict/judgeModel/timestamp, 7-day rolling trend query, and unsupported samples landing in a review queue that grows the golden set.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 96-eval-loop-quality-sampling*
*Context gathered: 2026-04-15*
