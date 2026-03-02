# Domain Pitfalls: Codebase Hardening Sweep

**Domain:** Hardening an existing Convex + Next.js production system
**Milestone:** v2.3 Codebase Hardening
**Researched:** 2026-03-02

---

## Critical Pitfalls

Mistakes that cause production breakage, data loss, or security regressions.

---

### Pitfall 1: Type Safety Sweep Breaks Runtime Behavior

**What goes wrong:** Replacing `ctx: any` with `MutationCtx`/`QueryCtx` causes compile-time errors that developers "fix" by changing the code logic rather than just the types. The existing runtime behavior worked; the types were wrong, not the logic. Changing logic to satisfy the type checker introduces regressions in code paths that were passing all tests.

**Why it happens:** When you add proper types to `(q: any) => q.eq("jobId", jobId)`, the compiler may reveal that an index name is wrong or a field name is misspelled. The temptation is to "fix" the index/field name to match the type, but the runtime was already working because Convex uses string-based index resolution. The misspelled name may actually be correct in the database, just not matching the TypeScript type.

**Consequences:**
- Queries silently return empty results (wrong index name after "fixing")
- Mutations write to wrong fields (renamed to satisfy types)
- Tests pass locally because they mock the DB layer, but production breaks

**Prevention:**
- Run `npx convex dev` to regenerate types BEFORE making any type changes. Convex codegen creates the proper `MutationCtx`, `QueryCtx`, and typed index callbacks in `convex/_generated/server.d.ts`. Use these generated types, not hand-crafted ones.
- Golden rule: if changing a type requires changing a query/mutation body, stop and verify the runtime behavior first. The type is documentation of what exists, not prescription for what should exist.
- Run the full test suite after every file's type sweep, not just at the end.

**Detection:** Any diff that changes both a type annotation AND a query/index/field name in the same commit is suspect.

**Confidence:** HIGH -- based on [Convex TypeScript best practices](https://docs.convex.dev/understanding/best-practices/typescript) and [Convex server module types](https://docs.convex.dev/api/modules/server).

---

### Pitfall 2: `internal as any` Removal Triggers Convex Codegen Mismatch

**What goes wrong:** The codebase uses `const internalApi = internal as any` in 7+ files (`convex/http.ts`, `convex/crons.ts`, `convex/credits/internal.ts`, etc.). Removing the `as any` cast reveals that the generated `internal` API types do not include some functions that are actually registered. Developers then "fix" this by renaming functions, reorganizing exports, or changing the module structure -- which breaks all existing function references and scheduled jobs.

**Why it happens:** Convex's type generation (`convex/_generated/api.d.ts`) requires `npx convex dev` to regenerate whenever functions are added/moved/renamed. If the generated types are stale, `internal.module.function` shows type errors even though the function exists at runtime. The `as any` cast was a workaround for stale codegen, not necessarily for missing functions.

**Consequences:**
- Scheduled jobs (crons, `ctx.scheduler.runAfter`) reference function paths that no longer exist after reorganization
- Webhook handlers call internal functions by path; renaming breaks live webhook processing
- The recursive delete cascade (`deleteExtractionInternal`) calls itself via `internal.extraction.mutations.deleteExtractionInternal` -- renaming this function without updating the self-reference creates infinite loops or silent failures

**Prevention:**
1. Run `npx convex dev` FIRST to regenerate types and see what the actual type errors are
2. If `internal.module.function` already compiles after codegen, the `as any` removal is a one-line change -- do not restructure anything
3. If functions are genuinely missing from codegen, check that they are properly exported from their module's `index.ts` before reorganizing
4. Never rename internal functions that are referenced by `ctx.scheduler.runAfter` or `ctx.runMutation(internal....)` without grep-searching all call sites

**Detection:** Any PR that removes `as any` and also moves/renames functions or changes `index.ts` exports needs extra scrutiny.

**Confidence:** HIGH -- directly verified in the codebase: `convex/http.ts:10`, `convex/subscriptions/actions.ts:36`, `convex/crons.ts:5`.

---

### Pitfall 3: Deletion Cascade Fix Causes Data Loss Through Ordering Errors

**What goes wrong:** The current `deleteExtractionInternal` cascade (lines 968-1009 of mutations.ts) deletes in order: results -> papers -> questions -> job. Adding `extractionEvidenceUnits` cleanup seems straightforward, but inserting it in the wrong position or with wrong batching causes:
- Evidence units deleted but papers kept (partial cleanup on error)
- Papers deleted before their evidence units (orphaning evidence permanently -- no `paperId` to query by)
- Reviews (`extractionResultReviews`) skipped entirely (already missing from cascade)

**Why it happens:** The cascade uses recursive self-invocation via `ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, { jobId })`. Each invocation re-queries from the top, checking results first, then papers, then questions. If you add evidence units after results but before papers, the cascade may re-enter and skip evidence units on the second pass because the control flow falls through to the paper deletion step.

**Consequences:**
- Orphaned `extractionEvidenceUnits` rows accumulate (each paper can have hundreds of evidence chunks)
- Orphaned `extractionResultReviews` rows accumulate (one per result per paper)
- Storage IDs (`storageId` on papers) not cleaned up, leaving orphaned files in Convex storage
- If deletion partially completes and fails, there is no way to resume -- the job may be deleted but child records remain

**Prevention:**
- Delete in strict dependency order: evidence units -> reviews -> results -> papers (with storage cleanup) -> questions -> saved views -> report snapshots -> run diffs -> job
- Each entity type should be a discrete step in the cascade with its own batch-and-reschedule logic
- Add a `deletionStatus` field to `extractionJobs` that tracks which step the cascade is on, so it can resume after failures
- Write a test that creates a full job graph (job + questions + papers + results + reviews + evidence units + storage) and verifies ALL child records are gone after deletion

**Detection:** After deletion, query each child table by `jobId`/`paperId` to verify zero rows remain.

**Confidence:** HIGH -- directly verified by reading `convex/extraction/mutations.ts:968-1009` and `convex/schema.ts`.

---

### Pitfall 4: Zotero API Key Encryption Migration Corrupts Existing Connections

**What goes wrong:** Migrating Zotero API keys from plaintext (`apiKey: v.string()`) to encrypted format (matching the `apiKeys` table pattern with `encryptedKey`) requires reading existing plaintext keys, encrypting them, and writing back. If the encryption runs in a Convex mutation (which cannot use Node.js `crypto`), it fails silently. If it runs in an action, the action cannot directly write to the DB -- it must call a mutation, creating a two-step process where the plaintext key is read, encrypted, and then the encrypted version is written. A failure between read and write leaves the key in an inconsistent state.

**Why it happens:** Convex separates mutations (DB access, no Node.js APIs) from actions (Node.js APIs like `crypto`, no direct DB access). Encryption requires `"use node"` actions. The existing `apiKeys/actions.ts` already has this pattern, but applying it to migration of existing data adds complexity: you must handle rows that are already encrypted (re-migration safety) and rows that are still plaintext (original format).

**Consequences:**
- Users lose Zotero connections if the migration corrupts their API key
- If `ENCRYPTION_KEY` env var is missing during migration, all keys become unrecoverable
- Schema change from `apiKey: v.string()` to `encryptedKey: v.string()` requires a multi-step migration (add optional `encryptedKey`, migrate data, remove `apiKey`) -- doing this in one step breaks the deployment

**Prevention:**
1. Follow the [Convex multi-step migration pattern](https://stack.convex.dev/intro-to-migrations): add `encryptedKey: v.optional(v.string())` first, then migrate, then make `encryptedKey` required, then remove `apiKey`
2. During migration, keep both fields: code reads `encryptedKey` if present, falls back to `apiKey` (dual-read pattern)
3. The migration action must be idempotent: skip rows where `encryptedKey` is already set
4. Validate `ENCRYPTION_KEY` exists before starting migration; abort entirely if missing
5. Test with a staging Convex deployment first, not production

**Detection:** After migration, verify every `zoteroConnections` row has a non-null `encryptedKey` and the decrypted value matches the original `apiKey`.

**Confidence:** HIGH -- verified encryption pattern in `convex/apiKeys/actions.ts` and Zotero schema in `convex/schema.ts:167-175`. Migration pattern from [Convex migration docs](https://stack.convex.dev/intro-to-migrations).

---

### Pitfall 5: Stripe `"dummy"` Key Removal Breaks Development and CI

**What goes wrong:** Both `convex/subscriptions/actions.ts:39` and `convex/credits/actions.ts:31` use `process.env.STRIPE_SECRET_KEY || "dummy"`. Removing the `"dummy"` fallback and adding an early throw seems like a simple security fix, but it breaks:
- Local development without Stripe configured
- CI test runs that do not set `STRIPE_SECRET_KEY`
- The Convex dev deployment startup (module-level code runs on deploy)

**Why it happens:** The Stripe SDK is instantiated at module scope, not inside individual function handlers. This means the `new Stripe(...)` call runs when Convex loads the module, which happens on every deployment and every function invocation in that module. If the validation throws at module scope, ALL functions in that file become uncallable -- including non-Stripe functions that share the module.

**Consequences:**
- Entire billing module becomes uncallable if `STRIPE_SECRET_KEY` is missing, even for functions that do not use Stripe directly
- Local `npx convex dev` fails on startup if env var is not set
- CI pipelines that test non-billing features break because the billing module fails to load

**Prevention:**
- Do NOT throw at module scope. Instead, create a lazy Stripe initialization function:
  ```typescript
  let _stripe: Stripe | null = null;
  function getStripe(): Stripe {
    if (!_stripe) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("STRIPE_SECRET_KEY is required");
      _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" });
    }
    return _stripe;
  }
  ```
- This validates on first use (inside a function handler), not on module load
- Non-Stripe functions in the same module continue to work
- Development environments without Stripe still load the module; only Stripe-calling functions fail with a clear error

**Detection:** After removing `"dummy"`, run `npx convex dev` in a clean environment without `STRIPE_SECRET_KEY` set. If the deployment fails, the fix is wrong.

**Confidence:** HIGH -- directly verified at `convex/subscriptions/actions.ts:39` and `convex/credits/actions.ts:31`.

---

### Pitfall 6: Env Var Validation Breaks Non-Production Environments

**What goes wrong:** Adding startup validation for env vars (`NEXT_PUBLIC_APP_URL`, `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_WEBHOOK_SECRET`) seems like a security win, but these vars have different requirements per environment. Validating ALL of them on startup means:
- Local dev breaks (no Stripe keys)
- Preview/staging breaks (different URL)
- CI breaks (minimal env setup)

**Why it happens:** The codebase has three runtime contexts: Next.js server (server actions), Convex backend (mutations/queries/actions), and Convex HTTP endpoints (webhook handlers). Each context has different env vars available. A blanket validation at module scope does not account for which context is running.

**Consequences:**
- Development velocity drops to zero while developers set up env vars they do not need
- CI pipelines fail on unrelated test suites
- New team members cannot run the project without full production env setup

**Prevention:**
- Validate env vars lazily, at the point of use, not at module load time
- Use environment-aware validation: only require `STRIPE_SECRET_KEY` inside Stripe-calling functions, not at module scope
- For `NEXT_PUBLIC_APP_URL`, validate inside the specific functions that use it (Stripe redirect URLs, Zotero OAuth callbacks) with a clear error message, not a module-level crash
- Create a validation helper that distinguishes "missing and required here" from "missing globally":
  ```typescript
  function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required for this operation`);
    return value;
  }
  ```

**Detection:** Run the full test suite without ANY of the optional env vars set. Only tests that explicitly test billing/encryption should fail.

**Confidence:** HIGH -- directly verified env var usage in `convex/http.ts:11-14`, `convex/subscriptions/actions.ts:39-46`.

---

## Moderate Pitfalls

Mistakes that cause bugs, performance issues, or wasted effort but are recoverable.

---

### Pitfall 7: N+1 Query Fix Changes Query Return Contract

**What goes wrong:** The N+1 queries in `loadJobDataForReporting` (mutations.ts:40-77) and `loadJobPapersAndResults` (queries.ts:145-170) fetch results per-paper in a loop. The fix is to batch-fetch all results for the job in one query. But this changes the data shape: the per-paper loop naturally produces results grouped by paper, while a single bulk query produces a flat list that must be re-grouped. If the re-grouping logic has an off-by-one or uses the wrong key, downstream code receives data in the wrong shape.

**Why it happens:** The N+1 pattern creates a `Map<paperId, results[]>` as a side effect of the loop. The batch pattern creates a flat `results[]` that must be explicitly grouped with `.reduce()` or a Map construction. If results reference a `paperId` that is not in the papers list (orphaned data), the grouping may create entries for non-existent papers.

**Prevention:**
- Keep the return type of helper functions identical before and after the fix
- Write a test that verifies the exact shape of `resultsByPaper` and `reviewsByResult` maps before refactoring, then verify it is unchanged after
- Use `Promise.all` with per-paper queries as an intermediate step (parallelized N+1) before full batch rewrite -- this is safer and still much faster in Convex since DB reads within a transaction have no network round-trip overhead

**Detection:** Compare the output of the old and new implementations with the same test data.

**Confidence:** HIGH -- verified N+1 patterns at `convex/extraction/mutations.ts:40-77` and `convex/extraction/queries.ts:145-170`. Convex [best practices](https://docs.convex.dev/understanding/best-practices/) confirm Promise.all parallelization is the standard fix.

---

### Pitfall 8: Unbounded `.collect()` Fix Breaks Pagination-Unaware Callers

**What goes wrong:** Replacing `.collect()` with `.take(N)` or `.paginate()` changes the function contract. Code that previously received ALL results now receives a subset. If the caller does not handle pagination, it silently operates on partial data -- showing wrong counts, missing items from exports, or producing incorrect aggregate statistics.

**Why it happens:** The codebase has 90+ `.collect()` calls. Most are safe (bounded by per-user indexes), but some are genuinely unbounded (the `backfillIsIndexed` full table scan, the `subscriptions` active status check). Fixing only the dangerous ones is correct, but a sweep that changes all `.collect()` calls breaks callers that expect complete results.

**Consequences:**
- Export functions produce partial CSV/JSON files
- Dashboard statistics show incorrect totals
- Insight aggregation (grounded rate, confidence) computed on subset of data
- The `getJobResults` query returns partial results, confusing users

**Prevention:**
- Audit each `.collect()` individually: is it bounded by an index that limits results to a small set (e.g., per-user, per-job)? If yes, leave it alone.
- Only fix `.collect()` calls that operate on entire tables or have no meaningful index filter
- For `backfillIsIndexed`, convert to a cursor-based scheduled job that processes batches, not a single query
- For dashboard/aggregate queries, add `.take(10000)` as a safety cap rather than removing `.collect()` entirely
- Convex enforces a hard limit: `.collect()` throws if it attempts to collect more than 1024 documents. Any `.collect()` that could exceed this MUST be fixed.

**Detection:** Any function that calls `.collect()` and also computes aggregates (counts, rates, sums) must be checked: does a `.take(N)` limit change the aggregate result?

**Confidence:** HIGH -- verified in codebase and confirmed by [Convex scaling patterns](https://stack.convex.dev/queries-that-scale). Convex enforces a 32,000 document scan limit and 1024 document collect limit per transaction.

---

### Pitfall 9: Rate Limiting Implementation Causes OCC Conflicts Under Load

**What goes wrong:** Implementing rate limiting in Convex using a `rateLimits` table with a counter-per-user-per-action creates a hot document. Every request from the same user for the same action reads and writes the same row. Under burst traffic, this triggers Convex's Optimistic Concurrency Control (OCC) retries, which paradoxically slow down the very users you are trying to protect.

**Why it happens:** Convex uses OCC for all mutations. Two concurrent requests that both read-then-write the same rate limit row will conflict: one succeeds, the other retries. With high concurrency, retries cascade and latency spikes.

**Prevention:**
- Use the official [`@convex-dev/ratelimiter`](https://www.convex.dev/components/rate-limiter) component instead of rolling your own. It handles [sharding with "power of two choices"](https://stack.convex.dev/rate-limiting) to distribute contention across multiple documents.
- If rolling your own, use a fixed-window approach with per-user keys (low contention since users rarely burst simultaneously)
- For the specific endpoints listed in `convex/lib/rateLimit.ts` (api-key-save: 5/min, checkout-session: 3/min), the volume is low enough that a simple table-based approach works. Do not over-engineer sharding for 5 requests per minute.
- Set rate limits conservatively at first (2x-3x expected traffic). Tighten after observing actual usage patterns.
- Beware the multiple-rate-limit pitfall: if checking multiple limits in one mutation, either check all before consuming any (using `check` ahead of `limit`), or roll back the entire transaction if any limit fails.

**Detection:** Monitor OCC retry rates in Convex dashboard after deploying rate limiting. If retries spike, the rate limit documents are too hot.

**Confidence:** HIGH -- based on [Convex rate limiting article](https://stack.convex.dev/rate-limiting) and [rate limiter component](https://www.convex.dev/components/rate-limiter).

---

### Pitfall 10: Debug Code Removal Breaks Internal Tooling Still in Use

**What goes wrong:** The 14 debug/test files in `convex/extraction/` are exported through `index.ts` and some are used by internal workflows. Removing them wholesale breaks:
- `test_runner.ts` / `test_automation.ts` -- may be called by CI pipelines or monitoring crons
- `debug.ts` / `debug_errors.ts` -- may be used by the Convex dashboard for manual investigation
- `create_test_job.ts` -- may be used for staging environment seeding

**Why it happens:** Debug functions in production backends are a gray area. They are security-concerning but operationally useful. The `requirePublicDebugEnabled()` gate means they are already disabled in production unless `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true` is set. Removing them entirely may be more disruptive than gating them properly.

**Consequences:**
- Internal workflows that reference `internal.extraction.test_runner.createAndRunTestJob` fail with "function not found"
- Manual debugging capabilities lost for production incidents
- Test automation pipelines break if they call these functions

**Prevention:**
1. Before removing any debug function, grep the entire codebase (including CI configs, cron definitions, and any external scripts) for references to that function name
2. Check `convex/crons.ts` for any scheduled invocations of debug/test functions
3. Separate into two categories:
   - **Safe to remove:** Functions only callable via dashboard manual invocation (`diagnoseJob`, `debugPaperResults`)
   - **Requires migration:** Functions called programmatically (`test_runner`, `test_automation`)
4. For functions that must stay, ensure they are ALL gated behind `requirePublicDebugEnabled()` or marked as `internalMutation`/`internalQuery`
5. Move test-only functions to a separate Convex module (e.g., `convex/testing/`) that can be conditionally excluded

**Detection:** After removal, run `npx convex dev` and check for "function not found" errors in cron definitions or scheduled jobs.

**Confidence:** HIGH -- directly verified debug exports in `convex/extraction/index.ts:94-121`.

---

### Pitfall 11: Security Hardening Changes ENCRYPTION_KEY Without Migration Plan

**What goes wrong:** If the `ENCRYPTION_KEY` environment variable needs to be rotated (compromised, employee departure, routine rotation), all existing encrypted API keys in the `apiKeys` table become undecryptable. The current AES-256-GCM implementation in `convex/apiKeys/actions.ts` uses a single key with no key version tracking.

**Why it happens:** The encrypted format (`iv:authTag:ciphertext`) does not include a key version identifier. There is no way to know which key was used to encrypt a given row. Rotating the key means new encryptions use the new key, but old data cannot be decrypted.

**Prevention:**
- Add a `keyVersion: v.number()` field to the `apiKeys` table schema (as `v.optional()` first, defaulting to `1` for existing rows)
- Store a mapping of key version -> key hex in env vars (e.g., `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, `ENCRYPTION_KEY` for current)
- The decrypt function should read `keyVersion` from the row and select the corresponding key
- Implement a migration action that re-encrypts all rows from old key to new key, updating `keyVersion`
- For the Zotero key migration (Pitfall 4), include `keyVersion` from the start
- AES-256-GCM nonces must never be reused with the same key; since `randomBytes(12)` is used for IVs, the risk is minimal but increases after approximately 2^32 encryptions with the same key

**Detection:** Try decrypting a row after key rotation. If it fails with "Unsupported state or unable to authenticate data", the old key was used and no version tracking exists.

**Confidence:** MEDIUM -- based on [AES-256-GCM key rotation best practices](https://terrazone.io/aes-256-encryption-types/) and the existing implementation at `convex/apiKeys/actions.ts:15-63`.

---

### Pitfall 12: Performance Fixes Change Convex Reactive Query Semantics

**What goes wrong:** Convex queries are reactive -- the client re-renders when any document read by the query changes. Refactoring a query to read fewer documents (performance win) changes WHICH documents trigger re-renders. Users may see stale data because the query no longer subscribes to updates on documents it used to read.

**Why it happens:** A query like `loadJobPapersAndResults` that reads all papers and all results subscribes to changes in ALL those documents. If you add `.take(50)` for pagination, the query only subscribes to the first 50 papers. Changes to paper 51+ do not trigger a re-render, so the client shows stale progress for large jobs.

**Consequences:**
- Job progress stops updating in the UI after the first page of papers
- Real-time extraction status becomes stale for large jobs
- Users think the job is stuck when it is actually progressing

**Prevention:**
- Understand which queries are used with Convex's `useQuery` hook (reactive) vs. called from actions/mutations (one-shot)
- For reactive queries (used in the UI), do not add `.take()` limits without also implementing proper pagination with a "load more" mechanism
- For one-shot queries (used in mutations for data processing), `.take()` is safe
- The `subscribeToJobProgress` query should remain unbounded (or use aggregate counts) to maintain real-time progress tracking
- Isolate frequently-updated fields (like progress counters) into separate documents to reduce cache invalidation scope -- see [Convex data segmentation pattern](https://stack.convex.dev/queries-that-scale)

**Detection:** After deploying query optimizations, verify that the extraction job dashboard still shows real-time progress updates for jobs with 50+ papers.

**Confidence:** HIGH -- Convex reactive model confirmed at [Convex query docs](https://docs.convex.dev/functions/query-functions) and [scaling queries article](https://stack.convex.dev/queries-that-scale).

---

## Minor Pitfalls

Issues that cause friction or technical debt but are not dangerous.

---

### Pitfall 13: Console.log Removal Using Next.js Compiler Config

**What goes wrong:** Using Next.js `compiler.removeConsole` in `next.config.js` to strip console.log in production is a blanket approach that also removes `console.warn` and `console.error` unless explicitly excluded. This hides real errors in production.

**Prevention:**
- Remove specific `console.log` statements manually in `app/settings/billing/page.tsx:282-290` and `app/actions/openalex.ts:13-35`
- Do NOT use `compiler.removeConsole: true` globally
- If using the compiler option, configure it as `removeConsole: { exclude: ["error", "warn", "info"] }` to preserve error logging
- For the Convex debug file (`convex/debug_papers.ts:20-21`), remove the `@ts-ignore` and the field access entirely rather than just the console.log

**Confidence:** HIGH -- verified debug locations in CONCERNS.md, Next.js compiler config from [Next.js docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging).

---

### Pitfall 14: `patchData: any` Fix Changes Field Inclusion Logic

**What goes wrong:** Replacing `const patchData: any = {}` at `convex/extraction/mutations.ts:1887` with `Partial<Doc<"extractionPapers">>` changes which fields can be added to the patch object. If the existing code conditionally adds fields that are not in the `extractionPapers` schema (e.g., computed/temporary fields), the typed version will show compile errors. Developers may remove those fields, changing the mutation's behavior.

**Prevention:**
- Read the patch construction logic carefully before typing it
- If non-schema fields are being written, that is a bug in the existing code (Convex would reject them at runtime anyway since schema enforcement is on). Fix the bug, do not work around it.
- Use `Partial<Pick<Doc<"extractionPapers">, "field1" | "field2">>` to type only the fields that are actually patched, rather than the full document type

**Confidence:** HIGH -- directly verified at `convex/extraction/mutations.ts:1887`.

---

### Pitfall 15: V32_CUTOVER_AT Removal Without Data Migration

**What goes wrong:** Removing the `V32_CUTOVER_AT` timestamp-based version gating without adding a schema-level `extractionVersion` field leaves old extraction jobs in an ambiguous state. Code that checks `isV32EnabledForJob` currently returns `true` when `V32_CUTOVER_AT === 0` (default), meaning old jobs are treated as V3.2-compatible. Removing the check without migration means old jobs may be processed with V3.2 logic they were not designed for.

**Prevention:**
- Add `extractionVersion: v.optional(v.number())` to `extractionJobs` schema first
- Write a migration that sets `extractionVersion: 32` for all jobs created after the cutover timestamp, and `extractionVersion: 31` for older jobs
- Replace all `isV32EnabledForJob` checks with `job.extractionVersion >= 32`
- Only then remove the `V32_CUTOVER_AT` env var dependency

**Confidence:** MEDIUM -- verified at `convex/extraction/workpoolActions.ts:111` and `convex/extraction/workpoolActions.ts:819-984`.

---

### Pitfall 16: Multiple Subscription Rows Per User During Dedup Fix

**What goes wrong:** The `subscriptions` table allows multiple rows per user (no uniqueness constraint). The `selectCanonicalSubscription` function picks the "right" one. If the hardening sweep adds a uniqueness enforcement (e.g., deleting duplicates), it may delete the wrong row -- the one with the active Stripe subscription ID.

**Prevention:**
- Before deduplicating, log ALL subscription rows for affected users with their `stripeSubscriptionId` and `status`
- The canonical subscription is the one with `status: "active"` and a valid `stripeSubscriptionId`
- Do NOT delete any row with a non-null `stripeSubscriptionId` unless it is confirmed canceled in Stripe
- Consider adding an `isCanonical: v.boolean()` field rather than deleting rows, to preserve audit trail

**Confidence:** MEDIUM -- verified at `convex/schema.ts:71-103` and `convex/subscriptions/lib/selectCanonicalSubscription.ts`.

---

## Integration Pitfalls

Cross-cutting concerns when multiple hardening fixes interact.

---

### Pitfall 17: Type Safety + Deletion Cascade = Double Breakage

**What goes wrong:** The type safety sweep and deletion cascade fix touch the same file (`convex/extraction/mutations.ts`). If done in parallel or in the wrong order:
- The type sweep adds proper `MutationCtx` types to `deleteExtractionInternal`, revealing that the recursive `ctx.runMutation(internal.extraction.mutations.deleteExtractionInternal, ...)` call may have type issues
- The cascade fix adds new deletion steps (evidence units, reviews, storage)
- Merging both changes requires resolving conflicts in a 2000+ line file where a mistake means data loss

**Prevention:**
- Do the type safety sweep FIRST, ship it, verify it works
- THEN do the deletion cascade fix in a separate phase
- Never refactor types and change deletion logic in the same PR

**Confidence:** HIGH -- both concerns target the same file and function.

---

### Pitfall 18: Rate Limiting + N+1 Fix = Changed Query Performance Profile

**What goes wrong:** Adding rate limiting to extraction job creation while simultaneously optimizing N+1 queries changes the performance profile unpredictably. The rate limiter adds a read+write per request. The N+1 fix reduces reads per request. If the rate limiter uses the same transaction as the query, the overall read count may be similar but with higher contention.

**Prevention:**
- Rate limiting should be its own mutation step (check limit, then proceed to the actual operation) or use the `@convex-dev/ratelimiter` component which handles this correctly
- Do not embed rate limit checks inside existing query handlers
- Deploy rate limiting and query optimizations in separate phases

**Confidence:** MEDIUM -- theoretical integration risk based on Convex OCC model.

---

### Pitfall 19: Schema Changes for Multiple Fixes Require Coordinated Migration

**What goes wrong:** Multiple hardening fixes require schema changes:
- Zotero encryption: add `encryptedKey`, remove `apiKey`
- Key versioning: add `keyVersion` to `apiKeys`
- Extraction version: add `extractionVersion` to `extractionJobs`
- Rate limiting: add `rateLimits` table
- Deletion tracking: add `deletionStatus` to `extractionJobs`

If deployed together without coordinated migration, the schema push may fail because existing data does not match the new required fields.

**Prevention:**
- All new fields must start as `v.optional()` -- Convex will reject a schema push with required fields that existing data does not have
- Group schema additions into one deployment, then migrate data, then tighten types in a follow-up deployment
- Test schema changes against the production Convex deployment using `npx convex deploy --preview` before pushing to production
- Follow [Convex's dual-write migration pattern](https://stack.convex.dev/intro-to-migrations): deploy code that writes both formats while reading the old format, migrate data asynchronously, update code to read the new format, then clean up

**Detection:** `npx convex deploy` will fail with a schema validation error if required fields are added without migration.

**Confidence:** HIGH -- confirmed by [Convex schema migration docs](https://stack.convex.dev/intro-to-migrations) and [Convex schemas documentation](https://docs.convex.dev/database/schemas).

---

### Pitfall 20: Orphaned PDF Cleanup During Cascade Fix Hits Convex Storage API Limits

**What goes wrong:** When fixing the deletion cascade to include storage cleanup (`ctx.storage.delete(storageId)`), processing a job with hundreds of papers that each have a PDF stored in Convex storage requires hundreds of sequential storage delete calls. This can hit Convex's function execution time limit (1 second for user code) or the 16,000 write limit per transaction.

**Why it happens:** Each `ctx.storage.delete()` is a write operation. Combined with document deletes for evidence units, reviews, results, and papers, a single cascade invocation for a large job may exceed transaction limits.

**Prevention:**
- Batch storage deletes: collect up to N storage IDs per cascade step, delete them, then reschedule
- Count total writes per cascade step (document deletes + storage deletes) and keep well under the 16,000 limit
- Consider a separate cleanup cron that processes orphaned storage IDs on a schedule, rather than inline in the cascade
- The existing `cleanupOldPdfFiles` function already has some of this logic -- extend it rather than duplicating in the cascade

**Detection:** Monitor Convex function execution duration after deploying cascade changes. If cascade mutations consistently approach the 1-second limit, batching is too aggressive.

**Confidence:** MEDIUM -- based on [Convex transaction limits](https://docs.convex.dev/production/state/limits): 16,000 writes per transaction, 1-second execution limit.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Debug code cleanup + console.log removal | Pitfall 10 (internal tooling), Pitfall 13 (blanket removal) | Grep all references before removal; manual removal over compiler config |
| Type safety sweep | Pitfall 1 (runtime behavior change), Pitfall 2 (codegen mismatch), Pitfall 14 (patchData) | Regenerate types first; type-only changes per commit; full test run after each file |
| Schema additions | Pitfall 19 (coordinated migration) | All new fields as v.optional(); group into one deployment; test with --preview |
| Deletion cascade fix | Pitfall 3 (ordering errors), Pitfall 17 (conflicts with type sweep), Pitfall 20 (storage limits) | Fix cascade after type sweep ships; add deletion status tracking; write comprehensive test |
| N+1 and performance fixes | Pitfall 7 (contract change), Pitfall 8 (pagination awareness), Pitfall 12 (reactive semantics) | Keep return types identical; use Promise.all as first step; preserve reactive subscriptions |
| Security hardening | Pitfall 4 (Zotero migration), Pitfall 11 (key rotation), Pitfall 5 (Stripe dummy key) | Multi-step migration pattern; key versioning; lazy initialization |
| Env var validation | Pitfall 5 (Stripe dummy key), Pitfall 6 (environment-aware) | Lazy validation at point of use; never validate at module scope |
| Rate limiting | Pitfall 9 (OCC conflicts), Pitfall 18 (performance interaction) | Use @convex-dev/ratelimiter component; deploy separately from query optimizations |

---

## Recommended Phase Ordering (Based on Pitfall Dependencies)

1. **Debug code cleanup + console.log removal** -- lowest risk, no schema changes, no behavioral changes. Builds confidence.
2. **Type safety sweep** -- must happen before cascade/N+1 fixes to establish type foundation. No runtime behavior changes if done correctly.
3. **Schema additions** (all `v.optional` fields) -- one coordinated push adding all new fields needed by later phases.
4. **Deletion cascade fix** -- depends on typed codebase and new schema fields. High-value fix for data integrity.
5. **N+1 and performance fixes** -- depends on typed codebase for safe refactoring.
6. **Security hardening** (encryption migration, env var validation) -- depends on schema additions for key versioning.
7. **Rate limiting** -- last because it is additive (new behavior, not fixing existing behavior) and depends on typed codebase.

---

## Sources

- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) -- HIGH confidence
- [Convex Server Module Types (MutationCtx, QueryCtx)](https://docs.convex.dev/api/modules/server) -- HIGH confidence
- [Convex GenericMutationCtx Interface](https://docs.convex.dev/api/interfaces/server.GenericMutationCtx) -- HIGH confidence
- [Convex Transaction Limits](https://docs.convex.dev/production/state/limits) -- HIGH confidence (32,000 doc scan, 16 MiB read/write, 4,096 index reads, 1s execution)
- [Convex Queries That Scale](https://stack.convex.dev/queries-that-scale) -- HIGH confidence
- [Convex Rate Limiting Patterns](https://stack.convex.dev/rate-limiting) -- HIGH confidence
- [Convex Rate Limiter Component](https://www.convex.dev/components/rate-limiter) -- HIGH confidence
- [Convex Intro to Migrations](https://stack.convex.dev/intro-to-migrations) -- HIGH confidence
- [Convex Lightweight Zero-Downtime Migrations](https://stack.convex.dev/lightweight-zero-downtime-migrations) -- HIGH confidence
- [Convex Schemas Documentation](https://docs.convex.dev/database/schemas) -- HIGH confidence
- [Convex Query Functions](https://docs.convex.dev/functions/query-functions) -- HIGH confidence
- [Convex Best Practices: Other Recommendations](https://docs.convex.dev/understanding/best-practices/other-recommendations) -- HIGH confidence
- [AES-256 Encryption Modes and Pitfalls](https://terrazone.io/aes-256-encryption-types/) -- MEDIUM confidence
- [Mistakes Engineers Make in Large Established Codebases](https://www.seangoedecke.com/large-established-codebases/) -- MEDIUM confidence
- [Next.js Console Removal](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging) -- HIGH confidence
