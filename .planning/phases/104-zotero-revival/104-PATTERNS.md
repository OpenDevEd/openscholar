# Phase 104: Zotero Revival - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 11 (3 new, 8 modified)
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `components/settings/zotero-connection-card.tsx` | component | request-response | `app/settings/connections/page.tsx` | exact |
| `app/extraction/new/zotero-tab.tsx` | component | request-response + CRUD | `app/extraction/new/library-tab.tsx` | role-match |
| `app/extraction/new/zotero-item-row.tsx` | component | event-driven | `components/extraction/add-to-extraction-button.tsx` | role-match |
| `app/extraction/new/selector-page-client.tsx` | component (modify) | request-response | self (lines 73, 90-96) | exact |
| `app/settings/connections/page.tsx` | component (modify) | request-response | self (add import + render) | exact |
| `convex/zotero/actions.ts` | service (modify) | batch | `convex/lib/envValidation.ts` (internalAction pattern) | role-match |
| `convex/lib/envValidation.ts` | config (modify) | batch | self (array append) | exact |
| `tests/env-validation.test.ts` | test (modify) | batch | self (mirror array + new cases) | exact |
| `convex/zotero/purge.test.ts` | test (new) | batch | `convex/wallet/wallet.test.ts` | exact |
| `messages/en-US.json` (+ 5 locales) | config (modify) | N/A | self (seed new namespaces) | exact |

## Pattern Assignments

### `components/settings/zotero-connection-card.tsx` (component, request-response)

**Analog:** `app/settings/connections/page.tsx`

**Imports pattern** (lines 1-14):
```typescript
"use client";

import { useState, useCallback } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { useAuthReadiness } from "@/components/providers/convex-provider";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
```

**Auth-gated query pattern** (connections/page.tsx lines 17-21):
```typescript
const { phase, canRunProtectedQueries } = useAuthReadiness();
const keys = useQuery(
  api.wallet.queries.listMyKeys,
  canRunProtectedQueries ? {} : "skip",
);
```
ZoteroConnectionCard uses the simpler `useProtectedQuery` variant instead:
```typescript
// From lib/auth/use-auth-query.ts lines 49-78
const { data: status } = useProtectedQuery(
  api.zotero.queries.getConnectionStatus,
  {},
);
```

**Two-step destructive confirmation pattern** (connections/page.tsx lines 158-183):
```typescript
{confirmRevoke === key._id ? (
  <div className="flex items-center gap-2">
    <button
      onClick={() => setConfirmRevoke(null)}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
    >
      {tc("cancel")}
    </button>
    <button
      onClick={() => handleRevoke(key._id)}
      disabled={revoking === key._id}
      className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
    >
      <Trash2 className="w-3 h-3" />
      {revoking === key._id ? t("revoking") : t("confirm")}
    </button>
  </div>
) : (
  <button
    onClick={() => setConfirmRevoke(key._id)}
    className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
  >
    <Trash2 className="w-3 h-3" />
    {t("revoke")}
  </button>
)}
```

**Async action handler with toast pattern** (connections/page.tsx lines 49-67):
```typescript
const handleRevoke = useCallback(
  async (walletKeyId: Id<"walletKeys">) => {
    const key = keys?.find((k) => k._id === walletKeyId);
    posthog.capture("api_key_revoked", {
      app_name: key?.appName,
    });
    setRevoking(walletKeyId);
    try {
      await revokeKey({ walletKeyId });
    } catch (error) {
      console.error("[Connections] Failed to revoke key:", error);
      toast.error(t("revokeKeyError"));
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  },
  [revokeKey, keys],
);
```

**Connected status display pattern** -- derived from `getConnectionStatus` return shape (convex/zotero/queries.ts lines 12-46):
```typescript
// Discriminated union return:
// { connected: true, zoteroUserId: string, username?: string, connectedAt: number }
// | { connected: false }
```

**Card layout pattern** (connections/page.tsx lines 138-204):
```typescript
<motion.div
  key={key._id}
  layout
  initial={{ opacity: 0, y: 8 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95 }}
  transition={{ delay: i * 0.05 }}
  className="rounded-xl border border-border/50 bg-background p-4 space-y-3"
>
  <div className="flex items-start justify-between gap-3">
    <div className="flex-1 min-w-0">
      {/* Title + metadata */}
    </div>
    {/* Action buttons */}
  </div>
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
    {/* Timestamps and meta badges */}
  </div>
</motion.div>
```

**Loading/empty states pattern** (connections/page.tsx lines 100-125):
```typescript
{/* Loading */}
{!keys && (
  <div className="py-12 text-center text-sm text-muted-foreground">
    <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent mx-auto mb-2" />
    {t("loadingConnections")}
  </div>
)}

{/* Empty state */}
{keys && keys.length === 0 && (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className="py-16 text-center space-y-3"
  >
    <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
      <Plug className="w-6 h-6 text-muted-foreground" />
    </div>
    {/* ... */}
  </motion.div>
)}
```

---

### `app/extraction/new/zotero-tab.tsx` (component, request-response + CRUD)

**Analog:** `app/extraction/new/library-tab.tsx` (structure, basket wiring) + `app/extraction/new/manual-ids-tab.tsx` (useAction data loading)

**Imports pattern** (library-tab.tsx lines 1-14):
```typescript
"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
```

ZoteroTab additionally needs `useAction` (not `useQuery` for data loading -- Zotero actions are API proxies):
```typescript
import { useAction } from "convex/react";
```

**Connection status gate pattern** (library-tab.tsx lines 18-24, adapted for Zotero):
```typescript
const { data: status } = useProtectedQuery(
  api.zotero.queries.getConnectionStatus,
  {},
);

// If disconnected, show empty state with link to /settings/connections
if (status && !status.connected) {
  return <NotConnectedState />;
}
```

**Action-based data loading with local state** (manual-ids-tab.tsx lines 22-26, adapted):
```typescript
const fetchCollections = useAction(api.zotero.actions.fetchCollections);
const fetchItems = useAction(api.zotero.actions.fetchItems);
const resolveByDoi = useAction(api.openalex.actions.resolveByDoi);
```

**Pagination via action + local state** (no direct codebase analog -- ZoteroTab is unique in using action-based pagination with `start`/`limit`/`nextCursor`/`hasMore`):
```typescript
// fetchItems return shape from convex/zotero/actions.ts lines 766-782:
// { items: ZoteroItem[], nextCursor?: number, hasMore: boolean }

const [items, setItems] = useState<ZoteroItemForUI[]>([]);
const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
const [isLoading, setIsLoading] = useState(false);

const loadPage = useCallback(async (start: number) => {
  setIsLoading(true);
  try {
    const result = await fetchItems({
      collectionKey: selectedCollection ?? undefined,
      start,
      limit: 25,
    });
    setItems(prev => start === 0 ? result.items : [...prev, ...result.items]);
    setNextCursor(result.nextCursor);
  } catch (error) {
    toast.error(t("loadItemsError"));
  } finally {
    setIsLoading(false);
  }
}, [fetchItems, selectedCollection]);
```

**Basket hook wiring pattern** (library-tab.tsx lines 25-26):
```typescript
const { addToBasket } = useAddToBasket();
```

**Loading spinner pattern** (library-tab.tsx lines 92-98):
```typescript
if (isLoading) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
```

**Empty state pattern** (library-tab.tsx lines 100-111):
```typescript
if (!items || items.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2">
      <p className="text-sm font-semibold">
        {t("libraryEmpty.heading")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("libraryEmpty.body")}
      </p>
    </div>
  );
}
```

**Item list layout pattern** (library-tab.tsx lines 133-175):
```typescript
<div className="divide-y">
  {items.map((item) => {
    return (
      <div
        key={item._id}
        className={`flex items-center gap-3 py-3 ${inBasket ? "opacity-60" : ""}`}
      >
        <Checkbox ... />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{item.title}</p>
          {item.doi && (
            <p className="text-xs text-muted-foreground truncate">
              {item.doi}
            </p>
          )}
        </div>
        {/* Action button area */}
      </div>
    );
  })}
</div>
```

**Toast feedback pattern** (library-tab.tsx lines 80-90):
```typescript
if (result.dropped > 0) {
  toast.info(
    t("addedWithDropped", {
      added: result.added,
      dropped: result.dropped,
    }),
  );
} else if (result.added > 0) {
  toast.success(t("addedSuccess", { added: result.added }));
}
```

---

### `app/extraction/new/zotero-item-row.tsx` (component, event-driven)

**Analog:** `components/extraction/add-to-extraction-button.tsx` (per-item toggle with basket state)

**Imports pattern** (add-to-extraction-button.tsx lines 1-17):
```typescript
"use client";

import { useCallback, useMemo } from "react";
import { Plus, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";
import { useExtractionBasketStore } from "@/lib/store/extraction-basket";
import { normalizeOpenAlexId } from "@/lib/openalex/normalize";
import type { BasketSource } from "@/lib/store/extraction-basket";
```

**Basket state check pattern** (add-to-extraction-button.tsx lines 47-54):
```typescript
const normalizedId = useMemo(
  () => normalizeOpenAlexId(paper.rawId),
  [paper.rawId],
);

const inBasket = useExtractionBasketStore((s) =>
  normalizedId ? s.papers.has(normalizedId) : false,
);
```

**Tooltip-wrapped disabled state pattern** (add-to-extraction-button.tsx lines 86-106):
```typescript
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn(inBasket && "text-primary")}
      disabled={isAtCap && !inBasket}
      onClick={handleToggle}
      aria-label={inBasket ? t("inBasket") : t("add")}
    >
      {inBasket ? (
        <Check className="h-4 w-4" />
      ) : (
        <Plus className="h-4 w-4" />
      )}
    </Button>
  </TooltipTrigger>
  <TooltipContent>{tooltipText}</TooltipContent>
</Tooltip>
```

**ZoteroItemRow-specific: per-item async resolution state machine** -- no direct analog exists. This is the novel pattern for Phase 104:
```typescript
// Resolution states: "idle" | "resolving" | "resolved" | "failed"
// Props receive: item data, resolution state, onResolve callback, onRetry callback
// Visual states:
//   - No DOI: disabled checkbox + opacity-50 + tooltip "No DOI available"
//   - DOI idle: enabled checkbox
//   - DOI resolving: inline Loader2 spinner replacing checkbox
//   - DOI resolved: green Check icon, item in basket
//   - DOI failed: red X icon + retry button + tooltip "Could not find in OpenAlex"
```

**addToBasket call shape** (add-to-extraction-button.tsx lines 58-78, adapted for Zotero source):
```typescript
const result = addToBasket({
  rawId: paper.rawId,       // OpenAlex ID from resolveByDoi
  title: paper.title,
  doi: paper.doi,
  source: "zotero",         // BasketSource already includes "zotero" (extraction-basket.ts line 13)
});
```

---

### `app/extraction/new/selector-page-client.tsx` (modify -- enable Zotero tab)

**Analog:** self

**Current disabled state** (line 73):
```typescript
<TabsTrigger value="zotero" disabled className="opacity-50">
  {t("tabs.zotero")}
</TabsTrigger>
```
Remove `disabled` and `className="opacity-50"`.

**Current placeholder content** (lines 90-96):
```typescript
<TabsContent value="zotero">
  <div className="flex min-h-[30vh] items-center justify-center">
    <p className="text-center text-sm text-muted-foreground max-w-sm">
      {t("zoteroComingSoon")}
    </p>
  </div>
</TabsContent>
```
Replace with:
```typescript
<TabsContent value="zotero">
  <ZoteroTab />
</TabsContent>
```

**Import pattern** follows existing sibling imports (lines 22-25):
```typescript
import { LibraryTab } from "./library-tab";
import { CollectionsTab } from "./collections-tab";
import { SearchResultsTab } from "./search-results-tab";
import { ManualIdsTab } from "./manual-ids-tab";
// Add:
import { ZoteroTab } from "./zotero-tab";
```

---

### `app/settings/connections/page.tsx` (modify -- add ZoteroConnectionCard + OAuth param handling)

**Analog:** self

**Import insertion point** (after line 14):
```typescript
import { ZoteroConnectionCard } from "@/components/settings/zotero-connection-card";
```

**ZoteroConnectionCard placement** -- before the wallet keys section. Insert inside the `<div className="p-6 space-y-6 max-w-2xl">` (line 99), before the loading state (line 101):
```typescript
{/* Zotero connection section -- D-01 */}
<ZoteroConnectionCard />
```

**OAuth query param handling pattern** -- add `useEffect` + `useSearchParams` to read `?zotero_connected=true` or `?zotero_error=...`:
```typescript
// No direct codebase analog for query param toast pattern.
// Follow React convention: useEffect on mount, read params, show toast, clean URL.
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("zotero_connected");
  const error = params.get("zotero_error");

  if (connected === "true") {
    toast.success(t("zotero.connectSuccess"));
  } else if (error) {
    toast.error(t("zotero.connectError", { error }));
  }

  if (connected || error) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}, [t]);
```

---

### `convex/zotero/actions.ts` (modify -- append purgeStaleZoteroState)

**Analog:** `convex/lib/envValidation.ts` (internalAction with audit logging pattern)

**internalAction registration pattern** (envValidation.ts lines 23-42):
```typescript
export const checkRequiredEnvVars = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // ... logic ...
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "ENV_VALIDATION_FAILURE",
      metadata: { missing: missing.join(",") },
    });
    return null;
  },
});
```

**Audit logging pattern** (convex/lib/audit.ts lines 4-20):
```typescript
export const writeAuditLog = internalMutation({
  args: {
    action: v.string(),
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

**Batch delete pattern** (convex/zotero/mutations.ts lines 153-181, cleanupExpiredOAuthTokens):
```typescript
const expiredTokens = await ctx.db
  .query("zoteroOAuthTokens")
  .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
  .take(100);

let deletedCount = 0;
for (const token of expiredTokens) {
  try {
    await ctx.db.delete("zoteroOAuthTokens", token._id);
    deletedCount++;
  } catch {
    // Token may have been deleted by concurrent process.
  }
}
```

**purgeStaleZoteroState structure** -- appended after line 1125 of `convex/zotero/actions.ts`. Uses `internalAction` (already imported at line 6). Must use `ctx.runQuery` + `ctx.runMutation` because actions cannot access `ctx.db` directly (per Convex guidelines):
```typescript
// Requires new internalMutation helpers for:
// 1. Counting + deleting zoteroConnections rows
// 2. Counting + deleting zoteroOAuthTokens rows
// OR a single internalMutation that does both in one transaction

export const purgeStaleZoteroState = internalAction({
  args: {},
  returns: v.object({
    connectionsDeleted: v.number(),
    tokensDeleted: v.number(),
  }),
  handler: async (ctx) => {
    // Pre-purge audit
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "ZOTERO_PURGE_START",
      metadata: {},
    });

    // Delete via internal mutations (actions have no ctx.db)
    const result = await ctx.runMutation(
      internal.zotero.mutations.purgeAllZoteroData,
    );

    // Post-purge audit
    await ctx.runMutation(internal.lib.audit.writeAuditLog, {
      action: "ZOTERO_PURGE_COMPLETE",
      metadata: {
        connectionsDeleted: String(result.connectionsDeleted),
        tokensDeleted: String(result.tokensDeleted),
      },
    });

    return result;
  },
});
```

**Note:** This also requires adding `purgeAllZoteroData` as an `internalMutation` in `convex/zotero/mutations.ts` following the existing mutation patterns in that file.

---

### `convex/lib/envValidation.ts` (modify -- append env vars)

**Analog:** self

**Current array** (lines 7-14):
```typescript
export const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "CLERK_JWT_ISSUER_DOMAIN",
] as const;
```

**Append** `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET` to the array. Do NOT add `ENCRYPTION_KEY` (already at index 1).

---

### `tests/env-validation.test.ts` (modify -- update mirror + new cases)

**Analog:** self

**Current test mirror** (lines 3-10):
```typescript
const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "CLERK_JWT_ISSUER_DOMAIN",
];
```
Add `"ZOTERO_CLIENT_KEY"` and `"ZOTERO_CLIENT_SECRET"` to match source.

**Existing test case pattern** (lines 34-48):
```typescript
it("detects missing STRIPE_SECRET_KEY", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  // Set all other required env vars to non-empty values
  process.env.ENCRYPTION_KEY = "test-key";
  process.env.STRIPE_GO_PRICE_ID = "price_go";
  process.env.STRIPE_PRO_PRICE_ID = "price_pro";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.CLERK_JWT_ISSUER_DOMAIN = "https://test.clerk.dev";

  const { validateRequiredEnvVars } = await import(
    "../convex/lib/envValidation"
  );
  const result = validateRequiredEnvVars();
  expect(result.missing).toContain("STRIPE_SECRET_KEY");
});
```

**New test cases follow identical pattern** -- set all other vars, delete the target, assert `result.missing` contains it. Must add `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET` to the "all others set" block in every existing test AND add 2 new test cases.

---

### `convex/zotero/purge.test.ts` (new test -- convex-test)

**Analog:** `convex/wallet/wallet.test.ts`

**convex-test setup pattern** (wallet.test.ts lines 1-5):
```typescript
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal, api } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
```

**Seed helper pattern** (wallet.test.ts lines 9-27):
```typescript
async function seedUser(
  t: ReturnType<typeof convexTest>,
  overrides?: { email?: string; clerkId?: string },
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: overrides?.clerkId ?? "clerk_wallet_test",
      email: overrides?.email ?? "wallet@test.com",
      firstName: "Wallet",
      lastName: "Tester",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    return userId;
  });
}
```

**Direct DB seeding for test data** (wallet.test.ts lines 59-76):
```typescript
async function seedWalletKey(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides?: { ... },
) {
  return await t.run(async (ctx) => {
    const walletKeyId = await ctx.db.insert("walletKeys", {
      userId,
      // ... fields ...
    });
    return walletKeyId;
  });
}
```

**Schema test pattern** (wallet.test.ts lines 80-97):
```typescript
describe("walletKeys schema", () => {
  it("creates a wallet key record with all fields", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);
    const walletKeyId = await seedWalletKey(t, userId, { ... });

    const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
    expect(record).not.toBeNull();
    expect(record!.userId).toBe(userId);
  });
});
```

**Internal mutation test pattern** (wallet.test.ts lines 132-151):
```typescript
describe("wallet internal mutations", () => {
  it("inserts a wallet key record", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t);

    const walletKeyId = await t.mutation(internal.wallet.internal.insertKey, {
      userId,
      // ... args ...
    });

    const record = await t.run(async (ctx) => ctx.db.get(walletKeyId));
    expect(record).not.toBeNull();
  });
});
```

**Purge test will need:** Seed zoteroConnections + zoteroOAuthTokens rows, call purge internalMutation, verify both tables are empty and counts are returned correctly.

---

### `messages/*.json` (modify -- seed i18n keys across 6 locales)

**Analog:** Existing `extraction.selector.*` and `connectionsPage.*` namespaces in `messages/en-US.json`.

**Pattern:** All new keys seeded in all 6 locales simultaneously (`en-US`, `en-GB`, `fr`, `ja`, `zh`, `hi`). Use English text as placeholder for non-English locales (per CONVENTIONS.md). Enforced by `tests/extraction-i18n-coverage.test.ts`.

**New namespaces to seed:**
- `connectionsPage.zotero.*` -- connection card strings (connect, disconnect, connected status, errors)
- `extraction.zoteroTab.*` -- ZoteroTab strings (not connected, loading, item rows, resolution states, pagination)

---

## Shared Patterns

### Authentication (Auth-Gated Queries)
**Source:** `lib/auth/use-auth-query.ts` lines 49-78
**Apply to:** `zotero-connection-card.tsx`, `zotero-tab.tsx`
```typescript
export function useProtectedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"] | "skip",
): { data: Query["_returnType"] | undefined } & QueryHookMetadata {
  const { phase, canRunProtectedQueries } = useAuthReadiness();
  const shouldRun = canRunProtectedQueries && args !== "skip";
  const data = useQuery(
    query as never,
    shouldRun ? (args as never) : "skip",
  ) as Query["_returnType"] | undefined;
  // ...
}
```

### Basket Hook
**Source:** `lib/hooks/use-add-to-basket.ts` lines 89-128
**Apply to:** `zotero-tab.tsx`, `zotero-item-row.tsx`
```typescript
export function useAddToBasket() {
  const add = useExtractionBasketStore((s) => s.add);
  const remove = useExtractionBasketStore((s) => s.remove);
  const count = useExtractionBasketStore((s) => s.papers.size);
  const limitData = useProtectedQuery(
    api.extraction.queries.getExtractionLimit,
    {},
  );
  const limit = limitData.data?.limit ?? 1000;

  const addToBasket = useCallback(
    (input: AddToBasketInput | AddToBasketInput[]): AddToBasketResult => {
      const inputs = Array.isArray(input) ? input : [input];
      const { added, dropped, entries } = computeCapAwareBatch(inputs, limit);
      if (entries.length > 0) {
        add(entries);
      }
      return { added, dropped };
    },
    [add, limit],
  );
  // ...
  return { addToBasket, removeFromBasket, isInBasket, basketCount: count, limit };
}
```

### Error Factory (Convex Backend)
**Source:** `convex/lib/errors.ts`
**Apply to:** `convex/zotero/actions.ts` (purge action)
```typescript
// Existing Zotero error codes (already in ErrorCode union):
// ZOTERO_NOT_CONNECTED, ZOTERO_OAUTH_NOT_CONFIGURED,
// ZOTERO_API_ERROR, ZOTERO_REQUEST_TOKEN_FAILED, ZOTERO_INVALID_RESPONSE
throw createError("ZOTERO_NOT_CONNECTED", "Zotero not connected");
```

### Audit Logging
**Source:** `convex/lib/audit.ts` lines 4-20
**Apply to:** `convex/zotero/actions.ts` (purge action pre/post logging)
```typescript
await ctx.runMutation(internal.lib.audit.writeAuditLog, {
  action: "ZOTERO_PURGE_START",
  metadata: { /* key-value pairs, all string values */ },
});
```

### i18n Translation Hook
**Source:** All tab components use identical pattern
**Apply to:** `zotero-connection-card.tsx`, `zotero-tab.tsx`, `zotero-item-row.tsx`
```typescript
const t = useTranslations("extraction.zoteroTab");
// or
const t = useTranslations("connectionsPage.zotero");
```

### Toast Notifications
**Source:** `sonner` used directly throughout (library-tab.tsx, manual-ids-tab.tsx, connections/page.tsx)
**Apply to:** `zotero-connection-card.tsx` (disconnect/connect feedback), `zotero-tab.tsx` (load errors), `zotero-item-row.tsx` (resolution feedback)
```typescript
import { toast } from "sonner";
toast.success(t("connectSuccess"));
toast.error(t("connectError", { error }));
```

### `cn()` Class Composition
**Source:** `lib/utils.ts` (clsx + tailwind-merge)
**Apply to:** All new UI components
```typescript
import { cn } from "@/lib/utils";
className={cn("base-classes", condition && "conditional-class")}
```

---

## No Analog Found

| File | Role | Data Flow | Reason | Mitigation |
|------|------|-----------|--------|------------|
| `app/extraction/new/zotero-item-row.tsx` (resolution state machine) | component | event-driven | No existing per-item async resolution with idle/resolving/resolved/failed states | RESEARCH.md Pattern 4 provides the complete state machine. Checkbox + spinner + check/X icon transitions are a composition of existing patterns (Checkbox from library-tab, spinner from manual-ids-tab, tooltip from add-to-extraction-button). |
| Pagination via `useAction` + `start`/`limit` cursor | component | request-response | No existing tab uses action-based pagination (all other tabs use reactive `useProtectedQuery`) | RESEARCH.md Pattern 3 provides the loadPage + nextCursor pattern. Follow manual-ids-tab's useAction approach but add pagination state management. |

## Metadata

**Analog search scope:** `app/extraction/new/`, `app/settings/connections/`, `components/extraction/`, `components/settings/`, `convex/zotero/`, `convex/lib/`, `convex/wallet/`, `lib/hooks/`, `lib/auth/`, `lib/store/`, `tests/`, `messages/`
**Files scanned:** 22 analog candidates, 11 selected as best matches
**Pattern extraction date:** 2026-04-16
