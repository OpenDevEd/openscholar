---
phase: 104-zotero-revival
verified: 2026-04-16T15:26:44Z
status: human_needed
score: 6/6
overrides_applied: 0
human_verification:
  - test: "Connect Zotero account via /settings/connections page"
    expected: "Clicking 'Connect Zotero' redirects to Zotero OAuth page; after authorizing, user returns to the app and sees connected status with username, Zotero ID, and timestamp"
    why_human: "Requires real Zotero OAuth 1.0a redirect to external service and browser navigation -- cannot verify programmatically without running server and real Zotero credentials"
  - test: "Browse Zotero library and add items to basket on /extraction/new"
    expected: "Connected user switches to Zotero tab, sees collection picker, browses items (25 per page), clicks checkbox on an item with a DOI and sees spinner then green checkmark; item appears in basket"
    why_human: "Requires live Convex backend, authenticated user with real Zotero connection, and real DOI resolution against OpenAlex API"
  - test: "Verify two-step disconnect confirmation"
    expected: "On /settings/connections, clicking Disconnect shows Cancel + Confirm Disconnect buttons; clicking Cancel reverts; clicking Confirm disconnects and shows success toast"
    why_human: "Interactive two-step UI flow with animation transitions needs visual confirmation"
  - test: "Verify Zotero items without DOI show disabled checkbox with tooltip"
    expected: "Items without a DOI (books, dissertations) show a grayed-out checkbox; hovering shows 'No DOI available' tooltip"
    why_human: "Requires real Zotero library with a mix of items with and without DOIs to confirm tooltip rendering"
---

# Phase 104: Zotero Revival Verification Report

**Phase Goal:** Reconnect the orphaned convex/zotero/** (~1433 LoC intact) to the UI via a Settings connect card and a Zotero tab in the selector, with lazy DOI-to-OpenAlex resolution and a dev-DB purge action for stale pre-v7.0 OAuth state.
**Verified:** 2026-04-16T15:26:44Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User with a connected Zotero account opens /extraction/new, switches to Zotero tab, and can add items to basket alongside Library/Collections/Search/Manual (SEL-06) | VERIFIED | `selector-page-client.tsx` line 74: Zotero `TabsTrigger` has no `disabled` prop; line 92: `<ZoteroTab />` rendered in `TabsContent value="zotero"`; `zotero-tab.tsx` calls `addToBasket({ source: "zotero" })` at lines 126 and 146; `useAddToBasket` imported from `lib/hooks/use-add-to-basket.ts` |
| 2 | User clicks "Connect Zotero" on /settings and is routed through startOAuth flow (ZOT-01) | VERIFIED | `zotero-connection-card.tsx` line 20: `useAction(api.zotero.actions.startOAuth)`; line 30: constructs `callbackUrl` from `window.location.origin + "/api/zotero/callback"`; line 32: `window.location.href = authorizeUrl` redirects to Zotero; `connections/page.tsx` line 124: `<ZoteroConnectionCard />` mounted above wallet keys |
| 3 | User browses Zotero library collections and items in ZoteroTab with per-item state indicators (ZOT-02) | VERIFIED | `zotero-tab.tsx` line 32: `useAction(api.zotero.actions.fetchCollections)`; line 33: `useAction(api.zotero.actions.fetchItems)`; line 91: `limit: 25` explicitly passed; lines 220-237: `Select` dropdown with `__all__` sentinel and collection options; `zotero-item-row.tsx` renders 5 visual states (idle/resolving/resolved/failed/no-DOI) |
| 4 | Zotero items without DOI show disabled checkbox with tooltip (ZOT-04) | VERIFIED | `zotero-item-row.tsx` lines 47-63: `if (!item.doi)` renders `Checkbox disabled aria-disabled="true"` wrapped in `Tooltip` with `TooltipContent` containing `t("noDoi")`; line 119: `opacity-60` applied when `!item.doi` |
| 5 | Env-validation cron verifies ZOTERO_CLIENT_KEY, ZOTERO_CLIENT_SECRET, and ENCRYPTION_KEY (ZOT-05) | VERIFIED | `convex/lib/envValidation.ts` lines 7-16: `REQUIRED_ENV_VARS` array contains all 3 keys (ENCRYPTION_KEY at index 1, ZOTERO_CLIENT_KEY at index 6, ZOTERO_CLIENT_SECRET at index 7); 8 entries total; `tests/env-validation.test.ts` passes 6/6 tests including dedicated tests for both Zotero keys |
| 6 | Dev-guarded purgeStaleZoteroState internal action deletes all zoteroConnections and zoteroOAuthTokens (ZOT-06) | VERIFIED | `convex/zotero/actions.ts` line 1135: `purgeStaleZoteroState = internalAction`; lines 1143-1146: pre-purge audit log; line 1150: calls `internal.zotero.mutations.purgeAllZoteroData`; lines 1154-1160: post-purge audit log with counts; `convex/zotero/mutations.ts` line 188: `purgeAllZoteroData = internalMutation` deletes all rows from both tables and returns counts |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `components/settings/zotero-connection-card.tsx` | ZoteroConnectionCard with connect/disconnect/status states | VERIFIED | 179 lines, exports `ZoteroConnectionCard`, uses `useProtectedQuery`, `useAction`, `useMutation`, `AnimatePresence mode="wait"`, 3 visual states (loading/disconnected/connected), two-step disconnect confirmation, `aria-live="polite"` wrapper |
| `app/extraction/new/zotero-tab.tsx` | ZoteroTab with connection gate, collection picker, paginated item list, DOI resolution | VERIFIED | 300 lines, exports `ZoteroTab`, connection gate via `getConnectionStatus`, collection picker with `Select`, paginated items with `limit: 25`, DOI-keyed resolution cache via `useRef(new Map)`, disconnected empty state with `/settings/connections` link |
| `app/extraction/new/zotero-item-row.tsx` | ZoteroItemRow with 5-state resolution state machine | VERIFIED | 167 lines, exports `ZoteroItemRow`, `ResolutionState`, `ZoteroItemForUI`; 5 visual states: idle (checkbox), resolving (Loader2 spinner), resolved (Check icon green), failed (X icon destructive + retry), no-DOI (disabled checkbox + tooltip) |
| `app/extraction/new/selector-page-client.tsx` | Enabled Zotero tab trigger and ZoteroTab content | VERIFIED | Line 26: `import { ZoteroTab }`, line 74: `TabsTrigger value="zotero"` without `disabled` or `opacity-50`, line 92: `<ZoteroTab />` inside `TabsContent value="zotero"`, no `zoteroComingSoon` in JSX |
| `app/settings/connections/page.tsx` | ZoteroConnectionCard mounted above wallet keys + OAuth param handler | VERIFIED | Line 16: imports `ZoteroConnectionCard`, line 124: `<ZoteroConnectionCard />` rendered in content div above wallet keys, lines 37-52: `useEffect` reads `zotero_connected`/`zotero_error` params, shows toast, calls `window.history.replaceState` to clean URL |
| `convex/lib/envValidation.ts` | Extended REQUIRED_ENV_VARS with Zotero keys | VERIFIED | Lines 7-16: 8-entry array includes `ZOTERO_CLIENT_KEY` and `ZOTERO_CLIENT_SECRET` |
| `convex/zotero/actions.ts` | purgeStaleZoteroState internal action | VERIFIED | Line 1135: `export const purgeStaleZoteroState = internalAction`, explicit `Promise<{connectionsDeleted: number; tokensDeleted: number}>` return type, calls `purgeAllZoteroData` mutation and writes pre/post audit logs |
| `convex/zotero/mutations.ts` | purgeAllZoteroData internal mutation | VERIFIED | Line 188: `export const purgeAllZoteroData = internalMutation`, deletes all rows from `zoteroConnections` and `zoteroOAuthTokens`, returns `{ connectionsDeleted, tokensDeleted }` |
| `convex/zotero/purge.test.ts` | Integration test for purge action | VERIFIED | 110 lines, 2 test cases: purge with seeded data (asserts counts + empty tables), purge on empty tables (asserts zero counts); follows `wallet.test.ts` pattern with seed helpers |
| `tests/env-validation.test.ts` | Updated env validation tests | VERIFIED | Mirror array has 8 entries, 6 tests pass (includes 2 new Zotero key tests) |
| `messages/en-US.json` (+ 5 other locales) | i18n keys for Zotero connection card and ZoteroTab | VERIFIED | All 6 locales contain `connectionsPage.zotero` (14 keys) and `extraction.zoteroTab` (20 keys); programmatic check confirms presence of all required keys |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `zotero-connection-card.tsx` | `convex/zotero/queries.ts` | `useProtectedQuery(api.zotero.queries.getConnectionStatus)` | WIRED | Line 19 |
| `zotero-connection-card.tsx` | `convex/zotero/actions.ts` | `useAction(api.zotero.actions.startOAuth)` | WIRED | Line 20 |
| `zotero-connection-card.tsx` | `convex/zotero/mutations.ts` | `useMutation(api.zotero.mutations.disconnect)` | WIRED | Line 21 |
| `connections/page.tsx` | `zotero-connection-card.tsx` | `import + render above wallet keys` | WIRED | Import line 16, render line 124 |
| `zotero-tab.tsx` | `convex/zotero/queries.ts` | `useProtectedQuery(api.zotero.queries.getConnectionStatus)` | WIRED | Line 29 |
| `zotero-tab.tsx` | `convex/zotero/actions.ts` | `useAction(api.zotero.actions.fetchCollections)` + `useAction(api.zotero.actions.fetchItems)` | WIRED | Lines 32-33 |
| `zotero-tab.tsx` | `convex/openalex/actions.ts` | `useAction(api.openalex.actions.resolveByDoi)` | WIRED | Line 34 |
| `zotero-tab.tsx` | `lib/hooks/use-add-to-basket.ts` | `addToBasket({ source: 'zotero' })` | WIRED | Lines 126 and 146 confirm `source: "zotero"` |
| `selector-page-client.tsx` | `zotero-tab.tsx` | `import ZoteroTab + render in TabsContent` | WIRED | Import line 26, render line 92 |
| `convex/zotero/actions.ts` | `convex/zotero/mutations.ts` | `ctx.runMutation(internal.zotero.mutations.purgeAllZoteroData)` | WIRED | Line 1150 |
| `convex/zotero/actions.ts` | `convex/lib/audit.ts` | `ctx.runMutation(internal.lib.audit.writeAuditLog)` | WIRED | Lines 1143 (ZOTERO_PURGE_START) and 1154 (ZOTERO_PURGE_COMPLETE) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `zotero-connection-card.tsx` | `status` | `api.zotero.queries.getConnectionStatus` via `useProtectedQuery` | Yes -- Convex query reads `zoteroConnections` table (discriminated union: connected/disconnected) | FLOWING |
| `zotero-tab.tsx` | `collections` | `api.zotero.actions.fetchCollections` via `useAction` | Yes -- Convex action proxies Zotero API `/users/{id}/collections` | FLOWING |
| `zotero-tab.tsx` | `items` | `api.zotero.actions.fetchItems` via `useAction` | Yes -- Convex action proxies Zotero API `/users/{id}/items` with pagination | FLOWING |
| `zotero-tab.tsx` | DOI resolution | `api.openalex.actions.resolveByDoi` via `useAction` | Yes -- Convex action calls OpenAlex API, result cached in `resolvedCacheRef` | FLOWING |
| `zotero-tab.tsx` | basket state | `useAddToBasket()` from `lib/hooks/use-add-to-basket.ts` | Yes -- Zustand store backed by sessionStorage | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Env validation tests pass | `npx vitest run tests/env-validation.test.ts --bail=1` | 6/6 tests pass, exit 0 | PASS |
| i18n keys present in all 6 locales | Node script checking all locale files for required keys | "All 6 locales have required i18n keys" | PASS |
| Zotero tab trigger not disabled | `grep 'disabled\|opacity-50' selector-page-client.tsx` | Only `basketCount === 0` disabled (Start Extraction button, not Zotero tab) | PASS |
| zoteroComingSoon placeholder removed | `grep 'zoteroComingSoon' selector-page-client.tsx` | No matches found | PASS |
| ZoteroConnectionCard mounted before wallet keys | Verified line 124 in connections/page.tsx | `<ZoteroConnectionCard />` followed by `<Separator>` precedes wallet key section | PASS |
| DOI resolution cache keyed by DOI not item key | Verified `resolvedCacheRef.current` usage | `cache.has(doi)`, `cache.set(doi, ...)`, `cache.get(doi)` -- all keyed by DOI string | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEL-06 | 104-03-PLAN | User can add papers to basket from connected Zotero library | SATISFIED | ZoteroTab wired into selector page, calls `addToBasket({ source: "zotero" })`, Zotero tab trigger enabled |
| ZOT-01 | 104-02-PLAN | User can connect Zotero account via settings page OAuth card | SATISFIED | ZoteroConnectionCard calls `startOAuth`, constructs callback URL, redirects to Zotero authorize page |
| ZOT-02 | 104-03-PLAN | User can browse Zotero library collections and items in ZoteroTab | SATISFIED | ZoteroTab fetches collections and items via Convex actions, renders Select dropdown + paginated item list |
| ZOT-04 | 104-03-PLAN | Items without DOI show disabled checkbox with tooltip | SATISFIED | ZoteroItemRow renders disabled Checkbox with `aria-disabled="true"` and `noDoi` tooltip when `!item.doi` |
| ZOT-05 | 104-01-PLAN | Env validation cron checks Zotero secrets | SATISFIED | `REQUIRED_ENV_VARS` includes ZOTERO_CLIENT_KEY, ZOTERO_CLIENT_SECRET (ENCRYPTION_KEY already present); 6/6 tests pass |
| ZOT-06 | 104-01-PLAN | Dev-guarded purge action for stale OAuth state | SATISFIED | `purgeStaleZoteroState` internalAction with audit logging calls `purgeAllZoteroData` internalMutation; purge test exists with 2 test cases |

No orphaned requirements -- all 6 requirement IDs from REQUIREMENTS.md Phase 104 mapping (SEL-06, ZOT-01, ZOT-02, ZOT-04, ZOT-05, ZOT-06) are accounted for across the 3 plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | -- | -- | No TODO/FIXME/PLACEHOLDER/HACK markers found in any phase artifact |

No stub patterns, no `return null`, no empty handlers, no console.log-only implementations, no hardcoded empty data flowing to rendering.

### Human Verification Required

### 1. Zotero OAuth Connect Flow

**Test:** On /settings/connections, click "Connect Zotero" and complete OAuth authorization with a real Zotero account.
**Expected:** User is redirected to Zotero's authorization page, authorizes, returns to the app, and sees connected status showing username, Zotero ID, and relative timestamp. A success toast appears.
**Why human:** Requires real Zotero OAuth 1.0a external redirect, browser navigation, and live Convex backend with ZOTERO_CLIENT_KEY/SECRET configured.

### 2. Zotero Library Browsing and Item Selection

**Test:** On /extraction/new, switch to the Zotero tab with a connected account. Browse collections, load items, click checkbox on an item with a DOI.
**Expected:** Collection picker shows library collections. Items load 25 at a time. Checking an item shows inline spinner, then green checkmark after DOI resolution. Item appears in basket with source "zotero".
**Why human:** Requires live Convex backend, authenticated user with real Zotero connection, and real DOI resolution against OpenAlex API. Cannot simulate full async resolution flow programmatically.

### 3. Two-Step Disconnect Confirmation

**Test:** On /settings/connections (connected state), click Disconnect, then Cancel, then Disconnect again, then Confirm Disconnect.
**Expected:** First click: Cancel + Confirm Disconnect buttons appear with animation. Cancel reverts to single Disconnect button. Confirm Disconnect executes mutation, shows success toast, card transitions to disconnected state.
**Why human:** Interactive multi-step UI flow with AnimatePresence transitions -- needs visual verification of animation timing and state transitions.

### 4. No-DOI Items Tooltip Rendering

**Test:** On /extraction/new Zotero tab, locate a Zotero item without a DOI (book, dissertation, grey literature).
**Expected:** Checkbox is disabled and grayed (opacity-60). Hovering shows tooltip: "No DOI available -- cannot add to extraction".
**Why human:** Requires real Zotero library containing items without DOIs to confirm tooltip renders correctly in context.

### Gaps Summary

No automated verification gaps were found. All 6 observable truths are verified through codebase analysis. All 11 artifacts exist, are substantive, wired, and have flowing data sources. All 11 key links are confirmed wired. All 6 requirements are satisfied. No anti-patterns detected. The 6/6 env-validation tests pass.

The 4 human verification items are standard for an OAuth + external API integration: they require a live server with real credentials and real Zotero library data to confirm end-to-end behavior that cannot be simulated through static code analysis.

---

_Verified: 2026-04-16T15:26:44Z_
_Verifier: Claude (gsd-verifier)_
