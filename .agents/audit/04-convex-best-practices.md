# Convex Best-Practices Audit — `convex/extraction/`

**Scope:** `convex/extraction/` (32 files, ~9,610 lines) + `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/workflow.ts`, `convex/workpool.ts`.
**Reference:** `convex/_generated/ai/guidelines.md` (authoritative).
**Date:** 2026-04-17.

---

## Summary

The extraction module is ambitious and architecturally sound: it uses `@convex-dev/workflow` for deterministic orchestration, `@convex-dev/workpool` with typed `defineOnComplete` callbacks, strict argument validators, a denormalized `extractionJobStats` counter, and a self-rescheduling batched cascade-delete pattern. However it contains **one critical auth violation**, several N+1 and unbounded-collect patterns, one `.filter()` on a DB query that should be a compound index, pervasive missing `returns` validators on internal queries, and four `"use node";` files that do not require the Node runtime. Multiple internal lookups against the same document inside a single action are opportunistic consolidation targets.

---

## BLOCK-level violations (must-fix)

### B1. `identity.subject` used instead of `identity.tokenIdentifier`

- **Rule broken:** Guidelines §auth — *"prefer `identity.tokenIdentifier` over `identity.subject`. Do NOT use `identity.subject` alone as a global identity key."*
- **File:line:** `convex/extraction/queries.ts:1656`
- **Current code:**
  ```ts
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
  ```
- **Fix:** Delete `getCurrentUserInternal` entirely. Nothing in the codebase imports it (it is not re-exported from `index.ts`) and action-side identity-based lookups should flow through `requireActionAuth` or via a `jobId → userId` mutation (pattern already used by `getUserIdFromJob` at `mutations.ts:2016`). If the helper must stay, change the entire call chain to delegate to `convex/lib/auth.ts` so there is exactly one source of truth — note that `convex/lib/auth.ts:37,54,72,81` also use `identity.subject`; it is the *codebase-wide* pattern, but for any *new* helper the rule is strict.
- **Why this is blocking:** Duplicating the Clerk-id lookup in extraction bypasses the `getCurrentUser` helper that also performs `assertActiveUser` (suspended/deleted state check). A suspended user can be returned here.

### B2. `.filter(q => q.neq(...))` on a DB query

- **Rule broken:** Guidelines §queries — *"Do NOT use `.filter()` on database queries — use indexes instead."*
- **File:line:** `convex/extraction/mutations.ts:1210`
- **Current code:**
  ```ts
  const papersWithStorage = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .filter((q) => q.neq(q.field("storageId"), undefined))
    .take(MAX_PAPERS_PER_JOB);
  ```
- **Fix:** This is a negative-filter that index queries cannot satisfy directly. The schema has no `by_job_hasStorage` index. Either (a) add a compound index `by_job_storageId: ["jobId", "storageId"]` and restructure cleanup to iterate only rows where `storageId !== undefined` via a scan in JS (cheap — 500 rows, one field check), or (b) drop the `.filter()` and test `paper.storageId` in JS. Option (b) is the zero-cost fix:
  ```ts
  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .take(MAX_PAPERS_PER_JOB);
  for (const paper of papers) {
    if (!paper.storageId) continue;
    …
  }
  ```

### B3. N+1 collect inside paper loop in `backfillJobStats`

- **Rule broken:** Guidelines §performance — *"avoid N+1 query patterns; batch-load children once."*
- **File:line:** `convex/extraction/mutations.ts:1271-1278`
- **Current code:** Loops questions × papers and issues one `ctx.db.query("extractionResults").withIndex("by_paper", …).collect()` **per (question, paper) pair**. With the existing ~5-20 questions and `MAX_PAPERS_PER_JOB = 500`, that is up to **10,000 index queries** in a single mutation.
- **Fix:** Outer-loop papers once; load each paper's results once into a `Map<questionKey, result>`; aggregate against that map for every question. Preferably pull all results for the job via `extractionResults.by_job` (needs a new index or a join through papers) — but the cheap fix is to move the `.collect()` outside the question loop:
  ```ts
  const resultsByPaper = new Map<string, Doc<"extractionResults">[]>();
  for (const paper of papers) {
    if (paper.processable === false) continue;
    resultsByPaper.set(paper._id, await ctx.db.query("extractionResults")
      .withIndex("by_paper", (q) => q.eq("paperId", paper._id)).collect());
  }
  for (const question of questions) { /* read from map */ }
  ```

---

## SHOULD-fix violations

### S1. Unnecessary `"use node";` directives

- **Rule broken:** Guidelines §runtime — *"`fetch()` works in default Convex runtime. Only use `"use node";` when you import Node.js-only APIs (`crypto`, `fs`, `stream`, `buffer`, `node:*`)."*
- **Files (verified with no Node imports):**
  - `convex/extraction/actions.ts:1` — uses only `fetch()`, `URLSearchParams`, `process.env` (process.env is available in both runtimes). **Remove the `"use node";`.**
  - `convex/extraction/prompts.ts:1` — pure string/regex logic. **Remove.**
  - `convex/extraction/test_helpers.ts:1` — only `ctx.db` calls; test_helpers is not even a registered action file (`index.ts:13` comment acknowledges "use node" action files are not re-exported; this file is imported by others). **Remove.**
  - `convex/extraction/evidence_units.ts:1` — uses only `Map`/regex/hashing. **Verify** — if the dynamic PDF import at `pdfjs_extract.ts` is only invoked via its own "use node" caller, this file can drop the directive. Currently marked as should-fix pending one-line review of all call sites.
  - `convex/extraction/chunking.ts:1` — pure string chunking logic (lines 8-80). **Remove.**
- **Fix:** Drop the directive wherever no Node-specific import exists. `actions.ts`, `prompts.ts`, `test_helpers.ts`, `chunking.ts` are clean. `workpoolActions.ts` (uses `@convex-dev/rag`, `@ai-sdk/openai`, `pdfjs-dist`, `decryptApiKey→node:crypto`) and `debug_pdfjs_alignment.ts` (pdfjs) and `test_automation.ts` (transitively loads node-flagged modules) are justified.
- **Why it matters:** Node-runtime functions cold-start slower, cannot share a bundle with default-runtime code, and cannot share any helpers with non-node files (explaining the `index.ts:13-17` barrel workaround). Dropping the directive simplifies bundling and the `index.ts` re-export restrictions.

### S2. Missing `returns:` validators on internal queries

- **Rule broken:** Guidelines §validators — *"All registered queries/mutations/actions MUST declare `args` AND `returns` validators."*
- **Files:line with no `returns`:**
  - `convex/extraction/queries.ts:1415` `getJobInternal`
  - `convex/extraction/queries.ts:1422` `debugRecentPapers`
  - `convex/extraction/queries.ts:1442` `getQuestionsInternal`
  - `convex/extraction/queries.ts:1454` `getPapersByOpenAlexIds`
  - `convex/extraction/queries.ts:1470` `getPaperInternal`
  - `convex/extraction/queries.ts:1477` `getEvidenceUnitsInternal`
  - `convex/extraction/queries.ts:1487` `getJobProgressInternal`
  - `convex/extraction/queries.ts:1517` `getPapersDebug`
  - `convex/extraction/queries.ts:1648` `getCurrentUserInternal`
  - `convex/extraction/queries.ts:424` `getPaperResultsInternal`
  - `convex/extraction/mutations.ts:2098` `saveExtractionResultsAndComplete` — **also missing `returns`**; handler returns `void`, should be `returns: v.null()`.
  - `convex/extraction/debug_job_citations.ts:82` `debugJobCitations`
  - `convex/extraction/debug_paper_results.ts:9` `debugPaperResults`
  - `convex/extraction/debug_errors.ts:9` `getFailedPapersDebug`
  - `convex/extraction/debug_papers.ts:9` `getPaperErrorsInternal`
  - `convex/extraction/debug_job_content.ts:11` `debugJobContent`
  - `convex/extraction/debug.ts:9` `diagnoseJob`
  - `convex/extraction/test_automation_internal.ts:10,71,95` `getFirstUserId`, `getJobStatus`, `getJobResults`
  - `convex/extraction/create_test_job.ts:9` `createTestJobForFix`
  - `convex/extraction/test_runner.ts:12,118` `createAndRunTestJob`, `getTestJobStatus`
  - `convex/extraction/testActions.ts:11` `createTestJob`
- **Fix:** Add `returns: v.null()` to all fire-and-forget internal mutations; use proper document validators (re-use `extractionJobValidator`, `extractionPaperValidator`, `extractionQuestionValidator` from `validators.ts`) for internal queries. The public-facing queries already do this correctly (30+ `returns:` entries in `queries.ts`).

### S3. Unbounded `.collect()` calls

- **Rule broken:** Guidelines §limits — *"Never `.collect()` unbounded; use `.take(MAX)` / `.paginate()` to cap memory."*
- **File:line — bounded by cardinality comments, acceptable:**
  - `queries.ts:149` (reviews per paper ~≤20), `queries.ts:225,241,361,416,431,507,528,596,707,1310,1377,1450` (questions per job ~≤20, job stats per job ~≤question count, saved views ~≤5, snapshots ~≤5, results per paper ~≤20)
  - `mutations.ts:59,75,80,311,599` (questions ≤20, results ≤20, reviews ≤20)
- **File:line — potentially unbounded, fix needed:**
  - `convex/extraction/debug.ts:48` — `extractionPapers` by job, no `.take()`
  - `convex/extraction/debug_job_citations.ts:91,98,148` — papers + results per job, no `.take()`
  - `convex/extraction/debug_paper_results.ts:18` — results for a paper, likely bounded but missing explicit cap
  - `convex/extraction/debug_job_content.ts:17` — papers by job, no `.take()`
  - `convex/extraction/test_automation_internal.ts:78,101` — papers for a job, no `.take()`
  - `convex/extraction/test_runner.ts:151,176` — same
  - `convex/extraction/test_helpers.ts:51,58,71` — papers/results/questions, no `.take()`
  - `convex/extraction/cascade-delete.test.ts` — 20+ collects but this is a test file; ignore.
  - `convex/extraction/job-stats.test.ts:105,314,332` — test file; ignore.
- **Fix:** Every non-test internal helper should use `.take(MAX_PAPERS_PER_JOB)` or `.take(MAX_EVIDENCE_UNITS_PER_PAPER)` consistent with the limits already imported from `convex/lib/queryBounds.ts`.

### S4. Redundant in-memory double-filter after partial-index query

- **File:line:**
  - `queries.ts:371` — index already constrains to `processable: true` (`by_job_processable`), then `papers.filter((p) => p.processable !== false)` is a no-op.
  - `queries.ts:584-585` paginated path uses the partial index correctly.
  - `mutations.ts:1000,1635` `queries.ts:948,1067,1224,1499,1641` all repeat the `processable !== false` JS filter without re-checking the index already applied.
- **Fix:** When querying via `by_job_processable`, the processable constraint is already enforced — drop the redundant `.filter`. When querying via plain `by_job`, keep the JS filter (schema allows `processable` to be undefined on legacy rows).

### S5. Multiple `ctx.runQuery` to the same document inside one action

- **File:line:**
  - `convex/extraction/workpoolActions.ts:715, 784, 877, 950` — `getJobInternal` is called 4× per paper inside `downloadAndIndexPdfAction` + `waitAndExtractAction`. Each is a separate network round-trip from the action runtime.
  - `workpoolActions.ts:793, 956` — `getPdfExtractionEnabledInternal` called once per action, but the flag cannot change during a single paper processing, so the second call is redundant.
- **Fix:** Load `{ job, pdfEnabled }` once at the top of each action via a single `ctx.runQuery(internal.extraction.queries.getJobAndFlagsInternal, { jobId })` that returns `{ job, pdfEnabled }`, then thread the values to helpers. The credit-guard re-reads (`freshJobForCredits`) are intentional and must stay.

### S6. Per-iteration scheduler-ping in delete cascade

- **File:line:** `convex/extraction/mutations.ts:1076, 1089, 1102, 1123, 1134, 1145, 1156, 1167, 1179, 1191`.
- **Observation:** Each batched delete step calls `ctx.scheduler.runAfter(0, … deleteExtractionInternal, { jobId })` before `return null;`. This is the documented self-reschedule pattern and is correct, but each invocation re-scans the previous five child tables to find the first non-empty bucket. For a job with 500 papers × 5 child-tables-per-paper, this is ~10 scheduler hops before the job is fully deleted. **Should-fix:** pass a `phase` argument (e.g. `"evidence"|"reviews"|"results"|"papers"|"questions"|"savedViews"|"snapshots"|"stats"|"runDiffs"|"baselineDiffs"|"job"`) so each re-run knows which step to resume, avoiding re-scanning earlier phases. This is a pure performance optimisation; correctness is preserved.

### S7. Inline mega-validators duplicated in ~8 places instead of re-using `validators.ts`

- **File:line:**
  - `mutations.ts:114-177` (`startExtraction`), `450-502` (`startExtractionFromTemplate`), `639-702` (`saveWorkflowTemplate`), `1330-1350` (`createPaperRecords`), `1786-1807` (`enqueuePaperProcessing`), `1852-1869` (`handleDownloadAndIndexComplete` context), `2100-2144` (`saveExtractionResultsAndComplete`).
  - `queries.ts:1322-1344` (`getWorkflowTemplates` returns), `276-299` (`getMyJobs` returns), plus several internal queries.
- **Observation:** The same source-selection and questions validators are rewritten inline. `validators.ts` already exports `extractionJobValidator`, `extractionQuestionValidator`, `citationValidator`, `searchFiltersValidator`, but there is **no** exported validator for `sourceHistoryEntries`, `sourceZoteroSelection`, `sourceManualItems`, or the question-input tuple. As a result these identical object shapes are duplicated verbatim 6-8 times.
- **Fix:** Add to `convex/extraction/validators.ts`:
  ```ts
  export const sourceHistoryEntriesValidator = v.array(v.object({ historyId: v.string(), searchFilters: searchFiltersValidator }));
  export const sourceZoteroSelectionValidator = v.object({ … });
  export const sourceManualItemsValidator = v.array(v.object({ … }));
  export const questionInputValidator = v.object({ key: v.string(), question: v.string(), type: questionTypeValidator, description: v.optional(v.string()) });
  ```
  Then reference from each site. Reduces drift risk; `schema.ts` can also import these.

---

## Pattern inconsistencies vs. `convex/library/`, `convex/screening/`, `convex/wallet/`

| Concern | `extraction/` | `screening/` | `library/` | `wallet/` |
|---|---|---|---|---|
| Public queries declare `returns` | ✓ (all) | ✓ | ✓ | ✓ |
| Internal queries declare `returns` | ✗ (20+ missing) | ✓ (mostly) | ✓ | ✓ |
| Splits into `mutations.ts` / `queries.ts` / `workflow.ts` / `workpoolActions.ts` | ✓ (+ 10 debug files) | ✓ (clean) | ✓ | ✓ |
| "use node" usage | 7 files, 4 unjustified | 1 file (`workpoolActions`), justified | 1 file (`backfill`), justified | 2 files, justified |
| Uses `filter` from `convex-helpers` | ✗ | ✗ | ✓ (`queries.ts:5`) | ✗ |
| Uses `resolveOwnedJob` / `assertJobOwnership` access helpers | ✓ | direct inline | direct inline | direct inline |
| Denormalized counters | `extractionJobStats` (per question) | `processedPapers/failedPapers/qualifiedPapers` on job | N/A | balance on doc |
| Debug-only internal queries checked into production | **10 debug files** in `extraction/` | 0 | 1 (`backfill.ts`) | 0 |
| Inline validator reuse | poor (S7) | good | good | good |

**Key inconsistency:** `extraction/` ships 10 debug files (`debug.ts`, `debug_errors.ts`, `debug_job_citations.ts`, `debug_job_content.ts`, `debug_paper_results.ts`, `debug_papers.ts`, `debug_pdfjs_alignment.ts`, `create_test_job.ts`, `testActions.ts`, `testWorkflow.ts`) registered as internal functions — none of the comparison modules do this. Per CLAUDE.md rule #3 (no legacy / no dead code) these should be moved to `scripts/` (for one-shot node scripts) or gated behind `CONVEX_ENV === "development"` checks. At minimum `testWorkflow.ts`, `testActions.ts`, and `create_test_job.ts` should be deleted — they have no test file references.

**Key inconsistency 2:** `extraction/queries.ts:73-80, 91-98` use a neat `resolveOwnedJob`/`resolveOwnedPaper` helper returning a tagged-union. This is **cleaner than** the duplicated `if (!job || job.userId !== user._id)` pattern in `screening/queries.ts:37-38` and `library/queries.ts`. Recommend **promoting** `resolveOwnedJob` into a generic `convex/lib/ownership.ts` and adopting it across screening/library/wallet.

---

## Modernization opportunities

### M1. Use `@convex-dev/workflow` for the paper loop

`runExtractionWorkflow` currently fetches all papers, then dumps them into a workpool via a per-paper `enqueuePaperProcessing` mutation (`workflow.ts:218-230`). This is correct, but the workflow step after enqueue simply sets status to `"extracting"` and returns — the workflow no longer awaits completion. The `finalizeJobIfDone` mutation (`mutations.ts:1619`) is called from workpool `onComplete` handlers. This is a valid pattern but **loses the workflow's durability guarantee** for the overall job lifecycle. Consider: keep the workflow running and let it `await step.runQuery(… getJobProgressInternal)` in a polling loop, or use `workflow.waitForCompletion`. The current fan-out-then-detach loses the "was the job ever started" ledger that `@convex-dev/workflow` is designed to provide.

### M2. Use `convex-helpers/server/filter` for defensible JS post-filtering

In places like `queries.ts:371, 711, 948, 1067, 1224, 1499, 1641` we post-filter index results with plain `.filter()`. The `convex-helpers` `filter` wrapper (already used in `library/queries.ts:5`) yields better streaming semantics and keeps the `ctx.db` fluent chain intact. Non-trivial, but unifies the style.

### M3. Use `@convex-dev/aggregate` for per-question counters

`extractionJobStats` is a hand-rolled per-question denormalized counter, maintained transactionally in `saveExtractionResultsAndComplete:2210` (upsert `patch` with read-then-write) and backfilled by `backfillJobStats`. The `@convex-dev/aggregate` component is purpose-built for this use case and is conflict-free under concurrent paper-completion. Current upserts are subject to OCC conflicts if two papers finish simultaneously. High-value swap.

### M4. Paginate insight queries

`getJobInsights` (line 613), `getQuestionInsights` (line 844), `getQuestionDisagreements` (line 1011), `getReviewQueue` (line 1132), `getJobResults` (line 481), `createExtractionReportSnapshot` (mutation, line 776), `createExtractionRunDiff` (line 970) all call `loadJobPapersAndResults(ctx, jobId)` or `loadJobDataForReporting`, which loads up to 500 papers + up to 20 results each in a single transaction. At the upper bound this is 10,500 docs in memory per query call. Use `paginate` with a continuation cursor or pre-aggregate into `extractionJobStats` (already half-done for the summary panel) and serve distributions from the counter table. This is the single largest performance lever.

### M5. Consolidate manual-items size bound

`schema.ts` allows `sourceManualItems` as an inline array on `extractionJobs`. There is no explicit limit in `startExtraction` (`mutations.ts:112`). UI may or may not cap the count. Either add `if (args.sourceManualItems?.length > MAX) throw …` in `startExtraction`, or move the items into a dedicated child table `extractionSourceManualItems` keyed by `jobId`, so that the job document does not bloat arbitrarily. The child table also enables pagination of large manual uploads.

### M6. Replace `v.any()` sentinel comment

`validators.ts:284` comment references a historical `paginationResultValidator(v.any())`. That has been properly fixed, but the comment should be removed (CLAUDE.md rule 3 — no legacy cruft).

---

## Positive observations

1. **Workpool `defineOnComplete` is used idiomatically** (`mutations.ts:1853, 1951, 2031`) with typed `context` validators — exemplary pattern.
2. **Multi-workpool separation** (`convex/workpool.ts:6, 17`): `pdfProcessingPool` (parallelism 3) vs `screeningPool` (parallelism 5) via named alias in `convex.config.ts`, avoiding cancel-all cross-contamination. Excellent.
3. **Cascade delete uses self-rescheduling batches** (`mutations.ts:1058`) with `BATCH_SIZE = 100` — correct approach for large jobs; respects Convex transaction size limits.
4. **Feature-flag gates** at every public mutation (`mutations.ts:180, 292, 457, 780` etc.) via `requireFeature(ctx, "extraction.enabled")` — robust defense-in-depth.
5. **Rate limiting** applied via `convex-helpers/server/rateLimit` token-bucket on `startExtraction` / `duplicateExtraction` / `startExtractionFromTemplate`.
6. **Strict typed validators** re-used for public return shapes (`extractionJobValidator`, `extractionPaperValidator`, `extractionResultWithReviewValidator`) — good baseline.
7. **`statusResultValidator` tagged-union return pattern** (`queries.ts:337`) gives the UI a clean `{status: "ok"|"unauthenticated"|"no_access"}` contract without throwing, which is superior to the `null`-only pattern in `screening/queries.ts:35`.
8. **Ownership helpers** `resolveOwnedJob` / `resolveOwnedPaper` (`queries.ts:69-101`) encapsulate access checks uniformly — worth promoting to `lib/`.
9. **Pre-aggregated `extractionJobStats`** with a backfill path (`mutations.ts:1234`) — correct denormalization choice for insights; only the backfill algorithm has the N+1 issue noted in B3.
10. **Empty `guard.ts`** (`extraction/guard.ts:1-4`) is a clean redirect comment pointing at the moved helper — low friction refactor done correctly.
11. **Credit-guard pattern** inside actions (`workpoolActions.ts:877-896, 973-988`) re-reads the job to detect mid-flight cancellation before deducting credits — thoughtful concurrency handling.

---

## Remediation priority

1. **Blocking:** B1 (auth subject), B2 (`.filter().neq`), B3 (N+1 backfill).
2. **High:** S1 (drop 4 unjustified "use node"), S2 (add `returns` to 20 internal queries), S3 (cap unbounded collects in debug files), S7 (centralize validators).
3. **Medium:** M3 (swap to `@convex-dev/aggregate`), M4 (paginate heavy insight queries), M5 (bound manual items), S5 (consolidate `ctx.runQuery` in actions).
4. **Low:** S4 (redundant double-filter), S6 (phase-param in cascade delete), M1 (workflow-level waitForCompletion), M2 (`convex-helpers/filter`), M6 (comment cleanup), delete `testWorkflow.ts` / `testActions.ts` / `create_test_job.ts`.
