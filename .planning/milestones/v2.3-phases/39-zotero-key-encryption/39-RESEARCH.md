# Phase 39: Zotero Key Encryption - Research

**Researched:** 2026-03-02
**Domain:** AES-256-GCM encryption, Convex action/mutation separation, data migration
**Confidence:** HIGH

## Summary

Phase 39 encrypts Zotero API keys at rest using the same AES-256-GCM pattern already proven in `convex/apiKeys/actions.ts`. The schema changes are already deployed (Phase 37 added `encryptedApiKey: v.optional(v.string())` and `keyPrefix: v.optional(v.string())` to `zoteroConnections`). The work decomposes into four parts: (1) extract `encrypt`/`decrypt` into a shared `convex/lib/crypto.ts` module, (2) update `apiKeys/actions.ts` to import from the shared module, (3) modify all Zotero write and read paths to encrypt/decrypt via the shared module, and (4) write an idempotent migration action to encrypt existing plaintext keys.

The core constraint is Convex's runtime separation: `crypto` module requires `"use node"` actions, but mutations and queries cannot use Node.js APIs. The existing Zotero actions file (`convex/zotero/actions.ts`) already has `"use node"`, so encryption in the OAuth completion flow and decryption in all API-calling actions is straightforward. The internal query `getConnection` returns the raw field value (encrypted string), and the calling action decrypts it. The `workpoolActions.ts` (also `"use node"`) that reads the Zotero connection for PDF downloads must also decrypt.

After migration, the `apiKey` field becomes dead code. The field remains in the schema as `v.optional(v.string())` (to be removed in a future schema cleanup), but no code path should read or write it. The `encryptedApiKey` field becomes the single source of truth.

**Primary recommendation:** Extract shared crypto module, update all Zotero write/read paths to use encryption, then run an idempotent migration action. Follow the dual-read pattern during transition (read `encryptedApiKey` if present, fall back to `apiKey`) until migration is confirmed complete.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Zotero API key encrypted with AES-256-GCM (matching apiKeys pattern) | Existing `convex/apiKeys/actions.ts` provides proven `encrypt`/`decrypt` functions using AES-256-GCM with random 12-byte IV and auth tag. Same `ENCRYPTION_KEY` env var (64 hex chars = 32 bytes). Schema already has `encryptedApiKey` field from Phase 37. All Zotero action files already use `"use node"` runtime. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `crypto` | built-in | AES-256-GCM encrypt/decrypt | Already used in `apiKeys/actions.ts`; required for symmetric encryption; available in all `"use node"` Convex actions |
| convex | 1.32.0 | Backend runtime, action/mutation/query definitions | Already installed; provides the `internalAction`/`internalMutation` primitives needed for migration |
| convex/values | (bundled) | `v.string()`, `v.optional()` validators | Built-in Convex validators; schema already updated in Phase 37 |

### Supporting
No new dependencies required. All libraries are already installed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared `convex/lib/crypto.ts` | Duplicate encrypt/decrypt in each file | Duplication creates divergence risk; shared module is cleaner and matches success criteria #2 |
| In-place field update (`apiKey` stores encrypted value) | New field `encryptedApiKey` | New field allows dual-read during migration and rollback safety. Phase 37 already added the field. |
| Key version tracking (`keyVersion` field) | Single key, no versioning | Deferred to future work per Pitfall 11 in milestone research. Adding `keyVersion` is recommended for key rotation but out of scope for SEC-01. |

**Installation:**
```bash
# No new packages needed. Zero npm install.
```

## Architecture Patterns

### Recommended File Structure
```
convex/
├── lib/
│   └── crypto.ts          # NEW: shared encrypt/decrypt (extracted from apiKeys/actions.ts)
├── apiKeys/
│   └── actions.ts         # MODIFIED: import from lib/crypto instead of local functions
├── zotero/
│   ├── actions.ts         # MODIFIED: encrypt on save, decrypt on read
│   ├── mutations.ts       # MODIFIED: saveConnection accepts encryptedApiKey + keyPrefix
│   ├── internal.ts        # MODIFIED: return encryptedApiKey instead of apiKey
│   └── queries.ts         # NO CHANGE (does not return apiKey)
└── extraction/
    └── workpoolActions.ts # MODIFIED: decrypt zoteroConnection.encryptedApiKey
```

### Pattern 1: Shared Crypto Module
**What:** Extract the `encrypt` and `decrypt` functions from `convex/apiKeys/actions.ts` into `convex/lib/crypto.ts` so both `apiKeys` and `zotero` modules can reuse them.
**When to use:** Whenever multiple modules need AES-256-GCM encryption with the same key.
**Example:**
```typescript
// convex/lib/crypto.ts
// NOTE: This file MUST NOT have "use node" directive.
// It exports pure functions that use Node.js crypto APIs.
// The calling file (an action with "use node") provides the runtime.
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createError } from "./errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw createError("API_KEY_ENCRYPTION_KEY_INVALID", "Encryption key must be 32 bytes (64 hex characters)");
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(encrypted: string, keyHex: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw createError("API_KEY_ENCRYPTED_FORMAT_INVALID", "Invalid encrypted format");
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw createError("API_KEY_ENCRYPTION_KEY_INVALID", "Encryption key must be 32 bytes (64 hex characters)");
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function getKeyPrefix(apiKey: string): string {
  const prefix = apiKey.substring(0, 7);
  return `${prefix}...`;
}
```

### Pattern 2: Encrypt on Write (OAuth Completion)
**What:** In `completeOAuth`, encrypt the access token before passing it to the `saveConnection` mutation.
**When to use:** When a new Zotero connection is created via OAuth.
**Example:**
```typescript
// In convex/zotero/actions.ts completeOAuth handler:
import { encrypt, getKeyPrefix } from "../lib/crypto";

const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
}

const encryptedApiKey = encrypt(accessToken, encryptionKey);
const keyPrefix = getKeyPrefix(accessToken);

await ctx.runMutation(internal.zotero.mutations.saveConnection, {
  userId,
  zoteroUserId,
  encryptedApiKey,
  keyPrefix,
  username: username || undefined,
});
```

### Pattern 3: Decrypt on Read (Action-Side)
**What:** Each action that needs the plaintext Zotero API key calls the `getConnection` internal query (which returns the encrypted key), then decrypts locally.
**When to use:** In every Zotero action that makes API calls (`fetchCollections`, `fetchGroups`, `fetchItems`, `getAttachments`, `downloadFile`).
**Example:**
```typescript
// Helper function in convex/zotero/actions.ts
import { decrypt } from "../lib/crypto";

function decryptZoteroApiKey(encryptedKey: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
  }
  return decrypt(encryptedKey, encryptionKey);
}

// In each action handler:
const connection = await ctx.runQuery(internal.zotero.internal.getConnection, { userId });
if (!connection) throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
const apiKey = decryptZoteroApiKey(connection.apiKey); // connection.apiKey is now the encrypted value
```

### Pattern 4: Dual-Read During Migration Transition
**What:** During the transition period (before migration completes), code reads `encryptedApiKey` if present, otherwise falls back to plaintext `apiKey`.
**When to use:** Temporarily, between deploying the new code and running the migration action.
**Example:**
```typescript
// In convex/zotero/internal.ts getConnection:
// Return encryptedApiKey if populated, else fall back to apiKey
return {
  zoteroUserId: connection.zoteroUserId,
  apiKey: connection.encryptedApiKey ?? connection.apiKey,
  username: connection.username,
};
```
This approach means the calling action's `decryptZoteroApiKey` must handle both encrypted (contains `:`) and plaintext formats. However, a cleaner approach is to check at the query level and only decrypt if the value looks encrypted.

**Recommended cleaner approach:** Return both fields from the internal query. Let the action decide:
```typescript
// internal.ts
return {
  zoteroUserId: connection.zoteroUserId,
  encryptedApiKey: connection.encryptedApiKey ?? null,
  apiKey: connection.apiKey,
  username: connection.username,
};

// In action:
const plainApiKey = connection.encryptedApiKey
  ? decryptZoteroApiKey(connection.encryptedApiKey)
  : connection.apiKey;
```

### Pattern 5: Idempotent Migration Action
**What:** An `internalAction` that reads all `zoteroConnections`, encrypts those with a null `encryptedApiKey`, and patches them.
**When to use:** Once, after deploying the updated code, to migrate existing plaintext keys.
**Example:**
```typescript
// convex/zotero/actions.ts (or a dedicated migration file)
export const migrateToEncryptedKeys = internalAction({
  args: {},
  returns: v.object({
    total: v.number(),
    migrated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw createError("API_KEY_ENCRYPTION_KEY_MISSING", "Encryption key not configured");
    }

    // Get all connections via internal query
    const connections = await ctx.runQuery(internal.zotero.internal.listAllConnections);
    let migrated = 0;
    let skipped = 0;

    for (const conn of connections) {
      if (conn.encryptedApiKey) {
        skipped++;
        continue; // Already migrated
      }
      const encrypted = encrypt(conn.apiKey, encryptionKey);
      const prefix = getKeyPrefix(conn.apiKey);
      await ctx.runMutation(internal.zotero.mutations.patchEncryptedKey, {
        connectionId: conn._id,
        encryptedApiKey: encrypted,
        keyPrefix: prefix,
      });
      migrated++;
    }

    return { total: connections.length, migrated, skipped };
  },
});
```

### Anti-Patterns to Avoid
- **Encrypting in a mutation:** Mutations run in Convex's deterministic runtime without Node.js `crypto` access. Encryption MUST happen in actions.
- **Decrypting in a query:** Same constraint -- queries cannot use `crypto`. Decryption MUST happen in actions.
- **Removing `apiKey` field from schema immediately:** The field must remain as `v.optional(v.string())` after migration until all code paths are verified clean. Removing a field from the schema while documents still have that field would fail Convex schema validation.
- **Making `apiKey` optional before migration runs:** The field is currently `v.string()` (required). Changing it to `v.optional()` is needed AFTER the migration populates `encryptedApiKey` on all rows and the new save path stops writing `apiKey`. This schema evolution must happen in a specific order.
- **Double-encrypting during migration re-runs:** The migration must check if `encryptedApiKey` is already populated and skip those rows (idempotent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-256-GCM encryption | Custom encryption scheme | Node.js `crypto.createCipheriv` with existing format | The `iv:authTag:ciphertext` format is already established in `apiKeys/actions.ts`. Must be compatible. |
| Key prefix extraction | Custom truncation | `getKeyPrefix` from shared module | Consistent 7-char prefix format across all key types |

**Key insight:** The encryption format (`iv:authTag:ciphertext` as hex strings separated by colons) is already established. Any new encryption MUST use the exact same format so `decrypt` works uniformly.

## Common Pitfalls

### Pitfall 1: Missing ENCRYPTION_KEY Corrupts Migration
**What goes wrong:** Running the migration action without `ENCRYPTION_KEY` set in the Convex environment leaves keys in an inconsistent state (some migrated, some not).
**Why it happens:** The env var might be set in production but not in staging/development.
**How to avoid:** Validate `ENCRYPTION_KEY` at the very start of the migration action, before processing any rows. Throw immediately if missing.
**Warning signs:** Migration action throws `API_KEY_ENCRYPTION_KEY_MISSING` error.

### Pitfall 2: Breaking Existing Connections During Deployment
**What goes wrong:** If the new code (which expects encrypted keys) deploys before the migration runs, all existing connections with plaintext keys break because `decrypt` fails on plaintext strings.
**Why it happens:** Convex deploys code atomically. The window between deploy and migration is a gap.
**How to avoid:** Use the dual-read pattern (Pattern 4 above). The internal query returns `encryptedApiKey` if present, falling back to `apiKey`. The action checks which field is populated and only decrypts the encrypted one. This ensures both pre-migration (plaintext) and post-migration (encrypted) rows work.
**Warning signs:** After deploy but before migration, Zotero actions throw "Invalid encrypted format" errors.

### Pitfall 3: workpoolActions.ts Reads Stale Connection Format
**What goes wrong:** `convex/extraction/workpoolActions.ts` line 754 reads `zoteroConnection.apiKey` and passes it directly to `downloadPdf`. After the migration, this field is encrypted, breaking Zotero PDF downloads.
**Why it happens:** Easy to miss because it is in a different module (`extraction/`) than the Zotero module.
**How to avoid:** Update the `resolvePdfBlob` function in `workpoolActions.ts` to decrypt the key. Since `workpoolActions.ts` already has `"use node"`, it can import from `convex/lib/crypto.ts`.
**Warning signs:** Zotero-sourced PDF downloads fail with authentication errors after migration.

### Pitfall 4: Schema Evolution Ordering
**What goes wrong:** Trying to make `apiKey` optional (or remove it) before all code paths stop writing it, or before the migration populates `encryptedApiKey` on all rows.
**Why it happens:** The schema change and code change must happen in a specific order.
**How to avoid:** Follow this sequence:
1. Deploy code that writes `encryptedApiKey` (new connections) and reads both fields (dual-read)
2. Run migration action to encrypt all existing plaintext keys
3. Remove all reads of the `apiKey` field from code
4. Change `apiKey` from `v.string()` to `v.optional(v.string())` in schema
5. (Future) Remove `apiKey` field entirely and clean up data
**Warning signs:** Convex deploy fails with schema validation error.

### Pitfall 5: ZoteroConnection Type Becomes Stale
**What goes wrong:** The local `ZoteroConnection` type alias in `convex/zotero/actions.ts` (line 22-26) hardcodes `apiKey: string`. After updating the internal query to return `encryptedApiKey`, TypeScript does not catch the mismatch because the type is manually defined.
**Why it happens:** The type is not derived from the schema or the query return type.
**How to avoid:** Update the `ZoteroConnection` type to match the new query return shape. Consider deriving it from the query return type or updating it to include `encryptedApiKey`.
**Warning signs:** Runtime `undefined` errors when accessing `connection.apiKey` after the query starts returning `encryptedApiKey`.

### Pitfall 6: lib/pdf/download.ts Interface Change
**What goes wrong:** The `DownloadPdfOptions.zoteroConnection` type (line 20-23 of `lib/pdf/download.ts`) expects `{ apiKey: string; userId: string }`. The `apiKey` here must be the **plaintext** key, not encrypted. If someone passes the encrypted value, Zotero API calls fail silently with 403 errors.
**Why it happens:** The interface name `apiKey` is ambiguous -- it could mean plaintext or encrypted.
**How to avoid:** The caller (`workpoolActions.ts`) must decrypt before passing to `downloadPdf`. The `DownloadPdfOptions` interface does NOT need to change -- it should always receive the plaintext key. Add a comment clarifying this.
**Warning signs:** Zotero PDF downloads return 403 Forbidden after encryption migration.

## Code Examples

### Complete Shared Crypto Module
```typescript
// convex/lib/crypto.ts
// Source: extracted from convex/apiKeys/actions.ts lines 1-68
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createError } from "./errors";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_INVALID",
      "Encryption key must be 32 bytes (64 hex characters)",
    );
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

export function decrypt(encrypted: string, keyHex: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw createError("API_KEY_ENCRYPTED_FORMAT_INVALID", "Invalid encrypted format");
  }
  const [ivHex, authTagHex, ciphertext] = parts;
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw createError(
      "API_KEY_ENCRYPTION_KEY_INVALID",
      "Encryption key must be 32 bytes (64 hex characters)",
    );
  }
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function getKeyPrefix(apiKey: string): string {
  const prefix = apiKey.substring(0, 7);
  return `${prefix}...`;
}
```

### Updated apiKeys/actions.ts Import
```typescript
// convex/apiKeys/actions.ts -- replace local encrypt/decrypt with imports
import { encrypt, decrypt, getKeyPrefix } from "../lib/crypto";
// Remove: local encrypt, decrypt, getKeyPrefix function definitions
// Remove: import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
// Keep: ALGORITHM and IV_LENGTH are now internal to lib/crypto.ts
```

### Updated saveConnection Mutation
```typescript
// convex/zotero/mutations.ts saveConnection -- accept encrypted fields
export const saveConnection = internalMutation({
  args: {
    userId: v.id("users"),
    zoteroUserId: v.string(),
    encryptedApiKey: v.string(),
    keyPrefix: v.string(),
    username: v.optional(v.string()),
  },
  returns: v.id("zoteroConnections"),
  handler: async (ctx, { userId, zoteroUserId, encryptedApiKey, keyPrefix, username }) => {
    const existing = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return await ctx.db.insert("zoteroConnections", {
      userId,
      zoteroUserId,
      apiKey: "ENCRYPTED_SEE_encryptedApiKey", // Placeholder for required field during transition
      encryptedApiKey,
      keyPrefix,
      username,
      connectedAt: Date.now(),
    });
  },
});
```

**Note on the `apiKey` field:** Since `apiKey` is `v.string()` (required) in the current schema, new inserts must provide a value. During the transition, use a sentinel value like `"ENCRYPTED_SEE_encryptedApiKey"` so the field is never accidentally used as a real API key. Alternatively, the schema can be changed to make `apiKey` optional in the same deployment. Since Phase 37 already deployed the schema with `apiKey` as required, making it optional requires a schema update in this phase. This is safe because existing rows all have the field populated.

### Updated getConnection Internal Query
```typescript
// convex/zotero/internal.ts -- return encryptedApiKey for action-side decryption
export const getConnection = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      zoteroUserId: v.string(),
      encryptedApiKey: v.optional(v.string()),
      apiKey: v.string(),
      username: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, { userId }) => {
    const connection = await ctx.db
      .query("zoteroConnections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!connection) return null;
    return {
      zoteroUserId: connection.zoteroUserId,
      encryptedApiKey: connection.encryptedApiKey,
      apiKey: connection.apiKey,
      username: connection.username,
    };
  },
});
```

### Migration Helper Mutations
```typescript
// convex/zotero/internal.ts -- add listAllConnections query
export const listAllConnections = internalQuery({
  args: {},
  returns: v.array(v.object({
    _id: v.id("zoteroConnections"),
    apiKey: v.string(),
    encryptedApiKey: v.optional(v.string()),
  })),
  handler: async (ctx) => {
    const all = await ctx.db.query("zoteroConnections").collect();
    return all.map((c) => ({
      _id: c._id,
      apiKey: c.apiKey,
      encryptedApiKey: c.encryptedApiKey,
    }));
  },
});

// convex/zotero/mutations.ts -- add patchEncryptedKey mutation
export const patchEncryptedKey = internalMutation({
  args: {
    connectionId: v.id("zoteroConnections"),
    encryptedApiKey: v.string(),
    keyPrefix: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, encryptedApiKey, keyPrefix }) => {
    await ctx.db.patch(connectionId, { encryptedApiKey, keyPrefix });
    return null;
  },
});
```

## Files to Modify (Complete Inventory)

| File | Change | Runtime | Notes |
|------|--------|---------|-------|
| `convex/lib/crypto.ts` | CREATE | N/A (imported by `"use node"` files) | Shared encrypt/decrypt/getKeyPrefix |
| `convex/apiKeys/actions.ts` | MODIFY | `"use node"` | Import from `lib/crypto`, remove local functions |
| `convex/zotero/actions.ts` | MODIFY | `"use node"` | Encrypt in `completeOAuth`, decrypt in all 5 read actions, add `migrateToEncryptedKeys` action, update `ZoteroConnection` type |
| `convex/zotero/mutations.ts` | MODIFY | mutation | `saveConnection` accepts `encryptedApiKey`+`keyPrefix` instead of `apiKey`, add `patchEncryptedKey` |
| `convex/zotero/internal.ts` | MODIFY | query | `getConnection` returns `encryptedApiKey`, add `listAllConnections` |
| `convex/extraction/workpoolActions.ts` | MODIFY | `"use node"` | Decrypt `zoteroConnection.apiKey` (now encrypted) before passing to `downloadPdf` |
| `convex/schema.ts` | MODIFY | schema | Make `apiKey` optional (`v.optional(v.string())`) -- only AFTER migration code is deployed |

**Files that do NOT need changes:**
- `convex/zotero/queries.ts` -- `getConnectionStatus` does not return `apiKey`; `getZoteroUserIdInternal` does not return `apiKey`
- `convex/http.ts` -- calls `completeOAuth` which handles encryption internally
- `lib/zotero-utils.ts` -- builds headers from plaintext key (callers are responsible for decrypting first)
- `lib/pdf/download.ts` -- receives plaintext key from caller (no change needed)
- `convex/extraction/workflow.ts` -- only reads `zoteroUserId`, not `apiKey`

## Zotero Action Read Points (All Must Decrypt)

Every action that calls `internal.zotero.internal.getConnection` and uses the API key:

| Action | File | Line | Uses `connection.apiKey` for |
|--------|------|------|------------------------------|
| `fetchCollections` | `convex/zotero/actions.ts` | 618, 632 | `fetchCollectionTreeFlat` -> Zotero API headers |
| `fetchGroups` | `convex/zotero/actions.ts` | 669, 680 | Zotero API headers |
| `fetchItems` | `convex/zotero/actions.ts` | 742, 762-888 | Multiple Zotero API calls |
| `getAttachments` | `convex/zotero/actions.ts` | 954, 971 | Zotero API headers |
| `downloadFile` | `convex/zotero/actions.ts` | 1019, 1029 | Zotero API headers |
| `resolvePdfBlob` | `convex/extraction/workpoolActions.ts` | 745, 754 | Passed to `downloadPdf` -> Zotero API headers |

## Deployment Sequence

The changes must be deployed in this order:

1. **Deploy code changes (atomic):** shared crypto module, updated apiKeys imports, Zotero encrypt-on-write and dual-read (reads encryptedApiKey if present, falls back to apiKey), updated workpoolActions decryption
2. **Verify:** New OAuth connections create encrypted keys. Existing connections with plaintext keys still work via fallback.
3. **Run migration:** Execute `migrateToEncryptedKeys` internal action from Convex dashboard. Verify all rows have `encryptedApiKey` populated.
4. **Deploy schema change:** Make `apiKey` field optional (`v.optional(v.string())`) and update `saveConnection` to stop writing it.
5. **Remove fallback code:** Remove dual-read logic, make `encryptedApiKey` the only read path.

Steps 4 and 5 can be combined into a single deployment after migration is confirmed complete.

## Open Questions

1. **Should `apiKey` be made optional in this phase or deferred?**
   - What we know: The field is currently `v.string()` (required). New connections must provide a value. After migration, the field is dead data.
   - What's unclear: Whether to tackle the schema change in this phase or leave it for a future cleanup phase.
   - Recommendation: Make `apiKey` optional in this phase. The sentinel value approach is messy. Better to update the schema to `v.optional(v.string())` as part of deployment step 4. Since all existing rows have the field populated, making it optional is a non-breaking schema change.

2. **Should `validateApiKeyFormat` be adapted for Zotero keys?**
   - What we know: The existing `apiKeys/actions.ts` has `validateApiKeyFormat` for provider keys (OpenAI, Anthropic, etc.). Zotero keys come from OAuth, not user input.
   - What's unclear: Whether Zotero keys have a predictable format to validate.
   - Recommendation: No format validation for Zotero keys. They come from Zotero's OAuth flow, not user input. Skip this.

3. **Key version tracking for future rotation?**
   - What we know: Pitfall 11 in milestone research recommends `keyVersion` field. Not adding it now makes future key rotation harder.
   - What's unclear: Whether this is in scope for SEC-01.
   - Recommendation: Out of scope for this phase. Flag as tech debt. The encrypted format itself (`iv:authTag:ciphertext`) is self-describing enough that a future migration can detect and re-encrypt.

## Sources

### Primary (HIGH confidence)
- `convex/apiKeys/actions.ts` lines 1-68 -- Existing AES-256-GCM encrypt/decrypt implementation (verified in codebase)
- `convex/zotero/actions.ts` -- All 5 action handlers that use `connection.apiKey` (verified line-by-line)
- `convex/zotero/mutations.ts` -- `saveConnection` mutation that writes plaintext `apiKey` (line 97-103)
- `convex/zotero/internal.ts` -- `getConnection` query that reads plaintext `apiKey` (line 32)
- `convex/extraction/workpoolActions.ts` line 754 -- `zoteroConnection.apiKey` used in PDF download
- `convex/schema.ts` lines 172-182 -- `zoteroConnections` table with both `apiKey` and `encryptedApiKey` fields
- `lib/pdf/download.ts` lines 20-23 -- `DownloadPdfOptions.zoteroConnection` interface

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE_v2.3_HARDENING.md` lines 280-367 -- Pre-researched architecture for Zotero encryption
- `.planning/research/PITFALLS.md` pitfalls 4 and 11 -- Migration and key rotation concerns
- `.planning/research/FEATURES_v2.3_HARDENING.md` section 6 -- Feature analysis for Zotero encryption

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries already installed and proven in apiKeys module
- Architecture: HIGH -- Existing encrypt/decrypt pattern verified in codebase; Convex action/mutation separation well understood; all target files identified and read
- Pitfalls: HIGH -- Migration ordering, dual-read pattern, workpoolActions dependency all identified from direct code inspection

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable -- Node.js crypto API and Convex runtime model are stable)
