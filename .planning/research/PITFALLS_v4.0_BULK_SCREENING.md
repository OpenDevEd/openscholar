# Domain Pitfalls: v4.0 Bulk Screening & Auto-Rating

**Domain:** Adding bulk background screening, user-defined scoring rules, and auto-rating to existing Convex-based academic search platform
**Researched:** 2026-03-08
**Confidence:** HIGH (based on direct codebase analysis + Convex platform documentation)

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or cost blowouts.

### Pitfall 1: Denormalized Counter Contention Under Bulk Writes

**What goes wrong:** The `saveToLibrary` mutation increments `user.libraryItemCount` via `ctx.db.patch`. When bulk screening auto-saves 200 papers to the library, each call reads the user document (to get `currentCount`), increments it, and patches. Convex uses OCC (Optimistic Concurrency Control) -- if two mutations read the same `libraryItemCount` simultaneously, one will be retried. With 200 concurrent saves, this causes a retry storm.

**Why it happens:** The existing `saveToLibrary` is designed for single-paper interactive use. Bulk operations hit the same user document from multiple concurrent mutations, creating write-write conflicts on `libraryItemCount`.

**Consequences:** Massive retry overhead. Potential OCC failures after max retries. Counter drift if retries are not handled correctly. Convex limits mutations to 16,000 document modifications per transaction, but the real issue is contention, not limits.

**Prevention:**
- Use the existing workpool pattern (`maxParallelism: 1` for library writes) to serialize library saves, eliminating OCC conflicts entirely.
- Alternatively, batch multiple library saves into a single mutation that inserts N items and increments the counter once by N.
- The collection `itemCount` denormalized counter has the same problem -- if all 200 papers go to one collection, the junction row inserts will also contend on `collection.itemCount`.

**Detection:** Watch for `MutationFailed` errors with OCC-related messages in Convex logs. Monitor mutation retry rates during bulk operations.

**Phase:** Must be addressed in Phase 1 (background job infrastructure), before any library save logic is built.

### Pitfall 2: Convex Action 10-Minute Timeout on Large Batches

**What goes wrong:** Each Convex action has a hard 10-minute timeout. Screening 200 papers with AI calls (even lightweight title+abstract screening) could exceed this if each call takes 3-5 seconds -- 200 * 4s = 800s = 13+ minutes. The action silently dies.

**Why it happens:** The existing extraction workflow already handles this by using the workpool pattern (enqueue individual paper processing as separate actions). But if bulk screening is naively implemented as a single action that loops through all 200 papers, it will timeout.

**Consequences:** Job appears to hang. No results saved for any paper (all-or-nothing failure). Credits may be deducted without results if deduction happens before processing.

**Prevention:**
- Follow the existing `runExtractionWorkflow` pattern: use a workflow to enqueue individual paper screening into the workpool, one paper per action.
- Each individual screening action (title+abstract only, no PDF) should complete in well under 10 minutes.
- The workpool's `maxParallelism: 3` already limits concurrency to avoid overwhelming AI providers.

**Detection:** Actions that approach 9+ minutes in Convex dashboard. Jobs stuck in "processing" status indefinitely.

**Phase:** Phase 1 -- job architecture must use per-paper workpool actions from the start.

### Pitfall 3: Credit Pre-Check Race Condition (TOCTOU)

**What goes wrong:** User has 50 credits. Bulk screening 200 papers costs ~100 credits. The job starts, deducting per-paper. After 50 papers, credits run out. Remaining 150 papers fail. User sees partial results with full "200 papers" expectation.

**Why it happens:** Credits are deducted per-paper in the existing extraction pattern (`withUserCreditsBatch` in `workpoolActions.ts`). There is no upfront reservation. The PROJECT.md documents this as a known pattern: "TOCTOU mitigation = per-user workpool -- Pending (documented, not yet needed)".

**Consequences:** Confusing UX. User paid for 50 papers but expected 200. No clear signal that credits were exhausted mid-job. The remaining papers are neither screened nor billed, but the job may show as "completed" or "failed" ambiguously.

**Prevention:**
- Pre-check credits at job creation: `estimatedCost = paperCount * creditPerScreening`. Reject the job if `userCredits < estimatedCost`.
- Do NOT pre-deduct the full amount (too complex to refund on partial failure). Instead, pre-check and warn, then deduct per-paper with a credit-exhaustion handler that gracefully stops the job and reports partial results.
- Add a `creditsExhausted` status to the job model, distinct from `completed` and `failed`.

**Detection:** Papers with status `failed` due to insufficient credits within a job that was expected to succeed.

**Phase:** Phase 1 (job creation) for pre-check, Phase 2 (processing logic) for exhaustion handling.

### Pitfall 4: Screening Data Isolation Between Per-Page and Bulk

**What goes wrong:** The existing per-page screening stores results in Zustand/client state (`ScreeningResponses = Record<paperId, Record<question, boolean | null>>`). Bulk screening stores results server-side in Convex. A user screens papers per-page, then runs bulk screening on the same papers. The two result sets conflict -- which is authoritative? Does bulk overwrite manual screening? Does the UI show stale client-side results?

**Why it happens:** The existing system was designed for client-side-only screening. The Zustand store (`useTransientScreeningStore`) holds transient screening responses. Bulk screening introduces a persistent server-side store. Two sources of truth emerge.

**Consequences:** User manually screens a paper as "include" (boolean: true). Bulk screening later rates it as "exclude" (false). The UI flickers between the two values depending on which data source is read. Trust in the tool erodes.

**Prevention:**
- Establish clear precedence: manual (per-page) screening always overrides bulk screening for the same paper+question pair.
- When running bulk screening, skip papers that already have manual screening responses for all questions.
- Store bulk screening results in a new Convex table (`screeningResults` or similar), separate from the client-side transient store.
- On the client, merge: manual results take priority, bulk results fill gaps.

**Detection:** Users report contradictory screening results. Paper shows different ratings in different views.

**Phase:** Phase 2 (scoring/rating logic) -- must define data model before building processing.

## Moderate Pitfalls

### Pitfall 5: Scoring Rule Edge Cases with Null/Inconclusive AI Responses

**What goes wrong:** User defines scoring rules: "Is this a randomized controlled trial? Yes = +5, No = -3". The AI returns `null` (inconclusive). The scoring system does not handle `null`. Paper gets 0 points by default, which may place it in an incorrect rating bracket (e.g., 3 stars instead of "unscored").

**Why it happens:** The existing screening response type is `boolean | null`. The scoring rules likely only account for `true`/`false`. The `null` case is the most common AI response for papers with insufficient abstracts.

**Prevention:**
- Explicitly handle `null` in scoring: allow users to configure a "null score" per question (default: 0, but configurable to e.g., -1 for conservative screening).
- Add an "unscored" state for papers where too many questions returned `null` (e.g., >50% null responses = "needs manual review" instead of auto-rating).
- Display null-response count alongside the score to signal confidence.

**Phase:** Phase 2 (scoring rules).

### Pitfall 6: Auto-Rating Star Threshold Ambiguity

**What goes wrong:** User defines: "0-3 points = 1 star, 4-6 = 2 stars, 7-10 = 3 stars". A paper scores exactly 4. But what about negative scores? Papers with all "No" answers score -9 (3 questions * -3 each). The threshold table has no entry for negative scores. The system either crashes, assigns 0 stars (not in the 0-5 range), or silently clips to 1 star.

**Why it happens:** The existing `saveToLibrary` accepts `rating: v.number()` with no validation on range. The UI likely renders 0-5 stars. If the scoring system produces a rating outside this range, the behavior is undefined.

**Prevention:**
- Validate rating thresholds at configuration time: all possible score ranges must be covered (including negative scores and scores above max).
- Clamp the final star rating to 0-5 with a clear warning when clamping occurs.
- Add a "score floor" that maps any score below the minimum threshold to 0 stars.
- Test edge cases: all-null responses, all-no responses, single-question screening, maximum possible score.

**Phase:** Phase 2 (scoring configuration validation).

### Pitfall 7: Workpool Parallelism Competition with Extraction Jobs

**What goes wrong:** The existing `pdfProcessingPool` has `maxParallelism: 3`. If bulk screening reuses this pool (or creates a competing pool), screening and extraction jobs compete for the same 3 slots. A user running both simultaneously sees both jobs crawl.

**Why it happens:** The comment in `workpool.ts` says "Reduced to 3 to prevent database conflicts with onComplete handlers." Creating a separate screening pool adds overhead but avoids competition.

**Consequences:** On Convex Pro, total parallelism across all workflows/workpools should not exceed 100. On free tier, should not exceed 20. Adding a second workpool is safe but adds scheduling overhead.

**Prevention:**
- Create a separate `screeningPool` with its own `maxParallelism` setting (e.g., 5, since screening is title+abstract only -- much lighter than PDF extraction).
- Keep the pools independent so extraction and screening can run simultaneously without starving each other.
- Document the total parallelism budget across all pools.

**Phase:** Phase 1 (job infrastructure).

### Pitfall 8: Collection Auto-Add Creating Duplicate Junction Rows

**What goes wrong:** Bulk screening auto-adds papers to a collection. If the paper is already in the collection (from a previous screening run or manual add), the junction table gets a duplicate row. The collection count inflates. Deleting the paper from the collection only removes one row, leaving an orphan.

**Why it happens:** The existing `addToCollection` mutation in `collections.ts` does not check for existing junction rows before inserting (based on the collection CRUD pattern observed). The `libraryItemCollections` junction table uses `by_item` and `by_collection` indexes but has no unique constraint on the (item, collection) pair.

**Prevention:**
- Before inserting a junction row, query `libraryItemCollections` with both `libraryItemId` and `collectionId` to check for duplicates. Convex does not have unique compound constraints, so this must be done in application logic.
- Use a helper function like `ensureCollectionMembership(ctx, itemId, collectionId)` that is idempotent.

**Phase:** Phase 3 (collection assignment).

### Pitfall 9: Scheduler Limit Exhaustion on Large Batches

**What goes wrong:** A single mutation can schedule at most 1,000 functions. If the workflow mutation tries to enqueue 200 papers * N steps per paper, it can hit the 1,000 limit. The existing extraction workflow already enqueues per-paper processing in a loop within a single workflow step.

**Why it happens:** Convex limits a single mutation to scheduling 1,000 functions. The workpool's `enqueueAction` internally uses `ctx.scheduler.runAfter`, counting against this limit.

**Prevention:**
- For 200 papers, this is likely fine (200 enqueue calls << 1,000 limit).
- But if batch size grows or multiple steps per paper are scheduled from the same mutation, batch the enqueue calls across multiple mutations using `scheduler.runAfter(0, batchEnqueueMutation, { papers: nextBatch })`.

**Phase:** Phase 1, but only a concern if batch sizes exceed 200.

### Pitfall 10: Missing Job Cancellation Support

**What goes wrong:** User starts bulk screening of 200 papers, realizes they configured the wrong questions. No way to cancel. All 200 papers are screened and billed. User must manually undo ratings.

**Why it happens:** The existing extraction system has `cancelExtraction` with credit-guard protection (`workpoolActions.ts` checks `freshJobForCredits?.status === "cancelled"` before deducting). Bulk screening needs the same pattern.

**Prevention:**
- Implement cancellation from day one, reusing the existing credit-guard pattern: each workpool action checks job status before AI call and before credit deduction.
- Accept the documented 0-2 paper race window where a paper might still be processed after cancellation.

**Phase:** Phase 1 (job lifecycle).

## Minor Pitfalls

### Pitfall 11: Inconsistent Screening Question Key Encoding

**What goes wrong:** The existing per-page screening uses raw question text as the key in `ScreeningResponses`. Bulk screening might use a different key format (e.g., `question_0`, `question_1`, or a hash). Results cannot be merged because keys do not match.

**Prevention:** Use the existing `encodeQuestionResponseMap` from `lib/ai/core/question-key-codec` as the single source of truth for question key encoding. Ensure both per-page and bulk screening use the same codec.

**Phase:** Phase 2.

### Pitfall 12: AI Provider Rate Limits on 200 Concurrent Requests

**What goes wrong:** Even with workpool throttling, if the screening pool processes 5 papers in parallel, each making an AI call, the provider (OpenAI, Anthropic) may rate-limit the requests. The action fails with a 429 error.

**Prevention:** The workpool's retry behavior (`maxAttempts: 3, initialBackoffMs: 2000, base: 2`) already handles transient 429s with exponential backoff. Ensure the screening workpool has the same retry configuration. For sustained rate limiting, reduce `maxParallelism`.

**Phase:** Phase 1 (workpool configuration).

### Pitfall 13: Cost Estimation Accuracy for "Screen All" Dialog

**What goes wrong:** The "Screen All" dialog shows estimated credit cost. But screening cost depends on abstract length (token count), which varies widely. A flat per-paper estimate may be 2-3x off, surprising users.

**Prevention:**
- Use a conservative per-paper estimate based on average abstract length + question count.
- Show as "estimated ~X credits" with a clear disclaimer.
- The existing `calculateServerCreditsToDeduct` uses actual token usage, so billing is accurate -- only the preview is estimated.

**Phase:** Phase 1 (configuration dialog).

### Pitfall 14: Bulk Results Not Triggering Reactive UI Updates

**What goes wrong:** Bulk screening runs in background. Results are written to Convex. But the search results page uses client-side Zustand state for screening responses. The UI does not update until the user navigates away and back.

**Prevention:** Use Convex `useQuery` subscriptions for bulk screening results. When results are written server-side, Convex's reactive queries automatically push updates to subscribed clients. The Zustand store should be treated as a cache that defers to server state.

**Phase:** Phase 3 (UI integration).

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Job infrastructure | Counter contention (Pitfall 1) | Serialize library writes via workpool or batch mutation |
| Job infrastructure | Action timeout (Pitfall 2) | Per-paper workpool actions, not single-action loop |
| Job infrastructure | Missing cancellation (Pitfall 10) | Credit-guard pattern from extraction, implement from day one |
| Job infrastructure | Pool competition (Pitfall 7) | Separate `screeningPool` from `pdfProcessingPool` |
| Scoring & rating | Null handling (Pitfall 5) | Explicit null-score config, "needs review" state |
| Scoring & rating | Threshold gaps (Pitfall 6) | Validate coverage at config time, clamp output to 0-5 |
| Scoring & rating | Data isolation (Pitfall 4) | Server-side results table, manual > bulk precedence |
| Collection assignment | Duplicate junctions (Pitfall 8) | Idempotent `ensureCollectionMembership` helper |
| UI integration | Stale client state (Pitfall 14) | Convex reactive queries for bulk results |
| Cost control | Credit TOCTOU (Pitfall 3) | Pre-check at job creation, graceful exhaustion handling |

## Sources

- Convex Limits: [https://docs.convex.dev/production/state/limits](https://docs.convex.dev/production/state/limits)
- Convex Workpool: [https://github.com/get-convex/workpool](https://github.com/get-convex/workpool)
- Convex Workflow: [https://www.convex.dev/components/workflow](https://www.convex.dev/components/workflow)
- Convex Background Job Management: [https://stack.convex.dev/background-job-management](https://stack.convex.dev/background-job-management)
- Convex Scheduled Functions: [https://docs.convex.dev/scheduling/scheduled-functions](https://docs.convex.dev/scheduling/scheduled-functions)
- Codebase: `convex/workpool.ts` (parallelism config), `convex/extraction/workflow.ts` (existing job pattern), `convex/extraction/workpoolActions.ts` (credit-guard pattern), `convex/library/mutations.ts` (denormalized counter), `convex/lib/queryBounds.ts` (MAX constants), `lib/types/screening.types.ts` (existing screening types), `lib/ai/core/batch.ts` (batch processor factory)
