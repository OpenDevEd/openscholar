# P6 — Paper Selection UX + Performance

**Intended reader:** an autonomous coding agent picking this up cold. You have not seen the conversation. Everything you need is linked below.

---

## 1. Mission

Close the gap between what P4 **built** (unified bucket + 5 source tabs + drawer + indicator + batched upload) and what P4 actually **shipped to the user**. The components exist; the wiring, the deselection path, and half the mass-select UX do not. This plan finishes the feature.

Scope:

1. **Mount the bucket UI.** `<BucketIndicator>` and `<BucketDrawer>` exist at `components/extraction/bucket/bucket-indicator.tsx` and `components/extraction/bucket/bucket-drawer.tsx` but are **imported nowhere outside their own files**. The user has no way to see staged count, open the drawer, remove items, or clear the bucket. Mount them in the `<JobCreator>` header (the mount site P4 Task 9 §446 specified but never executed).
2. **Make checkboxes toggle, not add-only.** Library, Collections, History, and Zotero all implement `onToggle` as a pure `addMany`. A checkbox that cannot be unchecked is a WCAG 4.1.2 violation and the P4 "removal is done from the bucket drawer" comment is a dead promise until (1) ships — and a second-class UX even after.
3. **Batch shift-click range selection.** `SelectableList.handleRowActivate` currently fans a 50-row shift-range out to 50 sequential `onToggle` calls → 50 Zustand writes → 50 subscriber notifications. Rewrite to one batched write.
4. **URL-sync the tab + use replace history for step.** `source-selector.tsx` uses `useState`; refreshing on step 2 loses the tab. Step uses `history: "push"` — a 3-step wizard litters 3 back-button presses. Both should be `nuqs`-backed and `replace`.
5. **"Select all across pages."** Select-all today covers only the 30-row visible page. For a 500-item library, that's 17 page-loads + 17 clicks to stage everything. Add a server-side "fetch all IDs for this query" path and the "Select all 500 items" affordance on the paginated tabs (Library, Collections, Zotero).
6. **Dedup feedback.** `bucket.addMany` silently collapses duplicates. Surface "3 added · 2 already in bucket" via the existing toast helpers.
7. **Collapse the duplicate "Add all visible" button** in Collections (two controls do the same thing).
8. **Clarify History row semantics.** A "selected" saved search stages N papers at submit time; today the UI hides N.
9. **A11y polish.** `aria-live` on the indicator count; focus restoration after `clear()`; visible "already-staged-elsewhere" hint for cross-source duplicates.

Explicitly **out of scope** (covered by P5):

- Bucket-store `readyCount` maintained field (P5 Task 7).
- `"use no memo"` directive purge (P5 Tasks 2-4.11).
- Redundant manual memos (P5 Tasks 8-10).
- `optimizePackageImports` (P5 Task 5).
- The 4 remaining Zustand fresh-reference bugs outside the bucket (P5 Task 1).

Explicitly **deferred** (P7 candidate, called out in §10):

- List virtualization (`@tanstack/react-virtual` or `content-visibility: auto`). Current page sizes (30 rows) don't warrant it; the 1000-row drawer might, once real-world usage lands.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY.** Every pattern this plan needs already exists in the repo:
   - `nuqs` URL state: `components/extraction/job-creator.tsx:54-57` — the exact `parseAsInteger.withDefault(1).withOptions({ history: "push" })` pattern (change to `"replace"`).
   - Toast helpers: `lib/toast/*` — `toast.validation.*`, `toast.success`, etc. Inventory first, extend second.
   - Pagination: `usePaginatedQuery` with `loadMore(30)` at `library-tab.tsx:20-24` and `collections-tab.tsx:96-100`.
   - Indeterminate-checkbox select-all: `components/extraction/bucket/selectable-list.tsx:38-45, 87-91` — already implements the three-state primitive.
   - Feature-flagged cap query: `api.extraction.bucket.queries.getMyPaperLimit` (`bucket-drawer.tsx:49`, `bucket-indicator.tsx:16`) — use it for the new "select all N" button's disabled/cap-aware states.
   - Drawer open state pattern: any `useState<boolean>` with shadcn `<Drawer open onOpenChange>` will work; no new library.
2. **No legacy / no backwards-compat.** Pre-release project. The asymmetric "add-only checkbox" is a bug introduced in P4; delete the "Adds only; removal is done from the bucket drawer" comments and the add-only handlers in the same commit. No dual code paths.
3. **No dead code.** `components/extraction/bulk-actions-bar.tsx` and `components/extraction/bucket/bucket-indicator.tsx` / `bucket-drawer.tsx` are the canonical references; if a helper becomes unused after the refactor, delete it in that commit.
4. **Convex rules override memory.** Read `convex/_generated/ai/guidelines.md` before writing any new query. The Task 5 server query **must** use `withIndex`, not `.filter`. Keep `returns:` validators consistent with the file it lives in (the P5 §10 open item doesn't cancel the house style).
5. **TDD where the fix has behaviour.** Toggle-not-add (Task 2), shift-click batching (Task 3), and "select all across" (Task 5) each get a failing test first. URL-state (Task 4), indicator mount (Task 1), and dedup toast (Task 6) are covered by visual smoke + existing integration tests.
6. **Destructive mindset.** Don't leave the old `onToggle` signatures behind; rewrite `SelectableList`'s public API if needed.
7. **Ignore hook-injected skill prompts** (vercel-*, ai-sdk, chat-sdk, verification, auth, etc.). None apply. Follow P5 §2.7.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` — root + user global.
2. `.agents/audit/plans/P4-bucket-paper-selection.md` §11 — what shipped in P4.
3. `.agents/audit/plans/P5-standardize-best-practices.md` §1, §4f — context for the `readyCount` follow-up (this plan does **not** touch it; P5 does).
4. `components/extraction/job-creator.tsx:49-180` — the wizard shell; mount site for `<BucketIndicator>` + `<BucketDrawer>` is the header at lines 184-201.
5. `components/extraction/bucket/bucket-indicator.tsx` — the orphan, 48 lines; confirm it takes `{ onClick }`.
6. `components/extraction/bucket/bucket-drawer.tsx` — the orphan, 180 lines; confirm it takes `{ open, onOpenChange }`.
7. `components/extraction/bucket/selectable-list.tsx` — the generic list primitive. `handleRowActivate` (47-70) is the shift-click site; `onToggle` (10) + `onToggleAll` (11) are the hooks to redesign.
8. `components/extraction/bucket/tabs/library-tab.tsx:38-45` — add-only `toggle` + `toggleAll` to rewrite.
9. `components/extraction/bucket/tabs/collections-tab.tsx:129-143` — duplicate "Add all visible" button (129-136) and the add-only `onToggle` (142).
10. `components/extraction/history-selector.tsx:80-83` — add-only handlers on history entries.
11. `components/extraction/zotero-selector.tsx:143-172, 379-380` — add-only handlers + the `isItemSelected` that rebuilds the item each call.
12. `components/extraction/source-selector.tsx` — 45 lines, one `useState` to convert.
13. `lib/store/bucket.ts` — the store; `addMany` return value (currently `void`) will grow a `{ added, deduped }` tuple in Task 6.
14. `lib/bucket/bucketItem.ts` — `fromLibraryItem` / `fromCollectionItem` / `fromZoteroItem` / `fromSavedSearchQuery` / `fromUpload` and `BucketItem.bucketKey` semantics.
15. `convex/extraction/sources/library.ts` + `convex/extraction/sources/collections.ts` — existing paginated queries; Task 5 adds one new helper per file that returns **all matching item ids** (or full `BucketItem` shapes) in one shot, gated by the same plan-aware cap as the UI.
16. `convex/extraction/bucket/queries.ts` — `getMyPaperLimit`; Task 5's new helpers **must** return ≤ `getMyPaperLimit` rows to avoid overflowing the bucket in one click.
17. `lib/toast/*` — existing toast shapes; Task 6 extends (not rewrites) the helpers.
18. `components/ui/drawer.tsx` + `components/ui/alert-dialog.tsx` — shadcn primitives already in use by the drawer.

---

## 4. Research summary (what the audit found)

### 4a. The orphan components (Ship-blocker)

- `grep -rn "BucketIndicator\|BucketDrawer" app/ components/` returns only the definitions at `components/extraction/bucket/bucket-indicator.tsx:11` and `components/extraction/bucket/bucket-drawer.tsx:42`. No import sites.
- `<JobCreator>` renders `<SourceSummary>` (counts) inside Step 2 (`job-creator.tsx:341`), but `<SourceSummary>` cannot replace the drawer: it has no removal UI, no "clear all," no cap banner, no per-item badges.
- Result: every `remove` / `clear` action in the bucket store is **unreachable** via the UI today. The only escape is clearing localStorage.

### 4b. Checkbox asymmetry (WCAG 4.1.2 violation, UX dark pattern)

Four tabs implement `onToggle` as pure `addMany`:

| File:Line | Handler | Behaviour |
|---|---|---|
| `library-tab.tsx:38-41` | `toggle` | Adds only. Comment says removal lives in the drawer. |
| `collections-tab.tsx:142` | `onToggle={(item) => onAdd([item], collectionId)}` | Adds only. |
| `history-selector.tsx:80` | `onToggle={(entry) => addMany([toBucketItem(entry)])}` | Adds only. |
| `zotero-selector.tsx:379` | `onToggle={(item) => addItems([item])}` | Adds only. |

Re-clicking a row shows the checkbox already checked, the click has no visible effect, and the user has no way to uncheck without the (unmounted) drawer. Shift-click range is also affected — `selectable-list.tsx:60` computes `target = !isSelected(current)`, but since `onToggle` ignores the `target` direction and always adds, Shift-click to *deselect* a range is a no-op.

### 4c. Shift-click fan-out (performance)

`selectable-list.tsx:61-65`:

```ts
for (let i = from; i <= to; i++) {
  const item = items[i];
  if (!item) continue;
  if (isSelected(item) !== target) onToggle(item, { shift: true });
}
```

Each `onToggle` is a fresh `addMany([one])` → fresh Zustand `set()` → all subscribers notified → all subscribers re-render. For a 50-row range, 50 store notifications fire synchronously. Every `useBucketStore` subscriber in the page re-renders 50 times inside a single user interaction. Measurable with a render counter mounted on `<BucketIndicator>` or `<SourceSummary>`.

Two levers: (i) change `addMany`'s callers to always pass an array; (ii) extend the primitive's contract so the range branch collects items into one array and issues one call. This plan does (ii) — it's a non-breaking change at the `SelectableList` boundary.

### 4d. URL state gaps

- `source-selector.tsx:17` — `const [tab, setTab] = useState<SourceTab>("history")`. Refresh loses the tab. Not deep-linkable.
- `job-creator.tsx:54-57` — `parseAsInteger.withDefault(1).withOptions({ history: "push" })`. Each Next/Back button press pushes a history entry. After completing the 3-step wizard, a user presses browser-back 3 times to leave the page.

Both are trivial `nuqs` rewrites.

### 4e. Paginated "select-all" scope

The indeterminate-checkbox header in `SelectableList` toggles over `items`, which for paginated tabs is only the current 30-row page:

| Tab | Max visible on one "Select all" click | User effort for 500 items |
|---|---|---|
| Library | 30 | 17 page-loads + 17 clicks |
| Collections | 30 | Same |
| Zotero | 50 | ~10 page-loads + 10 clicks |

Industry pattern: when a page is fully selected and more pages exist, show a secondary "Select all N items" affordance (Gmail, Linear, Notion). Server returns ids (not full rows) for speed; client stages them with `bucket.addMany`. The `getMyPaperLimit` query already caps this.

### 4f. Silent dedup

`bucket.ts:40-54` — `addMany` iterates incoming items, merges duplicates by `bucketKey` onto existing entries, and returns `void`. A user who stages DOI 10.1234/x from Library and then again from Zotero sees no toast, no indicator tick. From the user's perspective the second click "didn't register."

### 4g. Collections duplicate control

`collections-tab.tsx:129-136` — an explicit `<Button>` labeled "Add all visible" that calls `onAdd(items, collectionId)`. `SelectableList`'s header checkbox already does this via `onToggleAll`. Two controls, same outcome, different labels.

### 4h. History entry semantics

Each `searchHistory` entry expands to `entry.count` papers at submit time (server-side, via `api.extraction.mutations.startExtraction`'s `searchFilters` handling). `SelectableList` renders the entry row with `entry.count` already visible (history-selector.tsx:101-104), but the top-level "3 selected" text + the `<SourceSummary>` "3 history · …" line both count entries, not papers. A user who picks 3 saved searches totalling 1800 papers sees no hint that they're about to overflow the 1000 cap until submit time.

### 4i. Rebuild-on-every-compare in Zotero

`zotero-selector.tsx:160-172` — `isItemSelected` rebuilds a full `BucketItem` (via `fromZoteroItem`) **per item per render** just to derive `bucketKey`. At 500 items that's 500 object constructions per render pass. Fix: extract a cheap `zoteroBucketKeyFor(item, context)` that computes only the key.

### 4j. Accessibility gaps

- No `aria-live` region on the indicator; count changes are silent to screen readers.
- After `clear()` in the drawer the alert-dialog closes and focus falls to `<body>`. Restore focus to the indicator button (`<AlertDialogAction onClick>`-backed ref).
- Cross-source duplicates render as unselected in the "other" tab even though they're in the bucket. The `bucketKey` differs per source; use the shared `buildDedupeKey(doi, title, year)` (reused from P4) as a secondary "already staged elsewhere" signal on the row.

---

## 5. Architectural decisions (locked)

### 5a. `SelectableList` API extension

`onToggle` signature grows a second required argument `nextSelected: boolean` so callers can decide add vs. remove without re-computing `isSelected`. Existing single-click call sites pass `!isSelected(item)`; shift-range calls pass `target` once and batch. New signature:

```ts
onToggle: (t: T, next: boolean) => void;
onToggleRange?: (items: T[], next: boolean) => void; // optional; fall back to N onToggle calls
onToggleAll: (next: boolean) => void;
```

`handleRowActivate` collects the range items into one array and calls `onToggleRange(rangeItems, target)` if defined, else falls back to the old loop. Every tab wires `onToggleRange` to the batch form; no tab is left on the slow path.

### 5b. Toggle semantics

`addMany`/`remove` are the only store writes. `onToggle(item, false)` calls `remove(buildKey(item))`. `onToggle(item, true)` calls `addMany([toBucketItem(item)])`. The "checked" visual driver stays `isSelected(item)` reading `bucketKeys`.

### 5c. `addMany` return shape

```ts
type AddManyResult = { added: number; deduped: number; capped: number };
addMany: (items: BucketItem[]) => AddManyResult;
```

`capped` counts items dropped because `readyCount + added` would exceed the limit (post-P5 this is O(1); pre-P5 the cap check reads `getMyPaperLimit` **once** per call). The cap check lives **inside** `addMany` so every source benefits uniformly. Call sites surface results through `toast.bucket.added({ added, deduped, capped })` — a new helper in `lib/toast/*`.

### 5d. Tab URL state

`source-selector.tsx` switches to:

```ts
const [tab, setTab] = useQueryState(
  "tab",
  parseAsStringEnum(["history", "library", "collections", "zotero", "upload"])
    .withDefault("history")
    .withOptions({ history: "replace" }),
);
```

`job-creator.tsx:54-57` flips `"push"` → `"replace"` on the `step` param.

### 5e. "Select all across pages"

Server adds one query per paginated source:

- `api.extraction.sources.library.listAllIds({ query })` → `{ items: BucketItem[] }`, hard-capped at `getMyPaperLimit(ctx)` rows.
- `api.extraction.sources.collections.listAllItems({ collectionId })` → same.
- Zotero stays on `useSWRInfinite`; the "select all" button on Zotero triggers rapid sequential `setSize` calls + `fetchItems` until `hasMore === false`, then calls one `addMany`. (No new server endpoint; Zotero's third-party API doesn't give us a single-shot fetch.)

UI: when `headerChecked === true` (all visible selected) **and** `list.status === "CanLoadMore"`, show a secondary banner inside `SelectableList`:

> `30 of ~500 selected. Select all 500 →`

Clicking calls the new server query, passes results to `onToggleAll` via an escape hatch (e.g., a `onSelectAllAcross?: () => Promise<T[]>` prop), and shows the standard `addMany` toast on completion.

### 5f. Dedupe "also in bucket" hint

A new `useBucketStore((s) => s.dedupeKeys)` selector exposes a `Set<string>` of `buildDedupeKey(doi, title, year)` values, maintained inside `addMany`/`remove`/`clear`. Each tab's row render adds a small badge "Also in bucket (from Zotero)" when `dedupeKeys.has(itemDedupeKey) && !bucketKeys.has(itemBucketKey)`. The badge is muted; it's a hint, not a blocker.

### 5g. History row labelling

`history-selector.tsx` — renders `entry.count` inline (already there at 102-104). The `SelectableList` header label accepts a custom `headerLabel` prop (line 15, 92-98) — pass `${totalPapers} papers from ${selectedCount} searches` when any row is selected. `totalPapers = sum(entry.count for selected entries)`. `<SourceSummary>` counts history papers the same way (`entry.count`) rather than entries, so the cap math is honest at submit time.

### 5h. A11y

- `<BucketIndicator>` renders a visually-hidden `<span aria-live="polite">{readyCount} of {limit} papers staged</span>` adjacent to the visible count. Announcements fire on every change; polite prevents queue flooding.
- `<BucketDrawer>`'s clear `AlertDialogAction` takes a `ref` and restores focus to the indicator button on close via `onOpenChange(false)` + `indicatorRef.current?.focus()`.
- Rows with the "also in bucket" hint include `aria-label="… — also staged from Zotero"`.

### 5i. No virtualization in P6

Explicit deferral. Default pagination is 30 (Library, Collections) or 50 (Zotero). The drawer renders up to 1000 rows when full, which is the one legitimate virtualization candidate. P7 deals with it after real-world usage data.

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each is an atomic commit with a failing test where one is tractable. Commit message prefix `T<N>.<sub>`.

### Phase A — Ship-blocker

#### Task 1 — Mount `<BucketIndicator>` + `<BucketDrawer>` in `<JobCreator>`

**Why.** The drawer owns removal, cap banner, "clear all." Until mounted, the P4 feature is incomplete.

**Test first.** `components/extraction/__tests__/job-creator.test.tsx` (new or extend): render `<JobCreator>`, stage 2 items via the bucket store directly, assert:

- The indicator renders `2 / 1000`.
- Clicking the indicator opens a drawer containing both item titles.
- Clicking the per-item delete inside the drawer removes the item from the store.

**Implementation.** Inside `JobCreator`:

```tsx
const [drawerOpen, setDrawerOpen] = useState(false);
const indicatorRef = useRef<HTMLButtonElement>(null);
// header block (lines 184-201)
<div className="flex items-center gap-3">
  <BucketIndicator ref={indicatorRef} onClick={() => setDrawerOpen(true)} />
  <div className="text-sm text-muted-foreground">
    {t("stepOfThree", { step: validStep, total: 3 })}
  </div>
</div>
// below footer
<BucketDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
```

Forward the ref inside `<BucketIndicator>` (new prop; currently 11 lines, trivial change).

**Done when.** Test file green; manual smoke: indicator visible top-right; clicking opens drawer with every staged item.

---

### Phase B — Selection semantics

#### Task 2 — Toggle-not-add across every source tab

**Why.** §4b. Dark pattern + WCAG 4.1.2 violation. Blocks all subsequent mass-select work.

**Test first.** `components/extraction/bucket/__tests__/selectable-list.test.tsx`:

- Render `<SelectableList>` with 5 items, stage 2 of them.
- Click a staged row → `onToggle` called with `(item, false)`.
- Click an unstaged row → `onToggle` called with `(item, true)`.
- Shift-click to extend a staged range → `onToggleRange(rangeItems, false)` or N `onToggle(_, false)` calls.

**Implementation.**

1. Widen `SelectableList`'s `onToggle` to `(t, next: boolean) => void`. Update `handleRowActivate` line 67, 131, 64 to pass `!isSelected(current)` / `target` explicitly.
2. Rewrite each tab's `onToggle` to branch:

```ts
const onToggle = (item: LibItem, next: boolean) => {
  const key = fromLibraryItem(item).bucketKey;
  if (next) addMany([fromLibraryItem(item)]);
  else remove(key);
};
```

Apply at `library-tab.tsx:38`, `collections-tab.tsx:142` (via parent closure), `history-selector.tsx:80`, `zotero-selector.tsx:379`.

3. Rewrite `onToggleAll` to accept `next: boolean`:

```ts
onToggleAll: (next: boolean) => next ? addMany(...) : removeMany(keysOfVisible)
```

Add `removeMany(keys: string[])` to `bucket.ts` (one `set` for the whole batch).

4. Delete the "Adds only; removal is done from the bucket drawer" comment at `library-tab.tsx:39`.

**Done when.** Test file green; clicking a checked row in any tab unstages the item and the indicator ticks down.

---

#### Task 3 — Batch shift-click into one store write

**Why.** §4c. 50-row ranges fire 50 subscriber-notifying writes. Hot path once mass-select lands.

**Test first.** Extend the Task 2 test:

- Spy on `useBucketStore.getState().addMany` calls.
- Shift-click over a 10-row range where none are currently selected.
- Assert `addMany` was called **exactly once** with 10 items.

**Implementation.**

1. Widen `SelectableListProps<T>` with:

```ts
onToggleRange?: (items: T[], next: boolean) => void;
```

2. In `handleRowActivate`, collect the diffed items into one array and call `onToggleRange(diff, target)` if defined, else fall back to the old per-item loop (unchanged, for callers that haven't wired batch yet).
3. Each tab wires the batch form:

```ts
onToggleRange={(items, next) => {
  if (next) addMany(items.map(fromLibraryItem));
  else removeMany(items.map((i) => fromLibraryItem(i).bucketKey));
}}
```

4. Same pattern in `history-selector.tsx`, `collections-tab.tsx`, `zotero-selector.tsx`.

**Done when.** Test green; DevTools Profiler on a 50-row shift-range shows one render cycle on subscribed components, not 50.

---

### Phase C — URL state

#### Task 4 — `nuqs`-ify the tab and flip step to `replace`

**Why.** §4d. Tab state deep-linkable; wizard stops polluting browser history.

**Test first.** No new test; the existing e2e flow plus a manual refresh-with-`?tab=library` smoke is sufficient. If the repo has a route-level nuqs test harness, extend it.

**Implementation.**

- `source-selector.tsx`: swap `useState` for `useQueryState("tab", parseAsStringEnum([...]).withDefault("history").withOptions({ history: "replace" }))`. Type `tab` as `SourceTab`; the enum parser lands typed.
- `job-creator.tsx:56`: change `history: "push"` → `history: "replace"`.

**Done when.** Build + test suite green. Manual: copy the URL at any step/tab, paste into a new window, lands on same step/tab. Browser-back from step 3 goes to the previous real page, not step 2.

---

### Phase D — Mass-select UX

#### Task 5 — "Select all N across pages" for Library and Collections

**Why.** §4e. Current select-all only covers 30 rows per page.

**Test first.** `convex/extraction/sources/__tests__/library.test.ts`:

- Seed 60 library items for a user.
- Call `listAllIds({ query: undefined })` with a cap of 50 (mock `getMyPaperLimit`).
- Assert the response contains exactly 50 items; a "truncated: true" flag is returned.
- Assert another call with `query: "foo"` returns only items where `title`/`authors` match, still capped.

**Implementation.**

1. `convex/extraction/sources/library.ts` — add `listAllIds` query:

```ts
export const listAllIds = query({
  args: { query: v.optional(v.string()) },
  returns: v.object({
    items: v.array(vBucketItem),  // reuse existing validator
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);  // existing helper
    const limit = await getMyPaperLimit(ctx);
    const q = args.query?.trim();
    const iter = q
      ? ctx.db.query("libraryItems").withSearchIndex("search_library", ...)
      : ctx.db.query("libraryItems").withIndex("by_user", ...);
    const rows: Doc<"libraryItems">[] = [];
    for await (const row of iter) {
      if (rows.length >= limit + 1) break;
      rows.push(row);
    }
    const truncated = rows.length > limit;
    return {
      items: rows.slice(0, limit).map((r) => fromLibraryItemServer(r)),  // mirror the client `fromLibraryItem` shape
      truncated,
    };
  },
});
```

Mirror in `convex/extraction/sources/collections.ts` as `listAllItems({ collectionId })`.

2. Hoist `fromLibraryItem` / `fromCollectionItem` shape to a shared `convex/extraction/bucket/shapes.ts` so client and server emit identical `BucketItem`s. The client forms already live in `lib/bucket/bucketItem.ts`; server forms are new — DRY the keying.

3. `SelectableList` grows an optional `onSelectAllAcross?: () => Promise<{ added: number; truncated: boolean }>`. When `headerChecked === true` **and** `hasMore` (new prop), render the "Select all N →" banner above the list.

4. Each paginated tab wires `onSelectAllAcross`:

```ts
const selectAllAcross = async () => {
  const { items, truncated } = await convex.query(api.extraction.sources.library.listAllIds, { query });
  const result = addMany(items);
  toast.bucket.added({ ...result, truncated });
};
```

5. Zotero: flipping `setSize` in a loop until `hasMore === false` is the closest we can get; implement it the same way but warn the user if iteration would exceed the cap.

**Done when.** Convex tests green; manual: clicking "Select all 500" on a 500-row library stages 500 items in one `addMany`, shows "500 added · 0 deduped · 0 capped", indicator ticks to 500.

---

#### Task 6 — Dedup / cap toast

**Why.** §4f. Silent dedup = perceived bug.

**Test first.** `lib/store/__tests__/bucket.test.ts`:

- `addMany([A, B])` → `{ added: 2, deduped: 0, capped: 0 }`.
- `addMany([A, C])` → `{ added: 1, deduped: 1, capped: 0 }`.
- With `readyCount === 999` and limit 1000, `addMany([X, Y])` → `{ added: 1, deduped: 0, capped: 1 }`.

**Implementation.**

1. `bucket.ts`: `addMany` returns `{ added, deduped, capped }`. Cap check reads `getMyPaperLimit` via a module-level accessor injected once at app mount (or, simpler, pass limit in as a second arg from callers that hold the query result — preferred, avoids pulling Convex into the store).

```ts
addMany: (incoming: BucketItem[], limit: number) => { ... }
```

Every caller already has the limit via `useQuery(api.extraction.bucket.queries.getMyPaperLimit)`; plumb it.

2. `lib/toast/bucket.ts` (new):

```ts
export function bucketAdded({ added, deduped, capped, truncated = false }) {
  const parts = [`${added} added`];
  if (deduped > 0) parts.push(`${deduped} already in bucket`);
  if (capped > 0) parts.push(`${capped} dropped — bucket is full`);
  if (truncated) parts.push(`(only first N matched)`);
  toast.success(parts.join(" · "));
}
```

3. Every `addMany` call site in the bucket flow wires the toast. `bulk-pdf-upload.tsx`'s per-file `addMany` is the one exception — batched upload already has per-row UI; suppress the toast with `{ silent: true }`.

**Done when.** Tests green; staging a duplicate surfaces the toast; hitting the cap surfaces the "dropped" message.

---

#### Task 7 — Collapse duplicate "Add all visible" in Collections

**Why.** §4g. Two controls, one outcome.

**Implementation.** `collections-tab.tsx:129-137` — delete the button block. Select-all now happens via the `SelectableList` header checkbox (wired in Task 2). No test needed; existing `SelectableList` tests cover select-all semantics.

**Done when.** Diff shows lines 129-137 gone; collections tab renders one way to select-all.

---

#### Task 8 — History rows count papers, not entries

**Why.** §4h. A user selecting 3 saved searches totalling 1800 papers has no warning before submit.

**Test first.** `components/extraction/__tests__/history-selector.test.tsx`:

- Seed `searchHistory` with three entries (counts 500, 800, 500).
- Select two of them (500 + 800).
- Assert the list header shows "1,300 papers from 2 searches".
- Assert `<SourceSummary>`'s history total is 1,300, not 2.

**Implementation.**

1. `history-selector.tsx`: pass custom `headerLabel` to `<SelectableList>`:

```tsx
headerLabel={selectedCount > 0
  ? `${format.number(totalPapersForSelection)} papers from ${selectedCount} searches`
  : `${searchHistory.length} saved searches`}
```

2. `source-summary.tsx:19-32`: the history source contributes `entry.count` (via a new `paperCount` field on the history BucketItem produced by `fromSavedSearchQuery`). Already available in `entry.count`; thread it through.

3. Same math flows into the cap check in `addMany` — a history entry contributes its `paperCount` to `readyCount`, not 1. Update the `readyCount` maintained field (P5 Task 7) to respect this; document the dependency in §10.

**Done when.** Test green; staging 3 big searches surfaces the cap warning before Step 3.

---

### Phase E — A11y

#### Task 9 — `aria-live` + focus restoration + cross-source duplicate hint

**Why.** §4j.

**Test first.** `components/extraction/bucket/__tests__/a11y.test.tsx` using `@testing-library/react` + jsdom:

- Render `<JobCreator>` with `<BucketIndicator>` mounted. Stage an item. Assert a `role="status"` or `aria-live="polite"` node's text contains the new count.
- Open the drawer, click "Clear all," confirm. Assert focus lands on the indicator button.
- Render `<LibraryTab>` with an item whose DOI also exists in the bucket under a different source. Assert the row has `aria-label` containing "also staged from Zotero".

**Implementation.**

1. `bucket-indicator.tsx` — add visually-hidden live region beside the visible count:

```tsx
<span className="sr-only" aria-live="polite">
  {readyCount} of {limit} papers staged
</span>
```

2. `bucket-drawer.tsx` — accept an optional `onClearReturnFocus?: () => void` prop; call after the clear dialog closes. `job-creator.tsx` passes `() => indicatorRef.current?.focus()`.

3. `bucket.ts` — maintain a `dedupeKeys: Set<string>` field inside `addMany`/`remove`/`clear`. Selector `useBucketStore((s) => s.dedupeKeys)` returns stable identity per mutation. Each tab's row renders the "also staged from X" hint when `dedupeKeys.has(itemDedupeKey) && !bucketKeys.has(itemBucketKey)`.

4. The `from X` source label comes from the `BucketItem` whose `dedupeKey` matches — add a `dedupeKeyToSource: Record<string, BucketSource>` selector on the store. O(1) lookup.

**Done when.** A11y tests green; manual: VoiceOver announces every count change; clearing the bucket returns focus to the indicator.

---

### Phase F — Code-hygiene follow-through

#### Task 10 — Zotero `isItemSelected` hot-path fix

**Why.** §4i. Rebuilds a full `BucketItem` per item per render.

**Test first.** Micro-benchmark via `vitest` `bench`:

- `isItemSelected` over 500 items before vs. after. Assert post-fix is at least 10x faster.

**Implementation.**

1. `lib/bucket/bucketItem.ts` — export `zoteroBucketKeyFor(itemKey, context)`: the pure key computation extracted from `fromZoteroItem`.
2. `zotero-selector.tsx:160-172` — replace the `fromZoteroItem(...)` construction with `zoteroBucketKeyFor(item.key, zoteroContext)`.

**Done when.** Benchmark passes; functional behaviour unchanged (covered by the Task 2 toggle tests).

---

## 7. Migration & destructiveness checklist

- [ ] `<BucketIndicator>` and `<BucketDrawer>` mounted in `<JobCreator>` header + wizard root (Task 1).
- [ ] Every `onToggle` in Library / Collections / History / Zotero branches add vs. remove (Task 2).
- [ ] All "Adds only; removal is done from the bucket drawer" comments deleted.
- [ ] `SelectableList` exposes `onToggleRange`; every consumer wires the batch form (Task 3).
- [ ] `source-selector.tsx`'s `useState` replaced with `useQueryState` (Task 4).
- [ ] `job-creator.tsx:56` uses `history: "replace"`.
- [ ] `api.extraction.sources.library.listAllIds` + `api.extraction.sources.collections.listAllItems` shipped, gated by `getMyPaperLimit` (Task 5).
- [ ] "Select all N →" banner renders in `SelectableList` when `headerChecked && hasMore`.
- [ ] `bucket.addMany` returns `{ added, deduped, capped }`; cap check lives inside the store (Task 6).
- [ ] `lib/toast/bucket.ts` exists and is the only place the "N added · M deduped" sentence is formatted.
- [ ] Collections duplicate "Add all visible" button removed (Task 7).
- [ ] History row / summary count papers, not entries (Task 8).
- [ ] `aria-live` region on the indicator; focus restoration on clear (Task 9).
- [ ] Cross-source "also staged from X" hint renders when applicable.
- [ ] `zoteroBucketKeyFor` replaces `fromZoteroItem` in the hot `isItemSelected` path (Task 10).
- [ ] `knip` dead-code report clean.
- [ ] Build + full test suite green at every commit.

---

## 8. Files inventory

### Modified

- `components/extraction/job-creator.tsx` — mount indicator + drawer; header layout; step `history: "replace"`.
- `components/extraction/source-selector.tsx` — `nuqs` tab state.
- `components/extraction/history-selector.tsx` — toggle branching; paper-count label.
- `components/extraction/zotero-selector.tsx` — toggle branching; `zoteroBucketKeyFor` swap.
- `components/extraction/source-summary.tsx` — paper-count math for history source.
- `components/extraction/bucket/selectable-list.tsx` — widened `onToggle`, new `onToggleRange`, new "select all across" banner.
- `components/extraction/bucket/bucket-indicator.tsx` — `forwardRef`, `aria-live`.
- `components/extraction/bucket/bucket-drawer.tsx` — `onClearReturnFocus` prop.
- `components/extraction/bucket/tabs/library-tab.tsx` — toggle branching, `onToggleRange`, "Select all across" wiring.
- `components/extraction/bucket/tabs/collections-tab.tsx` — toggle branching, `onToggleRange`, "Select all across", delete duplicate button.
- `lib/store/bucket.ts` — `removeMany`, return `AddManyResult`, `dedupeKeys` field, cap-aware.
- `lib/bucket/bucketItem.ts` — export `zoteroBucketKeyFor` + shared source-mapping helpers.
- `convex/extraction/sources/library.ts` — add `listAllIds`.
- `convex/extraction/sources/collections.ts` — add `listAllItems`.
- `convex/extraction/bucket/shapes.ts` — new shared server-side `BucketItem` builder (new file).

### New

- `lib/toast/bucket.ts` — `bucketAdded({ added, deduped, capped, truncated })`.
- `components/extraction/__tests__/job-creator.test.tsx` — mount + drawer interaction.
- `components/extraction/bucket/__tests__/selectable-list.test.tsx` — toggle semantics, shift-range batching.
- `components/extraction/__tests__/history-selector.test.tsx` — paper-count label.
- `components/extraction/bucket/__tests__/a11y.test.tsx` — live region, focus, duplicate hint.
- `convex/extraction/sources/__tests__/library.test.ts` — `listAllIds` behaviour, cap, truncation flag.
- `convex/extraction/sources/__tests__/collections.test.ts` — `listAllItems`.
- `lib/store/__tests__/bucket.test.ts` — extended: `AddManyResult`, `dedupeKeys`, `removeMany`.

### Deleted

Not applicable as whole-file deletions — the scope is behavioural. Specific deletions:

- `collections-tab.tsx:129-137` — the duplicate "Add all visible" button.
- `library-tab.tsx:39` — the "Adds only" comment.
- Any `onToggle: (t: T) => void` type usage outside the newly widened signature.

---

## 9. Test strategy

- **Integration** (Task 1, 9): React Testing Library + jsdom; render `<JobCreator>` with a mocked bucket store; assert DOM state.
- **Unit** (Task 2, 3, 6, 8): render `<SelectableList>` in isolation; spy on store methods; assert call shape.
- **Convex** (Task 5): use `convex-test` + the existing `seedFullJobGraph` fixture pattern; seed N library items; call the new query; assert shape and cap.
- **Micro-benchmark** (Task 10): `vitest bench`; establish a pre-fix baseline in the same commit to prove the regression guard is meaningful.

Baseline from P5 §9: 134 test files / 1694 tests green. Every task leaves the suite green or adds tests that do.

---

## 10. Open items (flag to user before starting)

1. **Plan-aware cap check placement.** §5c puts the cap check inside `addMany` as a second arg. The alternative — `useBucketStore.setState((s) => ({ readyCount: … }))` from outside — is simpler but duplicates the cap logic at every call site. Default: **cap in store**. Ask if the user wants the caller-side alternative.

2. **Server endpoint shape for "Select all."** §5e returns full `BucketItem[]` up to the cap. Alternative: return just `bucketKey[]` and let the client hydrate from the already-fetched page. For DOI/title/year items that's fine; for items with `storageId` (uploads) it's wrong. Default: **full `BucketItem[]`** from the server, with a shared builder in `convex/extraction/bucket/shapes.ts`. Ask if the user prefers a thinner payload.

3. **Zotero "select all" UX.** Zotero can't fetch "all across pages" in one call — the API is cursor-paginated. §5e's approach issues sequential `fetchItems` until `hasMore` is false. On a 1000-item Zotero collection that's 20 sequential network calls. Acceptable, but the UI must show "Loading all 1000 items…" with cancel. Default: **include Zotero in the feature** with the loading-cancel UI. If the user wants to exclude Zotero from Phase D, Task 5 ships without it and we ticket the follow-up.

4. **Dependency on P5 Task 7 (`readyCount`).** Task 8 (paper-count from history) needs the `readyCount` maintained field to add `entry.count` on stage and subtract on unstage. If P5 Task 7 hasn't landed yet, P6 Task 8 must either ship its own store field or defer. Default: **P6 lands after P5 Task 7.** If the user wants P6 to ship first, add a P6-Task-8-pre step to extend the store field inline, then remove the local field when P5 Task 7 lands.

5. **Virtualization in P6 vs. P7.** §5i defers virtualization. The one user-visible place it matters is a full (1000-row) drawer. Default: **defer to P7.** If the user has a concrete perf measurement showing the drawer stuttering today, add it as a P6 Phase G.

6. **`useShallow` vs. atomic selectors on the bucket.** P5 §5a says atomic selectors are the house style. Task 9's `dedupeKeys` + `dedupeKeyToSource` selectors live in the same component; a tempting but forbidden pattern would be `useShallow((s) => ({ dedupeKeys: s.dedupeKeys, dedupeKeyToSource: s.dedupeKeyToSource }))`. Stay atomic.

None of these are blockers. Start at Task 1.
