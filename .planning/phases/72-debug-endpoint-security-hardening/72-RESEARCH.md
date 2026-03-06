# Phase 72: Debug Endpoint Security Hardening - Research

**Researched:** 2026-03-06
**Domain:** Convex function visibility, internal function registration, debug endpoint security
**Confidence:** HIGH

## Summary

This phase converts the remaining public debug/test Convex functions to internal functions so they are architecturally unreachable from the client SDK, then removes the now-unnecessary `debug_gate.ts` module and `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var pattern entirely.

The codebase has 12 debug-gated files. Of those, 8 already use `internalQuery`/`internalMutation`/`internalAction` but still redundantly call `requirePublicDebugEnabled()`. The remaining 4 files use public `query`/`mutation` and are the actual security concern -- they appear in the generated `api` namespace and are callable from any client. The conversion is mechanical: change the import, change the function constructor, remove `requireAuth()` (which fails in internal context), and remove the `requirePublicDebugEnabled()` call. After conversion, the `debug_gate.ts` module and its test become dead code and are deleted.

**Primary recommendation:** Convert 4 public functions to internal, remove `requirePublicDebugEnabled()` from all 12 files, delete `convex/lib/debug_gate.ts` and `tests/debug-gate.test.ts`, update `convex/extraction/index.ts` exports, and verify with `tsc --noEmit`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Debug query functions converted from public to internal (no client access possible) | 4 files identified that use public `query`/`mutation`: `debug.ts`, `debug_errors.ts`, `testActions.ts`, `create_test_job.ts`. Change to `internalQuery`/`internalMutation`. 8 files already internal but need `requirePublicDebugEnabled()` removed. |
| SEC-02 | Debug gate module and env var pattern deleted | `convex/lib/debug_gate.ts` deleted, all 12 imports of `requirePublicDebugEnabled` removed, `ENABLE_PUBLIC_DEBUG_FUNCTIONS` references eliminated |
| SEC-03 | Tests verify debug functions are registered as internal | Replace `tests/debug-gate.test.ts` with a new test that reads each debug file and asserts it uses `internalQuery`/`internalMutation`/`internalAction`, not `query`/`mutation`/`action` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex` | ^1.31.7 | Backend runtime | Already in project; `internalQuery`/`internalMutation` are first-class primitives |
| `vitest` | existing | Test runner | Already used for all unit tests in this project |

### Supporting
No new libraries needed. This is purely a refactor of existing Convex function registrations.

## Architecture Patterns

### Current State: Files Requiring Changes

**4 PUBLIC functions (the security problem -- appear in `api` namespace):**

| File | Export | Current Registration | Target |
|------|--------|---------------------|--------|
| `convex/extraction/debug.ts` | `diagnoseJob` | `query` | `internalQuery` |
| `convex/extraction/debug_errors.ts` | `getFailedPapersDebug` | `query` | `internalQuery` |
| `convex/extraction/testActions.ts` | `createTestJob` | `mutation` | `internalMutation` |
| `convex/extraction/create_test_job.ts` | `createTestJobForFix` | `mutation` | `internalMutation` |

**8 ALREADY INTERNAL functions (need `requirePublicDebugEnabled()` call removed only):**

| File | Export | Registration |
|------|--------|-------------|
| `convex/extraction/debug_papers.ts` | `getPaperErrorsInternal` | `internalQuery` |
| `convex/extraction/debug_paper_results.ts` | `debugPaperResults` | `internalQuery` |
| `convex/extraction/debug_job_content.ts` | `debugJobContent` | `internalQuery` |
| `convex/extraction/debug_job_citations.ts` | `debugJobCitations` | `internalQuery` |
| `convex/extraction/debug_pdfjs_alignment.ts` | `debugPdfAlignment` | `internalAction` |
| `convex/extraction/test_runner.ts` | `createAndRunTestJob`, `getTestJobStatus` | `internalMutation` |
| `convex/extraction/test_automation.ts` | `runPdfTestNow` | `internalAction` |
| `convex/extraction/test_automation_internal.ts` | `getFirstUserId`, `createTestJob`, `getJobStatus`, `getJobResults` | `internalQuery`/`internalMutation` |

**2 ROOT-LEVEL files (already internal, no debug gate -- no changes needed):**

| File | Registration | Notes |
|------|-------------|-------|
| `convex/debug.ts` | `internalQuery`, `internalMutation` | Already internal, no debug gate import |
| `convex/debug_papers.ts` | `internalQuery` | Already internal, no debug gate import |

### Files to Delete
- `convex/lib/debug_gate.ts` -- the env var gate module
- `tests/debug-gate.test.ts` -- tests for the deleted gate module

### Files to Update (exports)
- `convex/extraction/index.ts` -- lines 88-89 export public debug functions; these exports remain but the underlying functions change to internal (Convex barrel exports work for internal functions too)

### Pattern: Converting Public to Internal

```typescript
// BEFORE (public -- appears in api namespace)
import { query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

export const diagnoseJob = query({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();
    const user = await requireAuth(ctx);
    // ... uses user._id for ownership check
  },
});

// AFTER (internal -- only reachable via dashboard/CLI/internal calls)
import { internalQuery } from "../_generated/server";

export const diagnoseJob = internalQuery({
  args: { jobId: v.id("extractionJobs") },
  handler: async (ctx, args) => {
    // No auth check -- internal functions have no client auth context
    // No debug gate -- internal registration IS the gate
    const job = await ctx.db.get(args.jobId);
    // ... no user ownership check (internal caller is trusted)
  },
});
```

### Pattern: Removing Debug Gate from Already-Internal Functions

```typescript
// BEFORE
import { internalQuery } from "../_generated/server";
import { requirePublicDebugEnabled } from "../lib/debug_gate";

export const debugJobContent = internalQuery({
  handler: async (ctx, args) => {
    requirePublicDebugEnabled();  // Remove this line
    // ... rest of handler
  },
});

// AFTER
import { internalQuery } from "../_generated/server";

export const debugJobContent = internalQuery({
  handler: async (ctx, args) => {
    // ... rest of handler unchanged
  },
});
```

### Anti-Patterns to Avoid
- **Keeping `requireAuth()` in internal functions:** Internal functions called via `npx convex run` or `ctx.runQuery`/`ctx.runMutation` have NO client auth context. `requireAuth(ctx)` will always throw. Remove it entirely or replace user-scoping with an explicit `userId` argument if needed.
- **Adding audit logging to internal functions:** The debug gate had audit logging. Do NOT add replacement audit logging -- internal functions are only callable by trusted server-side code or dashboard operators.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Function access control | Env-var gates, runtime checks | Convex `internalQuery`/`internalMutation` registration | Platform-enforced; function literally does not exist in client-facing API |
| Verifying internal registration | Manual code review | Static test reading source files for import patterns | Automated, catches regressions in CI |

**Key insight:** Convex's internal function system is a compile-time guarantee. Functions registered with `internalQuery` are filtered out of the generated `api` TypeScript type AND are rejected at the platform level if called from a client SDK. No runtime check can match this level of security.

## Common Pitfalls

### Pitfall 1: Generated API Paths Break on Visibility Change
**What goes wrong:** Converting `query` to `internalQuery` removes the function from the `api` namespace and adds it to the `internal` namespace. Any code referencing `api.extraction.debug.diagnoseJob` gets a TypeScript error.
**Why it happens:** Convex code generation produces separate `api` and `internal` exports filtered by function visibility.
**How to avoid:** Run `tsc --noEmit` after all conversions. Grep for string-based function references (e.g., in `npx convex run` scripts).
**Warning signs:** TypeScript errors mentioning missing properties on `api.extraction.debug`.
**Current risk:** Grep confirms NO client-side code references these debug functions via the `api` namespace. The barrel file `convex/extraction/index.ts` re-exports them, but this works for internal functions too. Risk is LOW.

### Pitfall 2: `requireAuth()` Makes Internal Functions Uncallable
**What goes wrong:** `requireAuth(ctx)` calls `ctx.auth.getUserIdentity()`. In an internal function called via dashboard, CLI, or `ctx.runQuery`, there is no auth context -- it returns `null` and `requireAuth` throws `UNAUTHENTICATED`.
**Why it happens:** Internal functions bypass the client auth layer entirely.
**How to avoid:** Remove `requireAuth()` from all 4 functions being converted. For `diagnoseJob` and `getFailedPapersDebug` (which check job ownership via `job.userId !== user._id`), remove the ownership check entirely -- internal callers are trusted.
**Affected files:** `debug.ts` (has `requireAuth`), `debug_errors.ts` (has `requireAuth`), `testActions.ts` (has `requireAuth`), `create_test_job.ts` (has `requireAuth`).

### Pitfall 3: Barrel File Export Confusion
**What goes wrong:** `convex/extraction/index.ts` re-exports `diagnoseJob`, `getFailedPapersDebug`, `createTestJob`, and `createTestJobForFix`. After conversion, these are still valid exports (Convex barrel files can export internal functions). However, the re-export makes them appear in the `internal` namespace under the barrel path.
**How to avoid:** Verify after conversion that `tsc --noEmit` passes. The re-exports are fine -- Convex handles internal function re-exports correctly.

### Pitfall 4: Forgetting a `requirePublicDebugEnabled()` Call
**What goes wrong:** If one file still imports `debug_gate.ts` after the module is deleted, `tsc` will fail with a missing module error.
**How to avoid:** Delete `debug_gate.ts` LAST (or simultaneously with removing all imports). Run `tsc --noEmit` to confirm zero remaining references.

## Code Examples

### Replacement Test: Verify Internal Registration (SEC-03)

```typescript
// tests/debug-internal.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("debug function internal registration", () => {
  const DEBUG_FILES = [
    "convex/extraction/debug.ts",
    "convex/extraction/debug_errors.ts",
    "convex/extraction/debug_papers.ts",
    "convex/extraction/debug_paper_results.ts",
    "convex/extraction/debug_job_content.ts",
    "convex/extraction/debug_job_citations.ts",
    "convex/extraction/debug_pdfjs_alignment.ts",
    "convex/extraction/testActions.ts",
    "convex/extraction/test_runner.ts",
    "convex/extraction/test_automation.ts",
    "convex/extraction/test_automation_internal.ts",
    "convex/extraction/create_test_job.ts",
  ];

  it.each(DEBUG_FILES)(
    "%s uses only internal function registrations",
    (filePath) => {
      const content = readFileSync(resolve(filePath), "utf-8");
      // Must NOT use public registrations
      expect(content).not.toMatch(
        /\bfrom\s+["'][^"']*\/_generated\/server["'].*\b(query|mutation|action)\b/s
      );
      // Verify it does NOT import the deleted debug gate
      expect(content).not.toContain("requirePublicDebugEnabled");
      expect(content).not.toContain("debug_gate");
    },
  );

  it("debug_gate.ts does not exist", () => {
    expect(() =>
      readFileSync(resolve("convex/lib/debug_gate.ts"), "utf-8")
    ).toThrow();
  });
});
```

**Note:** The regex for detecting public registrations needs care. The import line `import { internalQuery } from "../_generated/server"` should NOT match. Only bare `query`, `mutation`, or `action` imports (without `internal` prefix) should match. A simpler approach: check that the file contains `internalQuery` or `internalMutation` or `internalAction` in its import statement and does NOT contain a standalone `query,` or `mutation,` or `action,` import token.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Env-var gate (`requirePublicDebugEnabled`) | `internalQuery`/`internalMutation` registration | Convex has always supported this | Platform-enforced unreachability vs runtime error throwing |
| `requireAuth()` in debug functions | No auth in internal functions (trusted caller) | Architectural understanding | Internal functions are only callable by server code |

**Deprecated/outdated:**
- `convex/lib/debug_gate.ts`: The entire env-var gate pattern. Internal function registration replaces it completely.
- `ENABLE_PUBLIC_DEBUG_FUNCTIONS` env var: Should be removed from all Convex deployment dashboards after this phase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run tests/debug-internal.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | All debug functions use internalQuery/internalMutation | unit (static file analysis) | `npx vitest run tests/debug-internal.test.ts` | No -- Wave 0 |
| SEC-02 | debug_gate.ts and env var do not exist | unit (file existence check) | `npx vitest run tests/debug-internal.test.ts` | No -- Wave 0 |
| SEC-03 | Tests verify internal registration (not env gate) | unit | `npx vitest run tests/debug-internal.test.ts` | No -- Wave 0 |
| N/A | TypeScript compiles cleanly after changes | build check | `npx tsc --noEmit` | N/A (built-in) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/debug-internal.test.ts && npx tsc --noEmit`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/debug-internal.test.ts` -- replaces `tests/debug-gate.test.ts`, covers SEC-01, SEC-02, SEC-03
- No framework install needed (vitest already configured)

## Open Questions

None. This phase is well-understood with no ambiguity. The conversion is mechanical and the pattern is already established by the 8 files that are already internal.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 14 debug/test files (12 gated + 2 root-level)
- `convex/_generated/api.d.ts` -- confirms which functions appear in `api` vs `internal` namespace
- `.planning/research/SUMMARY.md` -- prior project-level research confirming approach
- `.planning/milestones/v3.0-phases/55-security-and-audit/DEBUG-EXCLUSION-STRATEGY.md` -- documents current debug gate architecture
- `.planning/codebase/CONCERNS.md` -- identifies debug endpoint security concern with action item

### Secondary (MEDIUM confidence)
- Convex documentation on internal functions (well-established feature, verified by existing codebase usage)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, uses existing Convex primitives already in use
- Architecture: HIGH -- 8 of 12 files already follow the target pattern; conversion is mechanical
- Pitfalls: HIGH -- all pitfalls identified from prior project research and direct code analysis

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable domain, no moving parts)
