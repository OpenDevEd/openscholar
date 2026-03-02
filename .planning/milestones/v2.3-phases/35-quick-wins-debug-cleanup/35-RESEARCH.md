# Phase 35: Quick Wins & Debug Cleanup - Research

**Researched:** 2026-03-02
**Domain:** Debug artifact removal, config safety, dead code deletion (Next.js + Convex)
**Confidence:** HIGH

## Summary

Phase 35 addresses eight requirements spanning bug fixes (BUG-01/02/03), security hardening (SEC-02/03/04), and dead code removal (DATA-04/05). All changes are localized, low-risk, and have no external dependencies -- making this an ideal first phase for v2.3.

The codebase currently ships debug `console.log` statements in two production files (billing settings page and OpenAlex server action), has a `@ts-ignore` suppression hiding a field name mismatch, initializes Stripe with a `"dummy"` fallback key in three files, falls back `NEXT_PUBLIC_APP_URL` to `localhost:3000` in three files, and exports debug/test functions from the extraction module -- some of which are public mutations/queries gated by `requirePublicDebugEnabled()` but others are internal and ungated. Additionally, ~70 lines of V32_CUTOVER_AT version-gating logic and two backfill mutations (`backfillIsIndexed`, `backfillProcessable`) represent dead legacy code that should be deleted entirely.

**Primary recommendation:** Treat this as a purely subtractive/corrective phase -- delete debug artifacts, replace unsafe patterns with fail-fast alternatives, and remove dead code. No new features, no new abstractions.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BUG-01 | Debug console.log removed from billing settings page | Exact locations identified: `app/settings/billing/page.tsx` lines 66, 75, 208, 211, 219, 230, 233, 235, 237, 337 (10 statements). Delete all. |
| BUG-02 | Debug console.log removed from OpenAlex server action | Exact locations identified: `app/actions/openalex.ts` lines 13, 18, 23, 35 (4 statements). Also `app/api/openalex/search/route.ts` line 57 (1 statement in API route). Delete all. |
| BUG-03 | @ts-ignore removed from debug_papers.ts with proper typing or field removal | `convex/debug_papers.ts:20-21` references `p.pdfUsed` which does not exist in schema. Correct field name is `pdfContentUsed` (verified in `convex/schema.ts:348`). |
| SEC-02 | Stripe "dummy" key fallback replaced with lazy init | Three files: `convex/subscriptions/actions.ts:39`, `convex/credits/actions.ts:31`, `convex/maintenance/internal.ts:11`. Replace with lazy `getStripe()` pattern documented in Pitfalls research. |
| SEC-03 | NEXT_PUBLIC_APP_URL validated in non-dev environments | Three files: `convex/http.ts:11-14`, `convex/subscriptions/actions.ts:43-46`, `convex/credits/actions.ts:26-29`. Add validation function that throws at function entry (not module scope). |
| SEC-04 | Debug/test functions gated behind requirePublicDebugEnabled() | Public-facing ungated: none currently (all public debug funcs already gated). Internal test functions (`test_runner.ts`, `test_automation.ts`, `test_automation_internal.ts`, `test_helpers.ts`, `testWorkflow.ts`) are internal-only and thus not client-callable -- but success criteria says they should be gated. |
| DATA-04 | V32_CUTOVER_AT gating code deleted entirely | `convex/extraction/workpoolActions.ts` lines 111, 179-187 (constant + `isV32EnabledForJob` function) and guard calls at lines 815, 978. Delete constant, function, and all guard calls. |
| DATA-05 | One-time backfill mutations deleted | `convex/extraction/mutations.ts`: `backfillIsIndexed` (lines 1763-1792), `backfillProcessable` (lines 1794-1819). Also `resetExtractionMvpData` (lines 1957-2020) and `purgeLegacyExtractionRowsBatch` (lines 2022-2055). Remove from `convex/extraction/index.ts` exports too. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase is purely subtractive -- removing code and replacing patterns.

| Library | Version | Purpose | Already Installed |
|---------|---------|---------|-------------------|
| stripe | SDK v20.3.0+ | Stripe API client (lazy init pattern) | Yes |
| convex | Existing | Backend framework | Yes |
| next | Existing | Frontend framework | Yes |

### Supporting

None. No new dependencies.

### Alternatives Considered

None. This phase does not introduce anything new.

## Architecture Patterns

### Pattern 1: Lazy Stripe Initialization

**What:** Replace module-scope `new Stripe("dummy")` with a lazy singleton that validates on first use.
**When to use:** Any module that instantiates Stripe at module scope.
**Why:** Module-scope throws break ALL functions in the module, including non-Stripe ones. Lazy init only fails the specific function that needs Stripe.

```typescript
// Source: .planning/research/PITFALLS.md (Pitfall 5, verified pattern)
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Stripe operations are unavailable."
      );
    }
    _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" });
  }
  return _stripe;
}
```

**Files to apply:** `convex/subscriptions/actions.ts`, `convex/credits/actions.ts`, `convex/maintenance/internal.ts`

**After applying:** Replace all `stripe.` references with `getStripe().` in function handlers within those files. The variable `stripe` at module scope is deleted.

### Pattern 2: Env Var Validation at Function Entry

**What:** Validate `NEXT_PUBLIC_APP_URL` inside the function that uses it, not at module scope.
**When to use:** Any env var that differs between dev/staging/production and whose absence causes silent misbehavior.
**Why:** Module-scope validation breaks dev/CI environments that do not set production env vars.

```typescript
// Create a shared utility in convex/lib/env.ts (or inline)
function requireAppUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL;
  if (!url) {
    // Allow localhost fallback only in development
    if (process.env.CONVEX_CLOUD_URL?.includes("localhost") ||
        process.env.NODE_ENV === "development") {
      return "http://localhost:3000";
    }
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not configured. " +
      "Set this environment variable to your production URL."
    );
  }
  return url;
}
```

**Files to apply:** `convex/http.ts`, `convex/subscriptions/actions.ts`, `convex/credits/actions.ts`

**After applying:** Replace `const DOMAIN = process.env.NEXT_PUBLIC_APP_URL || ...` with calls to `requireAppUrl()` inside the function handlers that reference DOMAIN, or keep a module-scope constant that uses the utility but only in functions that actually need it.

### Pattern 3: Debug Function Gating

**What:** All public-facing debug/test functions MUST call `requirePublicDebugEnabled()` as the first line of their handler.
**Current state:** Public `query`/`mutation` debug functions (`diagnoseJob`, `getFailedPapersDebug`, `createTestJob`, `createTestJobForFix`) are already gated. Internal functions (`internalQuery`/`internalMutation`/`internalAction`) are NOT client-callable, so gating them is optional but the success criteria explicitly require it.

```typescript
// Already exists at convex/lib/debug_gate.ts
import { requirePublicDebugEnabled } from "../lib/debug_gate";

export const someDebugFunction = internalQuery({
  handler: async (ctx) => {
    requirePublicDebugEnabled(); // Add this line
    // ... rest of handler
  },
});
```

### Anti-Patterns to Avoid

- **Do not throw at module scope for env var validation:** This breaks all functions in the module, including unrelated ones. Always validate inside function handlers.
- **Do not replace console.log with a custom logger in this phase:** The goal is deletion, not replacement. If structured logging is desired, it belongs in a separate phase.
- **Do not add `process.env.NODE_ENV` guards around console.log:** Delete the statements entirely. They are debug artifacts, not operational logs. The codebase uses `console.error` and `console.warn` for operational logging (those stay).
- **Do not migrate V32_CUTOVER_AT to a schema field:** Per REQUIREMENTS.md Out of Scope: "V32_CUTOVER_AT migration to schema field -- Pre-production build -- delete entirely instead of migrating."
- **Do not fix backfill mutations:** Per REQUIREMENTS.md Out of Scope: "Backfill mutation fixes -- Pre-production build -- delete entirely instead of fixing."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stripe lazy singleton | Custom dependency injection | Simple closure pattern (shown above) | The closure pattern is 6 lines, well-understood, and used across the Node.js ecosystem |
| Env var validation | Custom config management system | Simple `requireAppUrl()` utility function | The validation logic is trivial; a config system adds indirection for no benefit |
| Debug function gating | Role-based access control | Existing `requirePublicDebugEnabled()` function | Already built and deployed; just call it |

**Key insight:** This phase is about removing code, not adding abstractions. Every addition should be minimal (a few-line function, not a framework).

## Common Pitfalls

### Pitfall 1: Stripe Lazy Init Breaks Module-Level `stripe` References

**What goes wrong:** After converting to `getStripe()`, any code that references the old `stripe` constant at module scope (outside a function handler) will fail.
**Why it happens:** The old pattern declares `const stripe = new Stripe(...)` at module scope. Other module-scope code may reference it.
**How to avoid:** Search each file for ALL references to the old `stripe` variable. In `convex/subscriptions/actions.ts`, `convex/credits/actions.ts`, and `convex/maintenance/internal.ts`, all Stripe usage is inside function handlers, so `getStripe()` works as a drop-in replacement.
**Warning signs:** TypeScript compile error on `stripe.` references after deletion.

### Pitfall 2: V32_CUTOVER_AT Deletion Breaks the Guard Path

**What goes wrong:** The `isV32EnabledForJob(createdAt)` function is called at two points in `workpoolActions.ts` (lines 815 and 978). Simply deleting the function without also deleting the call sites causes a compile error.
**Why it happens:** The guard returns early with an error message. Deleting the function but not the if-blocks leaves dead branches.
**How to avoid:** Delete in order: (1) both `if (!isV32EnabledForJob(...))` blocks, (2) the `isV32EnabledForJob` function, (3) the `V32_CUTOVER_AT` constant, (4) the `EXTRACTION_V3_2_CUTOVER_AT` env var reference. Verify no other file references these.
**Warning signs:** `npx convex dev` (or `tsc`) fails after deletion.

### Pitfall 3: Deleting Backfill Mutations Without Removing Exports

**What goes wrong:** `convex/extraction/index.ts` re-exports `backfillIsIndexed`, `backfillProcessable`, `resetExtractionMvpData`, and `purgeLegacyExtractionRowsBatch`. Deleting from `mutations.ts` without removing exports causes a compile error.
**Why it happens:** The barrel file (`index.ts`) has explicit named exports from `./mutations`.
**How to avoid:** After deleting from `mutations.ts`, remove corresponding export lines from `index.ts` (lines 56-60 approximately). Run `npx convex typecheck` to verify.
**Warning signs:** TypeScript error about missing exports.

### Pitfall 4: Replacing console.log in Billing Page Breaks Render Flow

**What goes wrong:** Some `console.log` calls in `app/settings/billing/page.tsx` are interleaved with control flow (e.g., `console.log("[BILLING] Blocked - already loading"); return;`). Blindly deleting entire lines could break the `return` on the next line.
**Why it happens:** Debug logging was added inline with guard clauses.
**How to avoid:** Delete only the `console.log(...)` statement, preserve the surrounding control flow. Read the full function context before each deletion.
**Warning signs:** The billing page stops responding to clicks (because an early-return guard was accidentally deleted).

### Pitfall 5: debug_papers.ts Field Fix May Need Schema Check

**What goes wrong:** Changing `p.pdfUsed` to `p.pdfContentUsed` compiles but returns the wrong data if the field was renamed or removed between schema versions.
**Why it happens:** The `convex/debug_papers.ts` file is a root-level file separate from `convex/extraction/debug_papers.ts`. The root-level file references the `extractionPapers` table.
**How to avoid:** Verify `pdfContentUsed` exists in the `extractionPapers` schema definition (`convex/schema.ts:348`). It does: `pdfContentUsed: v.optional(v.boolean())`. The fix is confirmed correct.
**Warning signs:** None -- this is a clean fix.

## Code Examples

### Example 1: Deleting console.log from billing page

```typescript
// BEFORE (app/settings/billing/page.tsx)
console.log("[BILLING] isLoading changed:", isLoading);

// AFTER -- line deleted entirely. No replacement needed.
```

### Example 2: Fixing debug_papers.ts

```typescript
// BEFORE (convex/debug_papers.ts:20-21)
// @ts-ignore
pdfUsed: p.pdfUsed

// AFTER
pdfContentUsed: p.pdfContentUsed
```

### Example 3: Lazy Stripe init (convex/subscriptions/actions.ts)

```typescript
// BEFORE (line 39)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

// AFTER
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Stripe operations are unavailable."
      );
    }
    _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" });
  }
  return _stripe;
}

// Then in handlers: getStripe().subscriptions.retrieve(...)
// instead of:       stripe.subscriptions.retrieve(...)
```

### Example 4: NEXT_PUBLIC_APP_URL validation

```typescript
// BEFORE (convex/subscriptions/actions.ts:43-46)
const DOMAIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_URL ||
  "http://localhost:3000";

// AFTER -- helper function (could live in convex/lib/env.ts)
function requireAppUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL;
  if (!url) {
    if (process.env.CONVEX_CLOUD_URL?.includes("localhost") ||
        process.env.NODE_ENV === "development") {
      return "http://localhost:3000";
    }
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not configured. " +
      "Set this environment variable to your production URL."
    );
  }
  return url;
}

// In handlers: const domain = requireAppUrl();
```

### Example 5: Deleting V32_CUTOVER_AT code

```typescript
// DELETE these from convex/extraction/workpoolActions.ts:

// Line 111 -- delete constant
const V32_CUTOVER_AT = Number(process.env.EXTRACTION_V3_2_CUTOVER_AT || "0");

// Lines 179-187 -- delete function
function isV32EnabledForJob(createdAt?: number) { ... }

// Lines 815-820 (inside downloadAndIndexPdfAction handler) -- delete guard block
if (!isV32EnabledForJob(job.createdAt)) {
  return {
    success: false,
    error: "This job predates EXTRACTION_V3_2_CUTOVER_AT...",
  };
}

// Lines 978-984 (inside waitAndExtractAction handler) -- delete guard block
if (!isV32EnabledForJob(job.createdAt)) {
  return {
    success: false,
    error: "This job predates EXTRACTION_V3_2_CUTOVER_AT...",
  };
}
```

### Example 6: Deleting backfill mutations from index.ts

```typescript
// DELETE from convex/extraction/index.ts (lines ~56-60):
export {
  // ... keep other exports ...
  backfillIsIndexed,        // DELETE
  backfillProcessable,      // DELETE
  resetExtractionMvpData,   // DELETE (also legacy one-time mutation)
  purgeLegacyExtractionRowsBatch, // DELETE (also legacy one-time mutation)
} from "./mutations";
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stripe `"dummy"` fallback at module scope | Lazy `getStripe()` singleton with fail-fast | Standard practice | Prevents silent misconfiguration in production |
| `console.log` for debugging | Structured logging or deletion | Always been best practice | Clean production logs |
| `@ts-ignore` to suppress type errors | Fix the underlying type issue | Always been best practice | Type safety maintained |
| Version-gating by timestamp env var | Delete entirely (pre-production artifact) | v2.3 | Simpler codebase, no runtime checks needed |

## Detailed File Inventory

### Files that need console.log removal

| File | Lines | Count | Notes |
|------|-------|-------|-------|
| `app/settings/billing/page.tsx` | 66, 75, 208, 211, 219, 230, 233, 235, 237, 337 | 10 | All `[BILLING]` prefixed debug logs |
| `app/actions/openalex.ts` | 13, 18, 23, 35 | 4 | Query params and SDK response logging |
| `app/api/openalex/search/route.ts` | 57 | 1 | Search params logging (same pattern as openalex.ts) |

**Note:** `console.error` calls (e.g., `app/actions/openalex.ts:29`) are operational error logging and should be KEPT.

### Files that need Stripe lazy init

| File | Current Line | Current Pattern |
|------|-------------|-----------------|
| `convex/subscriptions/actions.ts` | 39 | `const stripe = new Stripe(... \|\| "dummy", ...)` |
| `convex/credits/actions.ts` | 31 | `const stripe = new Stripe(... \|\| "dummy", ...)` |
| `convex/maintenance/internal.ts` | 11 | `const stripe = new Stripe(... \|\| "dummy", ...)` |

### Files that need NEXT_PUBLIC_APP_URL validation

| File | Current Lines | Variable Name |
|------|--------------|---------------|
| `convex/http.ts` | 11-14 | `FRONTEND_URL` |
| `convex/subscriptions/actions.ts` | 43-46 | `DOMAIN` |
| `convex/credits/actions.ts` | 26-29 | `DOMAIN` |

### Debug/test function gating audit

| File | Function | Type | Gated? | Action Needed |
|------|----------|------|--------|---------------|
| `convex/extraction/debug.ts` | `diagnoseJob` | `query` (public) | YES | None |
| `convex/extraction/debug_errors.ts` | `getFailedPapersDebug` | `query` (public) | YES | None |
| `convex/extraction/testActions.ts` | `createTestJob` | `mutation` (public) | YES | None |
| `convex/extraction/create_test_job.ts` | `createTestJobForFix` | `mutation` (public) | YES | None |
| `convex/extraction/debug_papers.ts` (extraction/) | `getPaperErrorsInternal` | `internalQuery` | NO | Not client-callable, but success criteria says gate it |
| `convex/extraction/debug_paper_results.ts` | `debugPaperResults` | `internalQuery` | NO | Not client-callable, but success criteria says gate it |
| `convex/extraction/debug_job_content.ts` | `debugJobContent` | `internalQuery` | NO | Not client-callable, but success criteria says gate it |
| `convex/extraction/debug_job_citations.ts` | `debugJobCitations` | `internalQuery` | NO | Not client-callable, but success criteria says gate it |
| `convex/extraction/debug_pdfjs_alignment.ts` | `debugPdfAlignment` | `internalAction` | NO | Not client-callable, but success criteria says gate it |
| `convex/extraction/test_automation.ts` | `runPdfTestNow` | `internalAction` | NO | Gate per success criteria |
| `convex/extraction/test_automation_internal.ts` | `getFirstUserId` | `internalQuery` | NO | Gate per success criteria |
| `convex/extraction/test_automation_internal.ts` | `createTestJob` | `internalMutation` | NO | Gate per success criteria |
| `convex/extraction/test_automation_internal.ts` | `getJobStatus` | `internalQuery` | NO | Gate per success criteria |
| `convex/extraction/test_automation_internal.ts` | `getJobResults` | `internalQuery` | NO | Gate per success criteria |
| `convex/extraction/test_runner.ts` | `createAndRunTestJob` | `internalMutation` | NO | Gate per success criteria |
| `convex/extraction/test_runner.ts` | `getTestJobStatus` | `internalMutation` | NO | Gate per success criteria |
| `convex/extraction/testWorkflow.ts` | `testSimpleWorkflow` | workflow.define | NO | Cannot gate (workflow step function); leave as-is |
| `convex/extraction/test_helpers.ts` | `getOrCreateTestUser` | helper function | NO | Not exported via index.ts; utility function only |
| `convex/extraction/test_helpers.ts` | `cleanupTestData` | helper function | NO | Not exported via index.ts; utility function only |

**Note on `convex/debug_papers.ts` (root-level):** This is a separate file from `convex/extraction/debug_papers.ts`. The root-level one has the `@ts-ignore` bug (BUG-03). It exports an `internalQuery` called `recent`.

### V32_CUTOVER_AT code to delete

| File | Lines | What |
|------|-------|------|
| `convex/extraction/workpoolActions.ts` | 111 | `const V32_CUTOVER_AT = ...` constant |
| `convex/extraction/workpoolActions.ts` | 179-187 | `isV32EnabledForJob()` function |
| `convex/extraction/workpoolActions.ts` | 815-820 | Guard in `downloadAndIndexPdfAction` |
| `convex/extraction/workpoolActions.ts` | 978-984 | Guard in `waitAndExtractAction` |

### Backfill/legacy mutations to delete

| File | Lines | Function | Reason |
|------|-------|----------|--------|
| `convex/extraction/mutations.ts` | 1763-1792 | `backfillIsIndexed` | One-time backfill, no longer needed |
| `convex/extraction/mutations.ts` | 1794-1819 | `backfillProcessable` | One-time backfill, no longer needed |
| `convex/extraction/mutations.ts` | 1957-2020 | `resetExtractionMvpData` | One-time data reset utility |
| `convex/extraction/mutations.ts` | 2022-2055 | `purgeLegacyExtractionRowsBatch` | One-time legacy row cleanup |
| `convex/extraction/index.ts` | ~56-60 | exports for above | Barrel file re-exports |

## Open Questions

1. **Should the root-level `convex/debug_papers.ts` be deleted entirely or just fixed?**
   - What we know: It is an `internalQuery` that fetches the 5 most recent `extractionPapers`. The `@ts-ignore` on `pdfUsed` references a non-existent field.
   - What's unclear: Whether this query serves any operational purpose or is purely a debug artifact.
   - Recommendation: Fix the field name to `pdfContentUsed` (minimum fix per BUG-03). If the planner decides it is dead code, it can be deleted entirely and removed from `convex/extraction/index.ts:97`.

2. **Should `convex/extraction/testWorkflow.ts` be deleted as dead code?**
   - What we know: It defines a `testSimpleWorkflow` that is exported via `index.ts:8`. It is a workflow definition, not a query/mutation, so `requirePublicDebugEnabled()` cannot be called inside it (workflow steps have a different execution model).
   - What's unclear: Whether any production path invokes this workflow, or if it was only for development.
   - Recommendation: The planner should consider deleting this file and its export entirely, since it appears to be a one-time development artifact. If kept, it cannot be gated.

3. **Should `app/api/openalex/search/route.ts:57` also have its console.log removed?**
   - What we know: This API route has the same debug `console.log` pattern as the OpenAlex server action. BUG-02 specifically mentions "OpenAlex server action," but this is an API route handler.
   - Recommendation: Delete it too -- it is the same debug pattern and same risk (logging all search params to stdout).

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of all files listed above
- `convex/schema.ts:348` -- confirmed `pdfContentUsed` is the correct field name
- `convex/lib/debug_gate.ts` -- verified existing gate implementation
- `.planning/research/PITFALLS.md` (Pitfall 5) -- verified lazy Stripe pattern
- `.planning/research/PITFALLS.md` (Pitfall 6) -- verified env var validation pattern
- `.planning/codebase/CONCERNS.md` -- verified all concern descriptions match current code

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES_v2.3_HARDENING.md` -- feature landscape aligns with requirements
- `.planning/REQUIREMENTS.md` Out of Scope section -- confirms delete-over-migrate approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, purely subtractive
- Architecture: HIGH -- patterns verified against existing codebase and prior research
- Pitfalls: HIGH -- each pitfall verified against actual code locations and line numbers

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no external dependencies)
