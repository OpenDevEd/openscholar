# Phase 55: Security and Audit - Research

**Researched:** 2026-03-04
**Domain:** XSS mitigation, audit logging, env var validation, debug function governance
**Confidence:** HIGH

## Summary

Phase 55 addresses five security concerns and two test requirements across the codebase. The work splits into four distinct domains: (1) eliminating XSS risk from `dangerouslySetInnerHTML` in `table-view.tsx` by replacing it with a React-native `HighlightedText` component that uses text splitting instead of raw HTML injection; (2) creating a persistent `auditLogs` table in Convex to replace ephemeral `console.log` audit events for security-sensitive operations (key decryption, debug gate access); (3) adding a cron-based startup check that validates required environment variables; and (4) documenting the debug function production exclusion strategy with actionable guidance.

The codebase already has well-structured patterns for each concern: `createError()` for typed errors, `defineTable()` for schema, `internalMutation` for internal-only write operations, and the existing `crons.ts` file for scheduling. The XSS fix is a pure frontend concern requiring no new dependencies -- React's built-in text rendering already escapes HTML. The audit table is a straightforward Convex table addition with an `internalMutation` writer. The env var validation requires a new cron entry calling a new `internalMutation` or `internalAction`.

**Primary recommendation:** Split into two plans -- Plan 01 covers SEC-01 (XSS) + TEST-01 (HighlightedText test) as a self-contained frontend change. Plan 02 covers SEC-02 (audit table) + SEC-03 (env var validation) + SEC-04 (debug docs) + SEC-05 (price ID fail-fast) + TEST-06 (env var test) as a backend security sweep.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Replace `dangerouslySetInnerHTML` in `table-view.tsx` with XSS-safe `HighlightedText` component | Identified all 4 call sites (lines 162-164, 378-380, 387-389, 450-452). Text splitting pattern documented in Code Examples. |
| SEC-02 | Create persistent `auditLogs` table with `writeAuditLog` internalMutation | Schema pattern documented. Two existing audit log sites identified: `convex/lib/crypto.ts:81` (KEY_DECRYPT) and `convex/lib/debug_gate.ts:25` (DEBUG_ACCESS). |
| SEC-03 | Cron-based startup env var validation | Existing `crons.ts` has 5 cron entries. Required env vars: `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN`. |
| SEC-04 | Document debug function production exclusion strategy | 12 debug-gated files identified. Current gate: `requirePublicDebugEnabled()` env var check. Convex has no file-level exclusion in deployment -- documentation must address deployment configs or staging project separation. |
| SEC-05 | Replace empty-string fallbacks for Stripe price IDs with fail-fast validation | `convex/lib/constants.ts` lines 21-23 use `\|\| ""` fallbacks. `assertPlanPriceConfig()` exists (line 55) but only called in `subscriptions/actions.ts`. Must add calls in billing-critical handlers. |
| TEST-01 | Unit test for `highlightText` / `HighlightedText` with HTML characters verifying XSS safety | New test file needed. After refactor, test the pure function that splits text on query match. |
| TEST-06 | Test for env var validation detecting missing critical env vars | New test file needed. Test the validation function with missing/present env vars via `vi.resetModules()` pattern (see `debug-gate.test.ts` for pattern). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.x | HighlightedText component (text splitting, no HTML injection) | Already in project; built-in HTML escaping |
| Convex | ^1.31.7 | `defineTable`, `internalMutation`, `cronJobs` for audit table and env var check | Already in project; native Convex patterns |
| Vitest | existing | Tests for XSS safety and env var validation | Already configured in `vitest.config.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| convex-helpers | ^0.1.111 | Already used for rateLimitTables | Already in schema, no new dependency needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| React text splitting | DOMPurify | Out of scope per REQUIREMENTS.md -- text splitting is simpler, zero-dep |
| Convex audit table | External SIEM/log sink | Out of scope per REQUIREMENTS.md -- Convex table is sufficient |
| Cron-based env check | Module-scope validation | Out of scope per REQUIREMENTS.md -- blocks all functions in module |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
components/
  extraction/
    results-views/
      table-view.tsx        # Remove dangerouslySetInnerHTML, use HighlightedText
      highlighted-text.tsx  # NEW: React-native text highlighting component

convex/
  lib/
    audit.ts               # NEW: writeAuditLog internalMutation
    constants.ts           # Modify: remove empty-string fallbacks
    crypto.ts              # Modify: call writeAuditLog instead of console.log
    debug_gate.ts          # Modify: call writeAuditLog instead of console.log
    envValidation.ts       # NEW: validateRequiredEnvVars function
  crons.ts                 # Modify: add env var validation cron
  schema.ts                # Modify: add auditLogs table

tests/
  highlight-text.test.ts   # NEW: XSS safety test
  env-validation.test.ts   # NEW: env var detection test
```

### Pattern 1: React Text Splitting for Safe Highlighting
**What:** Replace `dangerouslySetInnerHTML` + `highlightText()` HTML string with a React component that splits text into segments and wraps matches in `<mark>` elements.
**When to use:** Any time search query highlighting is needed in React without XSS risk.
**Example:**
```typescript
// components/extraction/results-views/highlighted-text.tsx

interface HighlightedTextProps {
  text: string;
  query: string;
  className?: string;
}

/**
 * Split text into segments: non-matching text and matching spans.
 * Returns an array of {text, isMatch} objects.
 * Pure function -- no HTML involved.
 */
export function splitTextByQuery(
  text: string,
  query: string
): Array<{ text: string; isMatch: boolean }> {
  if (!query || !query.trim()) {
    return [{ text, isMatch: false }];
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => ({
      text: part,
      isMatch: regex.test(part) || part.toLowerCase() === query.toLowerCase(),
    }));
}

export function HighlightedText({ text, query, className }: HighlightedTextProps) {
  const segments = splitTextByQuery(text, query);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.isMatch ? (
          <mark
            key={i}
            className="bg-yellow-200/50 dark:bg-yellow-500/30 rounded px-0.5"
          >
            {seg.text}
          </mark>
        ) : (
          seg.text
        )
      )}
    </span>
  );
}
```

### Pattern 2: Convex Audit Log Table with internalMutation Writer
**What:** Persistent audit table for security-sensitive operations, written via `internalMutation` so it cannot be called from clients.
**When to use:** Replace `console.log` audit events with durable storage.
**Example:**
```typescript
// convex/lib/audit.ts
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const writeAuditLog = internalMutation({
  args: {
    action: v.string(),        // e.g. "KEY_DECRYPT", "DEBUG_ACCESS"
    userId: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      action: args.action,
      userId: args.userId,
      metadata: args.metadata,
      timestamp: Date.now(),
    });
    return null;
  },
});
```

### Pattern 3: Cron-Based Env Var Validation
**What:** A cron job that runs on a low-frequency interval to validate that all required environment variables are present and non-empty.
**When to use:** For startup-time detection of misconfiguration without blocking module-level code.
**Example:**
```typescript
// convex/lib/envValidation.ts
const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "CLERK_JWT_ISSUER_DOMAIN",
] as const;

export function validateRequiredEnvVars(): { missing: string[] } {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === ""
  );
  return { missing };
}
```

**Cron registration:**
```typescript
// In convex/crons.ts -- add:
crons.interval(
  "validate required env vars",
  { hours: 24 },
  internal.lib.envValidation.checkRequiredEnvVars
);
```

**Important constraint:** `CLERK_JWT_ISSUER_DOMAIN` is accessed at module scope in `convex/auth.config.ts` (line 6: `domain: process.env.CLERK_JWT_ISSUER_DOMAIN!`). This means it is already implicitly required at deploy time. The cron check provides explicit validation with clear error messages for the other env vars that are accessed lazily.

### Pattern 4: Fail-Fast Price ID Validation in Handlers
**What:** Replace module-scope `|| ""` fallbacks with handler-level validation that throws if price IDs are empty.
**When to use:** In billing handlers that depend on price IDs being configured.
**Example:**
```typescript
// convex/lib/constants.ts -- CHANGE FROM:
export const GO_PRICE_ID = process.env.STRIPE_GO_PRICE_ID || "";
// CHANGE TO:
export const GO_PRICE_ID = process.env.STRIPE_GO_PRICE_ID ?? "";
// (Same behavior, but the assertPlanPriceConfig() call in handlers catches empty strings)
```

**Key insight:** The module-scope constants MUST still have a fallback value because Convex evaluates module-scope code at deploy time. The fix is NOT to remove the fallback -- it is to ensure `assertPlanPriceConfig()` is called in all billing-critical handlers, not just `createCheckoutSession`. Handlers that need price IDs: `createCheckoutSession` (already has it), `createBillingPortalSession`, `handleSubscriptionChanged`, and any webhook handler that resolves plans from price IDs.

### Anti-Patterns to Avoid
- **Module-scope `throw` for missing env vars:** Convex evaluates module-scope code at deploy time. A `throw` at module scope blocks ALL functions in that module, not just the one that needs the env var. The cron-based approach is correct.
- **Calling `writeAuditLog` from actions via `ctx.runMutation`:** The `decryptApiKey` function in `convex/lib/crypto.ts` is a pure Node.js function (not a Convex handler). It cannot call `ctx.runMutation`. The pattern must be: the calling action writes the audit log after decryption, not the crypto utility itself.
- **Using `dangerouslySetInnerHTML` with "sanitized" strings:** Even with DOMPurify, raw HTML injection is more fragile than React text nodes. Prefer the text splitting approach.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML escaping | Custom escape function | React text nodes (JSX `{text}`) | React auto-escapes all text content in JSX expressions |
| Audit log persistence | File-based logging | Convex `defineTable` + `internalMutation` | Queryable, durable, built into the existing stack |
| Env var validation framework | Custom env manager | Simple `process.env[key]` check in a cron | No need for complexity; 6 env vars, one check function |

**Key insight:** Every security fix in this phase uses existing project infrastructure. No new libraries, no new patterns -- just applying Convex and React idioms correctly.

## Common Pitfalls

### Pitfall 1: Regex `.test()` State in Global Regex
**What goes wrong:** Using `regex.test()` after `text.split(regex)` with a global (`g`) flag regex gives inconsistent results because `.test()` updates `lastIndex`.
**Why it happens:** JavaScript global regexes are stateful -- `.test()` alternates between true/false on consecutive calls.
**How to avoid:** In `splitTextByQuery`, compare case-insensitively with a string comparison (`part.toLowerCase() === query.toLowerCase()`) instead of reusing the same regex with `.test()`. Or create a fresh regex for each test.
**Warning signs:** Highlighted text appears intermittently or only every other match.

### Pitfall 2: Audit Log from Non-Handler Context
**What goes wrong:** Trying to call `ctx.runMutation(internal.lib.audit.writeAuditLog, ...)` from `decryptApiKey()` in `convex/lib/crypto.ts` -- but `decryptApiKey` is a plain function, not a Convex handler. It has no `ctx`.
**Why it happens:** The current audit is `console.log` which works anywhere. The persistent audit needs a mutation context.
**How to avoid:** Move audit logging to the caller. In `convex/apiKeys/actions.ts`, `convex/zotero/actions.ts`, and `convex/extraction/workpoolActions.ts`, call `writeAuditLog` after calling `decryptApiKey`. Remove the `console.log` from `decryptApiKey` itself or keep it as a secondary log.
**Warning signs:** Type errors when trying to pass `ctx` to `decryptApiKey`.

### Pitfall 3: Cron Env Var Check Accessing Node APIs
**What goes wrong:** If the env var validation cron is an `internalAction` with `"use node"`, it works. If it's an `internalMutation`, `process.env` access still works in Convex but only for env vars set in the Convex dashboard (not `.env.local`).
**Why it happens:** Convex mutations run in V8 isolate, not Node.js. `process.env` is available but only for Convex-configured env vars.
**How to avoid:** Use `internalAction` with `"use node"` for the cron handler, since it needs to check `STRIPE_SECRET_KEY` and `ENCRYPTION_KEY` which are Convex-dashboard env vars accessible in both contexts.
**Warning signs:** Env vars appear missing in mutation context but present in action context.

### Pitfall 4: Empty String vs Undefined for Price IDs
**What goes wrong:** `assertPlanPriceConfig()` checks `!GO_PRICE_ID || !PRO_PRICE_ID`. If the module-scope constant is set to `""` (empty string), this correctly catches it. But if you change the fallback to `undefined`, TypeScript type narrowing changes throughout the file.
**Why it happens:** The module-scope `process.env.X || ""` is intentional -- it provides a string type for downstream comparisons.
**How to avoid:** Keep the `|| ""` fallback for type safety. The fix is calling `assertPlanPriceConfig()` in more handlers, not changing the module-scope default.
**Warning signs:** Type errors in `getPlanFromPriceId` or `PLAN_PRICE_IDS` if changing fallback from `""` to `undefined`.

### Pitfall 5: Convex Has No File-Level Deploy Exclusion
**What goes wrong:** Attempting to exclude debug files from production Convex deployment using a config option that does not exist.
**Why it happens:** Unlike Next.js or Webpack, Convex deploys ALL `.ts` files in the `convex/` directory. There is no `exclude` option in `convex.config.ts`.
**How to avoid:** The correct approach is documentation: (1) keep the env var gate as the runtime kill switch, (2) document that `ENABLE_PUBLIC_DEBUG_FUNCTIONS` must NEVER be `"true"` in production, (3) optionally create a separate Convex project for staging with debug functions enabled.
**Warning signs:** Searching for Convex deploy exclusion options and finding none.

## Code Examples

### XSS-Safe HighlightedText Component (replacing dangerouslySetInnerHTML)
```typescript
// Source: Verified from React documentation -- JSX text expressions are auto-escaped

// BEFORE (vulnerable):
<div dangerouslySetInnerHTML={{ __html: highlightText(paper.title, searchQuery) }} />

// AFTER (safe):
<HighlightedText text={paper.title} query={searchQuery} />
```

**Call sites to replace in `table-view.tsx`:**
1. Line 162-164: Paper title in `TableCell` -- replace `<div dangerouslySetInnerHTML>` with `<HighlightedText>`
2. Line 378-380: Array item badge -- replace `<Badge dangerouslySetInnerHTML>` with `<Badge><HighlightedText /></Badge>`
3. Line 387-389: String answer div -- replace `<div dangerouslySetInnerHTML>` with `<HighlightedText>`
4. Line 450-452: Reasoning popover -- replace `<p dangerouslySetInnerHTML>` with `<HighlightedText>`

### Audit Log Schema
```typescript
// Source: Convex schema pattern from existing codebase (convex/schema.ts)

auditLogs: defineTable({
  action: v.string(),              // "KEY_DECRYPT" | "DEBUG_ACCESS" | "ENV_CHECK"
  userId: v.optional(v.string()),  // string not Id<"users"> -- some events have no user
  metadata: v.optional(v.record(v.string(), v.string())),
  timestamp: v.number(),
})
  .index("by_action", ["action"])
  .index("by_action_timestamp", ["action", "timestamp"])
  .index("by_timestamp", ["timestamp"]),
```

### Audit Log Callers (replacing console.log)
```typescript
// In convex/lib/crypto.ts -- remove console.log from decryptApiKey:
export function decryptApiKey(
  encrypted: string,
  keyHex: string,
  audit: { userId: string; purpose: string }
): string {
  const decrypted = decrypt(encrypted, keyHex);
  // Remove: console.log("[AUDIT:KEY_DECRYPT]", ...);
  // Audit logging moved to callers who have ctx
  return decrypted;
}

// In convex/apiKeys/actions.ts -- add audit log call after decryption:
const decrypted = decryptApiKey(keyData.encryptedKey, encryptionKey, {
  userId: user._id,
  purpose: `api-key-decrypt:${args.provider}`,
});
await ctx.runMutation(internal.lib.audit.writeAuditLog, {
  action: "KEY_DECRYPT",
  userId: user._id,
  metadata: { purpose: `api-key-decrypt:${args.provider}` },
});

// In convex/lib/debug_gate.ts -- cannot call mutation (no ctx), keep console.log
// AND add audit log call in each debug handler after requirePublicDebugEnabled()
```

### Env Var Validation Test
```typescript
// Source: Pattern from tests/debug-gate.test.ts (vi.resetModules + process.env manipulation)

describe("validateRequiredEnvVars", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("detects missing STRIPE_SECRET_KEY", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { validateRequiredEnvVars } = await import("../convex/lib/envValidation");
    const result = validateRequiredEnvVars();
    expect(result.missing).toContain("STRIPE_SECRET_KEY");
  });

  it("returns empty array when all env vars are present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxx";
    process.env.ENCRYPTION_KEY = "abc123";
    process.env.STRIPE_GO_PRICE_ID = "price_go";
    process.env.STRIPE_PRO_PRICE_ID = "price_pro";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxx";
    process.env.CLERK_JWT_ISSUER_DOMAIN = "https://clerk.example.com";
    const { validateRequiredEnvVars } = await import("../convex/lib/envValidation");
    const result = validateRequiredEnvVars();
    expect(result.missing).toEqual([]);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dangerouslySetInnerHTML` for search highlighting | React text splitting (JSX text nodes) | React best practice since React 16+ | Eliminates XSS vector entirely |
| `console.log` for audit events | Persistent database audit table | Standard security practice | Queryable, durable, tamper-resistant audit trail |
| Lazy env var access with no startup check | Cron-based validation at deploy+runtime | Common pattern in serverless | Early detection of misconfiguration |

**Deprecated/outdated:**
- DOMPurify for this use case: Out of scope per REQUIREMENTS.md. Text splitting is simpler and correct.

## Open Questions

1. **Debug gate audit logging from non-handler context**
   - What we know: `requirePublicDebugEnabled()` in `convex/lib/debug_gate.ts` is a plain function with no `ctx`. It cannot call `ctx.runMutation`.
   - What's unclear: Whether to (a) keep `console.log` in the gate and ALSO write audit from each caller, or (b) refactor gate to return a flag and let callers handle both gating and auditing.
   - Recommendation: Keep `console.log` as a secondary log in `debug_gate.ts` (backward compat, belt-and-suspenders). Add `writeAuditLog` calls in each debug handler that calls `requirePublicDebugEnabled()`. This is 12 call sites but each is a one-line addition.

2. **Cron frequency for env var validation**
   - What we know: A 24-hour interval catches misconfiguration within a day. A shorter interval (1 hour) catches it faster but adds load.
   - What's unclear: How quickly the team needs to detect env var removal.
   - Recommendation: Use 24-hour interval. Env vars are set via the Convex dashboard and rarely change. The cron also writes to the audit log on failure, providing visibility.

3. **Scope of `assertPlanPriceConfig()` expansion**
   - What we know: Currently only called in `createCheckoutSession`. SEC-05 requires fail-fast in handlers.
   - What's unclear: Exactly which handlers beyond `createCheckoutSession` need the assertion.
   - Recommendation: Add to all handlers that call `getPlanFromPriceId()` or reference `PLAN_PRICE_IDS` -- specifically the webhook handler and any subscription mutation that resolves plans.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `components/extraction/results-views/table-view.tsx` -- all 4 `dangerouslySetInnerHTML` call sites verified
- Codebase inspection: `convex/lib/crypto.ts` -- audit log at line 81 verified
- Codebase inspection: `convex/lib/debug_gate.ts` -- audit log at line 25 verified
- Codebase inspection: `convex/lib/constants.ts` -- empty-string fallbacks at lines 21-23 verified
- Codebase inspection: `convex/crons.ts` -- existing cron structure verified
- Codebase inspection: `convex/schema.ts` -- no existing `auditLogs` table
- Codebase inspection: 12 debug-gated files verified via grep

### Secondary (MEDIUM confidence)
- React documentation: JSX text expressions are auto-escaped (well-established React behavior since inception)
- Convex documentation: `process.env` accessible in both mutation and action contexts for dashboard-configured env vars

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing project patterns
- Architecture: HIGH - direct codebase inspection of all affected files, patterns verified
- Pitfalls: HIGH - pitfalls derive from specific codebase constraints (crypto.ts has no ctx, Convex has no deploy exclusion, global regex state)

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable domain, no fast-moving dependencies)
