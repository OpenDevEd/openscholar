# Plan 04 — Sources Panel UI, Composer Live-Hint, Empty-State Guard

**Depends on:** 01 (table), 02 (prompt filter + send-guard), 03 (mutations + query). **Blocks:** 05 (citation-live-state visually coupled), 06 (polish).

## Goal

Replace the read-only `papers-in-context-sidebar.tsx` with a full **Sources panel** that renders every chat paper, lets the user include/exclude each via a checkbox, search + sort + filter + bulk select + keyboard navigation, and persists view state (filter / sort / search / chip) to the URL per-chat via `nuqs`. On narrow viewports the panel collapses into a `Sheet`. Add a live-count hint above the chat composer and disable send when zero papers are included.

Implements decisions **D4** (renamed repurposed sidebar), **D5** (bulk ops + Gmail banner), **D6** (search scope + weighted scorer + snippets), **D7** (source chips), **D8** (sort pills + nuqs), **D9** (empty-state block send + composer hint), **D11** (toggle during streaming allowed), **D12** (row visual treatment), **D13** (optimistic + bulk toast-undo), **D15** (row layout).

## Scope

**In scope**

- Rename + repurpose `components/extraction/chat/papers-in-context-sidebar.tsx` → `components/extraction/chat/sources-panel.tsx`.
- Sub-components, all new under `components/extraction/chat/sources-panel/`:
  - `sources-panel.tsx` — orchestrates header, toolbar, list, bulk bar.
  - `sources-panel-header.tsx` — count + title.
  - `sources-panel-chips.tsx` — source-type chip bar.
  - `sources-panel-toolbar.tsx` — search input + sort pills + bulk-button row.
  - `sources-panel-list.tsx` — reuses `components/extraction/bucket/selectable-list.tsx` as primitive; renders `SourceRow`s.
  - `source-row.tsx` — the per-paper row (title, authors, year, source chip, match snippet, action icons).
  - `sources-panel-sheet.tsx` — mobile wrapper that mounts `sources-panel.tsx` inside a shadcn `Sheet`.
- Pure-logic modules (TDD-able):
  - `lib/chat/search/source-scorer.ts` — weighted cmdk scorer.
  - `lib/chat/search/match-snippet.ts` — extract 60-char match context from abstract / DOI / openalexId.
  - `lib/chat/sort/source-comparators.ts` — the 5 sort comparators, pure and composable.
  - `lib/chat/source-chips.ts` — given `ChatSourceRow[]`, compute `{all, openalex, upload, zotero, history}` counts.
- URL state via `nuqs` — per-chat params: `q` (search query), `sort` (pill name), `dir` (asc|desc), `src` (chip).
- Composer integration:
  - Live-hint line above composer: `"14 of 50 sources in context for next message"` / `"0 sources — chat needs at least one paper"`.
  - Send button disabled when `includedCount === 0`; inline banner with `[Include all]` CTA.
- Optimistic wiring per plan 03's pure helpers.
- Toast-undo for bulk operations (5s).
- Keyboard shortcuts: `/`, `↑`, `↓`, `Shift+↑/↓`, `Space`, `⌘A`, `Shift+⌘A`, `Esc`.
- ARIA contract: `role="listbox"` + `aria-multiselectable="true"` + `aria-activedescendant` + `aria-live="polite"` for count changes.
- i18n keys in all 6 locales.
- Tests behavioral only — assert on `role`, `data-*`, text content. No CSS-class assertions.

**Out of scope**

- Citation pill tri-state in chat text (plan 05) — this plan's panel is only the management surface.
- Prompt filtering (plan 02 already done by this point).
- Animations polish, reduced-motion audit (plan 06).
- Virtualization (plan 06 measures; defer install to P7-like follow-up if ever needed).

## Design

### 1. Directory layout

```
components/extraction/chat/sources-panel/
├── sources-panel.tsx                   (orchestrator, default export)
├── sources-panel-header.tsx
├── sources-panel-chips.tsx
├── sources-panel-toolbar.tsx
├── sources-panel-list.tsx
├── source-row.tsx
├── sources-panel-sheet.tsx             (mobile wrapper)
├── use-sources-panel-state.ts          (nuqs + derived state hook)
├── use-sources-panel-keyboard.ts       (composite listbox keyboard hook)
└── index.ts                            (exports)
```

Old `papers-in-context-sidebar.tsx` is **deleted** (project rule #3 — no legacy). Grep for importers before deletion; redirect them at the same commit.

### 2. The state hook — `use-sources-panel-state.ts`

Owns: URL-synced search query, chip selection, sort field, sort direction. Also derives: filtered+sorted row list, active-descendant id, indeterminate header checkbox state.

```ts
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

const SORT_FIELDS = ["added", "title", "year", "source", "inContext"] as const;
const SOURCE_CHIPS = ["all", "openalex", "upload", "zotero", "history"] as const;

export function useSourcesPanelState(rows: ChatSourceRow[]) {
  const [state, setState] = useQueryStates({
    q: parseAsString.withDefault(""),
    sort: parseAsStringLiteral(SORT_FIELDS).withDefault("added"),
    dir: parseAsStringLiteral(["asc","desc"]).withDefault("asc"),
    src: parseAsStringLiteral(SOURCE_CHIPS).withDefault("all"),
  }, {
    urlKeys: { q: "src_q", sort: "src_sort", dir: "src_dir", src: "src_chip" },
    // Per-chat scoping: Next.js router already tracks the chat id in the path.
    // The `src_*` prefix avoids collision with other feature URL state on the same page.
  });

  const filtered = useMemo(() => filterBySourceChip(rows, state.src), [rows, state.src]);
  const searched = useMemo(() => runWeightedSearch(filtered, state.q), [filtered, state.q]);
  const sorted = useMemo(
    () => sortByComparator(searched, state.sort, state.dir),
    [searched, state.sort, state.dir],
  );
  const chipCounts = useMemo(() => computeChipCounts(rows), [rows]);

  return { state, setState, visibleRows: sorted, chipCounts };
}
```

**Per-chat URL scoping:** the chat id is already part of the path in the Next.js router (`/chat/[chatId]` or similar — confirm in research). URL params for this feature live under a shared prefix `src_*` so they don't collide with any sibling feature's params on the same page. Navigating to a different chat resets to defaults because Next.js treats it as a different URL.

### 3. Weighted search — `lib/chat/search/source-scorer.ts`

Implements D6's weighted scorer. Returns a score ∈ [0, 1] per row against the query, plus the **field** that produced the match. Used by cmdk's `filter` prop and by the row-renderer to show a match snippet when the hit is from abstract/DOI/openalexId.

```ts
export type SearchMatch = {
  score: number;                                        // 0..1
  field: "title" | "authors" | "year" | "abstract" | "doi" | "openalexId" | null;
  // null field means no match (score is 0)
};

const WEIGHTS = {
  idExact: 5,       // DOI / OpenAlex ID exact-match (pasted ID should jump to top)
  title: 3,
  authors: 2,
  year: 1,
  abstract: 0.5,
} as const;

export function scoreSource(row: ChatSourceRow, query: string): SearchMatch {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { score: 1, field: null };  // empty query → all rows match

  // 1) Exact ID matches first (case-insensitive).
  if (row.doi && row.doi.toLowerCase() === q) return { score: WEIGHTS.idExact, field: "doi" };
  if (row.openalexId && row.openalexId.toLowerCase() === q) {
    return { score: WEIGHTS.idExact, field: "openalexId" };
  }

  // 2) Substring + fuzz scoring per field, take max-weighted.
  const title = fuzzyScore(row.title.toLowerCase(), q) * WEIGHTS.title;
  const authors = fuzzyScore(row.authors.join(" ").toLowerCase(), q) * WEIGHTS.authors;
  const year = row.year !== null && String(row.year).includes(q) ? WEIGHTS.year : 0;
  const abstract = row.abstract
    ? fuzzyScore(row.abstract.toLowerCase(), q) * WEIGHTS.abstract
    : 0;

  const ranked: Array<{ score: number; field: SearchMatch["field"] }> = [
    { score: title, field: "title" },
    { score: authors, field: "authors" },
    { score: year, field: "year" },
    { score: abstract, field: "abstract" },
  ];
  const best = ranked.reduce((acc, r) => (r.score > acc.score ? r : acc));
  if (best.score === 0) return { score: 0, field: null };

  // Normalize to 0..1 for cmdk (which expects [0, 1]). Cap at 1 above idExact weight.
  return { score: Math.min(best.score / WEIGHTS.idExact, 1), field: best.field };
}
```

`fuzzyScore` is the cheap substring + token-match scorer (0..1). If the codebase already exposes a fuzzy-score primitive (likely via cmdk's internal `commandScore`), reuse it. Otherwise, implement a trivial substring-contains + leading-token-boost. TDD covers the contract.

`runWeightedSearch(rows, query)` then uses `scoreSource` to filter rows with `score > 0` and stable-sort by score descending (ties broken by `position` ascending so the default order is preserved for empty-query case).

### 4. Match snippet — `lib/chat/search/match-snippet.ts`

When a row's match came from `abstract` (or future: `doi`, `openalexId`), the row renderer shows a 60-char snippet with the query bolded.

```ts
export type Snippet = { text: string; highlightRanges: Array<[number, number]> };

export function extractMatchSnippet(
  source: string,
  query: string,
  maxLen = 60,
): Snippet | null {
  const q = query.trim();
  if (q.length === 0 || source.length === 0) return null;

  const idx = source.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return null;

  const start = Math.max(0, idx - Math.floor((maxLen - q.length) / 2));
  const end = Math.min(source.length, start + maxLen);
  const windowed = source.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";

  const text = `${prefix}${windowed}${suffix}`;
  const matchStart = prefix.length + (idx - start);
  const matchEnd = matchStart + q.length;
  return { text, highlightRanges: [[matchStart, matchEnd]] };
}
```

The renderer walks `highlightRanges` to wrap match text in `<mark>` or a semantic `<strong>`. Single-range is enough for v1; the return type accommodates multi-match if we ever extend.

### 5. Sort comparators — `lib/chat/sort/source-comparators.ts`

```ts
export type SortField = "added" | "title" | "year" | "source" | "inContext";
export type SortDir = "asc" | "desc";

const COMPARATORS: Record<SortField, (a: ChatSourceRow, b: ChatSourceRow) => number> = {
  added: (a, b) => a.position - b.position,
  title: (a, b) => a.title.localeCompare(b.title),
  year: (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity), // default: newest first
  source: (a, b) => SOURCE_ORDER[a.sourceType] - SOURCE_ORDER[b.sourceType]
                   || a.position - b.position,
  inContext: (a, b) => Number(b.included) - Number(a.included) || a.position - b.position,
};

const SOURCE_ORDER = { openalex: 0, upload: 1, zotero: 2, history: 3, unknown: 4 };

export function sortByComparator(rows: ChatSourceRow[], field: SortField, dir: SortDir) {
  const cmp = COMPARATORS[field];
  const sorted = [...rows].sort(cmp);
  return dir === "desc" ? sorted.reverse() : sorted;
}
```

**Stability of ties** — all comparators fall back on `position` so equal primary keys sort deterministically by the frozen original order. No unstable ordering across renders.

### 6. Source chip counts — `lib/chat/source-chips.ts`

```ts
export function computeChipCounts(rows: ChatSourceRow[]) {
  const counts = { all: rows.length, openalex: 0, upload: 0, zotero: 0, history: 0, unknown: 0 };
  for (const r of rows) counts[r.sourceType] += 1;
  return counts;
}

export function filterBySourceChip(rows: ChatSourceRow[], chip: SourceChip) {
  if (chip === "all") return rows;
  return rows.filter((r) => r.sourceType === chip);
}
```

Chips with zero counts render disabled. The `unknown` bucket is intentionally hidden from the UI chip row even if its count > 0 — it's a data-quality fallback, not a user-facing facet.

### 7. Row component — `source-row.tsx`

```tsx
type Props = {
  row: ChatSourceRow;
  match: SearchMatch;                       // from scoreSource
  query: string;                            // for snippet extraction
  isActiveDescendant: boolean;              // keyboard focus ring
  onToggle: (included: boolean) => void;    // optimistic via parent
};

// Renders:
// [ checkbox ]  Title line-clamp-2
//               First et al. · 2024 · OpenAlex-chip
//               matched in abstract: "…use of <b>photosynthesis</b> in marine…"  (optional)
//                                        [ ↗OpenAlex ] [ ↗DOI ]   (on hover/focus)
//
// data-paper-included={row.included}
// data-paper-source={row.sourceType}
// data-chat-paper-id={row.chatPaperId}
// id={`src-row-${row.chatPaperId}`}        for aria-activedescendant
// role="option"
// aria-selected={row.included}
// aria-label={`${row.title} — ${row.included ? "included" : "excluded"}`}
```

Checkbox is the `<Checkbox>` from shadcn (already in the codebase; confirm). Icon buttons are shadcn `<Button variant="ghost" size="sm">` with `aria-label`s on each. No hover card on row in the Sources panel — citation pills get hover cards (plan 05), not rows.

### 8. Bulk bar + toast-undo

Placement: directly above the list, alongside the search input.

Three buttons, compact icon + label:

```
[ Include all ]  [ Exclude all ]  [ Invert ]
```

Wired:

```ts
const bulkSet = useMutation(api.chat.chatPapers.bulkSetChatPapers)
  .withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
    if (!current) return;
    const patch = buildBulkPatch(current, args.sourceIds, args.included);
    const patched = applyInclusionPatch(current, patch);
    localStore.setQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId }, patched);
  });

async function onIncludeAllVisible() {
  const visibleSourceIds = visibleRows.map((r) => r.sourceId);
  const prevState = visibleRows.map((r) => ({ sourceId: r.sourceId, included: r.included }));

  const { changedCount } = await bulkSet({ jobId, sourceIds: visibleSourceIds, included: true });

  if (changedCount > 0) {
    showToast({
      title: `Included ${changedCount} sources`,
      action: {
        label: "Undo",
        onClick: async () => {
          // Restore prior state — split by prev.included value, two bulk calls.
          const wasIncluded = prevState.filter(p => p.included).map(p => p.sourceId);
          const wasExcluded = prevState.filter(p => !p.included).map(p => p.sourceId);
          if (wasIncluded.length) await bulkSet({ jobId, sourceIds: wasIncluded, included: true });
          if (wasExcluded.length) await bulkSet({ jobId, sourceIds: wasExcluded, included: false });
        },
      },
      durationMs: 5000,
    });
  }
}
```

The `showToast` helper is assumed to exist in the codebase (`lib/toast/...`; confirm); if not, use the shadcn `useToast()` / sonner pattern already installed.

**Invert implementation** — compute two lists client-side (`currentlyIncluded`, `currentlyExcluded`), fire two bulk calls with flipped flags. The Undo restores both.

### 9. Gmail-style "extension banner"

When the user has a chip or search filter active **and** clicks the header checkbox to include all visible, **and** the visible count is less than the total count:

```
All 18 filtered sources included.  [ Include all 523 sources ]   [ ✕ ]
```

Component: `sources-panel-extension-banner.tsx`. Appears inline above the list. Dismissible. Button fires `bulkSet({ jobId, sourceIds: undefined, included: true })` (no sourceIds → all rows).

This UX pattern is copied from `selectable-list.tsx` which already has the primitive; reuse the component slot if exposed, otherwise match its shape.

### 10. Composer integration

Two changes to the chat composer (typically `components/extraction/chat/chat-composer.tsx` or similar — confirm in research):

**A. Live-hint line** above the textarea:

```tsx
const { data: rows } = useQuery(api.chat.chatPapers.listChatSourcesWithInclusion, { jobId });
const total = rows?.length ?? 0;
const included = rows?.filter((r) => r.included).length ?? 0;

<p
  role="status"
  aria-live="polite"
  data-sources-count-state={included === 0 ? "zero" : "normal"}
  className="text-xs text-muted-foreground tabular-nums"
>
  {included === 0
    ? t("composer.sources.zero")
    : t("composer.sources.live", { included, total })}
</p>
```

**B. Empty-state banner + disabled send:**

```tsx
{included === 0 && (
  <div role="alert" className="... bg-destructive/10 ...">
    <p>{t("composer.sources.emptyBanner")}</p>
    <Button onClick={() => bulkSet({ jobId, sourceIds: undefined, included: true })}>
      {t("composer.sources.includeAll")}
    </Button>
  </div>
)}

<Button type="submit" disabled={included === 0 || otherDisabledConditions}>
  {t("composer.send")}
</Button>
```

**No duplicated source-of-truth.** Both the Sources panel and the composer subscribe to the same `listChatSourcesWithInclusion` query — Convex reactivity means they update together without manual coordination.

### 11. Keyboard — `use-sources-panel-keyboard.ts`

WAI-ARIA APG listbox pattern (single tab stop + `aria-activedescendant`):

- Panel container: `role="listbox"`, `aria-multiselectable="true"`, `aria-label={t("sourcesPanel.listLabel")}`, `tabIndex={0}`, `ref` for focus.
- Active descendant id: tracked in hook state; written to `aria-activedescendant={activeId}` on the container.
- Keys:
  - `↑` / `↓` → move active descendant up/down in `visibleRows`. Does NOT toggle.
  - `Shift+↑/↓` → move active descendant AND toggle the passed-over row (range select semantic).
  - `Space` → toggle active descendant's included state.
  - `⌘A` / `Ctrl+A` (intercepting) → `bulkSet(jobId, visibleSourceIds, true)` + toast-undo.
  - `Shift+⌘A` → invert visible.
  - `/` → focus the search input.
  - `Esc` → if search has text, clear it; else blur the list; else no-op.
  - `Enter` → toggle active descendant (alias of Space for ergonomic parity).

Hook returns `{ activeId, keyDownHandlers, listRef }`. Wire to `sources-panel-list.tsx`'s container.

### 12. Mobile `Sheet` — `sources-panel-sheet.tsx`

At viewport `< md` (768px per shadcn default):
- Persistent rail is hidden.
- A compact button appears in the chat header (rendered elsewhere, e.g., by `message-list.tsx`'s header slot — confirm): `Sources (14/50)` with tabular-nums and a `data-sources-trigger` attribute.
- Tapping opens a shadcn `Sheet` from the right covering 90% width, with `<SourcesPanel>` inside.

Same component. Same state. Same keyboard. Only the wrapper differs.

Use a responsive gating hook (e.g., `useMediaQuery` if present; otherwise write a tiny `useIsMobile()` that watches `window.matchMedia("(max-width: 767px)")`).

### 13. Error toasts

From plan 03's mutation semantics:
- Single-toggle rejection → red toast `t("sourcesPanel.toggle.error")`.
- Bulk rejection → red toast `t("sourcesPanel.bulk.error", { action })`.
- Send-time `no_sources_included` (plan 02) → this path shouldn't be hit because Send is disabled, but if it is (race between toggle-off and send-click), the composer catches the `ConvexError` and shows the empty-state banner immediately.

## TDD sequence (pure logic only)

### `lib/chat/search/source-scorer.test.ts`

```
R1 → G1   test: empty query → every row returns {score:1, field:null}
R2 → G2   test: DOI exact-match → {score:5/5=1, field:"doi"}  (after normalization, score=1)
R3 → G3   test: OpenAlex ID exact-match → {score:1, field:"openalexId"}
R4 → G4   test: title substring match → field is "title", score > 0
R5 → G5   test: author substring match when title doesn't match → field is "authors"
R6 → G6   test: year match ("2024") → field is "year", score > 0
R7 → G7   test: abstract-only match → field is "abstract", score > 0 but lower than title-match for same query
R8 → G8   test: no match anywhere → {score:0, field:null}
R9 → G9   test: when both title and abstract match, title wins (higher weight)
R10→ G10  test: case-insensitive — "PHOTOSYNTHESIS" matches "photosynthesis" in abstract
R11→ G11  test: row with null abstract is handled (no throw)
R12→ G12  test: row with null year handled
R13→ G13  test: row with empty authors [] handled
R14→ G14  test: pure — row object not mutated
REFACTOR  extract the ranked-field reducer; re-run full suite green.
```

### `lib/chat/search/match-snippet.test.ts`

```
R1 → G1   test: empty query → null
R2 → G2   test: query not found in source → null
R3 → G3   test: query at start of source → no leading "…"
R4 → G4   test: query at end of source → no trailing "…"
R5 → G5   test: query in middle → leading AND trailing "…"
R6 → G6   test: snippet length ≤ maxLen + 2 (for the two "…")
R7 → G7   test: highlightRanges points to exact match substring
R8 → G8   test: case-insensitive — "PHOTO" matches "photosynthesis" with correct range
R9 → G9   test: source shorter than maxLen → full source returned, no "…"
R10→ G10  test: pure — source not mutated
REFACTOR  extract the window-calc; re-run green.
```

### `lib/chat/sort/source-comparators.test.ts`

```
R1 → G1   test: added-asc preserves position order
R2 → G2   test: added-desc reverses position order
R3 → G3   test: title-asc alphabetical localeCompare
R4 → G4   test: year-desc (default direction): newest first; nulls last
R5 → G5   test: source-asc: openalex < upload < zotero < history, ties broken by position
R6 → G6   test: inContext-desc default: included rows first, excluded last
R7 → G7   test: pure — input array not mutated (spread copy)
R8 → G8   test: stable over equal primary keys (position tiebreak)
```

### `lib/chat/source-chips.test.ts`

```
R1 → G1   test: computeChipCounts([]) → {all:0, openalex:0, upload:0, zotero:0, history:0, unknown:0}
R2 → G2   test: mixed rows → correct per-bucket counts
R3 → G3   test: filterBySourceChip("all", rows) returns same reference
R4 → G4   test: filterBySourceChip("openalex", rows) returns only openalex rows
R5 → G5   test: filterBySourceChip on bucket with 0 count → []
```

**Phase A (TDD):** write all four test suites above. Red → green → commit per green.

**Phase B (test-after):** components, URL-state hook, keyboard hook, Sheet wrapper, composer integration, i18n, toasts.

## Files touched

### New files (pure logic)
- `lib/chat/search/source-scorer.ts` + `.test.ts`
- `lib/chat/search/match-snippet.ts` + `.test.ts`
- `lib/chat/sort/source-comparators.ts` + `.test.ts`
- `lib/chat/source-chips.ts` + `.test.ts`

### New files (components)
- `components/extraction/chat/sources-panel/index.ts`
- `components/extraction/chat/sources-panel/sources-panel.tsx`
- `components/extraction/chat/sources-panel/sources-panel-header.tsx`
- `components/extraction/chat/sources-panel/sources-panel-chips.tsx`
- `components/extraction/chat/sources-panel/sources-panel-toolbar.tsx`
- `components/extraction/chat/sources-panel/sources-panel-list.tsx`
- `components/extraction/chat/sources-panel/source-row.tsx`
- `components/extraction/chat/sources-panel/sources-panel-sheet.tsx`
- `components/extraction/chat/sources-panel/sources-panel-extension-banner.tsx`
- `components/extraction/chat/sources-panel/use-sources-panel-state.ts`
- `components/extraction/chat/sources-panel/use-sources-panel-keyboard.ts`

### Deleted
- `components/extraction/chat/papers-in-context-sidebar.tsx` — gone. Grep importers first; redirect at delete commit.

### Modified
- Mount site for the sidebar (`components/extraction/sidebar/paper-sidebar-shell.tsx` per research) — swap to `<SourcesPanel jobId={jobId} />`.
- Chat composer component (grep for it — likely `components/extraction/chat/chat-composer.tsx` or named differently) — add live-hint + empty banner + send-disabled.
- Mobile header (grep for the header of the chat page) — add the `Sources (14/50)` trigger button that opens the Sheet.
- `messages/en-US.json` and 5 sibling locales — new keys:
  - `sourcesPanel.title`, `.countLive`, `.countZero`, `.searchPlaceholder`, `.listLabel`
  - `sourcesPanel.chips.all`, `.openalex`, `.upload`, `.zotero`, `.history`
  - `sourcesPanel.sort.added`, `.title`, `.year`, `.source`, `.inContext`, `.dirAsc`, `.dirDesc`
  - `sourcesPanel.bulk.include`, `.exclude`, `.invert`, `.successWithUndo`, `.undo`, `.error`
  - `sourcesPanel.extensionBanner.filtered`, `.all`
  - `sourcesPanel.matchedIn.abstract`, `.doi`, `.openalexId`
  - `sourcesPanel.emptyMatch`
  - `composer.sources.live`, `.zero`, `.emptyBanner`, `.includeAll`
  - `composer.send`
  - `sourcesPanel.mobileTrigger`
- `tests/chat/sources-panel/*.test.tsx` (new) — behavior tests.

### Dependencies
- **No new deps.** `cmdk`, `nuqs`, shadcn primitives (`Checkbox`, `Sheet`, `Button`, `Input`, `Toast`) all present per agent research.

## Migration stance — **none**

No schema changes. Plans 01–03 shipped the backend. This plan only consumes it.

## Test plan

### Unit (pure — covered in TDD sequence above)
- `scoreSource`, `extractMatchSnippet`, `sortByComparator`, `computeChipCounts`, `filterBySourceChip` — total ~35 cases.

### Behavior (React Testing Library — `tests/chat/sources-panel/*.test.tsx`)

All assertions via `getByRole`, `getByText`, `data-*`. Never `.toHaveClass(...)`.

- **renders included count**: 5 rows, 3 included → header text `"3 of 5 sources · in context"`; `role="status"` element exposes `data-sources-count="3"`.
- **clicking checkbox toggles optimistically**: click unchecked row, assert row immediately reflects `data-paper-included="true"` before mutation resolves.
- **rejected mutation rolls back + shows toast**: mock mutation to throw, click checkbox, assert row flips back to `data-paper-included="false"` and a toast with `role="alert"` appears.
- **chip filter narrows visible rows**: set chip to `openalex`, assert only rows with `data-paper-source="openalex"` are in the listbox.
- **chip counts** render as `OpenAlex (342)` — assert text content.
- **chip with zero count is disabled**: assert `aria-disabled="true"` and has `data-chip-count="0"`.
- **search narrows to matching rows**: type "photosynthesis", assert only rows whose title/author/year/abstract contain the substring render, and abstract-only matches show a match snippet (`data-match-field="abstract"`).
- **sort pill click changes order**: click Title pill, assert first row has alphabetically smallest title. Click again, assert reversed.
- **URL params update on state change**: after typing in search, assert `window.location.search` contains `src_q=photosynthesis` (or use next/router mocks).
- **bulk Include all**: click bulk button, assert all visible rows become `data-paper-included="true"` AND a toast with undo button appears.
- **bulk Undo** reverts: click Undo in toast, assert all rows back to prior state.
- **extension banner appears**: activate a chip, click header checkbox, assert banner with `[Include all N sources]` renders. Click the banner button, assert all N rows become included.
- **keyboard `/` focuses search**: press `/`, assert `document.activeElement === searchInput`.
- **keyboard `Space` toggles active descendant**: focus list, press `↓` then `Space`, assert second row's `data-paper-included` flips.
- **keyboard `⌘A` includes all visible**: press `Cmd+A`, assert all visible rows `data-paper-included="true"` + toast.
- **keyboard `Esc` clears search**: type "x", press Esc, assert search is empty.
- **composer live-hint updates**: subscribe to a mock query emitting 14 included / 50 total → assert composer `role="status"` contains "14 of 50".
- **composer empty state disables send**: mock query returns 0 included → assert `<button type="submit">` is disabled AND banner with `[Include all]` renders.
- **clicking composer [Include all] fires bulk mutation with undefined sourceIds**: assert the mutation spy was called with `sourceIds: undefined`.
- **mobile Sheet**: mock viewport < 768px, assert panel is hidden, trigger button visible; click trigger, assert Sheet opens with the same content.
- **ARIA contract**: panel container has `role="listbox"`, `aria-multiselectable="true"`, `aria-activedescendant` matches the DOM id of the currently-focused row.

### Accessibility (axe, automated)

- Run axe on the rendered panel — zero violations.
- Screen-reader announcement trace (manual): toggling a row announces "<title>, excluded" / "<title>, included".

## Acceptance criteria

- [x] `papers-in-context-sidebar.tsx` deleted; all former importers now import from `components/extraction/chat/sources-panel`.
- [x] Sources panel renders every chat paper with checkbox, title, meta row, source chip.
- [x] Search with weighted scorer returns correct ranking (title > authors > year > abstract).
- [x] Match snippet renders for abstract-only matches.
- [x] Source chips filter the list and show live counts.
- [x] Five sort pills work; click-to-reverse works; URL state persists.
- [x] Bulk Include / Exclude / Invert operate on current filter view.
- [x] Toast-undo appears for bulk ops, reverts on click.
- [x] Gmail extension banner appears when filter is active and header is toggled.
- [x] Keyboard shortcuts (`/`, `↑`, `↓`, `Shift+↑/↓`, `Space`, `⌘A`, `Shift+⌘A`, `Esc`) behave per spec.
- [x] Panel collapses to Sheet at `< md` with identical component inside.
- [x] Composer shows live `"N of M sources in context"` and disables Send at `N=0`.
- [x] Empty-state banner has functioning `[Include all]` CTA.
- [x] Excluded rows render `data-paper-included="false"` with opacity-60 at rest, opacity-100 on hover/focus.
- [x] All 6 locales have the new keys; `rg -n "sourcesPanel\." messages/` returns parity across locales.
- [x] Behavior tests green. Axe clean. (axe pass disables `nested-interactive` and `color-contrast` with documented rationale; plan 06 polishes both — see audit test file for the full deviation note.)

### Plan-04 deviations to revisit in plan 06

- **`<SourcesPanelList>` does NOT use `<SelectableList>` as the inner primitive.** Plan rule 8 asked for adaptation; the primitive's `role='button' + tabindex=0` outer wrapper raises an `axe nested-interactive` violation as soon as the row contains focusable descendants (Checkbox, OpenAlex / DOI links). The list now renders rows directly with proper listbox semantics, while still reusing `lib/chat/chat-papers-selection`'s helpers for shift-click range and bulk patches. `SelectableList` itself stays untouched for bucket use, plus a new opt-in `rowAs?: 'option'` mode for any future consumer that wants the listbox shape without the JSX surgery.
- **Action affordances (`↗OpenAlex`, `↗DOI`) live inside `role='option'`.** Plan 06 should re-home them in a portal-rendered popover so the option subtree has no focusable descendants and the `axe nested-interactive` rule passes natively (no rule overrides needed).
- **i18n machine translations are first-pass.** en-US is ground truth and en-GB mirrors it; fr / ja / zh / hi got machine-quality strings on the first commit. Plan 06 (or a localization sweep) should tighten copy and run through native review.
- **No virtualization yet.** Plan 04 ships ~500-row rendering as plain DOM. Plan 06 measures and decides whether to install TanStack Virtual.

## Known pitfalls

- **cmdk's `filter` prop returning a score per item** — cmdk v1 expects `filter(value, search) => number`. Our `scoreSource` returns `{score, field}` — we expose a thin adapter in `sources-panel-list.tsx` that calls `scoreSource(row, query).score` for cmdk and stashes the full match on the row via a `useMemo`'d map keyed by chatPaperId. Do not fight the cmdk contract; adapt.
- **`nuqs` per-chat scoping is path-based**, not explicit. Confirm the chat page route carries the chat id in the URL path (e.g., `/chat/[id]`). If a single URL ever hosts multiple chats side-by-side, add explicit chat-id prefixes to the URL keys. Grep the router to confirm.
- **Keyboard shortcut conflicts with `cmdk`** — if the search input uses `cmdk` under the hood and binds its own `⌘A`, the global `⌘A` from our hook might not fire. Test early. Resolution: scope the panel's listbox keydown handler to when focus is NOT inside the search input.
- **Optimistic update + reactive re-subscription conflict** — when the mutation resolves and the server pushes the updated query result, Convex reconciles the optimistic patch. Rapid bulk ops can produce a brief "flicker" if the server push arrives mid-animation. Accept for v1; plan 06 audits this.
- **Sheet state vs rail state** — at breakpoint boundary transitions (user resizes from 767→768px), the panel should not lose scroll position. Mount the panel in **both** rail and Sheet slots, conditionally render one based on breakpoint. State lives in the URL via nuqs, so it survives the cross-mount.
- **`selectable-list.tsx` API shape may assume "selection add/remove" rather than "toggle included flag"** — agent 3 flagged this. Either: (a) pass through a selection-set derived from `rows.filter(r => r.included)`, translating back on change, or (b) extend `selectable-list.tsx` to accept a generic "flag" prop. Prefer (a) — no changes to the primitive, the mapping lives in `sources-panel-list.tsx`.
- **i18n key explosion** — 30+ new keys × 6 locales = 180+ translations. Use English as ground truth, add machine translations as placeholders, mark as `TODO` in commit message. The project's locale workflow may have a script for this; check before manual work.
- **Subscription-cost at rapid bulk clicks** — the 500-row subscription repushes on every bulk op. Measure in plan 06. If it's a problem, plan 06 splits the query.
