# Pitfalls Research

**Domain:** v3.0 Zero-Any Overhaul — adding zero-any enforcement, pagination, XSS fixes, audit tables, and env validation to an existing Convex + Next.js + Stripe app
**Researched:** 2026-03-03
**Confidence:** HIGH (directly verified against codebase; see file citations)

---

## Critical Pitfalls

---

### Pitfall 1: `as any` Removal Silently Breaks Runtime Behavior When Types Are Wrong

**What goes wrong:**
Replacing `as any` with a typed pattern compiles cleanly but produces a different runtime value. The clearest example is `(fresh.customer as any)?.id` in `convex/maintenance/internal.ts:103`. The typed replacement uses `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id`. If the same pattern exists elsewhere in the codebase using a DIFFERENT field name or a different union shape, copying the pattern verbatim produces `undefined` silently — no compile error, no runtime throw, just a missing value that causes the downstream `syncSubscription` call to be skipped.

**Why it happens:**
Developers treat `as any` removals as mechanical find-replace work. They apply a pattern that worked for one union type to a different union type without verifying the actual runtime shape. Stripe's SDK uses `string | Stripe.Customer | Stripe.DeletedCustomer` for `customer`, but other fields use different union shapes. The typed pattern must be verified per-field, not copied wholesale.

**How to avoid:**
1. Before removing any `as any` cast, read the Stripe SDK type definition for that specific field (not the general "how to handle union types" pattern).
2. Add a unit test that asserts the correct value is extracted from BOTH union branches (string form AND expanded object form) before removing the cast.
3. Verify the existing test suite covers the expanded-customer path in `checkSubscriptionStatus` — it does not (CONCERNS.md confirms no test for expanded customer objects in that path).
4. Write the test first, watch it fail with the old `as any`, ensure it passes with the typed replacement.

**Warning signs:**
- Subscription status corrections silently skip when Stripe returns an expanded customer object.
- The `stripeCustomerId` local variable is `undefined` in logs but no error is thrown.
- OCC conflicts do not appear (no writes happening) but subscription divergence persists.

**Phase to address:** The type-safety sweep phase. Address `convex/maintenance/internal.ts` last in that phase, after tests are in place for the expanded-customer path.

---

### Pitfall 2: `convex-helpers` `filter().paginate()` Breaks Existing nuqs Cursor State

**What goes wrong:**
`convex/library/queries.ts` already uses `filter(q, ...).paginate(args.paginationOpts)` (lines 69–80 and 137–148). If a phase "migrates library queries to pagination" without realizing this is already done, it will attempt to add pagination a second time — or worse, replace the working `filter().paginate()` pattern with a new approach that invalidates existing URL cursor state stored via nuqs.

The real risk is subtler: the `convex-helpers` `filter()` helper performs post-fetch filtering, meaning it fetches potentially many more documents than the requested page size to find enough matching items. If pagination is "improved" by moving filters into the index query, the cursor values change format (Convex index-based cursors vs. filter-helper cursors are not interchangeable). Any user with a bookmarked URL or a browser history entry containing an old cursor will get a runtime error when the cursor cannot be decoded.

**Why it happens:**
The CONCERNS.md entry says "Library queries use unbounded `.collect()`" but the current code already uses `.paginate()`. The concern is actually about the `convex-helpers` filter approach doing more work than necessary, not about a missing pagination implementation. A phase that reads the concern but not the code will implement pagination on top of existing pagination, breaking things.

**How to avoid:**
1. Read the actual query code before writing any migration plan. Confirm whether `.paginate()` is already present.
2. If the goal is to push collection membership filter into the index (genuine improvement), do so in a new query that uses a different nuqs key for its cursor. Run both queries in parallel during rollout, then switch.
3. Never change the cursor format of an existing paginated query without adding a migration: on next load, if the cursor fails to parse, reset to page 1 (catch the Convex error and clear the cursor from nuqs state).
4. The `exportLibrary` query legitimately uses `.collect()` for export — this is intentional (exports all filtered items, no pagination). Do not add pagination there.

**Warning signs:**
- Browser console shows Convex error: "Invalid cursor" after deploying library query changes.
- Library page loads blank with no items and no error toast (cursor silently fails).
- Export still works but paginated view is broken (different code path — confirms cursor issue rather than filter issue).

**Phase to address:** Any phase touching library queries. Must read the actual code first, then determine if there is genuine work to do beyond what's already implemented.

---

### Pitfall 3: ExcelJS Migration Breaks XLSX Export Silently for Complex Cell Types

**What goes wrong:**
`lib/extraction/export.ts` uses `xlsx` via top-level `import * as XLSX from 'xlsx'`. Migrating to `exceljs` changes the entire API surface: `XLSX.utils.book_new()` becomes `new ExcelJS.Workbook()`, `XLSX.utils.aoa_to_sheet()` becomes `worksheet.addRows()`, and cell formatting uses completely different structures. The migration will compile successfully if ExcelJS types are satisfied, but the exported file may have:
- Missing headers (if `addRows` vs `addRow` is confused)
- Wrong cell types (ExcelJS distinguishes `type: ExcelJS.ValueType.String` vs ExcelJS infer-from-value)
- Corrupted `.xlsx` files that Excel opens with a repair dialog
- Missing sheets (if `workbook.addWorksheet()` arguments are wrong)

**Why it happens:**
ExcelJS's API uses a builder pattern entirely unlike `xlsx`'s array-of-arrays approach. Developers port the logic one function at a time and each piece appears to work in isolation, but the overall workbook structure requires all pieces to be set up in the correct order (workbook → worksheet → columns → rows). Skipping the column definition step (ExcelJS requires explicit column headers) produces a file that opens but has no header row — validation tests pass because the data rows are present.

**How to avoid:**
1. Migration sequence: `xlsx` → dynamic import of `xlsx` first (zero behavior change, just deferred load). Ship this. Then, in a separate phase, evaluate whether ExcelJS is worth the full API migration.
2. If migrating to ExcelJS, write an end-to-end test that: (a) generates an `.xlsx` file, (b) parses it back with a reader (use `xlsx` or ExcelJS itself), and (c) asserts exact headers, row count, and cell values. Do not rely on "no error thrown" as the success criterion.
3. Test with the actual extraction data shapes: boolean answers (`'Yes'`/`'No'`), null/undefined answers (empty string), array answers (semicolon-joined), and number answers.
4. The `formatAnswerForExcel()` function (line 39, `export.ts`) returns `any` — this must be typed for ExcelJS since ExcelJS cell values accept `ExcelJS.CellValue` not `any`. This is where type mismatches will surface.

**Warning signs:**
- The exported `.xlsx` file opens without error in the test environment but shows "we found a problem" in Excel 365.
- Row count in exported file does not match the number of papers.
- Boolean or null cells appear as `[object Object]` instead of 'Yes'/'No' or empty.

**Phase to address:** The performance/bundle optimization phase that addresses the synchronous XLSX import. Start with dynamic import before committing to a library migration.

---

### Pitfall 4: `dangerouslySetInnerHTML` Replacement Breaks Highlight Visual Correctness

**What goes wrong:**
`highlightText()` in `components/extraction/results-views/table-view.tsx:293-297` injects `<mark>` HTML via `dangerouslySetInnerHTML`. The safe replacement is to split the text on the search query and return React elements — an array of `<span>` and `<mark>` elements. The failure mode is subtle: the current implementation handles multi-word queries with spaces and special regex characters via `escapedQuery`. A naive React split approach that uses `text.split(query)` (without regex and case-insensitive flag) will miss matches where case differs or where the query contains special characters. The visual result: highlights disappear in the new implementation even though the old one worked correctly.

A second failure: `highlightText` is called for both `paper.title` (line 162) and `result.answer` text (lines 378-388, 450-451). The current implementation accepts a `string` input and returns a `string`. The React replacement must return `React.ReactNode`, which changes the TypeScript signature. Any call site that expects a `string` return — such as a `title` attribute or a non-React context — will break.

**Why it happens:**
The developer creates a React-native highlight component for the JSX render context but does not audit all call sites. The `title` attribute at line 161 (`title={paper.title}`) does not need highlighting — it currently passes raw text, not the `highlightText()` result. But if the refactor changes `highlightText` to return `ReactNode`, attempts to use it for the `title` attribute will produce `[object Object]`.

**How to avoid:**
1. Audit ALL call sites of `highlightText` before changing its signature. In `table-view.tsx`, find every `dangerouslySetInnerHTML={{ __html: highlightText(...) }}` call.
2. Replace `highlightText` with a `HighlightedText` React component that accepts `text: string` and `query: string` and returns JSX. Use `String.prototype.split` with a regex constructed the same way as the current implementation (case-insensitive, escaped query).
3. The component is only used inside `dangerouslySetInnerHTML` contexts — replace those entire `dangerouslySetInnerHTML` elements with `<HighlightedText text={...} query={...} />`.
4. The XSS test must verify: (a) HTML characters in `text` are escaped (use `<script>` in a paper title), (b) HTML characters in `query` are escaped, (c) case-insensitive match works, (d) no match renders plain text without wrapping elements.

**Warning signs:**
- Paper titles that contain HTML characters (`<`, `>`, `&`) render as escaped text instead of the actual character after the migration (double-escaping by React).
- Search highlighting stops working for lowercase queries against uppercase titles.
- TypeScript error: "Type 'ReactNode' is not assignable to type 'string'" at the `title` attribute.

**Phase to address:** The XSS fix phase. Write the test first (currently zero tests for this, confirmed by CONCERNS.md), then implement.

---

### Pitfall 5: Audit Table Writes in Hot Paths Create Convex Write Bottlenecks

**What goes wrong:**
Adding persistent audit table writes to replace `console.log` audit events is straightforward for low-frequency paths (API key save, debug gate access). It is dangerous for any path that runs in a tight loop or hot query. In this codebase, the `decryptApiKey` function in `convex/lib/crypto.ts:81-86` currently logs on every call. If the audit table write is added to `decryptApiKey` itself, and `decryptApiKey` is called inside a mutation that processes 500 papers (extraction loop), the mutation will attempt 500 audit table inserts in a single Convex transaction. This hits Convex's 16,000 write limit but more importantly adds 500 DB writes to what should be a fast mutation, causing OCC contention on the `auditLogs` table.

**Why it happens:**
Audit logging feels like a cross-cutting concern that belongs in the utility function. Moving it to the call site feels like duplication. But the utility function has no context about how many times it will be called per transaction. The developer adds the DB write to `decryptApiKey` without checking all call sites.

**How to avoid:**
1. Before moving audit logging to a Convex table write, grep all callers of `decryptApiKey` and count how many times each could be called per transaction.
2. For hot-path callers (inside extraction loops), emit a single audit record per operation, not per API call: "Decrypted API key for job X (N papers processed)".
3. For the `decryptApiKey` utility specifically: keep the `console.log` for hot paths and add the table write only for security-sensitive callers (API key save, explicit user access). Thread the choice via a parameter: `audit: { persist: boolean }`.
4. Alternatively, batch audit writes with `ctx.scheduler.runAfter(0, ...)` to a separate mutation that collects and inserts the batch — this keeps the write out of the hot mutation's transaction.
5. The audit table must have an index on `userId` and `timestamp` for any queries that will search it.

**Warning signs:**
- Extraction mutations run slower after audit logging is added (OCC retries visible in Convex dashboard).
- Extraction logs show "too many writes" errors from Convex.
- The `auditLogs` table grows proportionally to extraction paper count, not to security-sensitive operations.

**Phase to address:** The security hardening phase that adds the persistent audit table. This phase must define which operations are audited (security-sensitive user actions) vs. which remain console-only (internal processing loops).

---

### Pitfall 6: Env Var Validation at Startup Blocks Convex Deployment

**What goes wrong:**
`convex/lib/constants.ts` exports `assertPlanPriceConfig()` which throws if `GO_PRICE_ID` or `PRO_PRICE_ID` is empty. If this function is called at module load time (e.g., added to the module's top-level code, or called from a cron that runs on startup), a Convex deployment to a new environment that does not yet have `STRIPE_GO_PRICE_ID` set will fail to start. The deployment succeeds but the module fails to load, making ALL functions in that module uncallable — including non-Stripe functions like subscription queries.

A second failure: Convex processes validate env vars when the module loads for the first time after deployment. If the validation is in a `"use node"` module (required for Node.js APIs), it only runs for `"use node"` actions, not for regular mutations/queries. Placing env var validation in a `"use node"` module gives false confidence — the validation runs for action-based billing flows but not for mutation-based subscription reads.

**Why it happens:**
The `assertPlanPriceConfig()` function is already written and works correctly. The pitfall is WHERE it is called, not whether the function itself is correct. Developers see a ready-made validation function and call it at module scope or in an `init` function that runs on every module load, without checking the Convex module loading semantics.

**How to avoid:**
1. Call `assertPlanPriceConfig()` only inside function handlers (mutations/queries/actions), not at module scope.
2. The correct pattern for startup validation in Convex is a cron or an HTTP endpoint called during deployment verification — not a module-level side effect.
3. For the specific env vars in `constants.ts`: the Price IDs are already lazily read via `process.env.STRIPE_GO_PRICE_ID || ""`. This is correct. The assertion function should be called inside the first handler that uses those IDs (e.g., `createCheckoutSession`), not at module load.
4. Startup env var validation in Convex should be implemented as an `httpAction` endpoint (e.g., `/health`) that can be called by a deployment script. This gives explicit feedback without blocking module load.

**Warning signs:**
- `npx convex deploy` succeeds but subsequent function calls fail with "module failed to load".
- Stripe-unrelated functions (like subscription status queries) fail after adding env var validation to the Stripe constants module.
- Convex dashboard shows the module in an error state immediately after deployment.

**Phase to address:** The env var validation phase. Read PITFALLS.md for v2.3 (Pitfall 5 and 6) first — this pitfall was already documented there. The v3.0 fix must not re-introduce the module-scope call anti-pattern.

---

### Pitfall 7: Stripe Type Narrowing Becomes Overly Strict, Crashing Webhook Handlers

**What goes wrong:**
Stripe webhook handlers in `convex/http.ts` currently use typed SDK event objects (completed in v2.5, per PROJECT.md). The v3.0 concern is `convex/maintenance/internal.ts:103` — the `(fresh.customer as any)?.id` pattern. Replacing this with a strict type narrowing pattern is correct, BUT if the narrowing uses a type assertion instead of a type guard (`fresh.customer as Stripe.Customer` instead of `typeof fresh.customer !== 'string'`), it will throw a TypeScript error at compile time OR silently produce `undefined` at runtime if Stripe returns the string form.

A more dangerous scenario: if a developer adds `if (!fresh.customer || typeof fresh.customer === 'string') throw new ConvexError(...)` as part of "making the type narrowing explicit," any subscription that returns a non-expanded customer from Stripe (which is the DEFAULT — Stripe does not expand by default) will throw a ConvexError. This crashes the maintenance cron for ALL subscriptions, not just the ambiguous ones.

**Why it happens:**
Stripe's API returns `customer: string` by default (the customer ID) and only returns `customer: Stripe.Customer` when explicitly using the `expand: ['customer']` option. The codebase does not use `expand: ['customer']` in this path. Developers see the union type and add defensive code that throws for the string case, not realizing the string case is the COMMON case.

**How to avoid:**
1. The correct replacement for `(fresh.customer as any)?.id` is already documented in CONCERNS.md: `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id`.
2. Never throw or error when `fresh.customer` is a string — that is correct behavior. The string IS the customer ID.
3. Add a test with `fresh.customer` as a plain string and verify the handler extracts the ID correctly. Add a second test with an expanded customer object.
4. Do NOT add `expand: ['customer']` to the Stripe API call just to simplify the type narrowing — this adds a network round-trip and changes the Stripe billing credits for expanded resources.

**Warning signs:**
- `checkSubscriptionStatus` cron logs show `[WARN] No customer ID for subscription` for ALL subscriptions immediately after the type narrowing change.
- Subscription divergence corrections stop running (cron runs but makes no corrections).
- Convex error logs show ConvexError from the maintenance cron.

**Phase to address:** The type-safety sweep phase, specifically when addressing `convex/maintenance/internal.ts`. Must be paired with a test for both customer shapes before the change is deployed.

---

### Pitfall 8: Rate Limiter `name as any` Removal Breaks Callers Using String Variables

**What goes wrong:**
`convex/lib/rateLimit.ts:52` uses `name: args.name as any` in the `consume` internal mutation. The `consume` mutation accepts `name: v.string()` and passes it to `rateLimit()` which expects one of the three literal union members. Removing `as any` requires the `name` argument to be typed as the literal union. But the `consume` mutation is called from actions via `ctx.runMutation(internal.lib.rateLimit.consume, { name: rateLimitName, ... })`. If those callers pass a string variable (not a literal), the TypeScript type of `args.name` in the mutation becomes too narrow for the `rateLimit()` function's expected type.

The correct fix is a runtime check, not a type cast. Adding `z.enum([...rateLimitNames]).parse(args.name)` will throw a `ZodError` at runtime for invalid names — that is correct behavior. But if the enum is defined using the rate limit config keys and a new rate limit is added to the config without adding it to the enum, the enum and the config diverge silently. New rate limiters will throw at runtime.

**Why it happens:**
The `name` field must be `v.string()` in the Convex validator (because the literal union is not expressible as a Convex validator argument for an internal mutation called from actions). So the gap between the runtime string and the TypeScript literal union requires a manual bridging step that is easy to forget to maintain.

**How to avoid:**
1. Derive the valid names from the `defineRateLimits` config object itself using `keyof typeof rateLimitConfig` — never maintain a separate enum.
2. The runtime check should use `Object.keys(rateLimitConfig).includes(args.name)` rather than a hardcoded enum. This stays in sync automatically when new rate limits are added.
3. Use a type assertion after the runtime check: `name: args.name as keyof typeof rateLimitConfig` — this is a safe cast because the runtime check has already verified membership.
4. Add a test that calls `consume` with an invalid name and asserts the ConvexError response contains `{ kind: "RateLimited" }` or an appropriate error — currently no such test exists.

**Warning signs:**
- A new rate limit added to `defineRateLimits` works when called directly from mutations but fails when called through the `consume` indirection from actions.
- Rate limit enforcement silently fails for action-path rate-limited endpoints (no error, no throttle).
- TypeScript reports errors in action callers after the `as any` is removed.

**Phase to address:** The type-safety sweep phase. Fix after establishing the runtime validation pattern, not before.

---

### Pitfall 9: `@convex-dev/workflow` ID Type Mismatch Fails at Runtime After Library Update

**What goes wrong:**
`convex/extraction/mutations.ts:263` uses `workflow.cancel(ctx, job.workflowId as any)`. The `workflowId` field is stored in the `extractionJobs` table as a string. The `workflow.cancel()` function expects a specific ID type from the workflow component — likely `Id<"_scheduled_functions">` or a component-specific type. The `as any` works today because the runtime representation is compatible. If `@convex-dev/workflow` is updated and the ID type changes its runtime format (e.g., from a bare string to a namespaced string), the `as any` cast hides the incompatibility until `workflow.cancel()` fails at runtime with a cryptic error.

The v3.0 fix must not make this worse. The naive "fix" is to cast to `Id<"_scheduled_functions">` — but that is ALSO wrong if the workflow component uses its own ID namespace. The correct fix requires reading the `@convex-dev/workflow` documentation for the exact expected type of the `workflowId` parameter.

**Why it happens:**
The workflow component is a Convex component with its own generated types. The `workflowId` stored in the `extractionJobs` schema was originally typed as `v.string()` because the correct type was unknown at implementation time. Changing the schema to `v.id("_scheduled_functions")` or a component ID type requires a schema migration AND verification that existing stored workflow IDs are compatible with the new type.

**How to avoid:**
1. Read the `@convex-dev/workflow` source or docs to determine the exact TypeScript type returned when a workflow is started. This is the type that should be stored and used for cancellation.
2. Check whether changing the schema field type from `v.string()` to the correct ID type requires a data migration (existing stored string values must be compatible with the new type at runtime).
3. If the workflow component docs say the ID is a `string` that matches `Id<"_scheduled_functions">` format, a type-only change (no data migration) is safe. If the format differs, the schema change requires a data migration.
4. As an intermediate step: keep the schema as `v.string()` but add a type guard that validates the stored value against the expected format before passing to `workflow.cancel()`.
5. Do NOT remove `as any` here without first understanding what type `workflow.cancel()` actually expects — check the `@convex-dev/workflow` package's TypeScript definitions.

**Warning signs:**
- `workflow.cancel()` throws a runtime error mentioning "invalid ID" after removing `as any`.
- Extraction jobs that are cancelled no longer stop their workflow steps.
- TypeScript compiles cleanly but Convex runtime rejects the ID value.

**Phase to address:** The type-safety sweep phase. Treat this as a research item first — read the `@convex-dev/workflow` type definitions before writing any code.

---

### Pitfall 10: Credit TOCTOU Mitigation via Per-User Workpool Deadlocks or Over-Serializes

**What goes wrong:**
CONCERNS.md documents the credit TOCTOU mitigation as "per-user workpool with maxParallelism: 1" (Option A in `convex/credits/internal.ts:1275`). If this is implemented, ALL credit deductions for a user are serialized through a single-slot workpool. The deadlock scenario: an extraction job is running and uses a workpool action to deduct credits. The per-user credit workpool has `maxParallelism: 1`. If the extraction action ITSELF is running inside another workpool, and the credit deduction calls `ctx.runMutation` to a credit workpool action, the two workpools are now nested. Convex workpools are not designed for nested execution — the outer workpool action holds a slot while waiting for the inner workpool to process, but the inner workpool's single slot may be held by another pending request, creating a queue that grows without bound.

A subtler over-serialization: if multiple extraction papers are processed in parallel (up to 10 concurrent workpool actions, per `convex/workflow.ts`), and each paper deducts credits via the per-user credit workpool (`maxParallelism: 1`), the credit workpool becomes the bottleneck. Papers that finish quickly must wait for the credit workpool slot. For a 500-paper job, this serializes 500 credit deductions — increasing total job duration significantly.

**Why it happens:**
The TOCTOU problem is real but its actual consequences are benign (a user sees `INSUFFICIENT_CREDITS` when they expected success — no data corruption, no financial incorrectness). The mitigation introduces coordination overhead that is worse than the problem it solves. The documentation in `credits/internal.ts` explicitly says: "Implement additional mitigation ONLY on observed incident: a real double-deduction producing a negative balance."

**How to avoid:**
1. Do NOT implement the per-user workpool mitigation in v3.0 unless a negative balance incident has been observed in production. The existing Convex OCC protection is sufficient.
2. If the concurrency test is added (currently missing, per CONCERNS.md), verify it tests for NEGATIVE BALANCE (the actual failure mode), not for "two concurrent requests both see sufficient balance" (which is the expected, benign behavior).
3. If a mitigation IS needed, use Option B (version field on credits record) rather than Option A (per-user workpool). A version field adds a single field read/write per deduction with no workpool coordination overhead.
4. The test for this pitfall should simulate: two concurrent `deductCredits` mutations on the same user with balance=10, each requesting 8 credits. Expected outcome: one succeeds (balance=2), one fails with INSUFFICIENT_CREDITS. Actual negative balance should never occur.

**Warning signs:**
- Extraction job duration increases by more than 20% after adding per-user credit workpool.
- Convex function logs show "workpool queue depth > 10" for the credit workpool.
- Papers complete extraction but sit waiting for credit deduction confirmation before status updates.

**Phase to address:** The concurrency test coverage phase. Add the test to verify existing OCC protection works. Only implement the workpool mitigation if the test reveals OCC is insufficient.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `as any` cast for Stripe customer union | Compiles immediately | Silently returns `undefined` if Stripe changes response shape | Never for production billing paths |
| Calling `assertPlanPriceConfig()` at module scope | Single validation point | Blocks ALL functions in the module if env var is missing | Never — always call at use-site |
| `filter().paginate()` for collection membership | Works correctly today | Fetches more documents than needed, worsens with library size | Acceptable until library exceeds ~5,000 items per user |
| `console.log` for audit events in hot paths | Zero overhead | Not queryable, not tamper-evident, purged with Convex log rotation | Acceptable for debug-level logging; not for security audit events |
| `name as any` in rate limit `consume` mutation | Avoids complex type dance | New rate limit names silently fail exhaustiveness check | Never — use runtime validation instead |
| Top-level `import * as XLSX from 'xlsx'` | Simple import | 500KB added to initial bundle for ALL users | Never — dynamic import is straightforward here |
| `result as any` to access `correctedAnswer` | Avoids type derivation work | Type errors in field access are invisible at compile time | Never — derive the type from the existing validator |

---

## Integration Gotchas

Common mistakes when connecting to external services or internal systems.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Stripe SDK customer union | Assume `fresh.customer.id` always works | `typeof fresh.customer === 'string' ? fresh.customer : fresh.customer?.id` — always use type guard |
| Convex `paginationOptsValidator` | Add pagination to a query that already uses it, changing cursor format | Read the actual query code; verify `.paginate()` is not already present before migrating |
| `@convex-dev/workflow` `cancel()` | Pass stored string as `Id<"_scheduled_functions">` without verifying format | Read workflow component type definitions; verify stored IDs are runtime-compatible with expected type |
| ExcelJS migration from `xlsx` | Port array-of-arrays API to builder pattern, miss column definitions | Write an end-to-end test that reads the output file back; assert headers and values explicitly |
| Convex audit table writes | Add DB insert to utility function called inside extraction loops | Audit all call sites; add persistence only for security-sensitive callers, not hot-path processing |
| `convex-helpers` `filter()` | Replace with index-based filter, invalidating cursor format | New cursor format is incompatible with old bookmarked URLs; add cursor migration or catch and reset |
| nuqs URL state with Convex cursors | Store raw Convex cursor bytes in URL | nuqs handles serialization; the issue is cursor format changes between query implementations, not storage |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `decryptApiKey` with audit table write in extraction loop | Extraction mutations slow 10x; OCC retries spike | Audit only security-sensitive callers; batch or defer writes for hot-path callers | Extractions with 50+ papers |
| Per-user credit workpool with `maxParallelism: 1` | Extraction job duration grows linearly with paper count | Do not implement unless negative balance incident observed | 10+ concurrent paper extractions for same user |
| `filter().paginate()` for collection membership with large libraries | Query reads all user items to find collection members | Pre-filter by `by_collection` index before applying `filter()` | Libraries with 5,000+ items |
| Subscription cron fetching 1,000 records without circuit-breaker | Cron exceeds Convex action time limit; next cron fires while previous runs | Add cursor-based pagination and time-budget check inside cron | 1,000+ active subscriptions |
| Synchronous XLSX bundle load | Initial page load includes 500KB XLSX library even for non-exporters | Dynamic `import('xlsx')` inside the export handler | First user load on slow connections |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Audit table write added to `decryptApiKey` called in hot paths | Audit table grows proportionally to extraction size, not to security events — obscures real audit trail | Only persist audit events for user-facing key access operations; use `console.log` for internal use |
| `dangerouslySetInnerHTML` with AI-generated answer text | XSS via paper title or AI answer containing `<script>` or event handlers | Replace with React component that splits on match; test with HTML characters in both text and query |
| `assertPlanPriceConfig()` called at module scope | Module fails to load in environments without Stripe config, blocking all functions including non-billing ones | Call only at the point of use inside Stripe-dependent handlers |
| Rate limit exhaustiveness bypass via `as any` | Invalid rate limit name silently fails to enforce limit | Runtime validation against `Object.keys(rateLimitConfig)`; throw for unrecognized names |
| Workflow ID type mismatch hidden by `as any` | Workflow cancel silently fails if ID format changes after component update | Validate stored ID format against component expectations; write cancellation test |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Highlight disappears after XSS fix | Search highlighting stops working; users think search is broken | Verify highlight works with case-insensitive, special-character queries before shipping the React replacement |
| Cursor invalidation after pagination query change | Bookmarked library URLs show blank page with no error | Catch cursor decode errors in the library page; reset to page 1 with a toast explaining the URL was refreshed |
| ExcelJS migration breaks existing `.xlsx` files | Users get "Excel found problems" dialog; blame the app | Test output files in actual Excel/LibreOffice before shipping; use round-trip read test |
| Credit TOCTOU mitigation adds latency to paper processing | Extraction jobs feel slower; users cancel and retry | Never add synchronous serialization to the hot extraction path; measure before implementing |
| Env var validation error blocks billing page load | Users cannot subscribe or purchase credits; silent failure | Validate env vars lazily inside handlers; never block page load with validation |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **`as any` removal in `maintenance/internal.ts`:** Verify the fix works when `fresh.customer` is a plain string (the common case). Test with expanded customer object too. Both paths must extract a non-null customer ID.
- [ ] **XSS fix in `highlightText`:** Verify HTML characters in paper titles (e.g., `<em>Study</em>`) render as escaped text, not as HTML. Verify the `<mark>` highlight is still applied correctly around the matched substring.
- [ ] **ExcelJS migration (if pursued):** Open the exported file in Excel or LibreOffice. Assert row count, header presence, and cell values via round-trip read test. "No exception thrown" is not sufficient.
- [ ] **Audit table implementation:** Verify `decryptApiKey` calls from extraction processing paths do NOT write to the audit table. Verify explicit API key access calls (user settings, Zotero connection) DO write to the audit table.
- [ ] **Env var validation:** After adding validation calls, run `npx convex deploy` in an environment with only non-Stripe env vars set. Verify non-billing queries still work correctly.
- [ ] **Rate limiter `name` fix:** After removing `as any`, add a new rate limit to the config and verify it is automatically valid in the `consume` mutation without any additional code changes.
- [ ] **Workflow ID type fix:** After removing `workflow.cancel(ctx, job.workflowId as any)`, cancel an active extraction job and verify the workflow actually stops scheduling new steps. Check Convex logs for workflow step attempts after cancellation.
- [ ] **Credit concurrency test:** The new test must simulate two concurrent deductions on the same user and assert NO negative balance results. Assert that exactly one deduction succeeds for each credit unit.
- [ ] **Library query pagination (if any work done):** Bookmarked URL with old cursor should either work or gracefully reset to page 1 — never show a blank page or error.
- [ ] **Dynamic XLSX import:** Measure the bundle size of `lib/extraction/export.ts` before and after. The 500KB XLSX chunk should NOT appear in the initial bundle analysis.

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `as any` removal breaks subscription correction (customer `undefined`) | MEDIUM | Rollback `maintenance/internal.ts` to previous version; add test; re-deploy typed fix |
| Cursor format change breaks existing library URLs | LOW | Deploy query with cursor parse error handling (catch + reset to page 1); no data loss |
| ExcelJS migration produces corrupt files | MEDIUM | Revert to `xlsx` or dynamic `xlsx` import; file users exported with corrupted format are already downloaded, no server-side recovery |
| Audit table writes slow extraction mutations | MEDIUM | Remove `ctx.db.insert` from `decryptApiKey`; replace with `console.log`; schedule data backfill cron if audit records are needed |
| `assertPlanPriceConfig()` at module scope blocks billing | HIGH | Immediate deploy moving call inside function handler; every billing action is failing until resolved |
| Rate limit exhaustiveness gap allows unthrottled access | LOW | Add missing name to the runtime validation set; re-deploy; no data was corrupted |
| Workflow cancel fails silently after `as any` removal | MEDIUM | Re-add temporary `as any` with comment explaining why; file issue against `@convex-dev/workflow` for clarification on expected ID type |
| Credit TOCTOU workpool causes extraction slowdown | MEDIUM | Remove per-user workpool; revert to Convex OCC protection; no correctness issue results |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `as any` breaks runtime (Stripe customer union) | Type-safety sweep — do `maintenance/internal.ts` last, with test first | Test both customer shapes (string and expanded object) pass before deploy |
| Library cursor invalidation from pagination change | Library query phase — read actual code first | Confirm `.paginate()` already present; no cursor format change needed |
| ExcelJS API difference breaks output | Bundle optimization phase — start with dynamic import, not library swap | Round-trip read test before shipping |
| `dangerouslySetInnerHTML` React replacement breaks highlighting | XSS fix phase — write failing test first | XSS test + highlighting test both pass; visual regression check in browser |
| Audit table writes in hot paths | Security/audit phase — define audit scope before writing code | Extraction mutation latency unchanged after audit table addition |
| Env var validation blocks module load | Env validation phase — test without Stripe env vars | Non-billing functions work without `STRIPE_*` env vars set |
| Stripe type narrowing crashes webhook for string customer | Type-safety sweep — specifically `maintenance/internal.ts` | Maintenance cron runs without errors in staging; corrections applied |
| Rate limiter `as any` breaks exhaustiveness | Type-safety sweep — fix before adding new rate limits | New rate limit name valid in `consume` without code change |
| Workflow ID type mismatch | Type-safety sweep — research `@convex-dev/workflow` types first | Cancellation test passes; workflow stops scheduling after cancel |
| Credit TOCTOU workpool deadlock | Credit concurrency test phase — verify OCC sufficient before implementing workpool | Concurrency test shows no negative balance; no workpool needed |

---

## Sources

- Codebase inspection: `convex/maintenance/internal.ts:100-103`, `convex/library/queries.ts:69-83`, `lib/extraction/export.ts:1-2`, `components/extraction/results-views/table-view.tsx:293-297`, `convex/lib/rateLimit.ts:52`, `convex/lib/crypto.ts:81-86`, `convex/lib/constants.ts:55-58`, `convex/extraction/mutations.ts:263`, `convex/credits/internal.ts:1238-1280` — HIGH confidence
- `.planning/codebase/CONCERNS.md` — audit of known issues — HIGH confidence
- Prior research: `.planning/research/PITFALLS.md` (v2.3 hardening), `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md` — HIGH confidence (Pitfall 5 and 6 from v2.3 remain directly relevant to env var validation in v3.0)
- [Convex Transaction Limits](https://docs.convex.dev/production/state/limits) — 16,000 writes per transaction — HIGH confidence
- [Convex When to Use Return Validators](https://stack.convex.dev/when-to-and-when-not-to-use-return-validators) — runtime enforcement behavior — HIGH confidence
- [Convex Workflow Component](https://www.convex.dev/components/workflow) — cancel semantics — HIGH confidence
- [Convex Workpool Component](https://www.convex.dev/components/workpool) — cancellation does not stop in-progress work — HIGH confidence

---
*Pitfalls research for: v3.0 Zero-Any Overhaul — OpenAlex Count*
*Researched: 2026-03-03*
