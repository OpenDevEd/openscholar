# Phase 104: Zotero Revival - Context

**Gathered:** 2026-04-16 (updated 2026-04-16)
**Status:** Ready for planning

<domain>
## Phase Boundary

Reconnect the orphaned `convex/zotero/**` (~1433 LoC intact) to the UI via a Settings connection card and a Zotero tab in the `/extraction/new` selector, with lazy DOI-to-OpenAlex resolution, env-validation extension, and a dev-guarded purge action for stale pre-v7.0 OAuth state.

Requirements: SEL-06 (Zotero items → basket), ZOT-01 (Connect Zotero on settings page), ZOT-02 (ZoteroTab browse + add to basket), ZOT-04 (disabled checkbox for no-DOI items), ZOT-05 (env validation for Zotero env vars), ZOT-06 (purgeStaleZoteroState internal action).

</domain>

<decisions>
## Implementation Decisions

### Settings Connect Card (ZOT-01)
- **D-01:** Add a "Zotero" section at the top of the existing `/settings/connections/page.tsx`, before the wallet API keys section. The card shows connection status via `useProtectedQuery(api.zotero.queries.getConnectionStatus)` — if disconnected, shows a "Connect Zotero" button that calls `startOAuth`; if connected, shows username, Zotero user ID, connected-at timestamp, and a "Disconnect" button that calls `zotero.mutations.disconnect`.
- **D-02:** The "Connect Zotero" button constructs the callback URL as `${window.location.origin}/api/zotero/callback` (matching the existing `convex/http.ts` route at line 63). On click, it calls `api.zotero.actions.startOAuth({ callbackUrl })` and redirects to the returned `authorizeUrl`. The existing HTTP callback handler redirects back to `/?zotero_connected=true` or `?zotero_error=...`.
- **D-03:** Handle the `?zotero_connected=true` and `?zotero_error=...` query params on the root page (or settings page) by showing a success/error toast. Check for these params in a `useEffect` on the settings/connections page and clear them from the URL after displaying the toast.

### ZoteroTab Browse Experience (ZOT-02, SEL-06)
- **D-04:** Create a `<ZoteroTab>` component in `app/extraction/new/zotero-tab.tsx`. The tab checks connection status first — if disconnected, shows an empty state with a "Connect Zotero in Settings" link to `/settings/connections`. If connected, renders a collection picker dropdown and a paginated item list.
- **D-05:** The collection picker uses `api.zotero.actions.fetchCollections` (existing action). Display as a flat sorted-by-name dropdown (not a nested tree). Include an "All Items" option at the top that fetches items without a `collectionKey` filter. The active collection selection is stored in local component state.
- **D-06:** The item list uses `api.zotero.actions.fetchItems` with pagination via `start`/`limit` and the `nextCursor`/`hasMore` response pattern. Each item row shows: title, authors (truncated), year, DOI badge (present/absent), itemType badge, and a checkbox for basket selection. Page size: 25 items per page.
- **D-07:** Enable the Zotero tab in `selector-page-client.tsx` by removing the `disabled` prop and `opacity-50` class from the `TabsTrigger` (line 73), and replacing the placeholder content (lines 90-96) with `<ZoteroTab />`.

### DOI Resolution Flow (ZOT-04, SEL-06)
- **D-08:** Items WITHOUT a DOI field (`doi` is `undefined`/empty) render a disabled checkbox with a tooltip: "No DOI available — cannot add to extraction" (ZOT-04). These items are visually dimmed (opacity-50) but still visible so users see their full library.
- **D-09:** Items WITH a DOI use lazy resolution: checking the checkbox triggers `resolveByDoi(doi)` from Phase 100's `convex/openalex/actions.ts`. During resolution, show an inline spinner replacing the checkbox. On success (OpenAlex ID returned), add to basket with `source: "zotero"` and show a green checkmark. On failure (null returned or timeout), show a red X with tooltip "Could not find in OpenAlex" and a retry button.
- **D-10:** Resolved items cache their OpenAlex ID in local component state (`Map<string, string | null>`) so re-checking a previously resolved item skips the API call. The cache is scoped to the ZoteroTab component instance (cleared on unmount, not persisted).
- **D-11:** Bulk select is NOT supported for Zotero items — each item resolves individually due to the per-item DOI→OpenAlex resolution requirement. A "Select all" checkbox is omitted to avoid mass API calls. Users check items one-by-one.

### Env Validation Extension (ZOT-05)
- **D-12:** Extend `REQUIRED_ENV_VARS` in `convex/lib/envValidation.ts` to include `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`, and `ENCRYPTION_KEY`. `ENCRYPTION_KEY` is already required for API key encryption but was not in the validation list. All three are added to the array so the daily cron catches missing Zotero config.

### Purge Action (ZOT-06)
- **D-13:** Create `purgeStaleZoteroState` as an `internalAction` in `convex/zotero/actions.ts`. It deletes all rows from `zoteroConnections` and `zoteroOAuthTokens` tables. Guarded by platform-level internal function enforcement (not callable from clients). Callable only via Convex dashboard "Run Function" in dev environments. Logs a structured audit event before and after purge with row counts.
- **D-14:** The purge is a one-time cleanup for pre-v7.0 dev database state where `ENCRYPTION_KEY` may have been rotated, leaving orphan encrypted tokens that can't be decrypted. After running once, it should never be needed again. No UI surface.

### Claude's Discretion
- Exact Tailwind styling for the Zotero connection card on the settings page
- Whether the collection picker uses a Select dropdown or a Combobox (searchable)
- Animation transitions for connection status changes
- Exact toast wording for OAuth success/error/disconnect
- Loading skeleton design for the ZoteroTab collection and item lists
- Whether to show item count per collection in the dropdown
- Test file organization for new components and the purge action

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Zotero Backend (existing — DO NOT rewrite)
- `convex/zotero/actions.ts` — Complete OAuth 1.0a flow (`startOAuth` line 442, `completeOAuth` line 525), `fetchCollections` line 633, `fetchGroups` line 695, `fetchItems` line 758 (paginated with `nextCursor`/`hasMore`), `getAttachments` line 989, `downloadFile` line 1065
- `convex/zotero/queries.ts` — `getConnectionStatus` query (discriminated union: `{ connected: true, zoteroUserId, username, connectedAt }` | `{ connected: false }`)
- `convex/zotero/mutations.ts` — `storeRequestToken`, `getRequestToken`, `saveConnection`, `patchEncryptedKey`, `disconnect`, `cleanupExpiredOAuthTokens`
- `convex/zotero/internal.ts` — `getConnection` internal query (returns `{ zoteroUserId, encryptedApiKey, username } | null`)
- `lib/zotero-utils.ts` — `buildZoteroHeaders(apiKey?)`, `ZOTERO_USER_AGENT`, `isZoteroFileUrl`

### OAuth HTTP Callback
- `convex/http.ts` lines 61-92 — `GET /api/zotero/callback` handler, calls `internal.zotero.actions.completeOAuth`, redirects to `/?zotero_connected=true` or `?zotero_error=...`

### Schema
- `convex/schema.ts` lines 294-312 — `zoteroConnections` table (userId, zoteroUserId, encryptedApiKey, keyPrefix, username, connectedAt) with `by_user` and `by_zotero_user` indexes; `zoteroOAuthTokens` table (token, tokenSecret, userId, expiresAt) with `by_token`, `by_user`, `by_expiry` indexes

### Crons
- `convex/crons.ts` line 37 — `cleanup expired zotero oauth tokens` hourly cron already configured

### Env Validation
- `convex/lib/envValidation.ts` — `REQUIRED_ENV_VARS` array (currently 6 entries); `checkRequiredEnvVars` internal action

### GDPR Cleanup
- `convex/maintenance/mutations.ts` lines 38-44 — `cleanupDeletedUsers` already cascades Zotero connection deletion

### DOI Resolution (Phase 100 output)
- `convex/openalex/actions.ts` — `resolveByDoi` action: accepts DOI string, returns OpenAlex ID + metadata or null (8-second timeout)

### Selector Page (Phase 103 output)
- `app/extraction/new/selector-page-client.tsx` — Line 73: disabled Zotero `TabsTrigger`; lines 90-96: placeholder `TabsContent`
- `app/extraction/new/library-tab.tsx` — Reference for tab component pattern (data loading, checkbox selection, add-to-basket flow)

### Basket Store (Phase 99 output)
- `lib/store/extraction-basket.ts` — `useExtractionBasketStore`, `BasketEntry` (includes `source: BasketSource` where `"zotero"` is already in the union), `add()`, `remove()`, `has()` methods
- `lib/hooks/use-add-to-basket.ts` — `useAddToBasket` hook: `addToBasket`, `removeFromBasket`, `isInBasket`, `basketCount`

### Settings Page
- `app/settings/connections/page.tsx` — Existing connections page (wallet API keys); Zotero card goes above the wallet section
- `app/settings/layout.tsx` — Settings layout wrapper

### Auth
- `lib/auth/use-auth-query.ts` — `useProtectedQuery` wrapper for Clerk auth-safe queries
- `components/providers/convex-provider.tsx` — `useAuthReadiness` hook for auth phase gating

### Error System
- `convex/lib/errors.ts` — `createError` factory; existing codes include `ZOTERO_NOT_CONNECTED`, `ZOTERO_OAUTH_NOT_CONFIGURED`, `ZOTERO_API_ERROR`, `ZOTERO_REQUEST_TOKEN_FAILED`, `ZOTERO_INVALID_RESPONSE`

### i18n
- `messages/en-US.json` — Source of truth; seed `extraction.selector.tabs.zotero`, `extraction.zoteroTab.*`, `connectionsPage.zotero.*` namespaces

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code)

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), component naming (PascalCase), i18n key naming

### Prior Phase Context
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store and `BasketSource` decisions
- `.planning/phases/100-backend-wiring-tierselector-fix/100-CONTEXT.md` — `resolveByDoi` action design
- `.planning/phases/103-workbench-views-selector-page/103-CONTEXT.md` — Selector page tab architecture, ExtractionDialog wiring

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `convex/zotero/actions.ts` — Complete backend: OAuth flow, collection browsing, item fetching with pagination, attachment handling. ~1125 LoC, fully typed, ready to consume from UI
- `convex/zotero/queries.ts` — `getConnectionStatus` query with discriminated union return — ready for the settings card
- `convex/zotero/mutations.ts` — `disconnect` mutation — ready for the settings card disconnect button
- `lib/store/extraction-basket.ts` — Basket store already has `"zotero"` as a valid `BasketSource` — no store changes needed
- `lib/hooks/use-add-to-basket.ts` — `addToBasket` accepts any `BasketSource` including `"zotero"` — hook works out of the box
- `convex/openalex/actions.ts` — `resolveByDoi` action from Phase 100 — ready for DOI resolution in ZoteroTab
- `app/extraction/new/library-tab.tsx` — Reference pattern for how a selector tab loads data, shows checkboxes, and adds to basket
- `components/extraction/add-to-extraction-button.tsx` — Standalone button for adding papers — reuse pattern for Zotero item rows
- `convex/lib/envValidation.ts` — Simple array-append to add 3 new env vars

### Established Patterns
- Selector tab pattern: component checks auth, loads data via Convex action/query, renders rows with checkboxes, uses `useAddToBasket` hook
- Connection status check: `useProtectedQuery(api.zotero.queries.getConnectionStatus)` returns discriminated `connected: true | false`
- OAuth flow: client calls action → redirect to external auth → callback URL handled by Convex HTTP → redirect back with query params → client reads params and shows toast
- Internal actions for dev-only operations: platform-enforced unreachability, callable only from Convex dashboard
- i18n: seed all keys in 6 locales before UI work

### Integration Points
- `selector-page-client.tsx` line 73 → enable Zotero TabsTrigger, line 90 → replace placeholder with `<ZoteroTab />`
- `settings/connections/page.tsx` → add Zotero connection section above wallet keys
- `convex/lib/envValidation.ts` → append 3 env vars to `REQUIRED_ENV_VARS`
- `convex/zotero/actions.ts` → add `purgeStaleZoteroState` internal action

</code_context>

<specifics>
## Specific Ideas

- The entire Zotero backend (`convex/zotero/**`) is intact and functional — this phase is purely UI + wiring, NOT backend work. Do NOT rewrite, refactor, or modify the existing Zotero actions except to add the purge action.
- The `fetchItems` action already returns `doi?: string` per item — use this to determine checkbox enabled/disabled state (ZOT-04).
- The `fetchItems` action already returns `hasPdfChild: boolean` — display this as a badge in the ZoteroTab item rows for user context (researchers care about PDF availability).
- The OAuth callback redirects to `/?zotero_connected=true` — this needs to be handled (toast + URL cleanup). Consider redirecting back to `/settings/connections` instead, or detecting the param on the settings page.
- Zotero stays on OAuth 1.0a (verified 2025-09-24 per ROADMAP.md). Do NOT adopt `zotero-api-client@^0.48.0` (API-key auth only, no OAuth 1.0a).
- Bulk select is deliberately omitted for Zotero items to avoid mass `resolveByDoi` API calls. Each item resolves individually.
- The collection picker should be a simple flat dropdown, not a nested tree — keeps complexity low for a revival phase.
- `ENCRYPTION_KEY` is already used by the crypto module but was missing from env validation — adding it to ZOT-05 is a correctness fix, not just Zotero-specific.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 104-zotero-revival*
*Context gathered: 2026-04-16*
