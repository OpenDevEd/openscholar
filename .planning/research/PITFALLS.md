# Domain Pitfalls

**Domain:** Production readiness fixes for Convex app (public-to-internal conversion, aggregate counting, .collect() audit)
**Researched:** 2026-03-06

## Critical Pitfalls

Mistakes that cause rewrites, security regressions, or production incidents.

### Pitfall 1: Generated API Paths Break When Functions Change Visibility

**What goes wrong:** Converting `query` to `internalQuery` changes the function's generated API path. A function at `api.extraction.debug.diagnoseJob` moves to `internal.extraction.debug.diagnoseJob`. Any code still referencing the `api.*` path gets a TypeScript error at best, or a runtime "function not found" error if using string-based calls.

**Why it happens:** Convex code-generates two separate API trees: `api` (public) and `internal` (private). The function identifier changes namespace, not just access level.

**Consequences:** TypeScript catches most references at compile time (`tsc --noEmit`), but these sources can slip through:
- String-based references in test inventory files (the `DEBUG_GATED_FILES` array in `tests/debug-gate.test.ts` reads file contents but does not call via `api.*`, so it is safe)
- Dashboard bookmarks or Convex CLI scripts that use `npx convex run api.extraction.debug.diagnoseJob`
- Any `ctx.scheduler.runAfter` or `ctx.runQuery` calls using the old `api.*` path

**Prevention:**
1. After converting, run `tsc --noEmit` -- it will flag every broken `api.*` reference.
2. Search the entire codebase for the old function name string (not just import paths): `grep -r "debug.diagnoseJob" .` to catch string references.
3. The three files that are currently public and need conversion are: `convex/extraction/debug.ts` (`diagnoseJob` -- public query), `convex/extraction/debug_errors.ts` (`getFailedPapersDebug` -- public query), `convex/extraction/testActions.ts` (`createTestJob` -- public mutation), and `convex/extraction/create_test_job.ts` (`createTestJobForFix` -- public mutation). Verify zero client-side references exist (confirmed: no `app/` or `components/` files reference these).

**Detection:** `tsc --noEmit` failure, `verify-no-any.sh` includes tsc check.

**Confidence:** HIGH -- verified against actual codebase; 4 public functions need conversion, 9 are already internal.

---

### Pitfall 2: Removing requirePublicDebugEnabled Gate From Internal Functions

**What goes wrong:** After converting functions to `internalQuery`/`internalMutation`, developers remove the `requirePublicDebugEnabled()` call reasoning "it's internal now, the gate is unnecessary." This breaks the existing `debug-gate.test.ts` inventory test which asserts ALL debug files import `requirePublicDebugEnabled`.

**Why it happens:** The gate serves two purposes: (1) access control (redundant once internal), and (2) audit logging with `[AUDIT:DEBUG_ACCESS]` structured log. Removing the gate eliminates the audit trail.

**Consequences:**
- `tests/debug-gate.test.ts` "debug gate inventory" test fails because it checks that every file in `DEBUG_GATED_FILES` imports `requirePublicDebugEnabled`.
- Loss of audit logging for debug function invocations.
- If the function is later accidentally changed back to public, there is no safety net.

**Prevention:**
- Keep `requirePublicDebugEnabled()` in all debug/test functions even after internal conversion. The gate provides defense-in-depth and audit logging. Several files already follow this pattern (`debug_papers.ts`, `test_runner.ts`, `test_automation.ts` are internal but still use the gate).
- Update the test inventory array if files are deleted, but do not remove the gate.

**Detection:** `tests/debug-gate.test.ts` will fail immediately.

**Confidence:** HIGH -- verified: the test explicitly reads each file and checks for the import.

---

### Pitfall 3: Aggregate Component Introduces Schema Migration and Component Registration

**What goes wrong:** Adopting `@convex-dev/aggregate` for the `getLibraryCount` fix requires registering it in `convex.config.ts` as a Convex component, adding component tables to the schema, and running an initial backfill. This is a multi-step deployment that can break if partially applied.

**Why it happens:** Convex components are not simple npm packages -- they add their own tables and require explicit registration. The aggregate component uses a B-tree structure that must be populated before queries return correct results.

**Consequences:**
- Deploying the schema change without the backfill returns count of 0 for all users.
- The aggregate must be updated on every `libraryItems` insert/delete mutation, adding coupling.
- If the backfill is interrupted, counts are silently wrong with no error.

**Prevention:**
- **Prefer the simpler approach first:** A denormalized counter on the user record (increment on insert, decrement on delete) avoids the component dependency entirely. The project already decided against `@convex-dev/aggregate` in v3.0 for `extractionJobStats` (see MILESTONES.md: "Component adds a dependency and complexity; simple upsert table is sufficient").
- If using a counter: wrap increment/decrement in the existing `addToLibrary` and `removeFromLibrary` mutations. Use a separate `libraryUserStats` table or add a field to `credits`/`users`.
- If using `@convex-dev/aggregate`: register in `convex.config.ts`, deploy schema first, run backfill action, verify counts match before switching queries.

**Detection:** Compare aggregate count against `.take(10_000).length` result during backfill verification.

**Confidence:** HIGH -- official Convex docs confirm component registration requirement; project already rejected this approach once.

---

### Pitfall 4: Unbounded .collect() Audit Misses Index-Scoped Calls That Are Actually Safe

**What goes wrong:** An overzealous audit adds `.take(N)` bounds to every `.collect()` call, including ones that are inherently bounded by narrow index equality filters (e.g., "all questions for a job" where a job has 3-15 questions, or "all collection memberships for a user's collection").

**Why it happens:** The audit sees 125 `.collect()` calls across 27 files and applies a blanket rule. But many of these are scoped by indexes like `by_job`, `by_paper`, `by_collection`, `by_user` where the result set is inherently small.

**Consequences:**
- `.take(N)` silently truncates results. If N is too small, data is lost without error.
- Adding `.take(500)` to a query that loads all extraction results for a paper (typically 5-15 results) adds misleading code that implies the result could be larger.
- Worse: adding `.take(N)` to mutation cleanup paths (like cascade delete) causes orphaned data -- some child records are deleted but not all.

**Prevention:**
- Categorize each `.collect()` call into three buckets:
  1. **Inherently bounded** (scoped by narrow index, known small cardinality): leave as-is, add a comment explaining the bound. Examples: `extractionResults.by_paper` (max ~15), `extractionQuestions.by_job` (max ~15), `zoteroConnections.by_user` (max 1-3).
  2. **User-proportional** (grows with user activity): add `.take(N)` with a generous bound. Examples: `libraryItems.by_user`, `libraryItemCollections.by_collection`.
  3. **Unbounded** (could grow with table size): must paginate or use an aggregate. Example: the former `getLibraryCount` pattern.
- Document the rationale for each decision.

**Detection:** Code review; no automated detection for "is this .collect() safe?" -- requires understanding the data model cardinality.

**Confidence:** HIGH -- verified by examining actual `.collect()` calls in the codebase. The project already made this mistake once (bounding OAuth token cleanup `.collect()` was unnecessary since table has 0-5 rows, and the decision was documented).

## Moderate Pitfalls

### Pitfall 5: Convex Auto-Generated API Object Becomes Stale After File Renames

**What goes wrong:** After converting `convex/extraction/debug.ts` functions from `query` to `internalQuery`, the generated `_generated/api.ts` still exports the old path until `npx convex dev` or `npx convex deploy` regenerates it. Tests and type-checks against the stale generated file pass locally but fail on deploy.

**Prevention:** Always run `npx convex dev` (which regenerates `_generated/`) after changing function visibility. Do not commit without verifying the generated types match. In CI, `npx convex deploy` handles this automatically.

---

### Pitfall 6: Counter Increment/Decrement Race Condition

**What goes wrong:** A denormalized counter for library count can become inconsistent if two mutations (e.g., simultaneous bulk import and single delete) race. Convex mutations are serialized per-document, but if the counter is on a different document than the library item, the counter read-modify-write can conflict.

**Why it happens:** Convex uses optimistic concurrency control (OCC). Two mutations reading the same counter document, modifying it, and writing back will cause one to retry. This is correct behavior but can cause unexpected retry loops under high write load.

**Prevention:**
- Convex OCC handles this correctly -- the retrying mutation will re-read the current count and re-apply. No manual locking needed.
- For bulk operations (like Zotero sync importing many items), batch the counter update: increment by N in a single mutation rather than N separate mutations.
- The project already validated OCC behavior for credit deductions (see PROJECT.md: "Credit deduction OCC concurrency validated").

**Detection:** Convex logs show retry counts. If retries spike during bulk imports, batching is needed.

**Confidence:** MEDIUM -- Convex OCC is well-documented, but the specific counter pattern has not been implemented in this codebase yet.

---

### Pitfall 7: Debug Functions With Auth Checks Become Unreachable When Internal

**What goes wrong:** Several debug functions call `requireAuth(ctx)` which checks `ctx.auth.getUserIdentity()`. Internal functions called via `ctx.runQuery` from actions do NOT have auth context unless the action explicitly passes it. If these internal functions are called from other server-side code (crons, other internal functions), `requireAuth` throws "Authentication required."

**Why it happens:** `ctx.auth` is populated by the client's auth token. When a function is called server-side via `ctx.runQuery(internal.extraction.debug.diagnoseJob, ...)`, there is no client auth context.

**Consequences:** The debug functions become unusable from the Convex dashboard "Run function" feature or from other internal functions, which defeats the purpose of having diagnostic tools.

**Prevention:**
- For functions that are ONLY for developer diagnosis (all debug functions), remove `requireAuth(ctx)` when converting to internal. Internal functions are inherently trusted -- only your own Convex code can call them.
- For functions that need user-scoping, accept `userId` as an explicit argument instead of deriving it from auth context.
- The files affected are: `debug.ts` (has `requireAuth`), `debug_errors.ts` (has `requireAuth`), `testActions.ts` (has `requireAuth`). Files like `debug_papers.ts` and `debug_job_content.ts` are already internal and do NOT use `requireAuth`.

**Detection:** Attempting to call the function from the Convex dashboard or via `npx convex run` will throw.

**Confidence:** HIGH -- verified by reading each debug file; `requireAuth` depends on client auth token which internal callers lack.

---

### Pitfall 8: .take(10_000).length Returns Incorrect Count for Large Libraries

**What goes wrong:** The current `getLibraryCount` uses `.take(10_000)` which caps at 10,000. Users with more than 10,000 library items get an incorrect count. The replacement must handle the "count exceeds reasonable bound" case explicitly.

**Why it happens:** `.take(N)` is a band-aid. Any fixed N has a cliff where the count becomes wrong.

**Prevention:**
- A denormalized counter has no upper bound -- it is always accurate.
- If keeping `.take(N)` temporarily, display "10,000+" in the UI when count equals the cap. The current client code (`library-page-client.tsx` line 67) uses the raw number for a badge -- it does not handle the cap case.
- The aggregate component also has no upper bound but adds dependency complexity.

**Detection:** `getLibraryCount` test should include a "count at cap" test case.

**Confidence:** HIGH -- verified current implementation and client usage.

## Minor Pitfalls

### Pitfall 9: Test File Inventory Needs Manual Update

**What goes wrong:** The `debug gate inventory` test in `tests/debug-gate.test.ts` maintains a hardcoded `DEBUG_GATED_FILES` array listing all 12 debug/test files. If a file is renamed or deleted during the conversion, the test fails with a file-not-found error (it uses `readFileSync`).

**Prevention:** Update the `DEBUG_GATED_FILES` array whenever renaming or deleting debug files. Consider whether this inventory test should be updated to also verify that converted files use `internalQuery`/`internalMutation` instead of `query`/`mutation`.

---

### Pitfall 10: Removing the ENABLE_PUBLIC_DEBUG_FUNCTIONS Env Var Too Early

**What goes wrong:** After all functions are internal, someone removes the env var from the Convex dashboard thinking it is unused. But the `requirePublicDebugEnabled()` gate still checks it. All debug functions start throwing FORBIDDEN even when called internally.

**Prevention:** Either (a) keep the env var set to "true" in staging after conversion, or (b) if removing the gate entirely, do it in a single atomic change that also updates the test inventory.

---

### Pitfall 11: Search Index .collect() Cannot Use .take()

**What goes wrong:** The `queryLibraryItems` helper in `convex/library/queries.ts` (line 187) uses `.withSearchIndex().collect()`. Convex search index queries do not support `.take()` -- they return up to 256 results by default (the Convex search limit). Attempting to add `.take(N)` to a search index query may be a no-op or error.

**Prevention:** Do not attempt to bound search index `.collect()` calls -- they are already bounded by Convex's built-in search result limit (256). Document this in the audit as "inherently bounded by search index limit."

**Confidence:** HIGH -- Convex search index behavior is documented.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Debug endpoint conversion | Pitfall 1 (API path break), Pitfall 2 (gate removal), Pitfall 7 (auth in internal) | Convert import, keep gate, remove requireAuth, update test inventory, run tsc |
| Library count replacement | Pitfall 3 (aggregate complexity), Pitfall 8 (cap at 10k), Pitfall 6 (counter race) | Use denormalized counter, not aggregate component. Increment/decrement in existing mutations. |
| .collect() audit | Pitfall 4 (over-bounding safe calls), Pitfall 11 (search index) | Categorize by cardinality. Leave inherently-bounded calls alone. Skip search index calls. |
| All phases | Pitfall 5 (stale generated API), Pitfall 9 (test inventory) | Regenerate with `npx convex dev`, update test arrays |

## Sources

- [Convex Internal Functions](https://docs.convex.dev/functions/internal-functions) -- official docs on internalQuery/internalMutation/internalAction, confirms namespace change from `api` to `internal`
- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/) -- .collect() guidance, counting patterns, security recommendations
- [Convex Aggregate Component](https://www.convex.dev/components/aggregate) -- B-tree based counting, requires component registration
- [Efficient COUNT, SUM, MAX with the Aggregate Component](https://stack.convex.dev/efficient-count-sum-max-with-the-aggregate-component) -- implementation guide for aggregate-based counting
- Codebase inspection: `convex/extraction/debug*.ts`, `convex/extraction/test*.ts`, `convex/lib/debug_gate.ts`, `convex/library/queries.ts`, `tests/debug-gate.test.ts`, `components/library/library-page-client.tsx`

---

*Pitfalls research: 2026-03-06*
