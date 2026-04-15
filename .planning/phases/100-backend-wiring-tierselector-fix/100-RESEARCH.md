# Phase 100: Backend Wiring + TierSelector Fix - Research

**Researched:** 2026-04-15
**Domain:** Convex backend mutations/actions, OpenAlex API integration, error routing, extraction cascade filtering
**Confidence:** HIGH

## Summary

Phase 100 wires the TierSelector UI value through the Convex backend pipeline (schema -> mutation -> workpool -> cascade) and creates two new OpenAlex API actions (`resolveManualIds` and `resolveByDoi`). It also adds a server-side hard-reject error (`EXTRACTION_LIMIT_EXCEEDED`) with full i18n toast routing and cleans up an inline string-matching error handler in `extraction-dialog.tsx`.

The codebase is extremely well-structured for this work. The error system (`convex/lib/errors.ts` -> `lib/toast/error-resolver.ts` -> locale files) has a clear extension pattern. The cascade in `convex/extraction/extract.ts` is a pure function (`createCascadeTiers()`) that returns an array of 3 tiers -- filtering it by index is trivial. The OpenAlex API supports batch ID filtering (up to 100 pipe-separated values per request) and single DOI lookup, both well-documented.

**Primary recommendation:** Execute the 5-edit TierSelector threading first (schema -> mutation args -> job insert -> workpool read -> cascade filter), then add the two OpenAlex actions, then wire the error system. All work is backend-only with no migration.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add optional `tier` field to `extractionJobs` table: `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))`. No migration -- existing rows remain `undefined` and null-coalesce to `"auto"` at read time. `ModelTier` type from `tier-selector.tsx` is canonical.
- **D-02:** `createExtractionJob` mutation accepts new optional `tier` arg (defaults to `"auto"` if omitted), persists on job row. ExtractionDialog passes its existing `tier` state to the mutation call.
- **D-03:** `createCascadeTiers()` accepts optional `tier?: ModelTier`. `"auto"`/undefined = all 3 tiers; `"accurate"` = top tier only (last element); `"cheap"` = bottom tier only (first element).
- **D-04:** Workpool action reads `tier` from job row and passes to `createCascadeTiers(tier)`. Threading path: ExtractionDialog -> mutation -> workpool -> `createCascadeTiers(tier)`.
- **D-05:** Create `convex/openalex/actions.ts` with `resolveManualIds` (batch W\d+ validation via OpenAlex API) and `resolveByDoi` (single DOI lookup).
- **D-06:** Both actions use Convex `action` (not mutation) for external HTTP. Use `OPENALEX_CONTACT_EMAIL` env var for polite pool.
- **D-07:** Add `EXTRACTION_LIMIT_EXCEEDED` to `ErrorCode` union in `convex/lib/errors.ts`.
- **D-08:** Map `EXTRACTION_LIMIT_EXCEEDED` in `lib/toast/error-resolver.ts` to new `ToastErrorMessageKey`. Add i18n keys in all 6 locale files.
- **D-09:** Fix inline string-matching for `EXTRACTION_JOB_ALREADY_ACTIVE` in `extraction-dialog.tsx` to route through `resolveToastError`.

### Claude's Discretion
- Internal naming for helper functions within the OpenAlex actions module
- Batch size for OpenAlex API calls in `resolveManualIds` (e.g., batch of 50 IDs per request to stay within URL length limits)
- Exact error message wording for `EXTRACTION_LIMIT_EXCEEDED` across 6 locales
- Whether to add a `convex/openalex/` directory index file or keep it flat
- Test file organization for the new actions and cascade filtering

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEL-05 | User pastes OpenAlex IDs, resolved and added to basket via `resolveManualIds` | D-05/D-06: OpenAlex batch filter API supports up to 100 pipe-separated IDs per request; `normalizeOpenAlexId` handles mixed input formats |
| LIM-07 | `createExtractionJob` hard-rejects over-limit with typed `EXTRACTION_LIMIT_EXCEEDED` error routed to localized toast | D-07/D-08: Error system extension pattern verified; `getExtractionLimitForUser` already in mutation; 6 locale files identified |
| TIER-01 | TierSelector value persisted as optional `tier` field on `extractionJobs` row | D-01/D-02: Schema field addition verified; no migration needed; `ModelTier` type reused |
| TIER-02 | Workpool reads `tier` from job row, calls `createCascadeTiers(tier)` to filter cascade | D-03/D-04: `extractSingleAnswer` calls `createCascadeTiers()` at line 227; workpool action reads job at line 50-57; threading path confirmed |
| TIER-03 | Unit test asserts tier selection filters the cascade | Existing `extract.test.ts` provides mock pattern for `generateText`; `createCascadeTiers` can be tested via `extractAnswers` with mocked generateText |
| ZOT-03 | `resolveByDoi` returns within 10 seconds with resolved OpenAlex ID | D-05/D-06: Single DOI lookup via `https://api.openalex.org/works?filter=doi:{doi}` with `AbortSignal.timeout(10_000)` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tier field persistence | Database / Storage | -- | Schema change on `extractionJobs` table; Convex handles persistence |
| Tier threading through pipeline | API / Backend | -- | Mutation args -> job row -> workpool action -> cascade function; all server-side |
| Cascade filtering logic | API / Backend | -- | Pure function `createCascadeTiers(tier)` in `convex/extraction/extract.ts` |
| OpenAlex ID resolution | API / Backend | -- | Convex actions calling external OpenAlex HTTP API |
| DOI-to-OpenAlex resolution | API / Backend | -- | Convex action calling external OpenAlex HTTP API |
| Server-side limit rejection | API / Backend | -- | Mutation throws typed `ConvexError` before job creation |
| Error toast routing | Browser / Client | API / Backend | Backend throws typed error; client `resolveToastError` maps code to i18n key |
| i18n message keys | Browser / Client | -- | 6 locale JSON files with interpolated error messages |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | existing | Backend mutations, actions, schema | Project's backend; all DB operations go through Convex |
| convex-test | ^0.0.46 | Unit testing Convex functions | Already in devDependencies; required for TIER-03 |
| vitest | ^3.2.4 | Test runner | Already configured with edge-runtime for Convex tests |
| @edge-runtime/vm | ^5.0.0 | Test environment for Convex | Already in devDependencies |

[VERIFIED: package.json devDependencies]

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next-intl | existing | i18n for toast messages | Already used for all localized strings |
| sonner | existing | Toast notifications | Already used via `showStyledToast` |
| convex/values | existing | Validators (v.optional, v.union, v.literal) | Required for schema and arg validators |

### Alternatives Considered
None -- all decisions are locked. No new dependencies needed.

## Architecture Patterns

### System Architecture Diagram

```
ExtractionDialog (client)
  |
  | tier: "auto" | "cheap" | "accurate"
  v
createExtractionJob (mutation)
  |
  |-- 1. Validate paper count <= getExtractionLimitForUser()
  |     |-- FAIL: throw EXTRACTION_LIMIT_EXCEEDED --> resolveToastError --> i18n toast
  |     |-- PASS: continue
  |
  |-- 2. Insert job row with { ...existing, tier: args.tier ?? "auto" }
  |
  |-- 3. Start extraction workflow
  v
runExtractionWorkflow (workflow)
  |
  v
enqueueAllPapers (internal mutation)
  |
  v
processExtractionPaper (workpool action)
  |
  |-- Reads job.tier from job row
  |
  v
extractAnswers(bodyText, questions, ...)
  |
  |-- Calls extractSingleAnswer() per question
  |     |
  |     v
  |   createCascadeTiers(tier)
  |     |-- "auto"/undefined: [flash-lite, flash, haiku] (all 3)
  |     |-- "cheap":          [flash-lite]              (index 0 only)
  |     |-- "accurate":       [haiku]                   (index 2 only)
  |     v
  |   Cascade loop: try each tier with 2 attempts
  v
saveResult (internal mutation)
```

```
resolveManualIds (action)                  resolveByDoi (action)
  |                                          |
  |-- Parse raw input lines                  |-- Validate DOI format
  |-- normalizeOpenAlexId() each             |-- Call OpenAlex API
  |-- Batch into groups of 50                |     filter=doi:{doi}
  |-- For each batch:                        |     mailto=OPENALEX_CONTACT_EMAIL
  |     Call OpenAlex API                    |     AbortSignal.timeout(10_000)
  |     filter=openalex:W1|W2|...           |
  |     mailto=OPENALEX_CONTACT_EMAIL        |-- Return { openalexId, title, doi }
  |     per_page=100                         |   or null
  |-- Return { resolved: [...], unresolvable: [...] }
```

### Recommended Project Structure
```
convex/
  extraction/
    mutations.ts       # MODIFY: add tier to createExtractionJob args + insert
    extract.ts         # MODIFY: createCascadeTiers(tier?) filter logic
    extract.test.ts    # MODIFY: add TIER-03 cascade filtering tests
    workpoolActions.ts # MODIFY: read job.tier, pass to extractAnswers
    validators.ts      # (no change -- tier validator in schema.ts)
  openalex/
    actions.ts         # NEW: resolveManualIds + resolveByDoi
  lib/
    errors.ts          # MODIFY: add EXTRACTION_LIMIT_EXCEEDED to ErrorCode
  schema.ts            # MODIFY: add optional tier field to extractionJobs
lib/
  toast/
    error-resolver.ts  # MODIFY: add EXTRACTION_LIMIT_EXCEEDED mapping
  openalex/
    normalize.ts       # READ-ONLY: reuse normalizeOpenAlexId
components/
  extraction/
    extraction-dialog.tsx  # MODIFY: pass tier to mutation + migrate error handling
    tier-selector.tsx      # READ-ONLY: reuse ModelTier type
messages/
  en-US.json           # MODIFY: add extractionLimitExceeded toast key
  en-GB.json           # MODIFY: same
  fr.json              # MODIFY: same
  ja.json              # MODIFY: same
  zh.json              # MODIFY: same
  hi.json              # MODIFY: same
```

### Pattern 1: Schema Field Addition (No Migration)
**What:** Add optional field to Convex table -- new rows get the field, existing rows return `undefined`
**When to use:** When adding a new feature column that existing data does not need
**Example:**
```typescript
// convex/schema.ts -- extractionJobs table
// Source: verified from convex/schema.ts lines 410-440
extractionJobs: defineTable({
  // ... existing fields ...
  tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate"))),
})
```
[VERIFIED: convex/_generated/ai/guidelines.md confirms v.optional() pattern]

### Pattern 2: Convex Action for External HTTP
**What:** Actions that call external APIs use `action` (not `mutation`) since they have no `ctx.db` access
**When to use:** Any function that makes HTTP calls to external services
**Example:**
```typescript
// convex/openalex/actions.ts
// Source: convex/_generated/ai/guidelines.md action guidelines
import { action } from "../_generated/server";
import { v } from "convex/values";

export const resolveByDoi = action({
  args: { doi: v.string() },
  returns: v.union(
    v.object({
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (_ctx, args) => {
    const email = process.env.OPENALEX_CONTACT_EMAIL ?? "openscholar@sickrin.com";
    const url = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(args.doi)}&mailto=${email}&per_page=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json();
    const work = data?.results?.[0];
    if (!work) return null;
    return {
      openalexId: work.id?.replace("https://openalex.org/", "") ?? "",
      title: work.title ?? "",
      doi: work.doi?.replace("https://doi.org/", "") ?? undefined,
    };
  },
});
```
[VERIFIED: Convex guidelines confirm `fetch()` available in default runtime -- no `"use node"` needed for `fetch`]

### Pattern 3: Error System Extension
**What:** Add a new typed error code flowing from backend to localized toast
**When to use:** Any new backend rejection that needs user-facing messaging
**Example:**
```typescript
// Step 1: convex/lib/errors.ts -- add to ErrorCode union
export type ErrorCode =
  // ... existing codes ...
  | "EXTRACTION_LIMIT_EXCEEDED"  // NEW

// Step 2: convex/extraction/mutations.ts -- throw in createExtractionJob
if (args.papers.length > userLimit) {
  throw createError(
    "EXTRACTION_LIMIT_EXCEEDED",
    `Maximum ${userLimit} papers per job. You submitted ${args.papers.length}.`
  );
}

// Step 3: lib/toast/error-resolver.ts -- add to MESSAGE_KEY_BY_CODE
const MESSAGE_KEY_BY_CODE: Record<string, ToastErrorMessageKey> = {
  // ... existing mappings ...
  EXTRACTION_LIMIT_EXCEEDED: "extractionLimitExceeded",
};

// Step 4: Add "extractionLimitExceeded" to ToastErrorMessageKey union type
// Step 5: Add i18n key to all 6 locale files under "toast" namespace
```
[VERIFIED: Pattern matches existing `EXTRACTION_JOB_ALREADY_ACTIVE` -> `convex/lib/errors.ts` -> `error-resolver.ts` flow]

### Pattern 4: ExtractionDialog Error Migration
**What:** Replace inline string-matching error handling with `resolveToastError` pattern
**When to use:** Migrating legacy error handlers to the standard resolver
**Example:**
```typescript
// BEFORE (extraction-dialog.tsx lines 133-147):
} catch (error: unknown) {
  const msg = getErrorMessage(error, t("jobCreation.error"));
  if (typeof error === "object" && error !== null && "data" in error && ...) {
    showStyledToast("error", t("jobCreation.activeJobWarning"));
  } else {
    showStyledToast("error", msg);
  }
}

// AFTER: Use resolveToastError + MESSAGE_KEY_BY_CODE routing
} catch (error: unknown) {
  const resolved = resolveToastError(error, t("jobCreation.error"));
  const messageKey = getToastMessageKeyForErrorCode(resolved.code);
  showStyledToast("error", messageKey ? t(`toast.${messageKey}`) : resolved.message);
}
```
[VERIFIED: `resolveToastError` and `getToastMessageKeyForErrorCode` already exported from `error-resolver.ts`]

### Anti-Patterns to Avoid
- **Adding `"use node"` to the actions file when only using `fetch()`:** The Convex default runtime supports `fetch()` natively. Only add `"use node"` if using Node.js built-ins (fs, crypto, etc.). The OpenAlex actions only use `fetch`, so they run in the default runtime. [VERIFIED: Convex guidelines: "`fetch()` is available in the default Convex runtime. You do NOT need `"use node"` just to use `fetch()`."]
- **Putting actions and mutations in the same file with `"use node"`:** Convex guidelines explicitly warn: "Never add `"use node"` to a file that also exports queries or mutations." The new `convex/openalex/actions.ts` is action-only, which is correct. [VERIFIED: Convex guidelines]
- **Accepting `userId` as a function argument for auth:** Always derive from `ctx.auth.getUserIdentity()` server-side. [VERIFIED: Convex guidelines]
- **Mutating the cascade array in-place:** `createCascadeTiers` should return a new filtered array, not splice the original.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAlex ID normalization | Custom regex per call site | `normalizeOpenAlexId` from `lib/openalex/normalize.ts` | Already handles bare ID, URL, and prefixed formats; pure function, tested |
| User plan limit lookup | Inline subscription queries | `getExtractionLimitForUser(ctx, userId)` from `convex/lib/extractionLimit.ts` | Already resolves subscription -> plan -> limit; single source of truth |
| Error code -> toast routing | Inline string-matching | `resolveToastError` + `MESSAGE_KEY_BY_CODE` from `lib/toast/error-resolver.ts` | Handles legacy codes, ConvexError data extraction, fallback messages |
| Typed Convex errors | `new Error("message")` | `createError(code, message)` from `convex/lib/errors.ts` | Returns `ConvexError<ErrorData>` that `resolveToastError` can parse |
| Extraction limit constant | Hardcoded `1000` | `MAX_EXTRACTION_PAPERS_PER_JOB` from `convex/lib/queryBounds.ts` | Derived from `EXTRACTION_LIMITS_BY_TIER`; single source of truth |

**Key insight:** Every integration point in this phase already has an established helper or pattern in the codebase. The risk is not missing abstractions -- it is failing to use the ones that exist.

## Common Pitfalls

### Pitfall 1: Forgetting to Pass `tier` to the Workflow/Workpool Chain
**What goes wrong:** Tier is persisted on the job row but never read by the workpool action, so all jobs run the full 3-tier cascade regardless of selection.
**Why it happens:** The workpool action (`processExtractionPaper`) reads the job row (line 50-57 of `workpoolActions.ts`) but currently does not extract the `tier` field. The `extractAnswers` function does not accept a `tier` parameter. Both must be modified.
**How to avoid:** Follow the exact threading path: (1) `processExtractionPaper` reads `job.tier`, (2) passes it to `extractAnswers`, (3) `extractAnswers` passes it to `extractSingleAnswer`, (4) `extractSingleAnswer` passes it to `createCascadeTiers(tier)`.
**Warning signs:** All extraction jobs produce results from 3 different models regardless of tier selection.

### Pitfall 2: OpenAlex API Batch Size Exceeding URL Limits
**What goes wrong:** Batch request with 100+ IDs creates a URL > 2048 characters, causing HTTP 414 or silent truncation.
**Why it happens:** OpenAlex supports up to 100 pipe-separated values per filter, but 100 OpenAlex IDs (W + 10-11 digits each) create URLs of ~1600 chars for IDs alone, plus base URL and other params.
**How to avoid:** Batch in groups of 50 IDs per request (conservative, well under URL limits). Use `per_page=100` to ensure all results return in one page per batch. [CITED: developers.openalex.org/llms.txt -- max 100 pipe-separated values]
**Warning signs:** Some IDs in a large batch are silently missing from results.

### Pitfall 3: Missing `EXTRACTION_JOB_ALREADY_ACTIVE` Mapping in `MESSAGE_KEY_BY_CODE`
**What goes wrong:** After migrating `extraction-dialog.tsx` to use `resolveToastError`, the `EXTRACTION_JOB_ALREADY_ACTIVE` error code is not in `MESSAGE_KEY_BY_CODE`, so it falls through to a generic "Something went wrong" toast instead of the existing friendly "An extraction job is already running" message.
**Why it happens:** The current code handles this error with inline string matching. When migrating to `resolveToastError`, the code must also be added to the `MESSAGE_KEY_BY_CODE` map.
**How to avoid:** Add `EXTRACTION_JOB_ALREADY_ACTIVE: "extractionJobAlreadyActive"` to `MESSAGE_KEY_BY_CODE` and add "extractionJobAlreadyActive" to `ToastErrorMessageKey`. The i18n key already exists as `extraction.jobCreation.activeJobWarning` but needs a toast-level alias.
**Warning signs:** "An extraction job is already running" message stops appearing, replaced by generic error.

### Pitfall 4: Cascade Index Confusion (Top vs Bottom)
**What goes wrong:** `"accurate"` returns the cheapest model (index 0) and `"cheap"` returns the most expensive (index 2).
**Why it happens:** The `createCascadeTiers()` array is ordered cheapest-first: `[flash-lite, flash, haiku]`. "Accurate" should return the LAST element (haiku = most capable), "cheap" should return the FIRST element (flash-lite = cheapest).
**How to avoid:** D-03 is explicit: `"accurate"` = last element, `"cheap"` = first element. Comment the array ordering in the code.
**Warning signs:** "Accurate" tier jobs use flash-lite and produce worse results; "cheap" tier jobs use haiku and cost more.

### Pitfall 5: Convex Action vs Default Runtime for `fetch()`
**What goes wrong:** Adding `"use node"` to the OpenAlex actions file when it only uses `fetch()`.
**Why it happens:** Developer assumes all external HTTP calls need Node runtime.
**How to avoid:** Convex default runtime supports `fetch()` natively. Only add `"use node"` if Node.js built-ins are needed (fs, crypto, etc.). The actions file uses only `fetch` and `process.env`, both available in default runtime. Note: `process.env` is available in Convex actions in both runtimes.
**Warning signs:** Unnecessary Node.js runtime overhead; potential issues if queries/mutations are later added to the file.

### Pitfall 6: ExtractionDialog Error Handler Regression
**What goes wrong:** After refactoring the error handler, the `tier` value captured in the PostHog event (line 131) is lost, or the success toast stops firing.
**Why it happens:** The submit handler has both success and error paths. Refactoring only the error path can accidentally disrupt the success path or the PostHog capture that references `tier`.
**How to avoid:** Only modify lines 133-147 (the catch block). Leave the try block (lines 121-132) and finally block (line 148-150) untouched.
**Warning signs:** PostHog stops receiving `extraction_job_created` events, or success toasts disappear.

## Code Examples

### Cascade Filtering Implementation (TIER-02, TIER-03)
```typescript
// convex/extraction/extract.ts -- modify createCascadeTiers
// Source: verified from extract.ts lines 187-213

import type { ModelTier } from "../../components/extraction/tier-selector";

function createCascadeTiers(tier?: ModelTier): CascadeTier[] {
  const openrouter = createOpenRouter();

  const allTiers: CascadeTier[] = [
    {
      name: "google/gemini-2.5-flash-lite",  // Index 0: cheapest
      model: openrouter("google/gemini-2.5-flash-lite", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: "google/gemini-3-flash-preview",  // Index 1: middle
      model: openrouter("google/gemini-3-flash-preview", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
    {
      name: "anthropic/claude-haiku-4.5",     // Index 2: most capable
      model: openrouter("anthropic/claude-haiku-4.5", {
        plugins: [{ id: "response-healing" }],
        provider: { allowFallbacks: true },
      }),
    },
  ];

  // Filter cascade based on tier selection (D-03)
  switch (tier) {
    case "cheap":
      return [allTiers[0]];       // Cheapest model only
    case "accurate":
      return [allTiers[allTiers.length - 1]]; // Most capable model only
    case "auto":
    case undefined:
    default:
      return allTiers;            // Full cascade
  }
}
```
[VERIFIED: Array order confirmed from extract.ts lines 190-213]

### OpenAlex Batch Resolution (SEL-05)
```typescript
// convex/openalex/actions.ts -- resolveManualIds
// Source: OpenAlex API docs (developers.openalex.org)

import { action } from "../_generated/server";
import { v } from "convex/values";
import { normalizeOpenAlexId } from "../../lib/openalex/normalize";

const BATCH_SIZE = 50; // Conservative: ~700 chars of IDs per request

export const resolveManualIds = action({
  args: { rawInputs: v.array(v.string()) },
  returns: v.object({
    resolved: v.array(v.object({
      openalexId: v.string(),
      title: v.string(),
      doi: v.optional(v.string()),
    })),
    unresolvable: v.array(v.string()),
  }),
  handler: async (_ctx, args) => {
    const email = process.env.OPENALEX_CONTACT_EMAIL ?? "openscholar@sickrin.com";

    // 1. Normalize all inputs
    const normalized = args.rawInputs.map((raw) => ({
      raw,
      id: normalizeOpenAlexId(raw),
    }));

    const invalid = normalized.filter((n) => !n.id).map((n) => n.raw);
    const valid = normalized.filter((n) => n.id) as { raw: string; id: string }[];

    // 2. Batch into groups of BATCH_SIZE
    const resolved: Array<{ openalexId: string; title: string; doi?: string }> = [];
    const unresolvable = [...invalid];

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const ids = batch.map((b) => b.id).join("|");
      const url = `https://api.openalex.org/works?filter=openalex:${ids}&mailto=${email}&per_page=100`;

      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        unresolvable.push(...batch.map((b) => b.raw));
        continue;
      }

      const data = await response.json();
      const foundIds = new Set<string>();
      for (const work of data.results ?? []) {
        const workId = work.id?.replace("https://openalex.org/", "") ?? "";
        foundIds.add(workId.toUpperCase());
        resolved.push({
          openalexId: workId,
          title: work.title ?? "",
          doi: work.doi?.replace("https://doi.org/", "") ?? undefined,
        });
      }

      // Mark IDs not found in this batch as unresolvable
      for (const b of batch) {
        if (!foundIds.has(b.id.toUpperCase())) {
          unresolvable.push(b.raw);
        }
      }
    }

    return { resolved, unresolvable };
  },
});
```
[CITED: developers.openalex.org/llms.txt -- `filter=openalex:W1|W2`, max 100 pipe values, per_page max 100]

### Hard-Reject Error Flow (LIM-07)
```typescript
// convex/extraction/mutations.ts -- createExtractionJob, replace VALIDATION_ERROR with EXTRACTION_LIMIT_EXCEEDED
// Source: verified from mutations.ts lines 46-52

const userLimit = await getExtractionLimitForUser(ctx, user._id);
if (args.papers.length > userLimit) {
  throw createError(
    "EXTRACTION_LIMIT_EXCEEDED",
    `Maximum ${userLimit} papers per job. You submitted ${args.papers.length}.`
  );
}
```

### Test Pattern for Cascade Filtering (TIER-03)
```typescript
// convex/extraction/extract.test.ts -- new describe block
// Source: Pattern from existing extract.test.ts

describe("tier-based cascade filtering (TIER-03)", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("'cheap' tier uses only the first (cheapest) model", async () => {
    const { extractAnswers } = await import("./extract");
    const modelsUsed: string[] = [];

    mockGenerateText.mockImplementation(async (opts: Record<string, unknown>) => {
      // Track which model was used via the model object
      const model = opts.model as { modelId?: string };
      if (model?.modelId) modelsUsed.push(model.modelId);

      const prompt = String(opts.prompt ?? "");
      if (prompt.includes("Verify")) {
        return makeCriticResponse("supported", "OK");
      }
      return makeSuccessResponse();
    });

    // extractAnswers must accept tier parameter
    const results = await extractAnswers(
      "Paper text", [{ key: "q1", question: "Q?" }],
      undefined, undefined, undefined, undefined, "cheap"
    );

    expect(results).toHaveLength(1);
    expect(results[0].answer).not.toBeNull();
    // Only the cheapest model should have been attempted
    expect(modelsUsed.every((m) => m === "google/gemini-2.5-flash-lite")).toBe(true);
  });

  it("'accurate' tier uses only the last (most capable) model", async () => {
    // Similar pattern, assert only "anthropic/claude-haiku-4.5" was used
  });

  it("'auto' tier attempts all 3 models in cascade order", async () => {
    // Fail first 2 tiers, succeed on third -- all 3 models attempted
  });
});
```
[VERIFIED: Test mock pattern matches existing extract.test.ts]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `VALIDATION_ERROR` for limit exceeds | Dedicated `EXTRACTION_LIMIT_EXCEEDED` code | Phase 100 | Allows specific i18n messaging with limit/excess interpolation |
| Inline string-matching error handling | `resolveToastError` + `MESSAGE_KEY_BY_CODE` | Phase 100 | All extraction errors use one routing pattern |
| `createCascadeTiers()` no-args | `createCascadeTiers(tier?: ModelTier)` | Phase 100 | Cascade filtering based on user tier selection |

**Deprecated/outdated:**
- The inline error handler at `extraction-dialog.tsx` lines 133-147 must be replaced (D-09). This is the last inline string-matching error handler in the extraction surface.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `process.env.OPENALEX_CONTACT_EMAIL` is accessible in Convex default runtime actions (not just Node runtime) | Code Examples | If env vars are Node-only, actions need `"use node"` directive |
| A2 | OpenAlex API returns `results` array in batch filter response (not `data` or other key) | Code Examples | Response parsing would fail; easy to verify on first test run |
| A3 | OpenAlex work ID in API response is at `work.id` and is the full URL `https://openalex.org/W...` | Code Examples | ID extraction would fail if the field name or format differs |

Note: A1 is low risk -- existing `convex/extraction/parse.ts` reads `process.env.OPENALEX_CONTACT_EMAIL` at line 97 in a "use node" file, but the Convex guidelines confirm `fetch()` is available in default runtime. The `process.env` access pattern in actions should be verified. A2 and A3 are verifiable via a single test API call.

## Open Questions

1. **`process.env` in Convex default runtime vs Node runtime**
   - What we know: `fetch()` is available in default runtime. Existing OpenAlex code uses `process.env` in `"use node"` files.
   - What's unclear: Whether `process.env.OPENALEX_CONTACT_EMAIL` is accessible in the default Convex runtime without `"use node"`.
   - Recommendation: Start without `"use node"` since the Convex guidelines say env vars should be accessible. If it fails, add `"use node"` to the actions file (since it contains only actions, no queries/mutations, this is safe per guidelines).

2. **`extractAnswers` signature change for tier threading**
   - What we know: `extractAnswers` currently takes `(bodyText, questions, parsingSource?, traceId?, jobId?, paperId?)`. D-04 requires passing `tier` through.
   - What's unclear: Whether to add `tier` as a 7th positional parameter or refactor to an options object.
   - Recommendation: Add `tier?: ModelTier` as the 7th parameter to minimize disruption. The function already has 6 parameters -- one more is acceptable for this phase. A future refactor to an options object can be deferred.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.4 + convex-test 0.0.46 + @edge-runtime/vm 5.0.0 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run convex/extraction/extract.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TIER-03 | Cascade filtering by tier (cheap/accurate/auto) | unit | `npx vitest run convex/extraction/extract.test.ts -t "tier-based cascade"` | Wave 0 (add to existing file) |
| LIM-07 | `createExtractionJob` rejects over-limit with typed error | unit | `npx vitest run convex/extraction/mutations.test.ts -t "EXTRACTION_LIMIT_EXCEEDED"` | Wave 0 (add to existing file) |
| SEL-05 | `resolveManualIds` normalizes and batch-resolves IDs | unit | `npx vitest run convex/openalex/actions.test.ts` | Wave 0 (new file) |
| ZOT-03 | `resolveByDoi` returns within timeout | unit | `npx vitest run convex/openalex/actions.test.ts -t "resolveByDoi"` | Wave 0 (new file) |
| TIER-01 | Tier persisted on job row | unit | `npx vitest run convex/extraction/mutations.test.ts -t "tier persisted"` | Wave 0 (add to existing file) |
| TIER-02 | Workpool reads tier and filters cascade | integration | Manual: create job with tier="cheap", verify only 1 model used in logs | N/A -- workpool integration requires live Convex env |

### Sampling Rate
- **Per task commit:** `npx vitest run convex/extraction/extract.test.ts convex/extraction/mutations.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/openalex/actions.test.ts` -- covers SEL-05 (resolveManualIds) and ZOT-03 (resolveByDoi); needs mocked `fetch`
- [ ] New describe block in `convex/extraction/extract.test.ts` -- covers TIER-03 (cascade filtering)
- [ ] New describe block in `convex/extraction/mutations.test.ts` -- covers LIM-07 (EXTRACTION_LIMIT_EXCEEDED) and TIER-01 (tier persistence)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireAuth(ctx)` in all public mutations; user identity from `ctx.auth` |
| V3 Session Management | no | Handled by Clerk + Convex auth layer |
| V4 Access Control | yes | `getExtractionLimitForUser(ctx, user._id)` -- server-side enforcement of per-user limits |
| V5 Input Validation | yes | Convex validators on all mutation/action args; `normalizeOpenAlexId` sanitizes user input |
| V6 Cryptography | no | No crypto in this phase |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client bypasses limit check, submits 2000 papers | Tampering | Server-side `getExtractionLimitForUser` check in `createExtractionJob` mutation (already exists, changing error code) |
| User injects malicious strings in OpenAlex ID input | Tampering | `normalizeOpenAlexId` regex whitelist (only `W\d+` passes); invalid inputs returned in `unresolvable` array |
| Rate limiting abuse via `resolveManualIds` | Denial of Service | OpenAlex polite pool (10 req/s with mailto); batch size of 50 limits requests per invocation |
| User enumerates DOIs via `resolveByDoi` | Information Disclosure | Low risk -- OpenAlex data is public; action is auth-gated via Convex |

## Sources

### Primary (HIGH confidence)
- `convex/_generated/ai/guidelines.md` -- Convex API patterns, validator syntax, action runtime rules
- `convex/extraction/extract.ts` lines 187-213 -- Current `createCascadeTiers()` implementation
- `convex/extraction/mutations.ts` lines 32-147 -- Current `createExtractionJob` implementation
- `convex/extraction/workpoolActions.ts` lines 39-336 -- Current workpool action implementation
- `convex/lib/errors.ts` -- Full `ErrorCode` union type
- `lib/toast/error-resolver.ts` -- Full `MESSAGE_KEY_BY_CODE` mapping and `resolveToastError` implementation
- `components/extraction/tier-selector.tsx` -- `ModelTier` type definition
- `components/extraction/extraction-dialog.tsx` -- Current inline error handling at lines 133-147

### Secondary (MEDIUM confidence)
- [OpenAlex API llms.txt](https://developers.openalex.org/llms.txt) -- Batch filter syntax, max 100 pipe values, per_page max 100
- [OpenAlex API filter works](https://developers.openalex.org/api-entities/works/filter-works) -- Filter field names for `openalex` and `doi`
- [OpenAlex blog: batch DOI fetch](https://blog.openalex.org/fetch-multiple-dois-in-one-openalex-api-request/) -- Confirmed pipe-separated syntax for batch requests

### Tertiary (LOW confidence)
- None -- all claims verified against codebase or official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies
- Architecture: HIGH -- all integration points verified against actual source code
- Pitfalls: HIGH -- identified from concrete code review, not theoretical concerns
- OpenAlex API patterns: MEDIUM -- verified from official docs but response schema assumed from convention (A2, A3)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- Convex patterns, OpenAlex API, and codebase architecture are not changing rapidly)

## Project Constraints (from CLAUDE.md)

- **Convex backend:** Always read `convex/_generated/ai/guidelines.md` before writing Convex code [DONE -- read and findings integrated]
- **No legacy behavior:** All code must use modern patterns; no dead code, no compatibility shims
- **DRY:** Check codebase for reusable patterns before implementing (verified: `normalizeOpenAlexId`, `createError`, `resolveToastError`, `getExtractionLimitForUser` all exist and should be reused)
- **WCAG AAA:** Accessibility target for any UI changes (error toasts must be screen-reader accessible -- `showStyledToast` handles this via `aria-live`)
- **6 locales:** en-US, en-GB, fr, ja, zh, hi -- all must receive new i18n keys
