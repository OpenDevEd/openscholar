# Technology Stack: v3.0 Zero-Any Overhaul

**Project:** OpenAlex Count
**Researched:** 2026-03-03
**Confidence:** HIGH
**Scope:** NEW capabilities only. Existing stack (Next.js, Convex, Stripe SDK v20.3.0, @convex-dev/stripe, next-intl, nuqs, Zustand, Framer Motion, Playwright, Vitest, convex-helpers, AES-256-GCM, 744 tests) is validated — NOT re-researched.

---

## Context

v3.0 resolves every item in CONCERNS.md. The concerns map to exactly six new stack capabilities:

| Concern | Capability Needed | Decision |
|---------|-------------------|---------|
| `xlsx` large/unmaintained/sync | Excel export library replacement | Replace with ExcelJS 4.4.0 (dynamic import) |
| `dangerouslySetInnerHTML` XSS | HTML sanitization | DOMPurify 3.3.1 (client-only) OR text-split (no new dep) |
| Library `collect()` at scale | Real server-side pagination | Convex `paginationOptsValidator` (already installed, misapplied) |
| `as any` in Stripe/workflow | Typed narrowing patterns | Type guard patterns + `vWorkflowId` (already installed) |
| No startup env validation | Env var validation at startup | Zod v4 (already installed) |
| Concurrency test gap | Test concurrent mutations | `convex-test` sequential simulation (already installed) |

**Result: zero new npm packages required.** Every capability is achievable with the existing dependency tree.

---

## Recommended Stack

### No New Dependencies

| Capability | Package | Current Version | What Changes |
|------------|---------|----------------|-------------|
| Excel export | `exceljs` | NOT YET INSTALLED — see decision below | Install if XLSX replacement proceeds |
| XSS prevention | `dompurify` | NOT YET INSTALLED — see decision below | Install only if DOMPurify approach chosen |
| Server pagination | `convex` | `^1.31.7` (installed) | `paginationOptsValidator` already exported — apply it |
| Workflow ID typing | `@convex-dev/workflow` | `^0.3.4` (installed) | `vWorkflowId` already exported — use it |
| Env validation | `zod` | `^4.3.6` (installed) | Call `.parse(process.env)` at startup |
| Concurrency testing | `convex-test` | `^0.0.41` (installed) | Sequential simulation pattern (see below) |

### Decision Point: ExcelJS vs Text-Split for XSS

These are the only two items that could require new packages. Both have a zero-new-dependency alternative.

---

## ExcelJS: The xlsx Replacement

**Verdict: Install ExcelJS 4.4.0. The ESM concern is a non-issue for server-side Next.js route handlers.**

### What ExcelJS Provides

ExcelJS is the actively maintained Excel workbook library with full XLSX read/write, streaming, cell formatting, and formula support. Latest version: **4.4.0** (released October 2024). The `xlsx` package at `^0.18.5` has known prototype pollution vectors in certain parse paths and is stagnant.

### ESM Compatibility Reality

ExcelJS uses CommonJS internally (`require()` calls for `crypto`, `jszip`, etc.) which causes failures when bundled by esbuild/webpack in ESM output mode. However:

- This project uses Next.js, which handles CommonJS dependencies via its own bundler (webpack/turbopack with `transpilePackages` support).
- The failing scenario is "bundle ExcelJS for a browser in ESM format." That is not what this project does.
- `lib/extraction/export.ts` runs **server-side** (called from Next.js API routes or server actions, not from client bundles).
- Next.js Route Handlers (`app/api/**`) run in Node.js, where `require()` works fine. ExcelJS's CJS internals are transparent.
- Confirmed working pattern: import ExcelJS in a Next.js API route or server action with a standard dynamic import — no special config needed.

### Dynamic Import Pattern (Required)

The CONCERNS.md flags `xlsx` as synchronously bundled with the page. The fix for both `xlsx` and `exceljs` is the same: **dynamic import inside the export handler**.

```typescript
// lib/extraction/export.ts — replace static import
// BEFORE (problem): import * as XLSX from 'xlsx';  // ~500KB bundled always
// AFTER (fix): dynamic import inside the function

export async function exportToExcel(
  data: ExtractionExportData
): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Results");
  // ... build sheet ...
  return workbook.xlsx.writeBuffer() as Promise<Uint8Array>;
}
```

This eliminates the `~500KB` bundle weight for users who never click Export.

### Why Not Alternatives

| Alternative | Why Not |
|-------------|---------|
| Keep `xlsx` | Known security issues, no ESM, stagnant (last release 2023). Out-of-scope per CONCERNS.md recommendation. |
| CSV-only export | Loses XLSX capability that users may rely on. Excel formatting (cell types, column widths) unavailable. |
| `@e965/xlsx` (sheetjs-style fork) | Same prototype pollution surface. ESM issues identical. No advantage. |
| `write-excel-file` | Write-only, no read. Simpler API but far less control over cell formatting. Acceptable if formatting requirements are minimal, but ExcelJS is the clear standard. |

### Installation

```bash
npm install exceljs
```

**Bundle impact:** ExcelJS is ~1.5MB uncompressed but loaded dynamically — zero impact on initial page load. Only fetched when the Export dialog opens and user clicks XLSX.

---

## XSS Prevention: DOMPurify vs Text-Split

**Verdict: Use the text-split approach (React-native, no new dependency). Reserve DOMPurify for a fallback if complex HTML markup is needed later.**

### The Problem

`highlightText()` in `table-view.tsx` returns a raw HTML string injected via `dangerouslySetInnerHTML`. The paper title, AI answers, and reasoning are not sanitized before injection. An adversarial paper with `<script>` in the title, or AI-generated content with HTML characters, would execute in the user's browser.

### Option A: Text-Split (Recommended — Zero New Deps)

Split the text on the query match and return React elements. No HTML injection at all.

```typescript
// components/extraction/results-views/table-view.tsx
function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactElement {
  if (!query || !query.trim()) return <span>{text}</span>;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escapedQuery})`, "gi");
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}
```

Replace all `dangerouslySetInnerHTML={{ __html: highlightText(text, query) }}` call sites with `<HighlightText text={text} query={query} />`.

**Advantages:** Zero new dependency. Fully XSS-safe by construction (React escapes all content). Testable with standard Vitest/React Testing Library. Simpler than maintaining a sanitization library.

### Option B: DOMPurify (If Text-Split Is Inadequate)

DOMPurify 3.3.1 (released December 2024) is the industry standard for client-side HTML sanitization. TypeScript types are bundled — no `@types/dompurify` needed.

```typescript
import DOMPurify from "dompurify";
// Only runs in browser; DOMPurify requires a DOM environment
const clean = DOMPurify.sanitize(highlightText(text, query));
// Then: dangerouslySetInnerHTML={{ __html: clean }}
```

**Disadvantage:** DOMPurify requires a browser DOM. It does not run in Node.js/Vitest jsdom without extra setup (`isomorphic-dompurify` or mocking). Adds `~25KB` gzipped to the client bundle. The text-split approach is simpler and more correct.

**Use DOMPurify only if:** The highlight markup needs to render HTML from an external source (e.g., OpenAlex returns HTML-formatted abstracts). For the current use case (wrap matched substring in `<mark>`), text-split is strictly better.

### Installation (only if DOMPurify path chosen)

```bash
npm install dompurify
# Types are bundled — no @types/dompurify needed
```

---

## Convex Pagination: Real Server-Side Pagination

**Verdict: `paginationOptsValidator` is already imported in `convex/library/queries.ts`. The problem is `.collect()` is still called for filter paths. Replace with index-first querying + `.paginate()`.**

### Current State

`convex/library/queries.ts` imports `paginationOptsValidator` and calls `.paginate()` on the happy path (browse by index), but falls back to `.collect()` for collection-filtered and rating-filtered paths. As user libraries grow, the collect paths will hit Convex's memory/time limits.

### Correct Pattern

```typescript
import { paginationOptsValidator } from "convex/server";
import type { Cursor } from "convex/server";

export const listLibrary = query({
  args: {
    paginationOpts: paginationOptsValidator,
    collectionId: v.optional(v.id("collections")),
    rating: v.optional(v.number()),
    sortBy: v.union(
      v.literal("savedAt"),
      v.literal("rating"),
      v.literal("year"),
      v.literal("title")
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { status: "unauthenticated" as const };

    // Use index-based query for all paths; filter post-paginate only for
    // collection membership (requires junction table lookup)
    let q = ctx.db
      .query("libraryItems")
      .withIndex("by_user_savedAt", (idx) => idx.eq("userId", user._id));

    return await q.paginate(args.paginationOpts);
  },
});
```

**The collection filter problem:** Collection membership cannot be pushed into a single index query because the relationship lives in `libraryItemCollections`. The correct approach is:
1. Query the junction table `by_collection` to get item IDs (bounded by collection size)
2. Use `ctx.db.get()` for each item ID (parallel)
3. Return paginated results manually using cursor arithmetic

For v3.0 scope, the pragmatic fix is: **move collection filtering to use the junction table first** (bounded query) and return results without `.collect()` on the main `libraryItems` table.

### Cursor Type for Empty/First Page

The correct first-page cursor is `null`, not `""` or `"" as any`:

```typescript
// Correct: null means "start from beginning"
const { continueCursor, isDone, page } = await ctx.db
  .query("libraryItems")
  .paginate({ cursor: null, numItems: 20 });

// On client: usePaginatedQuery handles cursors automatically
// If constructing manually, cursor: null = first page, cursor: continueCursor = next page
```

**Schema for cursor storage:** `v.union(v.string(), v.null())` — matches the `Cursor` type exported from `convex/server`.

### usePaginatedQuery on Client

No change needed on the client side — `usePaginatedQuery` and the existing `useProtectedPaginatedQuery` wrapper handle cursors automatically. The fix is purely in the query handler.

---

## Stripe SDK v20 Typed Narrowing

**Verdict: No new library needed. Use the `typeof x === 'string'` type guard pattern already established in `convex/http.ts`.**

### The Problem

`convex/maintenance/internal.ts` line 103:
```typescript
: (fresh.customer as any)?.id;
```

The Stripe `customer` field on a subscription is typed as `string | Stripe.Customer | Stripe.DeletedCustomer`. Stripe does not provide a typed narrowing API for expanded vs non-expanded responses — this is a confirmed known limitation per the Stripe SDK maintainers.

### The Fix

```typescript
// Pattern already used in convex/http.ts — apply here too
const customerId: string | undefined =
  typeof fresh.customer === "string"
    ? fresh.customer
    : fresh.customer?.id;
```

This is type-safe: TypeScript narrows `fresh.customer` to `string` in the true branch and to `Stripe.Customer | Stripe.DeletedCustomer` in the false branch, giving `.id` access without casting.

**No new library needed.** The `typeof` guard is the official recommendation from the Stripe SDK team (they explicitly declined to implement conditional generic types for expanded responses).

### Rate Limiter Name Exhaustiveness

`convex/lib/rateLimit.ts` line 52:
```typescript
name: args.name as any,
```

Fix: Validate `args.name` against the union of known rate limit names before passing it to the rate limiter. The existing `RATE_LIMIT_NAMES` constant (or equivalent) gives the exhaustive set.

```typescript
// In the consume mutation args validator, restrict to known names:
args: {
  name: v.union(
    v.literal("search"),
    v.literal("export"),
    // ... all rate limit names
  ),
  // ...
}
```

This converts the `as any` cast into a compile-time-enforced union.

### Workflow ID Typing

`convex/extraction/mutations.ts` line 263:
```typescript
await workflow.cancel(ctx, job.workflowId as any);
```

`@convex-dev/workflow` v0.3.4 exports `vWorkflowId` for use in function argument validation. The `WorkflowId` type returned by `workflow.start()` is a branded string.

**Fix:** Store `workflowId` using `vWorkflowId` in the schema, and retrieve it as the correct type:

```typescript
import { vWorkflowId } from "@convex-dev/workflow";

// In schema.ts for extractionJobs table:
workflowId: v.optional(vWorkflowId),

// In mutations.ts — workflow.cancel() now accepts the correctly typed value:
if (job.workflowId) {
  await workflow.cancel(ctx, job.workflowId); // no cast needed
}
```

**Important caveat:** Changing the schema field from `v.optional(v.string())` to `v.optional(vWorkflowId)` is a schema migration. If `vWorkflowId` is a branded type that validates differently from a bare string, existing stored values may need migration. Verify `vWorkflowId` accepts existing stored string values before deploying.

---

## Env Var Validation at Startup

**Verdict: Use Zod v4 (already installed at ^4.3.6) with a Convex startup action. No new package needed.**

### Approach

Create a Convex action that validates all required env vars and can be called:
- From a startup cron (runs once on deployment)
- From the first request that touches billing/encryption (as a lazy gate)
- Manually via `npx convex run` during CI

```typescript
// convex/lib/envValidation.ts
import { z } from "zod";

const envSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex-encoded
  STRIPE_GO_PRICE_ID: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_ENTERPRISE_PRICE_ID: z.string().min(1),
  CLERK_JWT_ISSUER_DOMAIN: z.string().url(),
  OPENALEX_CONTACT_EMAIL: z.string().email(),
});

export function validateEnvVars(): void {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing/invalid env vars: ${missing}`);
  }
}
```

### Zod v4 API Notes

The project already uses Zod at `^4.3.6`. Zod v4 is a semver-major release with these relevant changes for env validation:

- `z.object().parse()` and `.safeParse()` — unchanged, still available
- Error shape: `result.error.issues` (not `.errors` as in v3) — use `.issues`
- Custom error messages: use `{ error: "message" }` not `{ message: "message" }`
- `z.string().email()` still works in v4 (the format validators moved to top-level in v4 but old methods are backward-compatible for now)

The existing codebase uses Zod primarily for AI schema validation in `lib/ai/core/`. These patterns remain valid in v4.

### Why Not @t3-oss/env-nextjs

`@t3-oss/env-nextjs` v0.13.10 provides a structured wrapper for Next.js env validation with client/server separation and type-safe `process.env` access. However:

- This project has two env namespaces: **Next.js** (client + server) and **Convex** (backend, separate process). `@t3-oss/env-nextjs` only handles `process.env` in the Next.js process — it cannot reach Convex runtime env vars.
- The Convex env vars (`STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, etc.) live in the Convex deployment environment, not in `.env.local`.
- Adding a new package to handle only the Next.js side while Convex remains unvalidated solves half the problem. A single Zod schema inside a Convex action validates the Convex-side env vars directly at the source.

---

## Concurrency Testing for Credit Deduction

**Verdict: `convex-test` v0.0.41 does not natively simulate concurrent mutations. Use sequential simulation to verify OCC invariants. No new package needed.**

### Current State

`convex/credits/deduct-credits.test.ts` already has "sequential deductions (simulating concurrent access)" tests. These run two mutations back-to-back, not truly in parallel.

### What convex-test Supports

`convex-test` runs in a single-threaded JS environment (Vitest). The mock backend executes mutations serially. True parallel OCC conflict simulation is not supported by the mock backend — OCC conflicts only manifest in the real Convex runtime.

### Correct Testing Strategy

Do not try to simulate true concurrency in `convex-test`. Instead, verify the invariants that make concurrent safety hold:

1. **Invariant test:** The `deductCredits` mutation re-reads the balance inside the mutation (not trusting a pre-read from the action). Test that calling `deductCredits` with a balance of 10 when the DB says 5 returns an error.

2. **Sequential cascade test:** Run two `deductCredits` mutations on the same user back-to-back where the second would overdraw. Verify the second throws `INSUFFICIENT_CREDITS` and the balance is correct.

3. **Documentation test:** Add a comment explaining that true OCC (two simultaneous calls both observing sufficient balance, one failing on retry) is guaranteed by Convex's serializable transaction model and cannot be reproduced in unit tests — only integration tests against real Convex.

```typescript
it("rejects deduction when balance is insufficient after prior deduction", async () => {
  const t = convexTest(schema);
  const { userId } = await seedUserWithCredits(t, 10, 0);

  // First deduction succeeds
  await t.mutation(internal.credits.internal.deductCredits, {
    userId,
    amount: 8,
    description: "first",
  });

  // Second deduction would overdraw — must throw
  await expect(
    t.mutation(internal.credits.internal.deductCredits, {
      userId,
      amount: 5,
      description: "second overdraw",
    })
  ).rejects.toThrow("INSUFFICIENT_CREDITS");
});
```

This tests the invariant that matters: the mutation enforces the constraint regardless of what the calling action read previously.

---

## Supporting Patterns (No New Packages)

### ExtractionResultWithReview Type (Eliminates export.ts and filtering.ts `as any`)

```typescript
// convex/extraction/validators.ts — derive shared type
import { extractionResultWithReviewValidator } from "./validators";
import type { Infer } from "convex/values";

export type ExtractionResultWithReview = Infer<
  typeof extractionResultWithReviewValidator
>;
```

```typescript
// lib/extraction/export.ts and lib/extraction/filtering.ts
// Replace: (result as any).correctedAnswer
// With:    result.correctedAnswer  (after threading ExtractionResultWithReview type)
```

This requires the export/filtering functions to accept `ExtractionResultWithReview[]` instead of the bare query return type. No new library — pure TypeScript.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Excel export | `exceljs` 4.4.0 | Keep `xlsx` 0.18.5 | Known security issues, stagnant, no ESM |
| Excel export | `exceljs` 4.4.0 | CSV-only | Loses XLSX capability; may break existing user workflows |
| XSS fix | Text-split React component | `dompurify` 3.3.1 | DOMPurify requires DOM (complicates SSR testing); text-split is simpler and correct |
| XSS fix | Text-split React component | `sanitize-html` | ~150KB, far heavier than DOMPurify; overkill for a `<mark>` wrapper |
| Env validation | Zod (already installed) | `@t3-oss/env-nextjs` | Does not cover Convex runtime env vars; new package for partial solution |
| Env validation | Zod (already installed) | Custom assertion function | Already done (`assertPlanPriceConfig`) but not called at startup — use Zod for exhaustive coverage |
| Concurrency test | Sequential invariant tests | `jest-circus` concurrent | Cannot run in convex-test mock; real OCC only testable against live Convex |
| Workflow typing | `vWorkflowId` from `@convex-dev/workflow` | `v.string()` with comment | Loses compile-time safety; cast remains fragile after upgrades |

---

## Installation

```bash
# If XSS fix uses DOMPurify path (not recommended — see text-split above):
npm install dompurify
# Types are bundled — no @types/dompurify needed

# If XLSX replacement proceeds:
npm install exceljs

# All other v3.0 capabilities use existing packages:
# - zod ^4.3.6 (installed) — env validation
# - convex ^1.31.7 (installed) — paginationOptsValidator
# - @convex-dev/workflow ^0.3.4 (installed) — vWorkflowId
# - convex-test ^0.0.41 (installed) — concurrency invariant tests
```

---

## Version Compatibility

| Package | Current Version | Notes |
|---------|----------------|-------|
| `exceljs` | 4.4.0 (to install) | CJS internally; works in Next.js Node.js route handlers. Dynamic import required to avoid bundle bloat. |
| `dompurify` | 3.3.1 (conditional) | Types bundled. Browser-only; needs `isomorphic-dompurify` or mock for Vitest jsdom env. |
| `zod` | ^4.3.6 (installed) | v4 API; use `result.error.issues` not `.errors`. `.parse()` and `.safeParse()` unchanged. |
| `convex` | ^1.31.7 (installed) | `paginationOptsValidator` and `Cursor` type from `convex/server`. |
| `@convex-dev/workflow` | ^0.3.4 (installed) | `vWorkflowId` exported. Version 0.2.7+ added `WorkflowId` type to `step.workflowId`. |
| `convex-test` | ^0.0.41 (installed) | Serial mutation execution only; true OCC concurrency not simulatable. |

---

## What NOT to Add

| Package | Why Not |
|---------|---------|
| `@t3-oss/env-nextjs` | Only covers Next.js `process.env`, not Convex backend env. Partial solution. Zod already installed. |
| `isomorphic-dompurify` | Only needed if DOMPurify approach chosen. Text-split avoids this entirely. |
| `html-react-parser` | Parses arbitrary HTML into React elements. Heavier than needed for a `<mark>` highlight wrapper. |
| `sanitize-html` | ~150KB, server-and-client. Overkill for client-side highlight XSS. |
| `write-excel-file` | Write-only, no rich cell formatting. ExcelJS has superset capability. |
| Any new test framework | convex-test + Vitest cover all test patterns needed for v3.0. |
| Any new state management | No new client state needed for v3.0 — this is a backend/type-safety milestone. |

---

## Sources

- [ExcelJS GitHub Releases](https://github.com/exceljs/exceljs/releases) — v4.4.0 confirmed (released October 2024). HIGH confidence.
- [ExcelJS ESM Discussion #2853](https://github.com/exceljs/exceljs/discussions/2853) — confirmed CJS-only internals; dynamic `require('crypto')` errors in bundled ESM. HIGH confidence.
- [DOMPurify GitHub Releases](https://github.com/cure53/DOMPurify/releases) — v3.3.1 confirmed (released December 2024). Types bundled. HIGH confidence.
- [Stripe SDK issue #1556](https://github.com/stripe/stripe-node/issues/1556) — confirmed: no typed conditional generics for expanded vs non-expanded; `typeof x === 'string'` is the official workaround. HIGH confidence.
- [Convex Pagination Docs](https://docs.convex.dev/database/pagination) — `paginationOptsValidator`, `.paginate()`, `Cursor` type. HIGH confidence.
- [Convex Stack: Take Control of Pagination](https://stack.convex.dev/pagination) — `getPage` helper from `convex-helpers/server/pagination`. MEDIUM confidence.
- [Convex OCC Docs](https://docs.convex.dev/database/advanced/occ) — serializability guarantees, automatic retry, cannot simulate in unit tests. HIGH confidence.
- [convex-test Docs](https://docs.convex.dev/testing/convex-test) — v0.0.41, serial execution, no native concurrency simulation. HIGH confidence.
- [@convex-dev/workflow npm](https://www.npmjs.com/package/@convex-dev/workflow) — v0.3.4. `vWorkflowId` exported. HIGH confidence.
- [@convex-dev/workflow CHANGELOG](https://github.com/get-convex/workflow/blob/main/CHANGELOG.md) — v0.2.7 added `WorkflowId` type; v0.3.4 adds list/pagination APIs. HIGH confidence.
- [Zod v4 Changelog](https://zod.dev/v4/changelog) — `.parse()` unchanged; `error.issues` replaces `error.errors`; `{ error: }` replaces `{ message: }`. HIGH confidence.
- [@t3-oss/env-nextjs](https://env.t3.gg/docs/introduction) — framework-agnostic env validation; does not cover Convex runtime. MEDIUM confidence.
- Direct codebase inspection: `package.json` (all installed versions), `convex/extraction/mutations.ts` (workflowId as any, line 263), `convex/maintenance/internal.ts` (customer as any, line 103), `convex/lib/rateLimit.ts` (name as any, line 52), `lib/extraction/export.ts` (result as any, lines 117/171/175-177/219), `lib/extraction/filtering.ts` (as any, lines 48/51), `components/extraction/results-views/table-view.tsx` (dangerouslySetInnerHTML, lines 162-163, 378-388, 450-451), `convex/library/queries.ts` (collect() calls, lines 39/113/186/204/217/251). HIGH confidence.

---

*Stack research for: v3.0 Zero-Any Overhaul*
*Researched: 2026-03-03*
