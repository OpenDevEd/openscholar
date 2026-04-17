# P4 — Bucket Paper Selection UX

**Intended reader:** an autonomous coding agent picking this up cold. You have not seen the conversation. Everything you need is linked below.

---

## 1. Mission

Redesign the extraction paper-selection UX around a unified **bucket**: a single, deduped, cross-source staging area where a user can accumulate papers from **search history**, their **library**, their **collections**, **Zotero**, and **bulk PDF upload** — then submit all of them as one extraction job.

Scope:

1. Replace the 3 isolated draft-job fields (`selectedHistoryIds`, `zoteroSelection`, `manualItems`) with one `items: BucketItem[]` Zustand slice, keyed by dedup key. Sources become views, not storage.
2. Add **Library** and **Collections** as first-class selection sources (tables already exist; never wired).
3. Raise the per-job paper cap from **500 → 1000** and route every read through a single `getPaperLimit(ctx)` helper so the cap is trivially plan-aware later.
4. Unify every PDF size constant at **100 MB** in one module (`lib/files/limits.ts`) and add server-side enforcement (currently only client-side at 25 MB).
5. Ship bulk PDF upload (drag-and-drop, per-file state machine, bounded concurrency, per-file error isolation — no failure aborts the batch).
6. Ship mass-selection primitives on every source tab (select-all-visible, select-page, shift-click range).
7. Ship a persistent `<BucketDrawer>` showing the cross-source staged list with source badges, dedup hints, and live cap banner.
8. Rewrite `startExtraction` to accept `bucketItems[]` directly. Delete the three `sourceType`-branched inputs and all draft-field legacy.

The extraction pipeline takes research papers (PDFs + metadata), chunks them, runs an LLM over each chunk to extract structured answers. The selection UX is the on-ramp to that pipeline and is the single largest friction point today.

Files touched are primarily in `components/extraction/`, `lib/store/extraction.ts`, `lib/store/bucket.ts` (new), `convex/extraction/bucket/` (new), `convex/extraction/mutations/jobs.ts`, `convex/extraction/dedupe.ts` (reuse), and one cross-cutting file-size unification in `lib/files/limits.ts` (new) + `lib/pdf/download.ts` + `lib/pdf/url-allowlist.ts` + `components/extraction/manual-items.tsx`.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY absolutely.** Check the codebase before adding anything. Existing pieces to reuse:
   - `buildDedupeKey()` in `convex/extraction/dedupe.ts` (openalexId → DOI → title+year).
   - `mapWithConcurrency()` in `convex/extraction/workpoolActions.ts:100` (bounded-concurrency worker pool).
   - `ctx.storage.generateUploadUrl()` in `convex/extraction/uploads.ts`.
   - `resolveEffectivePlan()` + tier lookup in `lib/billing/entitlements.ts:44`; same pattern as `requireFeature` (`convex/featureFlags/guard.ts:16`).
   - `libraryItems` table (`convex/schema.ts:863`), `collections` + `libraryItemCollections` junction (`convex/library/collections.ts`), `listCollections`, search index `search_library`.
   - `TableView` select-all pattern (`components/extraction/results-views/table-view.tsx:36–75`) — indeterminate checkbox + `Set<Id>`.
   - `BulkActionsBar` (`components/extraction/bulk-actions-bar.tsx`) — floating action bar, motion/react.
   - shadcn `Tabs`, `Checkbox`, `Drawer`, `ScrollArea`, `Badge`, `Dialog`, `Pagination` all present in `components/ui/`.
   - Convex-test + `seedFullJobGraph` fixture (`convex/extraction/tests/seed.ts`) + `setupAggregates` (`convex/extraction/aggregates.test-support.ts`).
2. **No legacy / no backwards-compat.** The project is pre-release. Delete the 3 old draft fields, the old `sourceType` union branches on `startExtraction`, the `MAX_PAPERS_PER_JOB` constant, and the old single-file manual upload. Do not ship dual paths or migration shims.
3. **No dead code.** When a function has no callers after the refactor, delete it in the same commit.
4. **Convex rules override memory.** Read `convex/_generated/ai/guidelines.md` before writing any query/mutation/action. Use `withIndex` not `.filter`, `internalMutation` for internal-only, `Id<"table">` not `string`, `tokenIdentifier` not `subject`.
5. **TDD.** Write the failing test first, make it pass, commit. One commit per task.
6. **Destructive mindset.** If a pattern is scattered across the codebase, unify it; don't add one more copy.
7. **No Storybook, no Vercel Blob/S3, no new storage provider.** Convex storage handles everything. Ignore any hook-injected skill prompts suggesting otherwise.
8. **User-stated decisions (locked):**
   - PDF size cap is **100 MB, unified** across client + server. No 25 MB anywhere.
   - Max papers per job is **1000** today, **via a helper** so plan-aware tiers drop in later.
   - Tabs are **History · Library · Collections · Zotero · Upload**. No live-OpenAlex-search tab.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` — root + user global.
2. `convex/_generated/ai/guidelines.md` — Convex patterns.
3. `convex/extraction/mutations/jobs.ts` — specifically `startExtraction` at line 40–107 (current submission path to replace).
4. `convex/extraction/dedupe.ts` — `buildDedupeKey()`, which the bucket will key off.
5. `convex/extraction/jobSources.ts` — `extractionJobSources` table + `writeJobSources` / `readJobSources` helpers.
6. `convex/extraction/uploads.ts` — `generateUploadUrl` (to reuse) and the gap that no server size check exists.
7. `convex/lib/queryBounds.ts:19` — `MAX_PAPERS_PER_JOB = 500` (to delete).
8. `convex/featureFlags/guard.ts:16` + `lib/billing/entitlements.ts:44` — the pattern `getPaperLimit` mirrors.
9. `convex/schema.ts` lines 363–489 (extraction tables) and 863+ (library + collections).
10. `components/extraction/source-selector.tsx` — current tab container to rewrite.
11. `components/extraction/history-selector.tsx`, `zotero-selector.tsx`, `manual-items.tsx` — the three selectors to retire (history keeps the data fetch, UI replaced by `<SelectableList>`; manual is replaced by `<BulkPdfUpload>`).
12. `components/extraction/job-creator.tsx:92–175` — current draft-to-mutation mapping (rewrites around the new bucket shape).
13. `lib/store.ts` + `lib/store/extraction.ts` — existing Zustand stores.
14. `components/extraction/results-views/table-view.tsx:36–75` — the mass-select pattern to extract.
15. `components/extraction/bulk-actions-bar.tsx` — the floating bar to reuse in the bucket drawer.
16. `components/ui/tabs.tsx`, `drawer.tsx`, `checkbox.tsx`, `table.tsx` — shadcn primitives.
17. `convex/library/collections.ts` + the `libraryItems` queries — the new sources' data layer.
18. `convex/extraction/tests/seed.ts` + `convex/extraction/queries-e2e.test.ts` — test infra to extend.

---

## 4. Research summary (what four parallel agents found)

### 4a. Current selection flow

- `app/extraction/new/page.tsx` → `<JobCreator>` (3-step wizard) → `<SourceSelector>` with shadcn `Tabs`: **history · zotero · manual**.
- State held in Zustand `draftJob` (`lib/store/extraction.ts`), persisted to localStorage, keyed by 3 independent fields: `selectedHistoryIds: string[]`, `zoteroSelection: ExtractionZoteroSelection | null`, `manualItems: ExtractionManualItem[]`. No unified bucket, no cross-source view, no dedup across sources.
- Submission via `startExtraction` (`convex/extraction/mutations/jobs.ts:40`) takes `sourceType: "history" | "zotero" | "manual" | "mixed"` + three parallel input arrays. Mutation writes to `extractionJobSources` (a child table — the 1 MB document limit forced this split).
- Hard cap **500**, silent: `MAX_PAPERS_PER_JOB = 500` in `convex/lib/queryBounds.ts:19`, never surfaced to the user. Sub-caps are inconsistent: history 20 entries, zotero 1000 items, manual 1000 items. A user loading 1000 Zotero items silently loses 500.
- No mass-select in any source tab. No select-all, no shift-range, no select-by-filter. TableView already has the pattern — it just never got applied to selection UIs.
- Dedup logic exists (`convex/extraction/dedupe.ts:buildDedupeKey`, priority openalexId → DOI → title+year) — but only invoked at job-setup time, never in UI. A user can today pick the same paper via both Zotero and a search history and the bucket doesn't know.

### 4b. Available sources & canonical shape

- **History**: existing. References saved OpenAlex search filters; papers re-fetched at run time.
- **Zotero**: existing. OAuth via `zoteroConnections` table, items `{itemKey, title, abstract?, authors[], year?, doi?}`.
- **Manual**: existing. Inline form + single-file PDF upload via `ctx.storage.generateUploadUrl`.
- **Library**: exists in schema (`libraryItems`, line 863), never used by extraction. Rich fields: `openalexId`, `title`, `authors`, `doi`, `abstract`, `publicationYear`, `journal`, `paperData`, full-text search index `search_library` on `searchableText`.
- **Collections**: exists (`collections` + `libraryItemCollections` junction), wired to library UI only. 1–50 collections per user. Queries: `listCollections`, `getCollectionsWithCounts`, `getItemCollections`.
- **No other ingestion paths**: no CSV/BibTeX/RIS, no DOI lookup, no URL ingestion. (Out of scope here; future phase.)
- **No canonical paper type across sources.** Each source has its own shape. A `BucketItem` normalization layer is the missing piece.

### 4c. Upload infrastructure

- Convex storage in active use: `generateUploadUrl`, `storage.store`, `storage.getUrl`, `storage.delete`. Dual-source on `extractionPapers` (`pdfUrl` for URL-fetched, `storageId` for uploaded/stored). Feature flag `extraction.pdf` gates uploads.
- `lib/pdf/download.ts` is mature: retries, 30 s timeout, smart HTML → PDF-URL extraction, PMC conversion, Unpaywall/OpenAlex fallbacks, Cloudflare detection, rejects non-`application/pdf` content types, capped at 100 MB.
- `mapWithConcurrency()` already exists (`convex/extraction/workpoolActions.ts:100`) — bounded worker pool used at concurrency 5 per paper. Reuse for bulk upload at concurrency 3.
- **Gap 1**: no bulk-upload UI. Current `manual-items.tsx` single-file-per-row. No drag-and-drop, no batch state.
- **Gap 2**: no per-file error isolation today. A failure = generic toast + lost state.
- **Gap 3**: no server-side size enforcement. `convex/extraction/uploads.ts:6` just generates a signed URL; a client bypassing the 25 MB check gets to upload whatever Convex accepts. Need a `recordUploadedFile(storageId)` mutation that reads metadata and rejects > 100 MB before linking.
- **Gap 4 (file-size inconsistency)**: `manual-items.tsx:18` caps at 25 MB; `lib/pdf/download.ts:20` and `lib/pdf/url-allowlist.ts:19` cap at 100 MB. Unify to 100 MB everywhere via `lib/files/limits.ts`.

### 4d. UI + test infra

- shadcn present: `Tabs`, `Checkbox`, `Table`, `Dialog`, `Drawer`, `ScrollArea`, `Badge`, `Pagination`, `Select`, `Popover`, `Cascader`, `Button`, `Card`, `Input`, `Radio-group`, `Textarea`. No `Command`, no `Skeleton`.
- `TableView` at `components/extraction/results-views/table-view.tsx:36–75` holds the reference mass-select pattern (indeterminate checkbox + `Set<Id>` + `onSelectionChange`). Extract to a reusable `<SelectableList>`.
- `<BulkActionsBar>` (`components/extraction/bulk-actions-bar.tsx`) is a floating animated action bar. Reuse in the bucket drawer header.
- Zustand stores in `lib/store.ts` + `lib/store/extraction.ts`. Already hold `extractionViewMode`, `extractionSortBy`, `expandedScreeningDetails`, `draftJob`. Add a `bucket` slice (new file `lib/store/bucket.ts`) or extend `extraction.ts`; prefer the new file to keep concerns clean.
- Test stack: **Vitest 3.2.4** + `convex-test` + `@testing-library/react`. Seed fixture `seedFullJobGraph` (`convex/extraction/tests/seed.ts`). Feature-flag tests use `withIdentity` pattern. Component tests mock `next-intl` via `vi.mock("next-intl", () => ({useTranslations: () => (key: string) => key}))`.
- No Storybook. Don't add one.

### 4e. Subscription plumbing (for `getPaperLimit`)

- `subscriptions` table (`convex/schema.ts:153–191`), field `plan: "free" | "go" | "pro" | "enterprise"`.
- Canonical lookup: `selectCanonicalSubscription()` → `resolveEffectivePlan()` in `lib/billing/entitlements.ts:44`. Entitled = `active | trialing | past_due`, else `free`.
- Tier ordering via `getPlanTier()` (`convex/subscriptions/queries.ts:27–45`): `free=0, go=10, pro=20, enterprise=30`.
- Feature flags use the same lookup: `requireFeature(ctx, flagKey, userId)` in `convex/featureFlags/guard.ts:16`, and `checkFlag` internal query for actions (`convex/featureFlags/internal.ts:82`).
- **Read plan via DB lookup on `subscriptions`, not from `ctx.auth.getUserIdentity()` claims.** `getPaperLimit(ctx, userId)` must do the same.

### 4f. File-size constants in use

| File | Line | Constant / literal | Value | What it gates |
|---|---|---|---|---|
| `components/extraction/manual-items.tsx` | 18 | `MAX_FILE_MB` | 25 MB | Client manual upload rejection |
| `lib/pdf/download.ts` | 20 | `PDF_DOWNLOAD_CONFIG.MAX_PDF_BYTES` | 100 MB | Server PDF download cap |
| `lib/pdf/url-allowlist.ts` | 19 | `DEFAULT_MAX_BYTES` | 100 MB | Fallback download cap |

Unify all three to one import from `lib/files/limits.ts`.

---

## 5. Architectural decisions (locked)

### 5a. One canonical `BucketItem`

```ts
// lib/bucket/bucketItem.ts
export type BucketSource = "history" | "library" | "collection" | "zotero" | "upload";

export type BucketItem = {
  bucketKey: string;           // from buildDedupeKey(); dedup primary key
  source: BucketSource;        // origin tab
  sourceRefId: string;         // e.g. historyId, libraryItemId, collectionItemId, zoteroItemKey, uploadId
  sourceMeta?: Record<string, unknown>; // per-source extras (zotero groupId, collection name, etc.)
  title: string;
  authors: string[];           // always array (empty if none)
  year?: number;
  doi?: string;
  openalexId?: string;         // normalized form "W123…"
  abstract?: string;
  storageId?: Id<"_storage">;  // present for uploads; present later for downloaded PDFs
  pdfUrl?: string;
  addedAt: number;             // client Date.now(); used for UI ordering
  status: "ready" | "uploading" | "failed"; // only non-"ready" for in-flight uploads
};
```

Every source has a normalizer: `fromSearchHistoryEntry`, `fromLibraryItem`, `fromCollectionItem`, `fromZoteroItem`, `fromUpload`. All produce `BucketItem`. `bucketKey` is computed via the existing `buildDedupeKey` in `convex/extraction/dedupe.ts` — move the pure logic to `lib/bucket/dedupe.ts` (same shape, plain TS) so client + server share one implementation. The Convex module re-exports from `lib/`.

### 5b. Unified bucket slice

`lib/store/bucket.ts`, persisted to localStorage via `zustand/middleware.persist`:

```ts
type BucketState = {
  items: Record<string, BucketItem>; // keyed by bucketKey for O(1) dedup
  order: string[];                   // insertion-order list of bucketKeys
  addMany(items: BucketItem[]): void;
  remove(bucketKey: string): void;
  clear(): void;
  updateStatus(bucketKey: string, patch: Partial<Pick<BucketItem,"status"|"storageId">>): void;
};

// selectors
const selectCount = (s: BucketState) => s.order.length;
const selectBySource = (src: BucketSource) => (s: BucketState) =>
  s.order.map(k => s.items[k]).filter(i => i.source === src);
const selectReadyCount = (s: BucketState) =>
  s.order.reduce((n, k) => n + (s.items[k].status === "ready" ? 1 : 0), 0);
```

`addMany` dedupes by `bucketKey` (last write wins on metadata; status never regresses from "ready" to "uploading"). Replaces `selectedHistoryIds`, `zoteroSelection`, `manualItems` in `draftJob` — those three fields are deleted.

### 5c. `getPaperLimit` helper

```ts
// convex/extraction/bucket/limits.ts
const PAPER_LIMIT_BY_PLAN: Record<Plan, number> = {
  free: 1000, go: 1000, pro: 1000, enterprise: 1000,
};
export async function getPaperLimit(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  userId: Id<"users">,
): Promise<number> {
  const plan = await resolveEffectivePlan(ctx, userId);
  return PAPER_LIMIT_BY_PLAN[plan];
}
```

Deletes `MAX_PAPERS_PER_JOB` from `convex/lib/queryBounds.ts`. All `.take(MAX_PAPERS_PER_JOB)` and `readJobSources(ctx, jobId, MAX_PAPERS_PER_JOB * 2)` callsites are rewritten to await `getPaperLimit` first. Audit callers via Grep before deleting the constant.

### 5d. Unified file-size

```ts
// lib/files/limits.ts
export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_MB = 100;
```

Replaces `MAX_FILE_MB = 25` in `manual-items.tsx`, `PDF_DOWNLOAD_CONFIG.MAX_PDF_BYTES` in `lib/pdf/download.ts`, `DEFAULT_MAX_BYTES` in `lib/pdf/url-allowlist.ts`. Server-side enforcement added via new `recordUploadedFile({ storageId })` mutation (reads storage metadata, rejects if over cap, links to bucket only on success).

### 5e. Tab reorg

`<SourceSelector>` tabs (in order):

1. **History** — existing OpenAlex saved-search picker. Keep its query logic. Reskin UI to the shared `<SelectableList>`.
2. **Library** — new. Paginated list of `libraryItems` with `search_library` searchIndex hook.
3. **Collections** — new. Two-pane: collection picker on left (`listCollections`), items on right via `libraryItemCollections` join.
4. **Zotero** — existing OAuth flow unchanged. Reskin item list to `<SelectableList>`.
5. **Upload** — new `<BulkPdfUpload>` replacing the old one-at-a-time manual form.

### 5f. Submit path

`startExtraction` signature replaced:

```ts
// before
args: { name, sourceType, sourceHistoryEntries?, sourceZoteroSelection?, sourceManualItems?, questions }
// after
args: { name, bucketItems: BucketItemInput[], questions }
```

`sourceType` on the job row is derived from the bucket (`"mixed"` if ≥ 2 distinct sources, else the single source). `extractionJobSources` rows are written straight from bucket items. Server re-runs `buildDedupeKey` as defense-in-depth. Cap is enforced via `getPaperLimit`, hard-erroring if `bucketItems.length > limit`.

### 5g. Feature flag

Gate the whole UX behind `extraction.bucket_v2`. Flag set to `minimumTier: "free"` after a clean green run. Flag deleted in P7 (final cleanup).

---

## 6. Task list

Tasks are **ordered**; later depends on earlier. Each is an atomic commit with its own failing-test-first step. After each task: `pnpm typecheck` (or project equivalent) + `pnpm test` before moving on.

The convention matches existing P0/P1/P2/P3: one commit per task, message prefixed `T<N>.<sub> <summary>`.

---

### Task 1 — Unify file-size constant

**Why.** Three divergent constants (25 MB client, 100 MB server, 100 MB download) violate DRY and allow client bypass. Unify at 100 MB.

**Test first** — `lib/files/limits.test.ts`:
- `MAX_PDF_BYTES === 100 * 1024 * 1024`.
- `MAX_PDF_MB === 100`.
- `MAX_PDF_BYTES / (1024 * 1024) === MAX_PDF_MB`.

**Implementation.**
- Create `lib/files/limits.ts` exporting `MAX_PDF_BYTES` and `MAX_PDF_MB`.
- `components/extraction/manual-items.tsx:18` — delete `MAX_FILE_MB`, import `MAX_PDF_MB`, update size-check + toast copy.
- `lib/pdf/download.ts:20` — delete local `MAX_PDF_BYTES` in `PDF_DOWNLOAD_CONFIG`, import from `lib/files/limits`. Keep the config object's other fields.
- `lib/pdf/url-allowlist.ts:19` — delete `DEFAULT_MAX_BYTES`, import `MAX_PDF_BYTES`.
- Grep `grep -rn "25 \* 1024\|MAX_FILE_MB\|DEFAULT_MAX_BYTES\|MAX_PDF_BYTES"` under repo root; every hit must come from `lib/files/limits.ts` or import it.

**Done when.** Typecheck clean, all tests green, no other file redefines the constant.

---

### Task 2 — Server-side upload size enforcement

**Why.** `convex/extraction/uploads.ts` currently trusts the client. Add a gate between upload and bucket-link.

**Test first** — `convex/extraction/uploads.test.ts`:
- `recordUploadedFile` rejects storage whose metadata size > `MAX_PDF_BYTES`.
- `recordUploadedFile` returns the storageId on success.
- `recordUploadedFile` requires `extraction.pdf` feature.

**Implementation.**
- Add `recordUploadedFile = mutation({ args: { storageId: v.id("_storage") }, returns: v.object({ storageId, bytes }), handler: ... })` in `convex/extraction/uploads.ts`. Reads `ctx.storage.getMetadata(storageId)`, asserts size ≤ `MAX_PDF_BYTES`, else `ctx.storage.delete(storageId)` + throw.
- Keep `generateUploadUrl` unchanged.

**Done when.** Over-cap upload is deleted + errors. Under-cap returns the id.

---

### Task 3 — Move dedup key to shared lib

**Why.** Client bucket dedup must use the same key as server dedup. The function is pure.

**Test first** — `lib/bucket/dedupe.test.ts`:
- `buildDedupeKey({ openalexId: "https://openalex.org/W1" })` → `"openalex:W1"`.
- `buildDedupeKey({ doi: "10.1/abc" })` → `"doi:10.1/abc"`.
- DOI normalization: `"https://doi.org/10.1/ABC"` → `"doi:10.1/abc"` (lowercase, prefix strip).
- Title+year fallback: `"The Foo Bar"` + `2020` → `"title:the foo bar#2020"`.
- Priority: openalexId > doi > title+year.
- No key if none of the three present → throw.

**Implementation.**
- Move the function body from `convex/extraction/dedupe.ts` to `lib/bucket/dedupe.ts` (plain TS, no Convex imports).
- Re-export from `convex/extraction/dedupe.ts` for server callers (no callsite churn).
- Both paths resolve to one implementation.

**Done when.** All existing dedup tests still pass; new shared-lib tests pass.

---

### Task 4 — `getPaperLimit` helper + delete `MAX_PAPERS_PER_JOB`

**Why.** Single source of truth for the cap, plan-aware-ready.

**Test first** — `convex/extraction/bucket/limits.test.ts`:
- Free user → 1000.
- Pro user → 1000 (changes later).
- Subscription with status `active` counts; `canceled` falls back to free.
- Works in QueryCtx, MutationCtx, ActionCtx.

**Implementation.**
- Create `convex/extraction/bucket/limits.ts` with `PAPER_LIMIT_BY_PLAN` map + `getPaperLimit(ctx, userId)` that calls `resolveEffectivePlan` (already exists in `lib/billing/entitlements.ts`).
- Grep for every usage of `MAX_PAPERS_PER_JOB`. Expected sites (verify):
  - `convex/extraction/mutations/jobs.ts:145` (`.take(MAX_PAPERS_PER_JOB)`).
  - `convex/extraction/mutations/jobs.ts:195` (`readJobSources(ctx, id, MAX_PAPERS_PER_JOB * 2)`).
  - Any validator referring to the constant.
- Rewrite each callsite to `const limit = await getPaperLimit(ctx, userId); …`. For the `* 2` site, pass `limit * 2`.
- Delete the constant from `convex/lib/queryBounds.ts`. Delete the file if `MAX_PAPERS_PER_JOB` was its only export.

**Done when.** Grep for `MAX_PAPERS_PER_JOB` returns 0 hits. Typecheck + tests green.

---

### Task 5 — `BucketItem` type + normalizers

**Why.** The canonical shape that every source produces and the whole UX reads.

**Test first** — `lib/bucket/bucketItem.test.ts`:
- `fromSearchHistoryEntry` → bucketKey from openalexId; source `"history"`.
- `fromLibraryItem` → bucketKey from openalexId; source `"library"`; authors flattened from stored string.
- `fromCollectionItem` → identical to library but with `source: "collection"` and `sourceMeta.collectionId`.
- `fromZoteroItem` → bucketKey from DOI when present, else title+year; source `"zotero"`; `sourceMeta.libraryType/groupId/collectionKey`.
- `fromUpload` → bucketKey from DOI when user supplied it, else a stable UUID prefixed `upload:<uuid>` when no DOI; status `"uploading"` initially; `storageId` set on completion.
- **Cross-source dedup**: `fromLibraryItem({ doi:"10.1/x" })` and `fromZoteroItem({ doi:"10.1/x" })` have the same `bucketKey`.

**Implementation.**
- Create `lib/bucket/bucketItem.ts` with the `BucketItem` type and five normalizers, each purely functional (no ctx/DB).
- Each normalizer accepts the source's existing row shape (import types from `convex/schema` output).

**Done when.** Property-style tests pass for every normalizer; cross-source dedup test passes.

---

### Task 6 — Bucket Zustand slice

**Why.** Replaces the three draft fields with one deduped store.

**Test first** — `lib/store/bucket.test.ts`:
- `addMany([a, b])` → count 2, order `[a.bucketKey, b.bucketKey]`.
- Re-adding `a` → still count 2, order unchanged.
- `remove(a.bucketKey)` → count 1.
- `clear()` → count 0.
- `updateStatus(k, { status: "ready", storageId })` updates without changing order.
- Status never regresses: `updateStatus(k, { status: "uploading" })` is a no-op if item is `"ready"`.
- Persistence: serialize → parse → state matches.

**Implementation.**
- Create `lib/store/bucket.ts` — Zustand slice with `persist` middleware, `partialize` to items + order only.
- No UI wiring yet (Task 9).

**Done when.** All store tests pass.

---

### Task 7 — `<SelectableList>` primitive

**Why.** One component powers mass selection across every source tab. DRY.

**Test first** — `components/extraction/bucket/selectable-list.test.tsx`:
- Renders list, checkbox per row.
- Header checkbox: none-selected state, some-selected (indeterminate), all-selected (checked).
- Click header → selects all visible.
- Click row → toggles single.
- Shift-click between two rows → selects the inclusive range.
- `onToggleAll` callback fires with the Set of all visible IDs.
- Keyboard: Space toggles focused row; Enter adds focused row to selection.

**Implementation.**
- Create `components/extraction/bucket/selectable-list.tsx`. Props:
  ```ts
  { items: T[]; isSelected: (t: T) => boolean;
    onToggle: (t: T, mods?: { shift?: boolean }) => void;
    onToggleAll: () => void;
    renderRow: (t: T) => ReactNode;
    keyOf: (t: T) => string; }
  ```
- Tracks last-clicked index in component state for shift-range.
- Uses existing `Checkbox` + `Table` from `components/ui/`.
- Extract the indeterminate-checkbox logic from `table-view.tsx:36–75` into this component; delete it from there and rewire `TableView` through `<SelectableList>` to kill duplication.

**Done when.** All interaction tests pass; `table-view.tsx` now imports `<SelectableList>` and has no local select logic.

---

### Task 8 — Bulk PDF upload with per-file isolation

**Why.** Batch upload where one failure never aborts the batch.

**Test first** — `components/extraction/bucket/bulk-pdf-upload.test.tsx`:
- Drop 10 files; 10 rows appear in state `"pending"` → `"uploading"` → `"uploaded"` (or `"failed"`).
- Mock upload URL + fetch; force file 3 to reject.
- Assert 9 files complete, file 3 is `"failed"` with a retry button.
- Retry file 3 → state transitions resume.
- Non-PDF MIME rejected client-side before upload attempt.
- File > 100 MB rejected client-side.
- Bounded concurrency: with `CONCURRENCY = 3`, at most 3 `"uploading"` at once.

**Implementation.**
- Create `components/extraction/bucket/bulk-pdf-upload.tsx`.
- Use `react-dropzone` (add to `package.json`). Accept `application/pdf` only.
- Per-file state machine in local reducer; bounded concurrency via a tiny inline worker pool matching `mapWithConcurrency` semantics (do not import the server helper — keep client TS clean).
- On each successful upload: call `recordUploadedFile({ storageId })` (Task 2), then `bucket.addMany([fromUpload(...)])` with `status: "ready"`.
- On failure: keep the row in a "retry tray" above the dropzone; don't add to the bucket.
- MIME + size validation via `MAX_PDF_BYTES` from `lib/files/limits`.

**Done when.** Forced-failure test proves batch survives; retry works; concurrency cap respected; bucket shows only successes.

---

### Task 9 — `<BucketDrawer>`

**Why.** Persistent cross-source view of what's staged; the single source of "what submits."

**Test first** — `components/extraction/bucket/bucket-drawer.test.tsx`:
- Drawer opens from header badge; closes on overlay click.
- Renders items grouped by source with shadcn `Badge` per row.
- Shows `N / 1000` counter; banner at ≥ 90 %; error state at ≥ 100 %.
- Remove button per row calls `bucket.remove(bucketKey)`.
- "Clear all" confirms via `Dialog`, then calls `bucket.clear`.
- Items with `status === "uploading"` show progress badge; not counted toward submit-ready count.

**Implementation.**
- Create `components/extraction/bucket/bucket-drawer.tsx` using shadcn `Drawer` + `ScrollArea`.
- Header mount point: a new `<BucketIndicator>` in the `<JobCreator>` header showing `{readyCount} / {limit}`.
- `limit` fetched via a new thin query `extraction.bucket.getMyPaperLimit` that calls `getPaperLimit` under the hood.

**Done when.** Drawer renders across all tabs, counts are live, remove/clear work.

---

### Task 10 — Library source tab

**Why.** Library table exists, never wired.

**Test first** — `convex/extraction/sources/library.test.ts`:
- `list` with no query returns all library items for the user.
- `list` with query uses `search_library` searchIndex.
- Pagination honors `paginationOpts`.
- Only the calling user's items returned (auth guard).

**Implementation.**
- Create `convex/extraction/sources/library.ts` with `list = query({ args: { paginationOpts, query? }, returns: …, handler })`.
- Create `components/extraction/bucket/tabs/library-tab.tsx` wrapping `<SelectableList>` + `search-input.tsx`. Selected rows route through `fromLibraryItem` → `bucket.addMany`.

**Done when.** Users can browse + search library + multi-select + stage in bucket.

---

### Task 11 — Collections source tab

**Why.** Same story as library.

**Test first** — `convex/extraction/sources/collections.test.ts`:
- `listItems(collectionId)` joins `libraryItemCollections` → `libraryItems`.
- Auth guard: only owner can list.
- Pagination honors `paginationOpts`.

**Implementation.**
- Create `convex/extraction/sources/collections.ts` with `listItems` query (reuse `listCollections` for the picker).
- Create `components/extraction/bucket/tabs/collections-tab.tsx` — two-pane (collection picker left, items right via `<SelectableList>`). "Add all from collection" button for power users.

**Done when.** Users can pick a collection, see items, multi-select, stage.

---

### Task 12 — Rewire History + Zotero through `<SelectableList>`

**Why.** Consistency; delete duplicate select logic.

**Test first.** Update existing `history-selector.test.tsx` / `zotero-selector.test.tsx` (or add if missing) to assert:
- Select-all-visible works.
- Shift-range works.
- Selected rows produce valid `BucketItem`s via the respective normalizer.

**Implementation.**
- Rewrite `history-selector.tsx` + `zotero-selector.tsx` to mount `<SelectableList>`. Drop local checkbox state.
- Keep Zotero OAuth + pagination flows as-is (they're working).
- History tab now accumulates per-paper, not per-search-history-entry — this is the semantic shift. Map each search-result row through `fromSearchHistoryEntry` to get paper-grain bucket items.

**Done when.** Tab UIs look identical; selection state is the bucket, not local.

---

### Task 13 — Replace `manual-items.tsx` with `<BulkPdfUpload>` tab

**Why.** Old single-file-per-row form is dead.

**Implementation.**
- Mount `<BulkPdfUpload>` as the "Upload" tab content.
- Delete `components/extraction/manual-items.tsx` entirely (no callers after this task). Delete its test file if present.
- Remove `manualItems` and related references from `lib/store/extraction.ts`.

**Done when.** Upload tab is drag-and-drop only; old file gone.

---

### Task 14 — Rewrite `startExtraction` around `bucketItems`

**Why.** Mutation is the only boundary that still knows about three sources.

**Test first** — extend `convex/extraction/queries-e2e.test.ts`:
- Mixed-bucket submission (history + library + zotero + upload) produces a job with `sourceType: "mixed"` and `extractionJobSources` rows for each input.
- Server dedup: if two bucket items share a `bucketKey`, only one row is written.
- Cap enforcement: `bucketItems.length > getPaperLimit(…)` → explicit error.
- Server-side MIME not required here (handled at upload time in Task 2); assert we don't re-read storage metadata on submit (perf).

**Implementation.**
- Rewrite `startExtraction` in `convex/extraction/mutations/jobs.ts:40`:
  ```ts
  args: { name, bucketItems: v.array(bucketItemInputValidator), questions: v.array(questionValidator) }
  ```
- Derive `sourceType` from the set of distinct `bucketItems[].source` values (`"mixed"` when ≥ 2).
- Write `extractionJobSources` rows directly from the bucket (one row per item).
- Fetch `limit = await getPaperLimit(ctx, userId)`; throw if `bucketItems.length > limit`.
- Re-run `buildDedupeKey` server-side as defense; drop dupes silently (log internal audit).
- Delete `sourceHistoryEntries` / `sourceZoteroSelection` / `sourceManualItems` from args — no compat.

**Done when.** New e2e tests green; old `sourceType`-branched logic removed; `job-creator.tsx:92–175` rewired to pass `bucketItems`.

---

### Task 15 — Delete the draft-job legacy fields

**Why.** No dead code.

**Implementation.**
- In `lib/store/extraction.ts`: delete `selectedHistoryIds`, `zoteroSelection`, `manualItems`, `activeSourceTab` (replaced by URL-synced tab state), and all their setters. Migration: the persisted store key is incremented or reset — these stores are UX-local, losing them has no user-data cost in pre-release.
- Delete old normalization helpers that turned draft fields into mutation args (around `job-creator.tsx:92–175`).
- Delete `MAX_ZOTERO_ITEMS`, `MAX_MANUAL_ITEMS`, `MAX_HISTORY_ENTRIES` sub-caps if they exist — bucket cap is the only cap.
- Grep: `grep -rn "selectedHistoryIds\|zoteroSelection\|manualItems"` returns 0 hits outside this task's commit.

**Done when.** Typecheck + tests green; old fields grep-gone.

---

### Task 16 — Feature-flag rollout + cleanup

**Why.** Ship safely then remove the flag.

**Implementation.**
- Add `extraction.bucket_v2` to `featureFlags` seed. Minimum tier `"free"` once green.
- Gate the new `<JobCreator>` on the flag for one commit; flip; remove the flag in the following commit.
- Final grep for any `bucket_v2` string → 0 hits.

**Done when.** Bucket UX is the only UX.

---

## 7. Migration & destructiveness checklist

- [ ] `MAX_PAPERS_PER_JOB` deleted; no callers.
- [ ] `MAX_FILE_MB = 25` deleted.
- [ ] `selectedHistoryIds`, `zoteroSelection`, `manualItems` deleted from Zustand.
- [ ] Old `sourceType`-branched `startExtraction` args deleted.
- [ ] `manual-items.tsx` deleted.
- [ ] `TableView` local checkbox logic replaced by `<SelectableList>`.
- [ ] `buildDedupeKey` deduplicated into `lib/bucket/dedupe.ts` with a single re-export for Convex.
- [ ] Zero `knip` dead-code warnings after the series.

---

## 8. Files inventory

### New
- `lib/files/limits.ts`
- `lib/bucket/bucketItem.ts`
- `lib/bucket/dedupe.ts`
- `lib/store/bucket.ts`
- `convex/extraction/bucket/limits.ts`
- `convex/extraction/sources/library.ts`
- `convex/extraction/sources/collections.ts`
- `components/extraction/bucket/selectable-list.tsx`
- `components/extraction/bucket/bulk-pdf-upload.tsx`
- `components/extraction/bucket/bucket-drawer.tsx`
- `components/extraction/bucket/bucket-indicator.tsx`
- `components/extraction/bucket/tabs/library-tab.tsx`
- `components/extraction/bucket/tabs/collections-tab.tsx`
- Tests parallel to each of the above.

### Modified
- `convex/extraction/mutations/jobs.ts` — new `startExtraction` signature.
- `convex/extraction/uploads.ts` — add `recordUploadedFile`.
- `convex/extraction/dedupe.ts` — re-export from `lib/bucket/dedupe`.
- `lib/pdf/download.ts`, `lib/pdf/url-allowlist.ts` — import unified size constant.
- `components/extraction/source-selector.tsx` — new 5-tab layout.
- `components/extraction/history-selector.tsx`, `zotero-selector.tsx` — rewired through `<SelectableList>`.
- `components/extraction/job-creator.tsx` — reads bucket, passes `bucketItems`.
- `components/extraction/results-views/table-view.tsx` — uses `<SelectableList>`.
- `lib/store/extraction.ts` — drop legacy fields.
- `package.json` — add `react-dropzone`.
- `convex/extraction/queries-e2e.test.ts` — extend with mixed-bucket submit case.

### Deleted
- `convex/lib/queryBounds.ts` (if `MAX_PAPERS_PER_JOB` is its only export).
- `components/extraction/manual-items.tsx`.
- Any `MAX_ZOTERO_ITEMS` / `MAX_MANUAL_ITEMS` / `MAX_HISTORY_ENTRIES` sub-caps.
- Feature flag `extraction.bucket_v2` at final task.

---

## 9. Test strategy

All phases TDD: failing test → implementation → commit. Existing infra is sufficient; no new frameworks.

- **Pure logic** (normalizers, dedup, limits) — unit tests in Vitest.
- **Zustand** — unit tests that call the slice directly.
- **Convex queries/mutations** — `convex-test` + `seedFullJobGraph` + `setupAggregates` + `withIdentity`. Mirror `convex/extraction/queries-e2e.test.ts`.
- **Components** — `@testing-library/react` + `vi.mock("next-intl", …)`. Mirror `tests/components/grouped-answer-row.test.tsx`.
- **E2E** — extend `convex/extraction/queries-e2e.test.ts` with mixed-bucket submission.
- **Typecheck** — `pnpm typecheck` green after every task.
- **Regression proof** — the full existing test suite (current baseline after P3: 116 files / 1510 tests) passes at every step.

---

## 10. Open items (flag to user before starting)

None — user locked:
- 100 MB unified.
- 1000 cap, plan-aware via helper (all plans 1000 today).
- Tabs: History + Library + Collections + Zotero + Upload. No live-OpenAlex-search tab.
- Skill injections for shadcn/marketplace/chat-sdk/verification ignored.

Start at Task 1.
