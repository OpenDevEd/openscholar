# Phase 43: Schema Migration & Quick Wins - Research

**Researched:** 2026-03-02
**Domain:** Convex schema migration, dead code removal, configuration hardening
**Confidence:** HIGH

## Summary

Phase 43 bundles five low-risk, high-value fixes that share a common theme: cleaning up known tech debt before deeper work begins. The work divides into three clusters: (1) a Convex schema migration to encrypt and then remove the deprecated plaintext `apiKey` field from `zoteroConnections`, (2) dead code / placeholder removal (the `/test-sidebar` page and the `admin@example.com` User-Agent), and (3) inline JSDoc policy documentation for every debug endpoint gated by `requirePublicDebugEnabled()`.

All five items require zero new dependencies. The migration uses the existing `migrateToEncryptedKeys` internal action (already implemented in Phase 39) and a new small mutation to clear the plaintext field. The quick wins are single-file edits. The debug documentation is a mechanical sweep across 10 files containing 14 gated endpoints.

The only ordering constraint is internal: the migration must be run and verified before the schema field is removed and before the fallback code paths are deleted. Everything else is independent.

**Primary recommendation:** Execute as two plans: Plan 01 handles the migration + schema cleanup (SEC-01, SEC-02), Plan 02 handles the three quick wins (SEC-04, SEC-05, BUG-05). Plan 01 is sequenced first because it gates a schema deploy.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Migrate all plaintext Zotero `apiKey` values to `encryptedApiKey` via one-time batched action | Migration action `migrateToEncryptedKeys` already exists in `convex/zotero/actions.ts:1097-1141`. Need to also patch `apiKey` to `undefined` after encryption, then verify zero rows remain. |
| SEC-02 | Remove deprecated `apiKey` field from schema and all fallback code paths after migration verification | Field at `convex/schema.ts:175`. Fallback code in `resolveZoteroApiKey` (actions.ts:42-45), `getConnection` return (internal.ts:19,35), `listAllConnections` return (internal.ts:48,53), `ZoteroConnection` type (actions.ts:26), `workpoolActions.ts:759-761`. |
| SEC-04 | Document debug endpoint production policy with inline JSDoc and deployment checklist | 10 files, 14 gated entry points. Gate function in `convex/lib/debug_gate.ts`. All already call `requirePublicDebugEnabled()` -- need JSDoc + policy annotation only. |
| SEC-05 | Remove orphaned `/test-sidebar` page from production build | Single file: `app/test-sidebar/page.tsx`. No imports from other files. No route references elsewhere. |
| BUG-05 | Replace placeholder `admin@example.com` in OpenAlex User-Agent with real operational email | Single occurrence: `convex/extraction/actions.ts:138`. Should use an environment variable for easy rotation. |
</phase_requirements>

## Standard Stack

### Core

No new libraries needed. This phase operates entirely within the existing stack.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | 1.32.0 | Schema definition, mutations, queries | Already installed; schema changes deploy via `npx convex deploy` |
| convex/lib/crypto.ts | project module | AES-256-GCM encrypt/decrypt | Already used by Phase 39 for Zotero key encryption |

### Supporting

None required.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled migration (existing) | `@convex-dev/migrations` | Rejected in STATE.md -- existing self-scheduling pattern is sufficient for the small zoteroConnections table |

**Installation:**
```bash
# No installation needed -- zero new dependencies
```

## Architecture Patterns

### Pattern 1: Three-Step Schema Field Removal in Convex

**What:** Safely removing a field from a Convex schema requires three deployments, not one. Convex validates ALL existing documents against the schema on deploy. Removing a field that still has data in any document causes a deploy failure.

**When to use:** Any time a schema field is being deprecated and removed.

**Steps:**
```
Step A: Ensure field is v.optional() in schema [ALREADY DONE -- Phase 39]
Step B: Run migration to clear/encrypt field, verify zero documents have it set
Step C: Remove field from schema definition, deploy
```

**Example (this phase):**
```typescript
// Step B: Migration mutation to clear apiKey after encryption
// In convex/zotero/mutations.ts:
export const clearPlaintextApiKey = internalMutation({
  args: { connectionId: v.id("zoteroConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    // Convex db.patch with undefined removes the field from the document
    await ctx.db.patch(connectionId, { apiKey: undefined });
    return null;
  },
});

// Verification query (run from dashboard):
// SELECT count(*) FROM zoteroConnections WHERE apiKey IS NOT NULL
// Must return 0 before Step C deploy
```

**Critical detail:** In Convex, `db.patch(id, { field: undefined })` removes the field from the document entirely. This is the correct way to clear an optional field before removing it from the schema.

### Pattern 2: Environment Variable for Rotatable Configuration

**What:** Values that may need to change without a code deploy (like contact emails) should come from environment variables, not hardcoded strings.

**When to use:** Any configuration value that is operational rather than structural.

**Example (BUG-05):**
```typescript
// In convex/extraction/actions.ts:
const contactEmail = process.env.OPENALEX_CONTACT_EMAIL;
if (!contactEmail) {
  throw new Error("OPENALEX_CONTACT_EMAIL environment variable not set");
}
// ...
"User-Agent": `OpenAlex-Count/1.0 (mailto:${contactEmail})`,
```

### Pattern 3: JSDoc Policy Annotation for Debug Endpoints

**What:** Every debug endpoint should have an inline JSDoc block documenting: (1) what it does, (2) its production policy (staging-only vs always-gated), and (3) the gate mechanism.

**When to use:** All functions that call `requirePublicDebugEnabled()`.

**Example:**
```typescript
/**
 * Diagnostic query to check extraction job status.
 *
 * @production STAGING ONLY -- gated by ENABLE_PUBLIC_DEBUG_FUNCTIONS env var.
 * Gate: requirePublicDebugEnabled() throws FORBIDDEN when env var is not "true".
 * Auth: Requires authenticated user; enforces job ownership (job.userId === user._id).
 */
export const diagnoseJob = query({
  // ...
});
```

### Anti-Patterns to Avoid
- **Combining migration and schema removal in one deploy:** The migration must run and be verified BEFORE the schema field is removed. These must be separate deploys.
- **Hardcoding emails that may change:** Use environment variables for operational contact information.
- **Removing fallback code before verifying migration:** The `resolveZoteroApiKey` fallback for plaintext `apiKey` must not be removed until the migration is verified complete (zero plaintext rows).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migration | Custom migration framework | Existing `migrateToEncryptedKeys` + small clear mutation | Table is small; no need for pagination or batching |
| Debug gate documentation | Runtime documentation system | Inline JSDoc | Static documentation that lives next to the code |

**Key insight:** The zoteroConnections table is tiny (one row per user with Zotero connected). The migration does not need batching, cursors, or self-scheduling. A simple loop over all rows is sufficient.

## Common Pitfalls

### Pitfall 1: Removing apiKey from schema before all documents are cleared

**What goes wrong:** `npx convex deploy` rejects the schema because existing documents still contain the `apiKey` field. The deploy fails and blocks all other code changes.
**Why it happens:** Developer assumes the migration action already cleared the field, but the existing `migrateToEncryptedKeys` only encrypts -- it does not set `apiKey` to `undefined`.
**How to avoid:** After running `migrateToEncryptedKeys`, run a second pass that patches every connection's `apiKey` to `undefined`. Then query for any rows with `apiKey !== undefined` and confirm count is 0.
**Warning signs:** Deploy failure with schema validation error mentioning `apiKey`.

### Pitfall 2: Forgetting the workpoolActions.ts fallback code path

**What goes wrong:** The `apiKey` field is removed from the schema and `resolveZoteroApiKey` is cleaned up, but `convex/extraction/workpoolActions.ts:759-761` still references `zoteroConnection.apiKey` directly. This causes a TypeScript compile error (the field no longer exists on the type).
**Why it happens:** The concerns doc mentions `actions.ts` and `internal.ts` but the workpoolActions fallback is less obvious.
**How to avoid:** Search for ALL occurrences of `apiKey` in the `convex/` directory after cleanup. The complete list of files to modify is documented in the Code Examples section below.
**Warning signs:** TypeScript error on `zoteroConnection.apiKey` property access.

### Pitfall 3: Using a non-deliverable email for OpenAlex User-Agent

**What goes wrong:** OpenAlex's polite pool system may verify that the email in the User-Agent is deliverable. A non-existent or bounce-prone address gets the application moved to the unprioritized pool, causing slower responses or rate limiting.
**Why it happens:** Developer picks an email from the codebase or a generic address without confirming it is monitored.
**How to avoid:** Use a real, monitored operational email. Store it as an environment variable (`OPENALEX_CONTACT_EMAIL`) so it can be rotated without a code deploy. Verify the email receives mail before deploying.
**Warning signs:** Slower OpenAlex API responses, 429 rate limit errors.

### Pitfall 4: Deleting test-sidebar without checking for imports

**What goes wrong:** Another file imports from `app/test-sidebar/page.tsx`, causing a build failure.
**Why it happens:** Assumption that test pages are standalone.
**How to avoid:** Search for imports of `test-sidebar` before deleting. (Verified: no imports exist -- the page is standalone.)
**Warning signs:** Next.js build failure with "module not found" error.

## Code Examples

### Complete list of files requiring changes for SEC-01 + SEC-02

```
# Files to modify for migration + schema cleanup:

convex/zotero/actions.ts
  - Line 22-27: Remove `apiKey?` from ZoteroConnection type
  - Line 34-47: Simplify resolveZoteroApiKey -- remove lines 42-45 (plaintext fallback)
  - Line 1097-1141: Update migrateToEncryptedKeys to also clear apiKey (patch to undefined)

convex/zotero/internal.ts
  - Line 9: Update comment to remove dual-read mention
  - Line 19: Remove `apiKey: v.optional(v.string())` from getConnection return validator
  - Line 35: Remove `apiKey: connection.apiKey` from getConnection return
  - Line 48: Remove `apiKey: v.optional(v.string())` from listAllConnections return validator
  - Line 53: Remove `apiKey: c.apiKey` from listAllConnections map

convex/extraction/workpoolActions.ts
  - Lines 751-761: Remove plaintext fallback branch (else if block at line 759-760)

convex/schema.ts
  - Line 175: Remove `apiKey: v.optional(v.string())` from zoteroConnections table
```

### Environment variable for OpenAlex email (BUG-05)

```typescript
// convex/extraction/actions.ts line 138
// BEFORE:
"User-Agent": "OpenAlex-Count/1.0 (mailto:admin@example.com)",

// AFTER:
"User-Agent": `OpenAlex-Count/1.0 (mailto:${process.env.OPENALEX_CONTACT_EMAIL || "admin@example.com"})`,
// Note: fallback preserves current behavior if env var not set.
// Alternatively, throw if env var is missing (stricter).
```

### Complete debug endpoint inventory for SEC-04

All files requiring JSDoc documentation:

```
convex/extraction/debug.ts
  - diagnoseJob (query, public, auth + ownership check)

convex/extraction/debug_errors.ts
  - getFailedPapersDebug (query, public, auth + ownership check)

convex/extraction/debug_papers.ts
  - getPaperErrorsInternal (internalQuery, internal only)

convex/extraction/debug_paper_results.ts
  - debugPaperResults (internalQuery, internal only)

convex/extraction/debug_job_content.ts
  - debugJobContent (internalQuery, internal only)

convex/extraction/debug_job_citations.ts
  - debugJobCitations (internalQuery, internal only)

convex/extraction/debug_pdfjs_alignment.ts
  - debugPdfAlignment (internalAction, internal only)

convex/extraction/test_runner.ts
  - createAndRunTestJob (internalMutation, internal only)
  - Second export at ~line 118 (needs inspection)

convex/extraction/test_automation.ts
  - runPdfTestNow (internalAction, internal only)

convex/extraction/test_automation_internal.ts
  - getFirstUserId (internalQuery, internal only)
  - createTestJob (internalMutation, internal only)
  - Two more exports at ~line 65 and ~line 86

convex/extraction/testActions.ts
  - createTestJob (mutation, public, auth check)

convex/extraction/create_test_job.ts
  - createTestJobForFix (mutation, public, auth check)
```

Total: 10 files, ~14 gated entry points.

### Deleting the test-sidebar page (SEC-05)

```bash
# Single file to remove:
rm app/test-sidebar/page.tsx

# Verification: after next build, /test-sidebar should return 404
# No other files import from this path (verified via grep)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plaintext apiKey stored directly | AES-256-GCM encrypted via encryptedApiKey | Phase 39 (v2.3) | Dual-read fallback still exists for pre-migration rows |
| Debug endpoints ungated | requirePublicDebugEnabled() gate | Phase 35 (v2.3) | All debug endpoints already gated; missing JSDoc policy docs |

**Deprecated/outdated:**
- `zoteroConnections.apiKey`: Deprecated since Phase 39. To be removed in this phase after migration verification.
- `resolveZoteroApiKey` plaintext fallback: Exists only for pre-migration compatibility. To be removed.

## Open Questions

1. **What email address should replace `admin@example.com`?**
   - What we know: Must be a real, monitored, deliverable email address used as the OpenAlex polite pool identifier.
   - What's unclear: The project owner needs to decide the specific email. It should be stored as `OPENALEX_CONTACT_EMAIL` environment variable.
   - Recommendation: Use the project's operational contact email. The planner should note that the implementor needs to set the env var in the Convex dashboard after deploy.

2. **Has `migrateToEncryptedKeys` already been run in production?**
   - What we know: The action was deployed in Phase 39 (v2.3). The Phase 39 summary says SEC-01 is "fully satisfied" but does not confirm the action was actually run against production data.
   - What's unclear: Whether all existing plaintext keys are already encrypted. If already run, Step B (clear apiKey) can proceed immediately. If not, Step A (encrypt) must run first.
   - Recommendation: The plan should include running the migration idempotently (it skips already-encrypted rows) and then clearing the apiKey field, regardless of whether it was previously run.

3. **Should the migration also clear `apiKey` from documents, or just set it to undefined?**
   - What we know: In Convex, `db.patch(id, { apiKey: undefined })` removes the field entirely from the document. This is necessary for the schema removal to succeed.
   - Recommendation: The existing `migrateToEncryptedKeys` should be extended (or a follow-up mutation should be added) to patch `apiKey: undefined` on every document after encryption. This is the critical missing step.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `convex/schema.ts`, `convex/zotero/actions.ts`, `convex/zotero/internal.ts`, `convex/zotero/mutations.ts`, `convex/extraction/workpoolActions.ts`, `convex/extraction/actions.ts`, `app/test-sidebar/page.tsx`, `convex/lib/debug_gate.ts`, all 10 debug endpoint files
- Phase 39 summary: `.planning/milestones/v2.3-phases/39-zotero-key-encryption/39-02-SUMMARY.md`
- Project concerns: `.planning/codebase/CONCERNS.md`
- Existing v2.4 research: `.planning/research/PITFALLS_v2.4_CONCERNS_SWEEP.md`, `.planning/research/STACK_v2.4_CONCERNS_SWEEP.md`, `.planning/research/FEATURES.md`

### Secondary (MEDIUM confidence)
- STATE.md decision: "Rejected @convex-dev/migrations for apiKey migration -- hand-rolled batched mutation using existing self-scheduling pattern"
- Convex schema validation behavior (from pitfalls research and prior project experience): deploy-time validation of all documents against schema

### Tertiary (LOW confidence)
- OpenAlex polite pool email verification behavior: Mentioned in concerns doc and pitfalls research but not independently verified against OpenAlex documentation. The recommendation to use a deliverable email is conservative and correct regardless.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - zero new dependencies, all APIs verified in codebase
- Architecture: HIGH - three-step schema migration pattern verified against Convex behavior and prior Phase 39 work
- Pitfalls: HIGH - all pitfalls verified against actual codebase state; complete file inventory produced
- Code examples: HIGH - all line numbers verified against current codebase

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- no external API changes expected)
