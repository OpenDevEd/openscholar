# Phase 104: Zotero Revival - Research

**Researched:** 2026-04-16
**Domain:** Zotero OAuth 1.0a integration revival, cross-source paper selector UI, Convex action/query wiring
**Confidence:** HIGH

## Summary

Phase 104 is a **UI wiring and integration phase**, not a backend phase. The entire Zotero backend (`convex/zotero/**`, ~1125 lines of actions, queries, mutations, internal queries) is intact and fully functional. The work consists of (1) building a `ZoteroConnectionCard` for the `/settings/connections` page, (2) building a `ZoteroTab` component for the `/extraction/new` selector page that uses the existing backend actions, (3) extending env validation with 2 additional keys, and (4) adding a dev-guarded purge internal action.

Every backend action this phase needs already exists and has typed return values with Convex validators. The `resolveByDoi` action from Phase 100 is deployed and ready. The basket store already includes `"zotero"` as a valid `BasketSource`. The selector page already has a disabled Zotero tab trigger and placeholder content at known line numbers.

**Primary recommendation:** Build the three new UI components (`ZoteroConnectionCard`, `ZoteroTab`, `ZoteroItemRow`) following the established patterns from `library-tab.tsx` and the wallet key revoke pattern in `connections/page.tsx`, wire them to the existing Convex backend, seed i18n keys across all 6 locales, and update env validation and tests.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add Zotero section at top of `/settings/connections/page.tsx`, before wallet API keys. Card shows connection status via `useProtectedQuery(api.zotero.queries.getConnectionStatus)`.
- **D-02:** "Connect Zotero" button constructs callback URL as `${window.location.origin}/api/zotero/callback`, calls `api.zotero.actions.startOAuth({ callbackUrl })`, redirects to returned `authorizeUrl`.
- **D-03:** Handle `?zotero_connected=true` and `?zotero_error=...` query params via `useEffect`, show toast, clean URL with `window.history.replaceState`.
- **D-04:** Create `<ZoteroTab>` in `app/extraction/new/zotero-tab.tsx`. Check connection status first; show empty state if disconnected with link to `/settings/connections`.
- **D-05:** Collection picker uses `api.zotero.actions.fetchCollections`. Display as flat sorted-by-name dropdown with "All Items" at top. Active collection in local component state.
- **D-06:** Item list uses `api.zotero.actions.fetchItems` with pagination via `start`/`limit` and `nextCursor`/`hasMore`. Page size: 25 items per page.
- **D-07:** Enable Zotero tab in `selector-page-client.tsx` by removing `disabled` prop and `opacity-50` from TabsTrigger (line 73), replacing placeholder content (lines 90-96) with `<ZoteroTab />`.
- **D-08:** Items WITHOUT a DOI render a disabled checkbox with tooltip: "No DOI available -- cannot add to extraction". Visually dimmed (opacity-50).
- **D-09:** Items WITH a DOI use lazy resolution via `resolveByDoi(doi)`. Show inline spinner during resolution, green checkmark on success, red X on failure with retry.
- **D-10:** Resolved items cache OpenAlex ID in local component state (`Map<string, string | null>`). Cache scoped to ZoteroTab instance.
- **D-11:** Bulk select NOT supported for Zotero items. Each item resolves individually.
- **D-12:** Extend `REQUIRED_ENV_VARS` in `convex/lib/envValidation.ts` to include `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`, and `ENCRYPTION_KEY` (already present -- only need `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET`).
- **D-13:** Create `purgeStaleZoteroState` as `internalAction` in `convex/zotero/actions.ts`. Deletes all rows from `zoteroConnections` and `zoteroOAuthTokens`. Platform-enforced internal. Logs structured audit event.
- **D-14:** Purge is one-time cleanup for pre-v7.0 dev state. No UI surface.

### Claude's Discretion
- Exact Tailwind styling for the Zotero connection card on the settings page
- Whether the collection picker uses a Select dropdown or a Combobox (searchable)
- Animation transitions for connection status changes
- Exact toast wording for OAuth success/error/disconnect
- Loading skeleton design for the ZoteroTab collection and item lists
- Whether to show item count per collection in the dropdown
- Test file organization for new components and the purge action

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEL-06 | User can add papers to basket from connected Zotero library | ZoteroTab component wires `fetchItems` -> per-item `resolveByDoi` -> `addToBasket({ source: "zotero" })`. Basket store already has `"zotero"` in `BasketSource` union. |
| ZOT-01 | User connects Zotero via Settings page OAuth 1.0a flow | `startOAuth` action exists (line 442), `completeOAuth` internal action exists (line 525), HTTP callback handler in `http.ts` lines 61-92. New `ZoteroConnectionCard` component wraps the existing flow. |
| ZOT-02 | User browses Zotero collections/items in ZoteroTab and adds to basket | `fetchCollections` (line 633) and `fetchItems` (line 758) actions exist with typed returns. `ZoteroTab` builds UI on top. |
| ZOT-04 | Zotero items without DOI show disabled checkbox with tooltip | `fetchItems` return type includes `doi: v.optional(v.string())` -- presence/absence drives UI state. |
| ZOT-05 | Env validation extended for Zotero env vars | `REQUIRED_ENV_VARS` array in `convex/lib/envValidation.ts` currently has 6 entries; append `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET` (ENCRYPTION_KEY already present at index 1). |
| ZOT-06 | Dev-guarded `purgeStaleZoteroState` internal action | New `internalAction` in `convex/zotero/actions.ts`. Uses `ctx.runQuery` + `ctx.runMutation` to enumerate and delete all rows from both Zotero tables. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Zotero OAuth 1.0a flow | API / Backend (Convex actions) | Browser (redirect trigger) | OAuth signature generation, token exchange, encryption all happen server-side. Browser only initiates redirect and reads callback params. |
| Zotero connection status | API / Backend (Convex query) | Browser (display) | `getConnectionStatus` is a reactive Convex query. Browser renders discriminated result. |
| Zotero library browsing | API / Backend (Convex actions) | Browser (display + pagination) | `fetchCollections` and `fetchItems` proxy Zotero API server-side (requires decrypted API key). Browser handles pagination state and collection selection. |
| DOI-to-OpenAlex resolution | API / Backend (Convex action) | Browser (trigger + cache) | `resolveByDoi` calls OpenAlex API server-side. Browser triggers per-item, caches results locally. |
| Basket management | Browser (Zustand store) | -- | Entirely client-side. `useExtractionBasketStore` + `useAddToBasket` hook. No backend involvement for basket state. |
| Env validation | API / Backend (Convex cron) | -- | `checkRequiredEnvVars` runs daily as internal action. No UI surface. |
| State purge | API / Backend (Convex internal action) | -- | `purgeStaleZoteroState` is platform-enforced internal. Only callable from Convex dashboard. |

## Standard Stack

### Core (all already installed, no new deps)

| Library | Version | Purpose | Why Standard | Source |
|---------|---------|---------|--------------|--------|
| convex | ^1.34.1 | Backend platform (actions, queries, mutations, HTTP routes) | Project backend; all Zotero actions already built on it | [VERIFIED: package.json] |
| convex/react | included in convex | `useAction`, `useQuery`, `useMutation` hooks | Standard client-side Convex consumption | [VERIFIED: package.json] |
| zustand | ^5.0.5 | Extraction basket state store | Basket already uses Zustand with sessionStorage persist | [VERIFIED: package.json] |
| next-intl | ^4.8.2 | i18n translations via `useTranslations` | All UI strings go through next-intl | [VERIFIED: package.json] |
| sonner | ^2.0.7 | Toast notifications | OAuth success/error/disconnect toasts | [VERIFIED: package.json] |
| motion/react | (installed) | Spring-based animations | Connection card status transitions | [VERIFIED: package.json] |
| lucide-react | (installed) | Icons (Loader2, Check, X, Unplug, BookOpen) | Standard icon library per UI spec | [VERIFIED: package.json] |
| radix-ui | via shadcn | Select, Checkbox, Tooltip primitives | Standard shadcn component library | [VERIFIED: components/ui/] |

### Supporting (test infrastructure, already installed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.2.4 | Test runner | Unit tests for env validation, purge action, source-shape assertions | [VERIFIED: vitest --version] |
| convex-test | (installed) | Convex function testing | Integration tests for `purgeStaleZoteroState` | [VERIFIED: vitest.config.ts] |
| @testing-library/react | (installed) | Component rendering tests | ZoteroTab component tests if needed | [VERIFIED: tests/setup.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| shadcn Select for collection picker | shadcn Combobox (searchable) | Select is simpler for flat sorted-by-name list. Combobox adds search for large libraries (100+ collections). Claude's discretion per CONTEXT.md. Recommend Select unless user has 50+ collections -- searchability is overkill for most researchers. |
| `zotero-api-client@^0.48.0` | Existing hand-rolled OAuth 1.0a | **Rejected per user constraint.** Package only supports API-key auth, no OAuth 1.0a. Existing backend is complete and tested. |

**Installation:**
```bash
# No new packages needed. All dependencies already installed.
```

## Architecture Patterns

### System Architecture Diagram

```
Browser (React)                    Convex Backend                     External APIs
===============                    ==============                     =============

[Settings Page]                                                       
  |                                                                   
  |- useProtectedQuery ---------> getConnectionStatus (query)         
  |  (reactive, auto-updates)     reads zoteroConnections table       
  |                                                                   
  |- "Connect Zotero" click                                           
  |  useAction(startOAuth) -----> startOAuth (action) ---------> Zotero OAuth 1.0a
  |  window.location = authUrl     generates HMAC-SHA1 sig            Request Token URL
  |                                stores request token               
  |                                                                   
  |  <-- Zotero redirects to --> GET /api/zotero/callback             
  |  /?zotero_connected=true       completeOAuth (internal action)    Zotero Access Token
  |  useEffect reads param         encrypts API key, saves conn       
  |  shows toast, cleans URL                                          
  |                                                                   
[Selector Page - ZoteroTab]                                           
  |                                                                   
  |- useProtectedQuery ---------> getConnectionStatus (query)         
  |                                                                   
  |- useAction(fetchCollections)-> fetchCollections (action) ---> Zotero API v3
  |  populates Select dropdown     decrypts API key                   /users/{id}/collections
  |                                                                   
  |- useAction(fetchItems) -----> fetchItems (action) ----------> Zotero API v3
  |  paginated (start/limit)       decrypts API key, paginates       /users/{id}/items/top
  |  renders item rows             checks children for PDF            
  |                                                                   
  |- checkbox click on DOI item                                       
  |  useAction(resolveByDoi) ---> resolveByDoi (action) ---------> OpenAlex API
  |  local Map cache               8-second timeout                   /works?filter=doi:X
  |  addToBasket(source:"zotero")                                     
  |                                                                   
[Basket Store (Zustand)]                                              
  sessionStorage-persisted                                            
  "zotero" already in BasketSource                                    
```

### Recommended Project Structure (new files only)

```
components/
  settings/
    zotero-connection-card.tsx    # New: ZoteroConnectionCard component
app/
  extraction/
    new/
      zotero-tab.tsx              # New: ZoteroTab selector tab
      zotero-item-row.tsx         # New: Individual item row with resolution states
convex/
  zotero/
    actions.ts                    # Modified: add purgeStaleZoteroState internalAction
  lib/
    envValidation.ts              # Modified: append 2 env vars to REQUIRED_ENV_VARS
app/
  settings/
    connections/
      page.tsx                    # Modified: add ZoteroConnectionCard, useEffect for params
  extraction/
    new/
      selector-page-client.tsx    # Modified: enable Zotero tab, import ZoteroTab
messages/
  en-US.json (+ 5 other locales) # Modified: seed connectionsPage.zotero.* and extraction.zoteroTab.*
tests/
  env-validation.test.ts          # Modified: update REQUIRED_ENV_VARS mirror + new test cases
convex/
  zotero/
    purge.test.ts                 # New: convex-test for purgeStaleZoteroState
```

### Pattern 1: Selector Tab Component (Reference: library-tab.tsx)

**What:** Each tab in the selector page follows the same structure: check auth/connection state, load data via Convex, render items with checkboxes, wire to basket store.

**When to use:** Building the ZoteroTab.

**Example:**
```typescript
// Source: app/extraction/new/library-tab.tsx (verified in codebase)
"use client";

import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAddToBasket } from "@/lib/hooks/use-add-to-basket";

export function ZoteroTab() {
  // 1. Check connection status (reactive query)
  const { data: status } = useProtectedQuery(
    api.zotero.queries.getConnectionStatus,
    {},
  );

  // 2. If disconnected, show empty state with link
  if (status && !status.connected) {
    return <NotConnectedState />;
  }

  // 3. Fetch collections via action (not query -- it's a Zotero API proxy)
  const fetchCollections = useAction(api.zotero.actions.fetchCollections);
  const fetchItems = useAction(api.zotero.actions.fetchItems);

  // 4. Use basket hook for adding items
  const { addToBasket } = useAddToBasket();

  // 5. Per-item DOI resolution via action
  const resolveByDoi = useAction(api.openalex.actions.resolveByDoi);

  // ... render collection picker + paginated item list
}
```

### Pattern 2: Two-Step Destructive Confirmation (Reference: connections/page.tsx wallet revoke)

**What:** Inline confirmation pattern where clicking a destructive button replaces it with "Confirm" + "Cancel" buttons.

**When to use:** The "Disconnect" button on the ZoteroConnectionCard.

**Example:**
```typescript
// Source: app/settings/connections/page.tsx lines 158-177 (verified in codebase)
{confirmDisconnect ? (
  <div className="flex items-center gap-2">
    <button onClick={() => setConfirmDisconnect(false)}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors">
      {tc("cancel")}
    </button>
    <button onClick={handleDisconnect} disabled={disconnecting}
      className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground">
      {disconnecting ? t("disconnecting") : t("disconnectConfirm")}
    </button>
  </div>
) : (
  <button onClick={() => setConfirmDisconnect(true)}
    className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive">
    {t("disconnectButton")}
  </button>
)}
```

### Pattern 3: Action-Based Data Loading with Local Pagination State

**What:** Unlike library-tab which uses a reactive query, ZoteroTab loads data via Convex actions (server-side Zotero API proxy). Pagination state is managed locally.

**When to use:** ZoteroTab item list and "Load more" button.

**Example:**
```typescript
// Source: manual-ids-tab.tsx useAction pattern + fetchItems action return shape (verified)
const [items, setItems] = useState<ZoteroItemForUI[]>([]);
const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
const [isLoading, setIsLoading] = useState(false);
const fetchItems = useAction(api.zotero.actions.fetchItems);

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

### Pattern 4: Per-Item Async Resolution with Local Cache

**What:** Each Zotero item checkbox triggers an independent `resolveByDoi` call. Results are cached in a local `Map` to avoid redundant API calls.

**When to use:** ZoteroItemRow checkbox interactions.

**Example:**
```typescript
// Source: D-09, D-10 from CONTEXT.md; resolveByDoi shape from convex/openalex/actions.ts
type ResolutionState = "idle" | "resolving" | "resolved" | "failed";

// Cache at ZoteroTab level
const [resolvedCache] = useState(() => new Map<string, string | null>());
const [itemStates, setItemStates] = useState<Map<string, ResolutionState>>(new Map());

const handleResolve = useCallback(async (itemKey: string, doi: string) => {
  // Check cache first
  if (resolvedCache.has(doi)) {
    const cachedId = resolvedCache.get(doi);
    if (cachedId) {
      addToBasket({ rawId: cachedId, title, doi, source: "zotero" });
    }
    return;
  }

  setItemStates(prev => new Map(prev).set(itemKey, "resolving"));
  try {
    const result = await resolveByDoi({ doi });
    resolvedCache.set(doi, result?.openalexId ?? null);
    if (result) {
      addToBasket({ rawId: result.openalexId, title: result.title, doi: result.doi ?? null, source: "zotero" });
      setItemStates(prev => new Map(prev).set(itemKey, "resolved"));
    } else {
      setItemStates(prev => new Map(prev).set(itemKey, "failed"));
    }
  } catch {
    resolvedCache.set(doi, null);
    setItemStates(prev => new Map(prev).set(itemKey, "failed"));
  }
}, [resolveByDoi, resolvedCache, addToBasket]);
```

### Anti-Patterns to Avoid

- **Do NOT call Zotero API from the browser:** All Zotero API calls go through Convex actions because they require the decrypted API key (server-side only). Never expose the API key to the client.
- **Do NOT use reactive queries for Zotero data:** `fetchCollections` and `fetchItems` are Convex `action`s (not `query`s) because they proxy external HTTP calls. Use `useAction` + local state, not `useQuery`.
- **Do NOT batch-resolve DOIs:** Per D-11, bulk select is deliberately omitted. Each item resolves individually to avoid overwhelming the OpenAlex API.
- **Do NOT modify existing Zotero backend:** Per CONTEXT.md specifics section, the backend is intact and functional. Only add the `purgeStaleZoteroState` internal action.
- **Do NOT adopt `zotero-api-client@^0.48.0`:** Rejected per user constraint (API-key auth only, no OAuth 1.0a).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth 1.0a flow | Custom OAuth client | Existing `startOAuth`/`completeOAuth` in `convex/zotero/actions.ts` | Complete, tested, handles HMAC-SHA1 signatures, token storage, encryption [VERIFIED: codebase] |
| Zotero API pagination | Custom cursor management | Existing `fetchItems` action with `start`/`limit`/`nextCursor`/`hasMore` return | Already handles recursive collection fetching, deleted item filtering, PDF child detection [VERIFIED: codebase] |
| API key encryption | Custom crypto | Existing `encrypt`/`decryptApiKey` from `convex/lib/crypto` | Used by wallet keys and existing Zotero flow. AES-256-GCM with key prefix extraction [VERIFIED: codebase] |
| Basket management | Custom state for selected items | `useAddToBasket` hook + `useExtractionBasketStore` | Cap-aware, deduplicated, sessionStorage-persisted, already supports `"zotero"` source [VERIFIED: codebase] |
| Connection status | Custom DB query | `useProtectedQuery(api.zotero.queries.getConnectionStatus)` | Reactive, auth-gated, discriminated union return type [VERIFIED: codebase] |
| Two-step confirm | Custom modal/dialog | Inline button swap pattern from wallet key revoke in `connections/page.tsx` | Established UX pattern on the same page. Matches user expectations [VERIFIED: codebase] |

**Key insight:** This phase has zero net-new backend logic. Every Convex action, query, and mutation is already written. The work is purely UI component creation + wiring + i18n seeding + a trivial env validation update + a trivial purge action.

## Common Pitfalls

### Pitfall 1: ENCRYPTION_KEY Already in REQUIRED_ENV_VARS

**What goes wrong:** CONTEXT.md D-12 says "add `ENCRYPTION_KEY`" but it is already at index 1 of the array.
**Why it happens:** D-12 was written before verifying the current array contents.
**How to avoid:** Only append `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET`. Verify `ENCRYPTION_KEY` is already present -- it is (index 1 in the array). [VERIFIED: `convex/lib/envValidation.ts` line 8]
**Warning signs:** Duplicate entries in the array causing confusing "missing" reports.

### Pitfall 2: OAuth Callback Redirects to Root, Not Settings

**What goes wrong:** The HTTP callback in `convex/http.ts` redirects to `/?zotero_connected=true`, not `/settings/connections?zotero_connected=true`. If the `useEffect` that reads the param is only on the settings page, users who land on root will miss the toast.
**Why it happens:** The callback handler was written before the settings page existed.
**How to avoid:** Either (a) handle the query param on a root-level component/layout that runs on both pages, or (b) change the callback redirect URL to `/settings/connections?...` instead. Option (b) is cleaner but requires modifying the HTTP handler (which is backend code per the "do not modify" constraint). Option (a) is safer -- add a shared hook or check on the root layout. Per D-03, implementation is at Claude's discretion.
**Warning signs:** User completes OAuth, lands on root page, sees no feedback.

### Pitfall 3: fetchItems Default Limit is 50, Not 25

**What goes wrong:** The `fetchItems` action defaults to `limit = 50` (line 786) but D-06 specifies page size of 25.
**Why it happens:** Default limit in the backend is optimized for batch fetching, not UI pagination.
**How to avoid:** Always pass `limit: 25` explicitly from the ZoteroTab component. The `requestLimit` inside `fetchItems` uses `Math.min(limit, 50)` so 25 is accepted. [VERIFIED: `convex/zotero/actions.ts` line 819]
**Warning signs:** Items list showing 50 items per page instead of 25.

### Pitfall 4: Zotero API Rate Limiting (Backoff + 429)

**What goes wrong:** Rapid collection/item fetching can trigger Zotero's rate limiting. The API returns `429 Too Many Requests` with optional `Retry-After: <seconds>` header, or a `Backoff: <seconds>` header on any response.
**Why it happens:** The existing `fetchItems` action makes multiple sequential requests (collection tree + items + children for PDF detection) and does not check for `Backoff` or `Retry-After` headers.
**How to avoid:** For this phase (UI revival), the risk is LOW because users browse one collection at a time and load 25 items per page. The existing 30-second timeout per request handles temporary blocks gracefully. A `fetchWithBackoff` helper would be a future improvement but is NOT required for revival. [CITED: https://www.zotero.org/support/dev/web_api/v3/basics]
**Warning signs:** Sporadic `429` errors in Convex logs during rapid page navigation.

### Pitfall 5: Stale Resolution Cache on Collection Switch

**What goes wrong:** User resolves DOIs in Collection A, switches to Collection B (which may share items), then back to A. The cache persists correctly. But if items overlap across collections, the cache key must be DOI (not item key) to avoid redundant calls.
**Why it happens:** Zotero items have unique keys, but the same DOI can appear in multiple collections.
**How to avoid:** Per D-10, cache key is the DOI string, not the Zotero item key. This correctly deduplicates across collections. The resolution result is tied to the DOI, not the Zotero item.
**Warning signs:** Same DOI being resolved multiple times when switching collections.

### Pitfall 6: Existing env-validation.test.ts Mirrors REQUIRED_ENV_VARS Inline

**What goes wrong:** The test file at `tests/env-validation.test.ts` has a hardcoded copy of the `REQUIRED_ENV_VARS` array (line 3-9). Adding vars to the source without updating the test will cause test failures.
**Why it happens:** The test uses dynamic `import()` after setting env vars, but the array constant is duplicated.
**How to avoid:** Update BOTH `convex/lib/envValidation.ts` AND `tests/env-validation.test.ts` in the same task. Add test cases for the new Zotero env vars. [VERIFIED: `tests/env-validation.test.ts`]
**Warning signs:** Test suite passes locally (vars are set) but fails in CI (vars missing from test mirror).

### Pitfall 7: i18n Keys Must Be Seeded Across All 6 Locales

**What goes wrong:** Adding keys to `en-US.json` only causes `tests/extraction-i18n-coverage.test.ts` to fail.
**Why it happens:** Enforced by test: all namespaces must exist in all 6 locales (en-US, en-GB, fr, ja, zh, hi).
**How to avoid:** Seed all new keys in all 6 locale files simultaneously. Use English text as placeholder for non-English locales (standard practice in this project). [VERIFIED: CONVENTIONS.md]
**Warning signs:** i18n coverage test failure.

## Code Examples

### ZoteroConnectionCard Component Structure
```typescript
// Source: D-01, D-02, D-03 from CONTEXT.md; wallet revoke pattern from connections/page.tsx
"use client";

import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ZoteroConnectionCard() {
  const { data: status } = useProtectedQuery(
    api.zotero.queries.getConnectionStatus,
    {},
  );
  const startOAuth = useAction(api.zotero.actions.startOAuth);
  const disconnect = useMutation(api.zotero.mutations.disconnect);

  // Connected state: show user info + disconnect
  // Disconnected state: show connect CTA
  // Loading state: spinner
}
```

### fetchItems Return Shape (for ZoteroItemRow props)
```typescript
// Source: convex/zotero/actions.ts line 766-780 (verified validators)
type ZoteroItemFromAction = {
  key: string;            // Zotero item key
  title: string;          // Paper title
  abstract?: string;      // Abstract text
  authors: string[];      // Author names
  year?: number;          // Publication year
  doi?: string;           // DOI if present (drives ZOT-04)
  itemType: string;       // "journalArticle", "book", "thesis", etc.
  numChildren?: number;   // Child attachments count
  hasPdfChild: boolean;   // True if item has a PDF attachment
};

// Action return: { items: ZoteroItemFromAction[], nextCursor?: number, hasMore: boolean }
```

### resolveByDoi Return Shape (for resolution flow)
```typescript
// Source: convex/openalex/actions.ts lines 30-34 (verified validators)
type ResolvedPaper = {
  openalexId: string;   // "W1234567890" (normalized, no URL prefix)
  title: string;        // Paper title from OpenAlex
  doi?: string;         // DOI without "https://doi.org/" prefix
} | null;               // null means DOI not found in OpenAlex
```

### purgeStaleZoteroState Internal Action
```typescript
// Source: Convex guidelines for internalAction pattern
// File: convex/zotero/actions.ts (append to existing file)
export const purgeStaleZoteroState = internalAction({
  args: {},
  returns: v.object({
    connectionsDeleted: v.number(),
    tokensDeleted: v.number(),
  }),
  handler: async (ctx) => {
    // Count before purge (via internal queries)
    // Delete all zoteroConnections rows
    // Delete all zoteroOAuthTokens rows
    // Log audit event with counts
    // Return counts for dashboard visibility
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zotero OAuth 2.0 speculation | Zotero remains OAuth 1.0a (no migration) | Verified 2025-09-24 per ROADMAP.md | DO NOT attempt OAuth 2.0 -- Zotero has NOT migrated [CITED: https://www.zotero.org/support/dev/web_api/v3/basics] |
| `zotero-api-client` npm package | Hand-rolled OAuth 1.0a in codebase | N/A | Package only supports API-key auth, not OAuth 1.0a [VERIFIED: CONTEXT.md specifics] |
| Zotero API default page size 25 | Max 100 items per request | Current | Use `limit: 25` for UI, existing backend respects `Math.min(limit, 50)` [CITED: Zotero API docs] |

**Deprecated/outdated:**
- Nothing in the existing Zotero backend is deprecated. All endpoints use Zotero API v3 (current). [VERIFIED: `lib/zotero-utils.ts` line 9: `'Zotero-API-Version': '3'`]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 + convex-test |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/env-validation.test.ts convex/zotero/purge.test.ts` |
| Full suite command | `npm run test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ZOT-05 | `REQUIRED_ENV_VARS` includes Zotero keys | unit | `npx vitest run tests/env-validation.test.ts -x` | Exists (needs update) |
| ZOT-05 | `validateRequiredEnvVars` detects missing ZOTERO_CLIENT_KEY | unit | `npx vitest run tests/env-validation.test.ts -x` | Exists (needs new test case) |
| ZOT-06 | `purgeStaleZoteroState` deletes all rows from both tables | integration (convex-test) | `npx vitest run convex/zotero/purge.test.ts -x` | Wave 0 gap |
| ZOT-06 | `purgeStaleZoteroState` logs audit event with counts | integration (convex-test) | `npx vitest run convex/zotero/purge.test.ts -x` | Wave 0 gap |
| ZOT-05 | Source-shape: envValidation.ts contains ZOTERO_CLIENT_KEY literal | source-shape | `npx vitest run tests/env-validation.test.ts -x` | Needs new assertion |
| SEL-06 | ZoteroTab component renders (smoke) | manual-only | N/A -- action-dependent rendering requires live Convex backend | N/A |
| ZOT-01 | OAuth flow connects (end-to-end) | manual-only | N/A -- requires live Zotero OAuth callback | N/A |
| ZOT-02 | Browse collections + items | manual-only | N/A -- requires live Zotero API | N/A |
| ZOT-04 | Disabled checkbox for no-DOI items | manual-only | N/A -- requires live Zotero data | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/env-validation.test.ts convex/zotero/purge.test.ts -x`
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `convex/zotero/purge.test.ts` -- integration test for `purgeStaleZoteroState` (convex-test, edge-runtime)
- [ ] Update `tests/env-validation.test.ts` -- add `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` to test mirror + new test cases

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | OAuth 1.0a via existing `startOAuth`/`completeOAuth` -- no changes needed |
| V3 Session Management | Yes | OAuth request tokens expire after 10 minutes (line 29 in mutations.ts), hourly cron cleanup |
| V4 Access Control | Yes | `requireCurrentUserId` gates all Zotero actions; `useProtectedQuery` gates all client queries |
| V5 Input Validation | Yes | All Convex functions have `args` validators with `v.*` |
| V6 Cryptography | Yes | API key encrypted via AES-256-GCM in `convex/lib/crypto` -- never hand-rolled, never stored plaintext |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zotero API key exposure | Information Disclosure | Key encrypted at rest, decrypted only server-side in actions, never sent to client [VERIFIED: codebase] |
| OAuth token theft via callback manipulation | Spoofing | Callback URL constructed from `window.location.origin` (same-origin), token verified server-side against stored `tokenSecret` [VERIFIED: codebase] |
| Stale OAuth tokens | Elevation of Privilege | 10-minute expiry + hourly cron cleanup [VERIFIED: `convex/crons.ts` line 37] |
| Client-callable purge action | Tampering | `internalAction` -- platform-enforced, not callable from clients [VERIFIED: Convex guidelines] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The OAuth callback redirect to `/?zotero_connected=true` is the current behavior and has not been changed since Phase 43 | Pitfall 2 | Toast never shown to user after OAuth -- low risk, easily verified at implementation time |
| A2 | Researchers typically have fewer than 50 Zotero collections, making a simple Select dropdown sufficient over a searchable Combobox | Alternatives Considered | UX friction for power users with large libraries -- mitigated by Claude's discretion |

## Open Questions

1. **OAuth callback redirect target**
   - What we know: `convex/http.ts` line 88 redirects to `/?zotero_connected=true` (root page) [VERIFIED: codebase]
   - What's unclear: Should we modify the HTTP handler to redirect to `/settings/connections?zotero_connected=true` instead? This would mean modifying backend code.
   - Recommendation: Handle the param on the root layout or in a shared hook that runs on both pages. Safer than modifying the backend handler (per "do not modify existing Zotero backend" constraint). Alternatively, the redirect target is a one-line change that could be considered "wiring" rather than "backend logic" -- at implementer discretion.

2. **Collection item counts in dropdown**
   - What we know: `fetchCollections` returns `numItems` per collection [VERIFIED: action return validator line 643]
   - What's unclear: Whether to display "Collection Name (42)" in the dropdown. Not specified in locked decisions; listed as Claude's discretion.
   - Recommendation: Show counts -- it helps researchers identify which collection to browse. Low implementation cost.

## Sources

### Primary (HIGH confidence)
- **Codebase verification:** `convex/zotero/actions.ts`, `convex/zotero/queries.ts`, `convex/zotero/mutations.ts`, `convex/zotero/internal.ts` -- all 4 files read in full, all action/query signatures and return types verified
- **Codebase verification:** `convex/openalex/actions.ts` lines 140-183 -- `resolveByDoi` action, return shape, timeout configuration verified
- **Codebase verification:** `lib/store/extraction-basket.ts` -- `BasketSource` union includes `"zotero"` at line 13
- **Codebase verification:** `lib/hooks/use-add-to-basket.ts` -- `addToBasket` accepts `source: "zotero"` via `BasketSource` type
- **Codebase verification:** `app/extraction/new/selector-page-client.tsx` -- disabled Zotero tab at line 73, placeholder at lines 90-96
- **Codebase verification:** `app/settings/connections/page.tsx` -- wallet key revoke pattern at lines 158-177
- **Codebase verification:** `convex/lib/envValidation.ts` -- `REQUIRED_ENV_VARS` array (6 entries, `ENCRYPTION_KEY` at index 1)
- **Codebase verification:** `tests/env-validation.test.ts` -- test mirror of env vars, 4 test cases
- **Codebase verification:** `convex/http.ts` lines 61-92 -- Zotero OAuth callback handler
- **Codebase verification:** `convex/schema.ts` lines 294-314 -- `zoteroConnections` and `zoteroOAuthTokens` table schemas
- **Codebase verification:** `convex/crons.ts` line 37 -- hourly Zotero OAuth token cleanup cron
- **Codebase verification:** `lib/zotero-utils.ts` -- API version 3 header, user agent string
- **Codebase verification:** `convex/_generated/ai/guidelines.md` -- Convex API patterns, internalAction/internalMutation conventions

### Secondary (MEDIUM confidence)
- [Zotero Web API v3 Basics](https://www.zotero.org/support/dev/web_api/v3/basics) -- Rate limiting (Backoff header, 429 + Retry-After), pagination (start/limit, max 100, Total-Results header), API version 3 confirmed current
- [Zotero Forums: API rate limits](https://forums.zotero.org/discussion/116749/api-rate-limits-on-searches) -- No specific rate limit numbers published; clients must handle headers dynamically

### Tertiary (LOW confidence)
- None -- all claims verified against codebase or official documentation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies already installed and verified in package.json
- Architecture: HIGH -- every backend function verified in codebase with exact line numbers, return types, and validators
- Pitfalls: HIGH -- all pitfalls verified against actual code (env validation test mirror, fetchItems default limit, callback redirect URL, i18n coverage test)

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable -- existing backend code, no external API changes expected)
