# Phase 37: Schema Additions - Research

**Researched:** 2026-03-02
**Domain:** Convex schema evolution (rate limit table, Zotero field additions)
**Confidence:** HIGH

## Summary

Phase 37 is a schema-only change that adds infrastructure needed by later phases (41: Rate Limiting Enforcement, 39: Zotero Key Encryption). The work is minimal in scope: spread `rateLimitTables` from `convex-helpers/server/rateLimit` into the Convex schema, and add two optional fields (`encryptedApiKey`, `keyPrefix`) to the existing `zoteroConnections` table. No logic changes, no new dependencies, no component installations.

The `convex-helpers` package (v0.1.112) is already installed and provides `rateLimitTables` as a plain object containing a single `rateLimits` table definition using standard `defineTable`. The `convex.config.ts` does NOT need modification -- this is a helper-based rate limiter, not a Convex component. The Zotero fields are added as `v.optional()` alongside the existing `apiKey` field so that existing data and code paths remain functional. Phase 39 will handle the actual encryption migration.

**Primary recommendation:** Add `...rateLimitTables` spread to schema.ts and add two optional fields to `zoteroConnections`. Verify with `npx convex dev` that the schema deploys and all existing functionality is unaffected.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RATE-01 | `rateLimitTables` added to Convex schema | `rateLimitTables` export from `convex-helpers/server/rateLimit` verified in installed package (v0.1.112). Adds `rateLimits` table with fields: `name: v.string()`, `key: v.optional(v.string())`, `value: v.number()`, `ts: v.number()` and index `name: ["name", "key"]`. Single import + spread into `defineSchema`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| convex | 1.32.0 | Backend runtime, database, schema definitions | Already installed; `defineSchema`/`defineTable` are the schema API |
| convex-helpers | 0.1.112 | `rateLimitTables` export for rate limit table definition | Already installed; provides pre-built schema definition for rate limiting |
| convex/values | (bundled) | `v.optional()`, `v.string()` validators | Built-in Convex validators for schema field types |

### Supporting
None needed. This phase uses only existing dependencies.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `convex-helpers/server/rateLimit` table | `@convex-dev/rate-limiter` component | Component requires `convex.config.ts` changes + component installation. `convex-helpers` is already installed with zero additional setup. The STACK research (from milestone research) already decided on `convex-helpers`. |
| Adding optional fields to existing `zoteroConnections` | Creating a new `zoteroEncryptedKeys` table | Separate table adds join complexity. Optional fields on the same table allow gradual migration in Phase 39 without breaking existing code. |

**Installation:**
```bash
# No new packages needed. Zero npm install.
```

## Architecture Patterns

### Pattern 1: Spread Operator for Rate Limit Tables
**What:** Use the object spread operator to merge `rateLimitTables` into the schema definition.
**When to use:** When adding the `convex-helpers` rate limit table to an existing schema.
**Example:**
```typescript
// Source: convex-helpers/server/rateLimit (verified in node_modules)
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  ...rateLimitTables,  // Adds "rateLimits" table
  // ... existing tables unchanged
});
```

**What `rateLimitTables` expands to:**
```typescript
// From node_modules/convex-helpers/server/rateLimit.js (line 125-132)
{
  rateLimits: defineTable({
    name: v.string(),
    key: v.optional(v.string()),
    value: v.number(),
    ts: v.number(),
  }).index("name", ["name", "key"]),
}
```

### Pattern 2: Optional Fields for Gradual Migration
**What:** Add new fields as `v.optional()` alongside existing fields so both old and new code paths work.
**When to use:** When a later phase will migrate data from old fields to new fields.
**Example:**
```typescript
zoteroConnections: defineTable({
  userId: v.id("users"),
  zoteroUserId: v.string(),
  apiKey: v.string(),                              // KEEP: existing field, still used
  encryptedApiKey: v.optional(v.string()),          // NEW: Phase 39 will populate
  keyPrefix: v.optional(v.string()),                // NEW: Phase 39 will populate
  username: v.optional(v.string()),
  connectedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_zotero_user", ["zoteroUserId"]),
```

### Anti-Patterns to Avoid
- **Removing `apiKey` field in this phase:** The existing `apiKey: v.string()` field is read by `convex/zotero/internal.ts:32`, `convex/zotero/actions.ts:632,680,762,763,772,782,808,847,888,971,1029`, and written by `convex/zotero/mutations.ts:100`. Removing it without updating all those code paths would break existing functionality. Phase 39 handles migration.
- **Making `encryptedApiKey` required:** Existing rows in `zoteroConnections` do not have this field. Making it required (`v.string()` instead of `v.optional(v.string())`) would fail Convex schema validation against existing data.
- **Adding rate limit configuration or enforcement logic:** This phase is schema-only. Rate limit definitions and enforcement belong in Phase 41.
- **Modifying `convex.config.ts`:** The `convex-helpers` rate limiter does NOT require component registration. Only `@convex-dev/rate-limiter` (the component version) would need `app.use()`. The project uses the helper-based approach.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limit table schema | Custom `defineTable({ ... })` for rate limits | `rateLimitTables` from `convex-helpers/server/rateLimit` | The export includes the exact table shape and index that `defineRateLimits`/`rateLimit` functions expect. Hand-rolling risks index name or field mismatches that would cause runtime errors in Phase 41. |

**Key insight:** The `rateLimitTables` export is tightly coupled to the `rateLimit()` and `defineRateLimits()` functions in the same module. They share the table name constant `"rateLimits"` and the index name `"name"`. Using the provided export ensures compatibility.

## Common Pitfalls

### Pitfall 1: Spread Position in Schema
**What goes wrong:** Placing `...rateLimitTables` after a table with the same name would silently override it (or vice versa).
**Why it happens:** JavaScript object spread merges keys; later keys win.
**How to avoid:** Place the spread at the TOP of the `defineSchema` call, before any custom table definitions. Verify the name `rateLimits` does not conflict with any existing table.
**Warning signs:** After deployment, the `rateLimits` table has unexpected fields or missing indexes.

**Current schema tables (verified no conflict):**
`users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, `stripeEventLogs`, `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`, `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionRunDiffs`, `libraryItems`, `collections`, `libraryItemCollections`

None conflict with `rateLimits`.

### Pitfall 2: TypeScript Import Path for rateLimitTables
**What goes wrong:** Importing from wrong path causes build failure.
**Why it happens:** `convex-helpers` has multiple export paths.
**How to avoid:** Use exactly: `import { rateLimitTables } from "convex-helpers/server/rateLimit";`
**Warning signs:** TypeScript error: "Module not found" or "has no exported member 'rateLimitTables'".

### Pitfall 3: Schema Deploy Failure with Required Fields on Existing Data
**What goes wrong:** Adding a required field to `zoteroConnections` fails deployment because existing documents lack the field.
**Why it happens:** Convex validates existing data against the new schema on deployment.
**How to avoid:** Always use `v.optional()` for new fields when existing data does not have them.
**Warning signs:** `npx convex dev` fails with "Document ... does not match the schema for table zoteroConnections".

### Pitfall 4: Forgetting to Keep apiKey as Required
**What goes wrong:** Changing `apiKey` from `v.string()` to `v.optional(v.string())` or removing it entirely. Existing reads in zotero/internal.ts and zotero/actions.ts would get `undefined` at runtime.
**Why it happens:** Anticipating Phase 39's migration and making changes prematurely.
**How to avoid:** Make zero changes to the `apiKey` field definition. Only add new fields.
**Warning signs:** TypeScript errors about `string | undefined` in zotero code paths.

## Code Examples

### Complete Schema Change (the only code change in this phase)
```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { rateLimitTables } from "convex-helpers/server/rateLimit";

export default defineSchema({
  // Rate limiting (convex-helpers) -- NEW
  ...rateLimitTables,

  // ═══════════════════════════════════════════════════════════════
  // USERS - synced from Clerk, single source of truth in Convex
  // ═══════════════════════════════════════════════════════════════
  users: defineTable({
    // ... unchanged
  }),

  // ... all other tables unchanged ...

  // ═══════════════════════════════════════════════════════════════
  // ZOTERO INTEGRATION - OAuth connections (auth only)
  // ═══════════════════════════════════════════════════════════════
  zoteroConnections: defineTable({
    userId: v.id("users"),
    zoteroUserId: v.string(),
    apiKey: v.string(),                              // KEEP: existing, still active
    encryptedApiKey: v.optional(v.string()),          // NEW: for Phase 39
    keyPrefix: v.optional(v.string()),                // NEW: for Phase 39
    username: v.optional(v.string()),
    connectedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_zotero_user", ["zoteroUserId"]),

  // ... rest unchanged ...
});
```

### Verification Command
```bash
# After schema changes, verify deployment succeeds
npx convex dev
# Then verify the rateLimits table exists in the dashboard
# and all existing functionality still works
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom rate limit table definition | `rateLimitTables` from `convex-helpers` | convex-helpers 0.1.x | Ensures table schema matches what `rateLimit()` function expects |
| Separate `@convex-dev/rate-limiter` component | Still available but `convex-helpers` helper is simpler for this project | Both approaches are current | Component approach adds to `convex.config.ts`; helper approach uses a regular table |

**Note from convex-helpers source (rateLimit.js line 1-4):**
> "Note: this is now a Component I recommend you use instead: `@convex-dev/rate-limiter` component"

The helpers author recommends the component version for new projects. However, the project's milestone research already decided on `convex-helpers` (see STACK_v2.3_HARDENING.md: "Why convex-helpers over @convex-dev/ratelimiter component: Already installed. No component registration needed."). This decision is locked.

## Open Questions

1. **Rate limit table type compatibility with project MutationCtx**
   - What we know: `rateLimit()` from `defineRateLimits` requires `{ db: GenericDatabaseWriter<RateLimitDataModel> }`. The project's `MutationCtx` provides `{ db: GenericDatabaseWriter<DataModel> }`. Since `DataModel` includes the `rateLimits` table (after schema addition), `DataModel extends RateLimitDataModel` should hold.
   - What's unclear: TypeScript may require an explicit cast or generic constraint when passing `ctx` to `rateLimit()`. The STACK research shows `rateLimit(ctx, { ... })` working directly.
   - Recommendation: This is a Phase 41 concern, not Phase 37. The schema addition itself has no type compatibility issues. Flag for Phase 41 research.

## Sources

### Primary (HIGH confidence)
- `node_modules/convex-helpers/server/rateLimit.d.ts` - Verified `rateLimitTables` export type, table shape, index definition
- `node_modules/convex-helpers/server/rateLimit.js` (lines 125-132) - Verified runtime `rateLimitTables` implementation
- `convex/schema.ts` - Current schema (22 tables, no `rateLimits` conflict)
- `convex/zotero/mutations.ts` - Current `saveConnection` writes `apiKey` field (line 100)
- `convex/zotero/internal.ts` - Current `getConnection` reads `apiKey` field (line 32)
- `convex/zotero/actions.ts` - 20+ references to `connection.apiKey` (lines 632, 680, 762, 763, 772, 782, 808, 847, 888, 971, 1029)
- `convex/convex.config.ts` - Confirmed no rate limiter component registration needed

### Secondary (MEDIUM confidence)
- `.planning/research/STACK_v2.3_HARDENING.md` - Milestone-level decision to use `convex-helpers` over `@convex-dev/rate-limiter`
- `.planning/research/FEATURES_v2.3_HARDENING.md` - Feature landscape including Zotero encryption approach

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages already installed, verified in node_modules
- Architecture: HIGH - Single file change (schema.ts), pattern verified in convex-helpers source
- Pitfalls: HIGH - Verified existing table names for conflicts, confirmed optional field requirement for existing data

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- convex-helpers schema export is unlikely to change)
