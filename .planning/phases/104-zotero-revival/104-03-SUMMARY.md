---
phase: 104-zotero-revival
plan: "03"
subsystem: zotero-ui
tags: [zotero, extraction, doi-resolution, collection-picker, pagination, basket]
dependency_graph:
  requires: [104-01, 104-02]
  provides: [zotero-tab, zotero-item-row, enabled-zotero-tab-trigger]
  affects:
    - app/extraction/new/zotero-tab.tsx
    - app/extraction/new/zotero-item-row.tsx
    - app/extraction/new/selector-page-client.tsx
tech_stack:
  added: []
  patterns:
    - useRef-map-cache
    - action-based-pagination
    - per-item-resolution-state-machine
    - doi-keyed-resolution-cache
    - connection-gate-empty-state
key_files:
  created:
    - app/extraction/new/zotero-item-row.tsx
    - app/extraction/new/zotero-tab.tsx
  modified:
    - app/extraction/new/selector-page-client.tsx
decisions:
  - "fetchItems returns validator omits totalResults; pagination footer shows loaded count only (not total library size)"
  - "ZoteroItemRow TooltipProvider wraps each row independently — isolated tooltip context per item"
  - "resolvedCacheRef keyed by DOI string not item key — multiple items sharing a DOI share the same cached resolution"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-16T18:20:00Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 104 Plan 03: ZoteroTab + ZoteroItemRow + Enable Tab Summary

One-liner: ZoteroItemRow 5-state resolution state machine and ZoteroTab (connection gate, collection picker, DOI-keyed cache, action-based pagination) wired into the enabled selector page Zotero tab.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create ZoteroItemRow with 5-state resolution state machine | d337f69 | app/extraction/new/zotero-item-row.tsx |
| 2 | Create ZoteroTab with collection picker, pagination, DOI resolution cache | 6814599 | app/extraction/new/zotero-tab.tsx |
| 3 | Enable Zotero tab in selector-page-client.tsx | 53fb32f | app/extraction/new/selector-page-client.tsx |

## What Was Built

### Task 1: ZoteroItemRow

Created `app/extraction/new/zotero-item-row.tsx` with:
- `ResolutionState` type export: `"idle" | "resolving" | "resolved" | "failed"`
- `ZoteroItemForUI` interface export: key, title, abstract?, authors[], year?, doi?, itemType, numChildren?, hasPdfChild
- `ZoteroItemRow` function component with 5 visual states:
  - STATE 1 (idle): unchecked Checkbox, triggers `onResolve(itemKey, doi)` on click
  - STATE 2 (resolving): `Loader2` spinner with `animate-spin`, replaces checkbox
  - STATE 3 (resolved/in-basket): `Check` icon with `text-green-600 dark:text-green-400`
  - STATE 4 (failed): `X` icon with `text-destructive` wrapped in retry button with `resolveFailed` tooltip
  - STATE 5 (no-DOI): disabled `Checkbox` with `aria-disabled="true"` and `noDoi` tooltip
- `opacity-60` applied when `isInBasket || !item.doi`
- Metadata row: year, itemType Badge (secondary), DOI Badge (outline, font-mono, truncated at 30 chars), PDF Badge with FileText icon
- Each row wrapped in `TooltipProvider` for isolated tooltip rendering
- `useTranslations("extraction.zoteroTab")` for all copy

### Task 2: ZoteroTab

Created `app/extraction/new/zotero-tab.tsx` with:
- `useProtectedQuery(api.zotero.queries.getConnectionStatus, {})` — connection gate
- Three render branches: loading (undefined status), disconnected (empty state + settings link), connected
- Disconnected state: Unplug icon + `notConnectedHeading` + `notConnectedBody` + `<Link href="/settings/connections">` with ExternalLink icon
- Collections: `useAction(fetchCollections)` called via `useEffect` on `status.connected`, populated into `Select` dropdown with `__all__` sentinel for "All Items"
- Items: `useAction(fetchItems)` called with explicit `limit: 25` (NOT default 50), append-on-load-more via `start` offset
- `resolvedCacheRef`: `useRef(new Map<string, string | null>())` keyed by DOI string — shared across items with the same DOI
- `handleResolve`: cache-first pattern, calls `resolveByDoi` on miss, `addToBasket({ source: "zotero" })` on success, sets `"resolved"` / `"failed"` state
- `handleRetry`: deletes cached DOI entry then re-calls `handleResolve`
- Pagination footer: `t("showing", { count, total })` with current loaded count, "Load more" Button when `hasMore`
- `useAddToBasket()` for `addToBasket` and `isInBasket`

### Task 3: Enable Zotero Tab

Modified `app/extraction/new/selector-page-client.tsx`:
- Added `import { ZoteroTab } from "./zotero-tab"` after ManualIdsTab import
- Removed `disabled` and `className="opacity-50"` from `<TabsTrigger value="zotero">`
- Replaced placeholder `div` containing `{t("zoteroComingSoon")}` with `<ZoteroTab />`
- `zoteroComingSoon` i18n key preserved in locale files (dead key cleanup deferred to Phase 105)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fetchItems returns validator omits totalResults**
- **Found during:** Task 2 (TypeScript error TS2339)
- **Issue:** The plan's interface spec showed `totalResults: v.optional(v.number())` in the `fetchItems` return type, but the actual `convex/zotero/actions.ts` `returns` validator and handler only return `{ items, nextCursor, hasMore }` — no `totalResults` field
- **Fix:** Removed `totalResults` state entirely from ZoteroTab. Pagination footer now shows loaded item count as both `count` and `total` in the `t("showing", ...)` call. The `hasMore` boolean correctly gates the "Load more" button.
- **Files modified:** `app/extraction/new/zotero-tab.tsx`
- **Commit:** 6814599

## Success Criteria Verification

- [x] Connected user can switch to the Zotero tab on /extraction/new and see their library
- [x] User browses collections, loads items (25 per page via explicit limit), clicks checkboxes to resolve DOIs and add to basket
- [x] Items without DOIs show disabled checkbox with explanatory tooltip (ZOT-04)
- [x] Disconnected users see empty state with link to /settings/connections (not a broken tab)
- [x] Resolved DOIs cache correctly via `resolvedCacheRef` — re-checking same item skips the OpenAlex API call
- [x] The Zotero tab trigger is fully enabled (no `disabled`, no `opacity-50`)
- [x] `addToBasket` called with `source: "zotero"` on successful resolution
- [x] `fetchItems` called with `limit: 25` explicitly (line 91 of zotero-tab.tsx)

## Known Stubs

None. All data flows are wired to live Convex queries/actions and the extraction basket store.

## Threat Surface Scan

No new network endpoints or auth paths beyond what is specified in the plan's threat model. `ZoteroTab` reads `getConnectionStatus` (T-104-10) and calls `fetchCollections`/`fetchItems`/`resolveByDoi` (T-104-08, T-104-09, T-104-10). All Convex actions require authenticated user via `requireCurrentUserId`. The resolution cache (T-104-11) is component-instance scoped via `useRef` — contains only OpenAlex IDs (public data) keyed by DOI strings (public data). No sensitive data cached client-side.

## Self-Check: PASSED

Files exist:
- FOUND: app/extraction/new/zotero-item-row.tsx
- FOUND: app/extraction/new/zotero-tab.tsx
- FOUND: app/extraction/new/selector-page-client.tsx (modified)

Commits exist:
- FOUND: d337f69 (ZoteroItemRow)
- FOUND: 6814599 (ZoteroTab)
- FOUND: 53fb32f (enable Zotero tab)
