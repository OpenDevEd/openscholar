---
phase: 104-zotero-revival
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - app/extraction/new/selector-page-client.tsx
  - app/extraction/new/zotero-item-row.tsx
  - app/extraction/new/zotero-tab.tsx
  - app/settings/connections/page.tsx
  - components/settings/zotero-connection-card.tsx
  - convex/lib/envValidation.ts
  - convex/zotero/actions.ts
  - convex/zotero/mutations.ts
  - convex/zotero/purge.test.ts
  - messages/en-US.json
  - messages/en-GB.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
  - tests/env-validation.test.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 104: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 104 (Zotero Revival) introduces OAuth 1.0a integration with Zotero, a connection management UI, a Zotero items browser tab in the extraction selector, and supporting backend actions/mutations. The implementation is well-structured overall, with proper use of Convex internal actions for sensitive operations, encrypted API key storage, and good separation of concerns between UI and backend.

Key concerns: one security issue where the raw OAuth response (containing the API key in cleartext) is logged on error, a UI text bug showing "Connecting..." during disconnect, and a redundant null check.

## Critical Issues

### CR-01: OAuth response with API key logged in cleartext

**File:** `convex/zotero/actions.ts:600-604`
**Issue:** When the Zotero access token response is missing expected fields, the raw `responseText` is logged via `console.error`. This response contains `oauth_token_secret` which is the Zotero API key itself. Even though this only fires on error, it writes credential material to server logs (Convex dashboard logs, any log aggregator) where it persists and may be visible to anyone with dashboard access.
**Fix:**
```typescript
if (!accessToken || !zoteroUserId) {
  console.error("Zotero access token response missing fields", {
    hasAccessToken: !!accessToken,
    hasUserId: !!zoteroUserId,
    hasUsername: !!username,
    // Do NOT log responseText -- it contains the API key in cleartext
  });
  return { success: false, error: "Invalid response from Zotero" };
}
```

## Warnings

### WR-01: Disconnect button shows "Connecting..." instead of "Disconnecting..."

**File:** `components/settings/zotero-connection-card.tsx:151`
**Issue:** When the user confirms disconnect, the loading state text uses `t("connecting")` which resolves to "Connecting..." -- the wrong label for a disconnect action. This is a copy/paste error from the connect handler pattern.
**Fix:**
Add a `disconnecting` key to all locale files under `connectionsPage.zotero`, or reuse an existing pattern:
```tsx
{disconnecting ? t("disconnectButton") + "..." : t("disconnectConfirm")}
```
Or better, add a dedicated i18n key like `"disconnecting": "Disconnecting..."` in all locale files and use:
```tsx
{disconnecting ? t("disconnecting") : t("disconnectConfirm")}
```

### WR-02: handleResolve depends on `items` array causing stale closure risk

**File:** `app/extraction/new/zotero-tab.tsx:124,158`
**Issue:** The `handleResolve` callback depends on the `items` state array (line 158 dependency list). It uses `items.find()` at line 124 to get the title for the cache-hit path. When "Load more" appends items, this recreates `handleResolve` and cascades to `handleRetry`, causing all `ZoteroItemRow` components to re-render. More importantly, if a user clicks an item, then "Load more" completes before the async resolve finishes, the `items` reference could be stale within the in-flight callback -- though the `itemKey` lookup would still work because the item was in the previous array.
**Fix:** Remove `items` from the dependency list. In the cache-hit branch, look up the item title differently -- either pass `title` into the callback from the row component, or use a ref for items:
```tsx
// In handleResolve, remove items from deps:
const handleResolve = useCallback(
  async (itemKey: string, doi: string, title: string) => {
    // ...cache hit path uses `title` parameter directly
    addToBasket({ rawId: cachedId, title, doi, source: "zotero" });
    // ...
  },
  [resolveByDoi, addToBasket],
);
```
This also requires updating the `onResolve` callback signature in `ZoteroItemRow` to pass title.

### WR-03: API key prefix logged in fetchItems debug output

**File:** `convex/zotero/actions.ts:816`
**Issue:** The `fetchItems` action logs `apiKeyPrefix: apiKey.substring(0, 8) + "..."` at line 816. While 8 characters is less than the full key, it leaks a meaningful prefix of the decrypted API key to server logs on every item fetch. The `keyPrefix` stored in the database (via `getKeyPrefix`) is designed for safe display, but this log uses the raw decrypted key directly.
**Fix:** Either remove the `apiKeyPrefix` from the log, or use the stored `keyPrefix` from the connection record:
```typescript
console.log("[fetchItems] Starting fetch with params:", {
  userId,
  collectionKey,
  includeDescendants,
  groupId,
  start,
  limit,
  prefix,
  apiKeyPresent: !!apiKey,
  // Remove apiKeyPrefix entirely
});
```

## Info

### IN-01: Redundant null check in inBasket computation

**File:** `app/extraction/new/zotero-tab.tsx:262`
**Issue:** `cachedId != null && cachedId !== null` is redundant. The loose inequality `!= null` already rejects both `null` and `undefined`, making the strict `!== null` check unnecessary.
**Fix:**
```tsx
const inBasket =
  resState === "resolved" ||
  (cachedId != null && isInBasket(cachedId));
```

### IN-02: Excessive console.log statements in production backend code

**File:** `convex/zotero/actions.ts` (lines 255, 420, 674, 807, 841, 863, 882, 898, 904, 905, 923, 974)
**Issue:** The `fetchCollections` and `fetchItems` actions contain 14+ `console.log` statements logging pagination details, URL strings, response headers, and batch stats. While useful during development, these will produce significant log volume in production for every Zotero API call, increasing Convex log costs and making it harder to find real issues.
**Fix:** Either remove the debug logs before shipping, or guard them behind a debug flag / log level. At minimum, the URL logging at line 898 (`console.log("[fetchItems] Fetching from URL:", url.toString())`) should be removed as it exposes the API version and query parameters in logs.

### IN-03: Test file duplicates REQUIRED_ENV_VARS instead of importing

**File:** `tests/env-validation.test.ts:4-12`
**Issue:** The test file re-declares the `REQUIRED_ENV_VARS` array as a plain constant instead of importing it from `convex/lib/envValidation.ts`. If a new env var is added to the source list, the test will silently miss it.
**Fix:** Import from the source module:
```typescript
import { REQUIRED_ENV_VARS } from "../convex/lib/envValidation";
```
Note: the test uses dynamic `import()` for `validateRequiredEnvVars` to get fresh module state after env manipulation, but `REQUIRED_ENV_VARS` is a static constant that can be imported normally.

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
