# P8 — Bucket Sidebar Redesign (Desktop Motion Sidebar + Mobile Vaul)

**Intended reader:** an autonomous coding agent picking this up cold. You have
not seen the conversation. Everything you need is linked below.

> **Testing rules (read before writing any test in this plan):**
> This plan's original draft prescribed assertions on Tailwind class strings
> (`text-destructive`, `line-clamp-2`, `h-10 w-10`, etc.). **That was wrong and
> has been corrected.** When implementing any "Test first" block below:
>
> 1. **Never assert on CSS class strings or inline style round-trips.**
>    `.className.toMatch(/.../)`, `toHaveClass("...")`, and
>    `style.backgroundColor === "var(--x)"` tests are source-round-trip noise
>    that break on cosmetic refactors without verifying behavior.
> 2. **Assert on observable behavior** — text via `getByText` /
>    `toHaveTextContent`, role/ARIA via `getByRole`, semantic state via
>    `data-*` attributes (e.g. `data-capacity-state`, `data-color-role`,
>    `data-source`), and store state via Zustand `getState()`.
> 3. **Visual concerns (layout clamping, sizing, color tint) belong in
>    Playwright / visual-regression tests**, not JSDOM unit tests.
> 4. **If a test needs to verify state that currently only surfaces via a
>    class, fix the source first** — add a `data-*` or ARIA attribute
>    that exposes the state, then test against that.
>
> See `CLAUDE.md` and `AGENTS.md` (Testing philosophy section) for the
> project-wide rule.

> **Revision note (verification pass):** After the initial draft, the bucket
> system accumulated several P7/T1–T10 commits (count-chip, paper-pull caps,
> `updatePaperCount` on the store). The plan's approach survives those changes
> intact, but three references were corrected in this pass:
> 1. **`createSidebarStore` factory exists** at `lib/store.ts:1162-1182` — §5a
>    now uses the factory instead of a bespoke store definition. Saves ~25
>    lines and keeps parity with the third existing consumer,
>    `useLibrarySidebarStore` (line 1197).
> 2. **`lib/bucket/source-labels.ts` exports `BUCKET_SOURCE_LABELS`** (not
>    `SOURCE_LABELS`); the "collection" source maps to `"Collections"`
>    (plural). `bucket-drawer.tsx` carries a stale local duplicate that
>    uses `"Collection"` (singular) — Task 1 deletes the local copy and
>    imports from the lib.
> 3. **`bucket-drawer.tsx` is now 190 lines** (was 133). Line references
>    below have been refreshed. The AlertDialog block is at lines 150-181,
>    the row markup at 106-143, warning row at 83-96.
> No other plan assumptions were invalidated.

---

## 1. Mission

Replace the bucket's current Vaul-based right-edge modal drawer with a
persistent, collapsible motion sidebar on desktop — mirroring the two existing
sidebars in the codebase (`FilterSidebar` on search results, `ExtractionCitationSidebar`
on extraction results). The drawer's three pain points — **right-edge
overflow on narrow viewports, cramped item rows, and zero spatial feedback when
items are added** — all dissolve when the bucket becomes part of layout flow
instead of a modal overlay.

Scope:

1. **New `BucketSidebar`** — `components/extraction/bucket/bucket-sidebar.tsx`,
   a fourth instance of the established Framer Motion sidebar pattern
   (filter, library, citation are the existing three). Collapsed
   sliver (48 px) with Package icon + live count badge; expanded panel (360 px)
   with header (title, capacity, collapse button), body (flat item list with
   source chips + colored dot per source, 2-line title clamp, 44 × 44 remove
   target), footer (Clear all → Sonner undo toast). Persisted collapse state
   via **`createSidebarStore('openalex-bucket-sidebar')`** factory (already
   shipped, `lib/store.ts:1162-1182`), `sidebarSpring` animation, keyboard
   toggle **Ctrl/Cmd+Shift+B**.
2. **Job-creator restructure** — `components/extraction/job-creator.tsx`
   wraps its wizard chrome in a `relative` container with right padding equal
   to the current sidebar width; mounts `<BucketSidebar>` absolutely positioned
   at `right-0 top-0 bottom-0` on desktop. Keep the sidebar visible across all
   three wizard steps (auto-collapse default on Step 3 — optional stretch).
3. **Mobile keeps existing flow.** `BucketIndicator` (header) +
   `BucketDrawer` (Vaul, `direction="right"`) only render under `md`.
   Desktop hides both and exposes the new sidebar. `components/ui/drawer.tsx`
   stays — `components/ui/cascader.tsx:405-418` is a second consumer that
   cannot lose Vaul.
4. **Count bounce micro-animation.** Inside the collapsed sliver's count
   badge and the expanded header's count text: `AnimatePresence mode="wait"`
   keyed on `readyCount` (exit-up / enter-from-below), and a spring scale
   pulse (`scale: [1, 1.15, 1]`) on the container when the count changes. No
   flight animation, no `LayoutGroup`, no portals.
5. **Clear-all → Sonner undo toast.** Delete the `<AlertDialog>` in the
   current drawer. Extend `lib/store/bucket.ts` with `restoreFromSnapshot(snap)`
   and an `AllClearSnapshot` type. Add `bucketCleared(snapshot, restore)` to
   `lib/toast/bucket.ts` that calls `toast(...)` with an `action: { label:
   "Undo", onClick }` and a 5-second duration.
6. **Source chips** — replace the generic outline Badge with a compact chip:
   `h-5 px-1.5 rounded-full` with a 6 × 6 `rounded-full` leading dot using
   `var(--chart-N)` per source. Mapping lives in a new
   `lib/bucket/source-colors.ts` (hoisted from `lib/bucket/source-labels.ts`
   or merged — see §5f). History=chart-1, Library=chart-2,
   Collection=chart-3, Zotero=chart-4, Upload=chart-5.
7. **Capacity signalling** — drop the two amber/destructive sibling
   `<Badge>`s in `BucketIndicator`. Use text-tint only
   (`text-amber-600 dark:text-amber-400` at `nearCap`,
   `text-destructive` at `atCap`). The collapsed sliver's count inherits
   the same tint. No separate banner on the expanded sidebar header; the
   tinted count + a single inline warning row below the header (reused
   from current drawer lines 70-79) is sufficient.
8. **Row layout fix** — 2-line title clamp (`line-clamp-2`) instead of
   `truncate`; drop the `inline-flex` status wrapper (known Safari
   `min-w-0` interaction); bump remove button to `h-10 w-10` touch
   target; `items-center` (not `items-start`) for balanced rows.

Explicitly **out of scope**:

- Flight / shared-element / `layoutId` animations when an item is staged
  (user ruled out in discuss phase).
- Grouping by source (user: flat list with chips).
- Kebab menu / Export BibTeX / Copy DOIs (user: start with Clear-all only).
- `TwoColumnLayout` adoption — filter-sidebar uses `absolute right-0 top-0
  bottom-0` inside a `relative` parent (see §4a). Match that pattern, don't
  refactor job-creator's entire layout.
- Dark-mode chart token variants. `--chart-1` through `--chart-5` are only
  defined in light mode (`globals.css:68-73`); in dark mode they inherit
  the light OKLCh values, which remain visible thanks to their chroma.
  If post-ship visual review flags contrast, that's a follow-up.
- List virtualization in the sidebar body. Deferred to P7's follow-up
  ticket (see P6 §10).
- Zotero "select all across pages" UX changes (P6 Task 5 shipped the
  functionality; sidebar just consumes the same `addMany` output).

Explicitly **deferred**:

- Auto-collapse the sidebar when the user advances to Step 3 (question
  builder). Marked as optional stretch inside Task 4.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY.** Every primitive this plan needs already exists. The audit below
   lists every reuse target:
   - `sidebarSpring`, `hoverSpring`: `lib/ui/sidebar-motion.ts` — copy, don't
     reinvent. Stiffness 300 / damping 25 / mass 0.8 for panel; 400/25/0.6
     for button hover.
   - Zustand + persist pattern: **use `createSidebarStore(persistKey)` and
     `createSidebarDimensions(expanded, collapsed)` factories** at
     `lib/store.ts:1162-1194`. `useLibrarySidebarStore` (line 1197) is the
     third consumer; ours is the fourth. The factory omits `expand()` — not
     a blocker, call `setCollapsed(false)` directly if programmatic expansion
     is ever needed (it isn't, in this plan's scope).
   - `useIsMobile` + breakpoint: `hooks/use-mobile.tsx`. `MOBILE_BREAKPOINT =
     768`.
   - `motion.aside` pattern: `components/shared/filter-sidebar.tsx:99-109`
     (translateX via `animate`, fixed `width` via style, CSS `transition`
     on parent width). Match verbatim.
   - Sonner toast primitive: `components/ui/sonner.tsx` wrapping `sonner`
     (v2.0.7). `<Toaster />` already mounted at `app/layout.tsx:101`. Use
     `toast(...)` with `action: { label, onClick }`.
   - Bucket toast helper precedent: `lib/toast/bucket.ts:20-38` —
     `bucketAdded()`. Add `bucketCleared()` beside it.
   - Chart tokens: `app/globals.css:68-73`. Use as `var(--chart-N)` or
     Tailwind's `[color:var(--chart-N)]` escape syntax.
   - ScrollArea + Button + Badge: existing shadcn primitives, no changes.
   - Keyboard toggle precedent: `components/shared/filter-sidebar.tsx:69-82`
     — copy the `useEffect` + `KeyboardEvent` listener exactly. Chord for
     bucket: **Ctrl/Cmd+Shift+B** (verified unused).
   - Source label map: **`BUCKET_SOURCE_LABELS`** at
     `lib/bucket/source-labels.ts:8-14` (note: plural name, and
     `collection` maps to `"Collections"` plural — verified against
     current file). Extend (don't duplicate) with colors in the same file.
     **Additionally, delete the local `SOURCE_LABELS` duplicate** inside
     `components/extraction/bucket/bucket-drawer.tsx:34-40` — it drifted
     from the lib ("Collection" singular) and is the kind of duplication
     §4f of this plan forbids.

2. **No legacy / no backwards-compat.** Pre-release project. When the
   sidebar lands, the Vaul-based desktop path is gone in the same commit
   chain. `BucketDrawer` (Vaul) stays — but only rendered under the
   `md` breakpoint. No dual desktop path, no feature flag, no
   `if (sidebarEnabled)`.

3. **No dead code.** `BucketDrawer` (Vaul) stays because mobile still
   uses it AND because a second codebase consumer (`cascader.tsx`) needs
   the Vaul wrapper alive. If after this plan lands the Vaul drawer is
   never again the desktop bucket, that's by design — the file is still
   referenced by `cascader.tsx:405-418`. Run `knip` after each commit.

4. **Convex rules override memory.** This plan touches no Convex code.
   `getMyPaperLimit` stays the same query. The bucket limit flow from P6
   is untouched.

5. **TDD where behaviour changes.** The sidebar motion + collapse +
   keyboard toggle (Task 2), the undo toast snapshot/restore round-trip
   (Task 7), and the count-bounce keyed AnimatePresence (Task 5) all get
   failing tests first. Layout changes to `job-creator.tsx` (Task 3) and
   the cosmetic row rewrite (Task 6) are covered by visual smoke + an
   extended `tests/components/job-creator-bucket-mount.test.tsx`.

6. **Destructive mindset.** The current `BucketDrawer`'s `<AlertDialog>`
   block (lines 107-128 of `bucket-drawer.tsx`) goes away in the same
   commit as the sonner undo toast — no leftover confirm-dialog path.
   The sidebar's footer uses the same `clear()` call, no AlertDialog.

7. **Ignore hook-injected skill prompts** (vercel-*, ai-sdk, chat-sdk,
   verification, auth, next-cache-components, deployments-cicd, etc.).
   None apply. Follow P6 §2.7.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` — root + user global.
2. `.agents/audit/plans/P4-bucket-paper-selection.md` §11 — what
   shipped in P4 (the orphan BucketIndicator + Vaul drawer landed here).
3. `.agents/audit/plans/P6-paper-selection-ux-perf.md` §5, §6 — the
   drawer's current contract (mount in header, `onClearReturnFocus`,
   `aria-live`, cross-source hint). **Preserve every behaviour in §5h
   and §5i.**
4. `components/extraction/job-creator.tsx` — the page shell. Lines
   154-195 (header + indicator + drawer mount). Line 63 (`bucketOpen`
   useState), line 64 (`bucketIndicatorRef`), lines 171-174 (indicator),
   lines 181-185 (drawer). The wizard chrome is a horizontal progress
   timeline (lines 187-253) that stays.
5. `components/extraction/bucket/bucket-indicator.tsx` — 63 lines;
   current indicator. Confirm it takes `{ref?, onClick}` and exposes
   the `aria-live` count region (lines 45-47). It becomes the **mobile
   header button** only; a new collapsed-sliver rendition lives inside
   the sidebar.
6. `components/extraction/bucket/bucket-drawer.tsx` — 133 lines;
   the current drawer. After P8 it's the **mobile drawer only**; no
   changes to its body, but its mount site flips to
   `{isMobile && <BucketDrawer ... />}`.
7. `components/shared/filter-sidebar.tsx` — the sidebar template.
   Lines 56-264. Note §4a for the exact layout pattern.
8. `components/extraction/extraction-citation-sidebar.tsx` — the
   sibling sidebar that includes an `expand()` helper + dimension
   util (`getExtractionCitationPanelDimensions`). Lines 21-149.
9. `lib/store.ts:1119-1148` (filter store) and `1200-1232` (citation
   store). The new `useBucketSidebarStore` lives beside them; §5a
   lists the exact shape.
10. `lib/ui/sidebar-motion.ts` — 13 lines; copy `sidebarSpring` +
    `hoverSpring` usage verbatim.
11. `hooks/use-mobile.tsx` — 20 lines; `useIsMobile()` + `MOBILE_BREAKPOINT = 768`.
12. `lib/store/bucket.ts` — current store. `clear()` at the `clear`
    method (P6 §5f); `addMany` return type. Task 7 adds
    `restoreFromSnapshot(snap)` and an `AllClearSnapshot` type.
13. `lib/toast/bucket.ts:1-38` — existing `bucketAdded()`. Task 7 adds
    `bucketCleared()` beside it.
14. `lib/bucket/source-labels.ts:8-14` — Task 6 merges colors into this
    file (or extracts both into `lib/bucket/source-meta.ts` — see §5f).
15. `app/globals.css:68-73` — chart palette. Light-only. Task 6 does
    **not** add dark variants; inheritance is acceptable.
16. `components/ui/sonner.tsx` + the existing Sonner call sites
    (`lib/toast/bucket.ts:36`, `lib/toast/use-app-toast.ts`) — Sonner
    action-button syntax reference.
17. `components/ui/cascader.tsx:405-418` — the other Vaul consumer.
    **Do not touch.** Confirms we cannot delete `components/ui/drawer.tsx`.
18. `tests/components/job-creator-bucket-mount.test.tsx` — the
    mount test. Task 10 extends it.

---

## 4. Research summary (what the audit found)

### 4a. Three existing sidebars, one factory

`FilterSidebar`, `LibrarySidebar`, and `ExtractionCitationSidebar` are all
instances of the same pattern. The first two now use a shared factory
`createSidebarStore(persistKey)` + `createSidebarDimensions(expanded,
collapsed)` at `lib/store.ts:1162-1194`; the citation panel predates the
factory and still inlines its own store (adds an `expand()` helper the
factory lacks).

| Building block                                   | Filter                        | Library                          | Citation                             |
| ------------------------------------------------ | ----------------------------- | -------------------------------- | ------------------------------------ |
| Store creator                                    | `createSidebarStore`          | `createSidebarStore`             | inline `create<State>()(persist(...))` |
| Persist key                                      | `'openalex-filter-sidebar'`   | `'openalex-library-sidebar'`     | `'openalex-extraction-citation-panel'` |
| Dimensions                                       | `createSidebarDimensions(320,48)` | `createSidebarDimensions(320,48)` | bespoke `getExtractionCitationPanelDimensions` |
| Expanded / collapsed widths                      | 320 / 48                      | 320 / 48                         | 460 / 48                             |
| Motion primitive                                 | `motion.aside`                | `motion.aside`                   | `motion.aside`                       |
| Spring                                           | `sidebarSpring` (300/25/0.8)  | same                             | same                                 |
| Mobile branch                                    | `if (!mounted \|\| isMobile) return null` | same                             | wrapped by `ExtractionResultsShell` tab switcher |
| Positioning                                      | `absolute right-0 top-0 bottom-0` in `h-full relative` parent | same                             | same                                 |
| Chrome tokens                                    | `bg-background/95 dark:bg-background/90 border-l border-border/50` | same                             | same                                 |
| Inner card tokens                                | `rounded-xl border border-border/60 bg-card shadow-sm` | same                             | same                                 |
| Keyboard toggle                                  | Ctrl/Cmd+Shift+F              | none                             | none                                 |
| Hover on controls                                | `whileHover={{ scale: 1.05 }}` + `hoverSpring` | same                             | same                                 |

The bucket sidebar uses the factory. Spec deltas: expanded width 360 px
(narrower than citation's 460 because there's no PDF canvas; wider than
filter/library's 320 because paper rows are denser than filter sections);
keyboard chord **Ctrl/Cmd+Shift+B**. No `expand()` helper — the factory
omits it and the sidebar doesn't need it; close buttons call `toggle()`
and the keyboard handler calls `toggle()`, which are sufficient.

### 4b. The right-overflow root cause

`components/ui/drawer.tsx:62` — `w-3/4` on all `direction=right` drawers
below the `sm` breakpoint, with `max-w-sm` (384 px) only at ≥ 640 px. On
a 375 px viewport the drawer is 281 px wide; after row padding + badge +
36 px trash button, ~130 px remains for title+authors. Rows defined at
`components/extraction/bucket/bucket-drawer.tsx:106-143` use `truncate`
(single-line ellipsis); `<Badge>` has no `max-width`; the status wrapper
at lines 120-132 (`<div className="mt-1 inline-flex ...">`) is a known
Safari culprit for breaking `min-w-0` truncation in a flex child.

The sidebar makes this irrelevant: it's part of layout flow, its width
is deterministic (360 px desktop, 48 px collapsed, hidden on mobile),
and the row layout fix (§5d) removes the `inline-flex` wrapper anyway.

### 4c. The other Vaul consumer

`components/ui/cascader.tsx:405-418` — the Cascader renders a Vaul
drawer on mobile:

```tsx
if (isMobile) {
  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger asChild disabled={disabled}>...</DrawerTrigger>
      <DrawerContent>...</DrawerContent>
    </Drawer>
  );
}
```

Implication: `components/ui/drawer.tsx` and the `vaul` dep stay.
Neither `drawer.tsx` nor the Cascader get touched by this plan. Only
`components/extraction/bucket/bucket-drawer.tsx` flips from
"always mounted" to "mobile only".

### 4d. Chart tokens present in light mode only

`app/globals.css:68-73` defines `--chart-1` through `--chart-5` inside
the `:root` block. The `.dark` block (lines 111-184) does **not**
redefine them. OKLCh lightness values 0.55–0.75 remain legible against
the dark-mode `--card` (`oklch(0.21 0.012 55)`); no action required
unless contrast review fails. The new source-color mapping uses
`var(--chart-N)` — works in both schemes without changes.

### 4e. Sonner + existing toast helpers

- **Library**: `sonner` v2.0.7.
- **Wrapper**: `components/ui/sonner.tsx`.
- **Root mount**: `<Toaster />` at `app/layout.tsx:101`.
- **Existing helper**: `lib/toast/bucket.ts:20-38` exports
  `bucketAdded(result, opts)`. No `bucketCleared`.
- **Action API** (Sonner v2):
  ```ts
  toast("Cleared 12 papers", {
    duration: 5000,
    action: { label: "Undo", onClick: () => restore(snapshot) },
  });
  ```

### 4f. Current bucket store primitives

`lib/store/bucket.ts` (reported in §5c of P6):
- `items: Record<string, BucketItem>`
- `order: string[]`
- `dedupeKeys: Set<string>`
- `dedupeKeyToSource: Record<string, BucketSource>`
- `addMany(items, limit) -> AddManyResult`
- `remove(bucketKey)`
- `removeMany(bucketKeys)`
- `clear()`
- `updateStatus(bucketKey, patch)`

Persist config: `name: "extraction-bucket"`, `version: 1`, `partialize`
keeps `items + order` only (Set isn't serializable); `merge` recomputes
dedupe maps on hydration.

Task 7 extends with:
- `type AllClearSnapshot = { items: Record<string, BucketItem>; order: string[] }` (private Set/map can be recomputed via `computeDedupeMaps(items)` already in the file).
- `restoreFromSnapshot(snap: AllClearSnapshot) -> void`.

### 4g. `job-creator.tsx` is flat

Lines 153-395: single `<div className="w-full p-4 md:p-6">` wrapper.
No `TwoColumnLayout`, no `relative` parent. Header at lines 156-179 is
a flex row: Cancel button, **BucketIndicator at 171-174**, step counter
at 175-177. Drawer mount at 181-185 immediately after the header.

Tasks 3 + 4 wrap the wizard chrome in a `relative` parent with
right-padding equal to the current sidebar width (reactive to the
Zustand store's collapse state), and mount `<BucketSidebar>` as an
absolutely-positioned sibling. Match filter-sidebar's pattern verbatim.

### 4h. Current `BucketIndicator` does double duty

`components/extraction/bucket/bucket-indicator.tsx:12-58`:
- Takes `{ref?, onClick}`.
- Reads `readyCount` via Zustand atomic selector.
- Outputs: Button (outline, sm) with Package icon, text `${readyCount} / ${limit}`, sr-only live region, and two sibling `<Badge>`s for nearCap / atCap.

Under P8 the indicator keeps its existing API and becomes the **mobile
trigger** only. A new internal component — `BucketSidebarSliver` — lives
inside `bucket-sidebar.tsx`; it reads the same store, renders a 48 px-wide
vertical presentation (icon top, count middle, no badges), and acts as
the click target to expand the sidebar. The collapsed sliver is what the
filter/citation sidebars show when collapsed — not a separate file.

The two sibling `nearCap` / `atCap` Badges go away. Capacity signals
via text color on the count only (§5e).

### 4i. Count bounce — current state

No animation today. `readyCount` changes cause an instant re-render of
the text. Task 5 adds `<AnimatePresence mode="wait">` keyed on
`readyCount` around the count span, and a scale-pulse on the count
container. Reduced motion downgrades to opacity swap.

### 4j. A11y to preserve (non-negotiable)

From P6 §5h, landed in commit 18773be + 0d29c6b:
- `aria-live="polite"` count region in the indicator.
- Focus return to indicator after Clear-all.
- `aria-label="Remove ${item.title}"` on per-item trash button.
- `aria-pressed` + keyboard shift-range in `SelectableList`.

Bucket sidebar preserves every one. The expanded sidebar gets:
- A `role="complementary"` + `aria-label="Staged papers bucket"` on the
  `motion.aside`.
- `aria-expanded` on the sliver button.
- `aria-controls` linking sliver button → panel id.
- The existing `aria-live` region moves into the sliver (stays in the
  mobile indicator too — both need it).
- Focus return after undo-toast's Undo click → back to sliver button.
- `Escape` when the sidebar is expanded closes it (collapses, doesn't
  unmount); focus lands on the sliver button.

### 4k. Keyboard chord audit

Taken:
- **Ctrl/Cmd+Shift+F** — filter sidebar toggle (`filter-sidebar.tsx:68`).
- **Ctrl/Cmd+Enter** — submit from textareas.
- **Shift+Enter** — newline in search.

Free for this plan: **Ctrl/Cmd+Shift+B** (B for Bucket). Use it.

### 4l. Tests that need updating

- `tests/components/job-creator-bucket-mount.test.tsx` — asserts
  `<BucketIndicator>` + `<BucketDrawer>` mount, `open/onOpenChange`
  wiring, count sync, Clear-all + focus return. Under P8 this splits
  into:
  - **Mobile branch**: jsdom `window.innerWidth = 375` before render;
    assert `<BucketIndicator>` rendered, `<BucketDrawer>` mounted,
    `<BucketSidebar>` NOT rendered.
  - **Desktop branch**: jsdom `window.innerWidth = 1024`; assert
    `<BucketSidebar>` rendered, `<BucketIndicator>` NOT rendered in the
    header, `<BucketDrawer>` NOT mounted. Count sync + clear flow now
    goes through the sidebar; Clear-all triggers a Sonner toast with
    `role="status"` containing "Undo".

---

## 5. Architectural decisions (locked)

### 5a. New `useBucketSidebarStore` — via factory

Append to `lib/store.ts` beside the existing factory-based stores (after
line 1198, before the citation panel block):

```ts
// Bucket sidebar store — staged-papers sidebar on job-creator
export const useBucketSidebarStore = createSidebarStore("openalex-bucket-sidebar");
export const getBucketSidebarDimensions = createSidebarDimensions(360, 48);
```

That's it. Two lines. The factory at `lib/store.ts:1162-1194` already
handles persist config, `_hasHydrated` guard, `setCollapsed` + `toggle`,
localStorage name, partialize. Matches `useLibrarySidebarStore` (line
1197-1198) verbatim in shape.

Default collapsed state: **`false`** — first-time user lands on
job-creator, sees the bucket expanded alongside the sources. They can
collapse it (persisted). The factory defaults to `isCollapsed: false`
(line 1166) — exactly what we want.

**Why not `expand()`?** The factory omits it. Only the citation panel
store defines one. In this plan, every place that wants to "expand" is
either a direct toggle (collapse button → toggle) or a click on the
collapsed sliver (click handler → toggle). No code path needs to
_guarantee_ expanded state irrespective of current value. Call
`setCollapsed(false)` inline if that ever changes.

### 5b. `BucketSidebar` component shape

New file: `components/extraction/bucket/bucket-sidebar.tsx`.

Public API — zero props. The component is self-contained: it reads
bucket items + cap from their respective stores/queries, reads its own
collapse state from `useBucketSidebarStore`, and renders nothing on
mobile (guarded by `useIsMobile()` + `_hasHydrated`).

Structure:

```tsx
export function BucketSidebar() {
  const isMobile = useIsMobile();
  const hydrated = useBucketSidebarStore((s) => s._hasHydrated);
  const isCollapsed = useBucketSidebarStore((s) => s.isCollapsed);
  const toggle = useBucketSidebarStore((s) => s.toggle);
  const setCollapsed = useBucketSidebarStore((s) => s.setCollapsed);
  // ... keyboard toggle effect ...

  if (!hydrated || isMobile) return null;

  const { expandedWidth, collapsedWidth } = getBucketSidebarDimensions(isCollapsed);
  const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

  return (
    <div
      className="h-full relative overflow-hidden"
      style={{
        width: isCollapsed ? collapsedWidth : expandedWidth,
        transition: `width ${sidebarSpring.stiffness}ms ease-out`,
      }}
    >
      <motion.aside
        role="complementary"
        aria-label="Staged papers bucket"
        className={cn(
          "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
          "bg-background/95 dark:bg-background/90",
          "border-l border-border/50",
        )}
        initial={false}
        animate={{ x: translateX }}
        transition={sidebarSpring}
        style={{ width: expandedWidth }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isCollapsed ? <BucketSidebarSliver key="sliver" onExpand={() => setCollapsed(false)} /> : <BucketSidebarPanel key="panel" onCollapse={toggle} />}
        </AnimatePresence>
      </motion.aside>
    </div>
  );
}
```

`BucketSidebarSliver` and `BucketSidebarPanel` are internal, not exported
— they live in the same file. Keeping them internal matches
`extraction-citation-sidebar.tsx` where collapsed + expanded controls
are inline.

**Sliver (48 px wide, full height)**:
- Vertical stack: Package icon top (16 px), animated count (vertical
  text or stacked digits), optional destructive tint.
- Entire sliver is a button (`<button type="button" onClick={onExpand}>`)
  with `aria-label="Open bucket — ${readyCount} of ${limit}"`,
  `aria-expanded={false}`, `aria-controls="bucket-sidebar-panel"`.
- Hover: `whileHover={{ scale: 1.05 }}` + `hoverSpring`.
- The `aria-live="polite"` sr-only span lives here (moved from the
  mobile indicator — see §5g for the mobile path).

**Panel (360 px wide, full height, three sections)**:

Header — `p-4 border-b border-border/50`:
- Left: `h2` "Bucket" (`text-foreground font-semibold`); capacity
  line `${readyCount} / ${limit} papers ready to submit` with text-tint
  (amber/dest) at thresholds. Same warning row from current drawer lines
  70-79 (kept verbatim).
- Right: collapse button (`Button variant="ghost" size="icon"` with
  `PanelRightClose` lucide icon — or reuse `X` if the codebase prefers).
  `aria-label="Collapse bucket sidebar"`.

Body — `ScrollArea` with `flex-1 px-4`:
- Empty state (unchanged from current drawer line 81).
- Flat `<ul className="space-y-2 pb-4">`. Each `<li>` is a row
  (see §5d for exact markup).

Footer — `border-t p-4`:
- `<Button variant="ghost" size="sm" onClick={onClearClick}>Clear all</Button>`
  (disabled when `items.length === 0`).
- No close button — the sidebar is persistent.

Panel has `id="bucket-sidebar-panel"` so the sliver's `aria-controls`
resolves.

### 5c. Keyboard toggle

Copy `filter-sidebar.tsx:69-82` verbatim, swap the key from `"F"` to
`"B"`:

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [toggle]);
```

Plus a second effect: `Escape` while expanded → collapse + return focus
to the sliver button (focus return mechanism = ref passed down).

### 5d. Row redesign

Replace the current row markup (`bucket-drawer.tsx:84-103`) with:

```tsx
<li
  key={item.bucketKey}
  className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3"
>
  <SourceChip source={item.source} />
  <div className="flex-1 min-w-0">
    <p className="text-sm font-medium leading-snug line-clamp-2">
      {item.title}
    </p>
    <p className="mt-0.5 text-xs text-muted-foreground truncate">
      {authorsPreview(item)}
      {item.status !== "ready" && (
        <>
          {" · "}
          {item.status === "uploading" && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />uploading
            </span>
          )}
          {item.status === "failed" && <span>upload failed</span>}
        </>
      )}
    </p>
  </div>
  <Button
    size="icon"
    variant="ghost"
    className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
    onClick={() => remove(item.bucketKey)}
    aria-label={`Remove ${item.title}`}
  >
    <Trash2 className="h-4 w-4" />
  </Button>
</li>
```

`authorsPreview(item)` = `item.authors.slice(0, 3).join(", ") || "Unknown"` +
(year ? ` · ${year}` : ""). Lift the helper into the same file
(no need for a separate `lib/bucket/authors-preview.ts` — one call site).

Key deltas vs. current drawer:

- `items-center` (not `items-start`) — rows align around the title
  baseline.
- Status moved inline into the authors line (`… · uploading`) — drops
  the flex-breaking `inline-flex` wrapper from §4b.
- `line-clamp-2` on title (was `truncate`). Second line renders when
  needed; no mid-word cutoff.
- `h-10 w-10` trash button — 40 px touch target (shadcn's `size="icon"`
  default is h-10 w-10 when `size` is "icon"; keep shadcn defaults but
  add `className="shrink-0"` to prevent flex squeeze).
- Hover: trash turns destructive. Subtle cue.

### 5e. Capacity tint only

In both sliver and panel, the count span gets:
- `text-amber-600 dark:text-amber-400` when `nearCap && !atCap`.
- `text-destructive` when `atCap`.
- `text-foreground` otherwise.

Drop the two sibling `<Badge>`s in the current `BucketIndicator`
(lines 48-57). For the mobile `BucketIndicator` (unchanged shell), apply
the same tint class to the count span and remove the badges too — keeps
mobile and desktop visually consistent. (This is a small edit to
`bucket-indicator.tsx`; see Task 9.)

The warning row in the panel header (when `nearCap || atCap`) stays —
it's the one banner, not a pair of badges.

### 5f. Source colors

Decision: **extend `lib/bucket/source-labels.ts`** (don't create a new
file). The file already exports `BUCKET_SOURCE_LABELS` (plural —
canonical across the codebase; `bucket-drawer.tsx` has a drifted local
`SOURCE_LABELS` that Task 8 deletes). Add `SOURCE_COLOR_VAR` beside it:

```ts
// lib/bucket/source-labels.ts (after adding SOURCE_COLOR_VAR)
import type { BucketSource } from "@/lib/bucket/bucketItem";

export const BUCKET_SOURCE_LABELS: Record<BucketSource, string> = {
  history: "History",
  library: "Library",
  collection: "Collections",
  zotero: "Zotero",
  upload: "Upload",
};

/**
 * CSS variable name (without var()) for the colored dot on each source chip.
 * Maps to the chart palette defined in app/globals.css:68-73.
 */
export const SOURCE_COLOR_VAR: Record<BucketSource, string> = {
  history: "--chart-1",
  library: "--chart-2",
  collection: "--chart-3",
  zotero: "--chart-4",
  upload: "--chart-5",
};
```

Chip renderer — new file `components/extraction/bucket/source-chip.tsx`,
reused by both `BucketSidebar` (desktop) and `BucketDrawer` (mobile):

```tsx
// components/extraction/bucket/source-chip.tsx
import type { BucketSource } from "@/lib/bucket/bucketItem";
import { BUCKET_SOURCE_LABELS, SOURCE_COLOR_VAR } from "@/lib/bucket/source-labels";
import { cn } from "@/lib/utils";

export function SourceChip({ source, className }: { source: BucketSource; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0",
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: `var(${SOURCE_COLOR_VAR[source]})` }}
        aria-hidden="true"
      />
      {BUCKET_SOURCE_LABELS[source]}
    </span>
  );
}
```

Both `BucketSidebar` (desktop) and `BucketDrawer` (mobile) import and
render `<SourceChip source={item.source} />` in place of the current
`<Badge variant="outline">{SOURCE_LABELS[item.source]}</Badge>`.

**Consequence — the local `SOURCE_LABELS` const in `bucket-drawer.tsx:34-40`
goes away** (Task 8 handles this). It's a stale duplicate: uses
`"Collection"` (singular) vs. the lib's `"Collections"` (plural). The
mobile drawer's existing `SOURCE_LABELS[item.source]` call site is
replaced by `<SourceChip source={item.source} />` in the same commit.

### 5g. Mount strategy in `job-creator.tsx`

```tsx
// Current outer wrapper (line 154):
// <div className="w-full p-4 md:p-6">

// After P8:
<div className="h-full md:flex md:gap-0">
  <div className="flex-1 min-w-0 p-4 md:p-6 md:overflow-y-auto">
    {/* existing header, progress, step content, footer — unchanged */}
  </div>
  <BucketSidebar /> {/* returns null on mobile */}
</div>
```

The sidebar doesn't consume padding/margin — it's part of the flex row.
`min-w-0` on the left column prevents the wizard from stretching under
the sidebar (flex default would let its content push the sidebar off
screen).

**Mobile** (`isMobile === true`): `BucketSidebar` returns null, flex
row collapses to a single column (`md:flex md:gap-0` means it's only
flex at ≥ 768 px; below md it's a plain stack). The existing
`<BucketIndicator>` stays at `job-creator.tsx:171-174`, and
`<BucketDrawer open={bucketOpen} onOpenChange={setBucketOpen} onClearReturnFocus={...} />`
stays at 181-185 — but wrapped in `{isMobile && ...}` so desktop
doesn't mount them. The `bucketOpen` useState + `bucketIndicatorRef`
stay; the indicator's `aria-live` region stays (mobile users still need
announcements).

Hydration: `useIsMobile` returns `false` during SSR (the hook's `undefined`
initial state coerces to `false` via `!!isMobile`). That means SSR +
first-render show the desktop layout, with the sidebar collapsed-by-default
(after P8's hydration guard lets it render). On mobile, the first paint
has no sidebar and an absent indicator → hydration corrects it on the
first `useEffect` tick, mounting the indicator + drawer. This is
consistent with `filter-sidebar.tsx:85` (`if (!mounted || isMobile) return null`).
We accept the same hydration shift the other sidebars accept.

### 5h. Count bounce (sliver + panel)

Shared component, reused in both:

```tsx
function AnimatedCount({ value, total, tint }: { value: number; total: number; tint: string }) {
  return (
    <motion.span
      className={cn("inline-flex items-center gap-1 font-medium tabular-nums", tint)}
      animate={{ scale: [1, 1.15, 1] }}
      transition={{ duration: 0.3, times: [0, 0.5, 1], ease: [0.4, 0.0, 0.2, 1] }}
      key={`pulse-${value}`} // re-triggers pulse on change
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={value}
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
      <span className="text-muted-foreground">/ {total}</span>
    </motion.span>
  );
}
```

Reduced motion: wrap the `animate={{scale:...}}` and the inner
`initial/animate/exit` in a `useReducedMotion()` guard. If reduced,
skip both (render a plain `<span>{value} / {total}</span>`).

Mount site (sliver): replaces the plain count text in the collapsed
presentation. Mount site (panel): replaces the count fragment in the
header's capacity line. Mount site (mobile `BucketIndicator`):
**also** swap the existing plain count text for this — keeps desktop
and mobile count-change feedback identical.

### 5i. Clear-all with undo toast

Store changes (Task 7):

```ts
// lib/store/bucket.ts
export type AllClearSnapshot = {
  items: Record<string, BucketItem>;
  order: string[];
};

// inside the store factory, beside clear():
restoreFromSnapshot: (snap: AllClearSnapshot) => {
  set(() => ({
    items: { ...snap.items },
    order: [...snap.order],
    ...computeDedupeMaps(snap.items),
  }));
},
```

No store-side snapshot field. The snapshot is held in the toast callback
closure — if the user stages more papers during the 5-second undo
window and then clicks Undo, we overwrite the new additions. That's
acceptable: Undo means "restore what was there". If the user wanted to
keep the new additions, they wouldn't click Undo.

Toast helper (Task 7), new in `lib/toast/bucket.ts`:

```ts
import { toast } from "sonner";
import type { AllClearSnapshot } from "@/lib/store/bucket";

export function bucketCleared(
  clearedCount: number,
  snapshot: AllClearSnapshot,
  restore: (snap: AllClearSnapshot) => void,
): void {
  toast(
    `Cleared ${clearedCount} ${clearedCount === 1 ? "paper" : "papers"} from the bucket`,
    {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => restore(snapshot),
      },
    },
  );
}
```

Call site inside `bucket-sidebar.tsx` (new) and
`bucket-drawer.tsx` (mobile, flipped from AlertDialog):

```tsx
const handleClearAll = () => {
  const snapshot: AllClearSnapshot = {
    items: { ...itemsMap },
    order: [...order],
  };
  const count = snapshot.order.length;
  clear();
  bucketCleared(count, snapshot, restoreFromSnapshot);
  onClearReturnFocus?.();
};
```

The mobile drawer drops its `<AlertDialog>` (lines 107-128). Clear-all
becomes a single-click, reversible. Matches P4/P5/P6/P7's
"no legacy dual paths" rule.

### 5j. A11y sweep

- Sliver: `<button type="button" aria-expanded={false}
  aria-controls="bucket-sidebar-panel" aria-label="Open bucket — N of M">`.
- Panel: `role="region" aria-labelledby="bucket-sidebar-title"`; the
  h2 carries that id.
- `<h2 id="bucket-sidebar-title">Bucket</h2>`.
- `aria-live="polite"` sr-only span beside the count in both sliver and
  mobile indicator. Messages: `"${readyCount} of ${limit} papers staged"`.
  Announcement throttled per P6 §5h (inherited; no change).
- Escape key handler: when expanded, `Escape` calls `toggle()` and
  focuses the sliver button via a `ref` passed to the sliver.
- Clear-all flow: focus returns to the sliver button (not the expanded
  panel's collapse button). Matches P6 §4j's focus-to-trigger pattern.
- Reduced motion: `useReducedMotion()` guard on every motion component
  in the sidebar. Panel still slides (motion-respectful users lose the
  spring; panel snaps into place), but the count pulse and digit swap
  are bypassed.

### 5k. What stays untouched

- `lib/store/bucket.ts` — every existing method (`addMany`, `remove`,
  `removeMany`, `clear`, `updateStatus`, dedupe maps). Only **additions**
  in Task 7 (`AllClearSnapshot`, `restoreFromSnapshot`).
- `components/extraction/bucket/selectable-list.tsx` — untouched. The
  source tabs keep calling `addMany` / `remove`; the sidebar is a pure
  display surface for what those tabs stage.
- `components/extraction/bucket/tabs/*.tsx` — untouched.
- `components/ui/drawer.tsx` — untouched (second consumer at
  `cascader.tsx`).
- `convex/**` — untouched.

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each task is an atomic commit
with a failing test where one is tractable. Commit message prefix
`T<N>.<sub>`.

### Phase A — Store + primitive

#### Task 1 — `useBucketSidebarStore` (factory) + `SOURCE_COLOR_VAR` + `SourceChip`

**Why.** Store must exist before the sidebar component can read
collapse state; `SourceChip` is a cross-file primitive used by both
sidebar and mobile drawer.

**Test first.** `lib/__tests__/bucket-sidebar-store.test.ts`:

- Import `useBucketSidebarStore`; assert default `isCollapsed === false`.
- `toggle()` flips; second `toggle()` flips back.
- `setCollapsed(true)` sets; `setCollapsed(false)` reverses.
- Persisted to `localStorage` under `"openalex-bucket-sidebar"`; trigger
  persist + re-read from storage; hydrated store mirrors the persisted
  state. (If the factory's persist is hard to exercise cleanly in a
  unit test, shift this assertion into a mobility test for Task 2 that
  seeds `localStorage` before mount — easier than re-creating Zustand
  store instances.)
- `getBucketSidebarDimensions(false)` returns `{ expandedWidth: 360,
  collapsedWidth: 48, currentWidth: 360 }`; `(true)` returns
  `currentWidth: 48`.

**Implementation.**

1. Append to `lib/store.ts` (beside `useLibrarySidebarStore` at line
   ~1198, before the inline-declared citation panel store):
   ```ts
   export const useBucketSidebarStore = createSidebarStore("openalex-bucket-sidebar");
   export const getBucketSidebarDimensions = createSidebarDimensions(360, 48);
   ```
2. Create `components/extraction/bucket/source-chip.tsx` (§5f).
3. Add `SOURCE_COLOR_VAR` export to `lib/bucket/source-labels.ts`
   (§5f). **Do not rename** `BUCKET_SOURCE_LABELS` — the lib name is
   canonical; all other consumers already use it.

**Done when.** Store test green; `SourceChip` renders with correct
colored dot for each of the 5 sources (snapshot or light render test).

---

### Phase B — The sidebar

#### Task 2 — `BucketSidebar` component skeleton + mount

**Why.** Introduce the visible surface before filling it with
features. Mounts on desktop only; no behaviour beyond open/close.

**Test first.** `tests/components/bucket-sidebar.test.tsx`:

- Render `<BucketSidebar />` at `window.innerWidth = 1024`; assert
  the aside renders with role="complementary".
- Render at `window.innerWidth = 375`; assert the component returns
  null (jsdom width guard).
- Click the sliver button → store's `isCollapsed` flips to `false`.
- Click the collapse button inside the expanded panel → `isCollapsed`
  flips to `true`.
- Fire `keydown` with `ctrlKey+shiftKey+"B"` → store flips.
- Fire `keydown` with `Escape` while expanded → collapses + focus on
  sliver button.

**Implementation.**

1. Create `components/extraction/bucket/bucket-sidebar.tsx` with the
   shape in §5b. Include:
   - The mobile + hydration guard.
   - `motion.aside` + width container (copy verbatim from
     `filter-sidebar.tsx:96-111`, swap widths to 360/48 and `aria-label` to
     `"Staged papers bucket"`).
   - `BucketSidebarSliver` internal component: icon + count span
     placeholder + click-to-expand button.
   - `BucketSidebarPanel` internal component: header with title, empty
     capacity line placeholder, empty body, empty footer.
   - Keyboard effect for Ctrl/Cmd+Shift+B.
   - Escape handler for expanded panel.
2. Mount in `job-creator.tsx` per §5g.
3. Wrap the existing `<BucketIndicator>` (lines 171-174) and
   `<BucketDrawer>` (lines 181-185) with `{isMobile && ...}`. Keep the
   `bucketOpen` state; it's now mobile-only.
4. Export nothing new from `bucket/` except `BucketSidebar` itself.

**Done when.** Test green; resize browser from 1200 → 320 px and
observe: sidebar collapses to 48 px → vanishes → mobile indicator +
drawer appear.

---

#### Task 3 — Panel content (items list + Clear-all)

**Why.** The sidebar is functionally inert until it shows the bucket's
content.

**Test first.** Extend `tests/components/bucket-sidebar.test.tsx`:

- Stage 3 items via the bucket store directly; assert the panel body
  renders 3 `<li>`s with titles.
- Click a per-item remove button → store drops that row; panel
  re-renders with 2 rows.
- Empty state: unstaged, assert the "The bucket is empty…" text
  appears.

**Implementation.**

1. Inside `BucketSidebarPanel`, render the header + body + footer per
   §5b:
   - Header: "Bucket" h2 + capacity text (static for now — Task 5
     swaps it for `AnimatedCount`) + collapse button.
   - Warning row reused from `bucket-drawer.tsx:70-79` (copy verbatim;
     it's three lines of JSX, not worth a shared helper).
   - Body: `ScrollArea` with a `<ul>` of rows per §5d.
   - Footer: Clear-all button (onClick wires to Task 7's handler;
     for now, just calls `clear()` directly + TODO comment).
2. Import `SourceChip` from Task 1.
3. Remove button uses the existing `remove(bucketKey)` from the bucket
   store.

**Done when.** Test green; visual QA: add a paper from the Library
tab, see it appear in the sidebar with the correct chip color.

---

### Phase C — Feedback

#### Task 4 — Count tint + Panel header capacity signal

**Why.** Without capacity signalling the redesign regresses the
current indicator's near-cap / at-cap visibility.

**Test first.** Extend `tests/components/bucket-sidebar.test.tsx`.
**Assert on behavior, not on class strings.** Expose capacity state
via a `data-capacity-state="normal" | "near" | "at"` attribute on the
capacity element and assert on that + the warning row text:

- With `readyCount === 0`: `data-capacity-state="normal"`, no element
  with `role="status"` in the tree.
- With `readyCount === 950`, `limit === 1000`: `data-capacity-state="near"`
  and `getByRole("status")` has text "Approaching the per-job cap."
- With `readyCount === 1000`: `data-capacity-state="at"` and
  `getByRole("status")` has text "You've hit the per-job cap.…"

**Implementation.**

1. Compute capacity state (`"normal" | "near" | "at"`) inside the panel
   from the same thresholds as `bucket-indicator.tsx:28-29`.
2. Apply the `data-capacity-state` attribute to the capacity element
   and drive the tint class off the state. Do not test the class.
3. The warning row below the header: conditional render based on
   state being `"near"` or `"at"`. Same markup as
   `bucket-drawer.tsx:70-79`, wrapped in `role="status"`.

**Done when.** Test green. Sliver count turns amber → red as the cap
is approached.

---

#### Task 5 — `AnimatedCount` + count bounce

**Why.** The user's explicit request: "make the count bounce".

**Test first.** `tests/components/animated-count.test.tsx`. Assert on
observable text/structure, not on class strings or DOM snapshots:

- Render `<AnimatedCount value={5} total={1000} tint="" />`; assert
  `5` and `/ 1000` appear in the rendered text.
- `rerender` with `value={6}`; assert `6` appears in the rendered text.
  (The visual digit-swap animation is a browser concern and belongs in
  a visual-regression / Playwright test, not a JSDOM unit test.)
- Render with `useReducedMotion` mocked to `true`; assert the output
  text is `6 / 1000`. Do not assert on the presence/absence of
  `motion.span` wrappers — the observable contract is the text.
- Render with `showTotal={false}`; assert the `/ total` suffix does
  not appear.

The `tint` prop is a cosmetic passthrough; do not test that a specific
Tailwind class string reaches the DOM. Color and emphasis are
visual-regression concerns.

**Implementation.**

1. Extract `AnimatedCount` per §5h into
   `components/extraction/bucket/animated-count.tsx` (separate file —
   used from 3 sites: sliver, panel, mobile indicator).
2. Replace the plain count span in:
   - `bucket-sidebar.tsx` sliver — vertical layout tweak (number + `/ total` stacked or side-by-side; stacked is more legible at 48 px).
   - `bucket-sidebar.tsx` panel header capacity line.
   - `bucket-indicator.tsx:38-41` (mobile).
3. Ensure the `tabular-nums` class is on the count to avoid width
   jumps.

**Done when.** Test green; add a paper, observe digit swap + spring
scale pulse in sliver + panel + (on mobile viewport) indicator.

---

### Phase D — Clear-all undo

#### Task 6 — Store `restoreFromSnapshot` + `AllClearSnapshot`

**Why.** Undo requires restore, restore requires a typed snapshot.

**Test first.** Extend `tests/store/bucket.test.ts`:

- Add 3 items; take `{items, order}` snapshot; `clear()`; assert
  empty.
- Call `restoreFromSnapshot(snap)`; assert 3 items back, in original
  order, `dedupeKeys` recomputed.
- Add 2 more items after `clear()` but **before** restore; call
  `restoreFromSnapshot(snap)`; assert the 2 new items are dropped
  (restore overwrites).

**Implementation.**

1. Export `AllClearSnapshot` type from `lib/store/bucket.ts`.
2. Add `restoreFromSnapshot` to the state + factory; it replaces
   `items` + `order` wholesale and recomputes dedupe maps via the
   existing `computeDedupeMaps()` helper.

**Done when.** Test green. No code in `addMany`, `remove`, `clear`,
`updateStatus` changes.

---

#### Task 7 — Sonner undo toast + wire Clear-all (both drawer and sidebar)

**Why.** User picks "undo toast instead of confirm dialog" in discuss;
needs to ship across both mobile drawer + desktop sidebar for parity.

**Test first.** `tests/components/bucket-clear-toast.test.tsx`:

- Render `<BucketSidebar>` with 3 items; click Clear-all; assert
  Sonner's toast region has text "Cleared 3 papers" and an "Undo"
  button.
- Click "Undo"; assert bucket store has the 3 items back.
- Same flow for the mobile `<BucketDrawer>` after swapping its
  AlertDialog out.

**Implementation.**

1. Add `bucketCleared(count, snapshot, restore)` to
   `lib/toast/bucket.ts` per §5i.
2. `bucket-sidebar.tsx` footer's Clear-all: implement `handleClearAll`
   per §5i, wire up.
3. `bucket-drawer.tsx`: **delete** the `<AlertDialog>` block
   (lines 150-181). Replace with a direct Clear-all button that calls
   the same `handleClearAll` helper. Also delete the `confirmClear`
   useState (line 73). Also delete the AlertDialog imports at lines
   14-24 (confirm they aren't used elsewhere in the file — they
   aren't).
4. `onClearReturnFocus?.()` fires on the click, before the toast is
   shown (same as current flow).

**Done when.** Test green; a Clear-all on desktop shows the toast; on
mobile the drawer's Clear-all shows the same toast (the drawer stays
open — the toast is enough confirmation; if user wants to close, they
tap the Close button or outside).

---

### Phase E — Cosmetic + cleanup

#### Task 8 — Row redesign in the panel body

**Why.** §5d. Matches modern 2026 row density; kills the Safari
`inline-flex` trap.

**Test first.** Extend the Task 3 test with behavior-only assertions:

- Render a row with a 200-character title; assert the full title text
  reaches the DOM (`screen.getByText(longTitle)`). **Do not assert on
  `line-clamp-2` or any Tailwind class** — JSDOM has no layout engine
  and cannot verify clamping. Real 2-line clamping belongs in a
  Playwright / visual-regression check.
- Render a row with `status === "uploading"`; assert the
  "uploading" text is visible in the row
  (`screen.getByText(/uploading/i)`). Do not assert on class strings
  such as `flex` / `flex-col` to "prove" inline layout; instead assert
  structurally — e.g., that the trash button and the title are not
  nested inside each other (two separate click targets,
  `title.contains(trash) === false`).

**Implementation.**

1. Rewrite the panel body row per §5d.
2. Remove any now-unused imports (`Badge` was kept because
   `SourceChip` replaces it; confirm no other uses in the sidebar).

**Done when.** Test green; Safari sanity check — resize the sidebar
to 320 px min with a long title, confirm no horizontal scrollbar
appears inside the row.

---

#### Task 9 — Mirror row + chip in mobile `BucketDrawer`

**Why.** Parity. Mobile users deserve the same chip + row layout.

**Test first.** `tests/components/bucket-drawer.test.tsx` (new or
extend the existing job-creator-bucket-mount test's mobile branch).
Assert on observable behavior — no Tailwind-class assertions:

- Render `<BucketDrawer open={true}>` with 3 items at
  `window.innerWidth = 375`; assert each row exposes a SourceChip via
  `data-source={source}`, the title text is present, and the remove
  button is findable via `getByRole("button", { name: /remove .../i })`.
- **Do not assert** "2-line-clamp" or "`h-10 w-10` trash" through
  class regex. Those are visual contracts — verify in a Playwright /
  visual-regression pass if they matter.

**Implementation.**

1. In `bucket-drawer.tsx:106-143`, swap the `<Badge variant="outline">`
   for `<SourceChip>` and adopt the row layout from §5d.
2. **Delete the local `SOURCE_LABELS` const at `bucket-drawer.tsx:34-40`
   entirely** — `<SourceChip>` now renders the label via the lib's
   canonical `BUCKET_SOURCE_LABELS`. This also fixes the
   "Collection" vs "Collections" drift.
3. Also swap the mobile `BucketIndicator`'s two sibling
   `<Badge>`s (lines 48-57) for conditional `tint` class on the
   count span (§5e).

**Done when.** Test green; at 375 px viewport the drawer row looks
identical to the sidebar row at desktop widths.

---

#### Task 10 — Tests + docs + knip

**Why.** `tests/components/job-creator-bucket-mount.test.tsx` still
tests the pre-P8 world. Split it, fix the fixtures.

**Test first.** Itself.

**Implementation.**

1. Split `tests/components/job-creator-bucket-mount.test.tsx` into
   three scenarios (one file, three `describe` blocks or three `it`
   blocks):
   - **Desktop**: `window.innerWidth = 1024`; assert `<BucketSidebar>`
     renders with `role="complementary"`; assert `<BucketDrawer>`
     does not mount (`queryBy` returns null for its `role="dialog"`);
     assert indicator in header does not render.
   - **Mobile**: `window.innerWidth = 375`; assert `<BucketIndicator>`
     renders in header; clicking opens `<BucketDrawer>` (Vaul);
     assert `<BucketSidebar>` does not render.
   - **Clear-all flow (desktop)**: stage 2 items; click the sidebar's
     Clear-all; assert toast appears; click Undo; assert items restored.
2. Run `knip`; confirm no unreferenced imports linger in
   `bucket-drawer.tsx` after the AlertDialog deletion.
3. No user-facing docs to update.

**Done when.** All tests green; `knip` clean.

---

## 7. Migration & destructiveness checklist

- [ ] `useBucketSidebarStore` defined in `lib/store.ts` beside the
      other two sidebar stores (Task 1).
- [ ] `getBucketSidebarDimensions(isCollapsed)` exported.
- [ ] `SourceChip` + `SOURCE_COLOR_VAR` shipped (Task 1).
- [ ] `BucketSidebar` component mounts on desktop only; returns
      null on mobile + during SSR pre-hydration (Task 2).
- [ ] Ctrl/Cmd+Shift+B keyboard toggle works; Escape collapses when
      expanded (Task 2).
- [ ] `<BucketIndicator>` + `<BucketDrawer>` in `job-creator.tsx`
      wrapped in `{isMobile && ...}` (Task 2).
- [ ] Sidebar panel renders items, handles per-item remove, shows
      empty state (Task 3).
- [ ] Capacity tint + single inline warning row (Task 4).
- [ ] `AnimatedCount` replaces plain count span in sliver, panel,
      and mobile indicator (Task 5).
- [ ] `AllClearSnapshot` type + `restoreFromSnapshot` method on
      bucket store (Task 6).
- [ ] `bucketCleared()` helper in `lib/toast/bucket.ts` (Task 7).
- [ ] `<AlertDialog>` block deleted from `bucket-drawer.tsx`;
      imports pruned (Task 7).
- [ ] Mobile drawer + desktop sidebar use the SAME `handleClearAll`
      flow (snapshot → clear → toast) (Task 7).
- [ ] Row layout uses `line-clamp-2`, `items-center`, `h-10 w-10`
      trash target, inline status in authors line (Task 8).
- [ ] `SourceChip` renders in the mobile drawer too (Task 9).
- [ ] Mobile `<BucketIndicator>`'s two `<Badge>`s removed; tint-only
      (Task 9).
- [ ] `tests/components/job-creator-bucket-mount.test.tsx` split into
      desktop + mobile + clear-flow (Task 10).
- [ ] `knip` clean; full test suite green at every commit.
- [ ] `npx tsc --noEmit` green.

---

## 8. Files inventory

### Modified

- `lib/store.ts` — append `useBucketSidebarStore` + width constants +
  `getBucketSidebarDimensions`.
- `lib/bucket/source-labels.ts` — add `SOURCE_COLOR_VAR` export.
- `lib/store/bucket.ts` — add `AllClearSnapshot` + `restoreFromSnapshot`.
- `lib/toast/bucket.ts` — add `bucketCleared` helper.
- `components/extraction/job-creator.tsx` — wrap outer div as a
  flex row at `md`+; wrap `<BucketIndicator>` + `<BucketDrawer>` in
  `{isMobile && …}`; mount `<BucketSidebar />` as the right column.
- `components/extraction/bucket/bucket-drawer.tsx` — delete
  `<AlertDialog>`, swap Badge for `SourceChip`, adopt row redesign
  (§5d), wire `handleClearAll` to the shared helper.
- `components/extraction/bucket/bucket-indicator.tsx` — drop the two
  sibling `<Badge>`s, apply tint class on the count, use
  `AnimatedCount`.
- `tests/components/job-creator-bucket-mount.test.tsx` — split into
  three scenarios.

### New

- `components/extraction/bucket/bucket-sidebar.tsx` — new sidebar
  component. ~180 lines. Contains `BucketSidebarSliver` +
  `BucketSidebarPanel` internal components.
- `components/extraction/bucket/source-chip.tsx` — shared chip.
  ~20 lines.
- `components/extraction/bucket/animated-count.tsx` — shared animated
  count component. ~40 lines.
- `lib/__tests__/bucket-sidebar-store.test.ts` — store unit test.
- `tests/components/bucket-sidebar.test.tsx` — sidebar mount +
  collapse + keyboard.
- `tests/components/animated-count.test.tsx` — count animation +
  reduced-motion test.
- `tests/components/bucket-clear-toast.test.tsx` — undo-toast flow
  (both desktop + mobile).

### Deleted

No whole-file deletions. Specific deletions:

- `components/extraction/bucket/bucket-drawer.tsx` — the `<AlertDialog>`
  block (lines 150-181), the `confirmClear` useState (line 73), the
  AlertDialog imports (lines 14-24), the local `SOURCE_LABELS` const
  (lines 34-40, duplicates the lib's `BUCKET_SOURCE_LABELS`). Vaul
  wrapper stays because the drawer is still mobile's surface.
- `components/extraction/bucket/bucket-indicator.tsx` — the two
  sibling `<Badge>`s at lines 48-57.

`components/ui/drawer.tsx` stays untouched. `vaul` stays in
`package.json`. `cascader.tsx` is the anchor.

---

## 9. Test strategy

- **Unit** (Task 1, 6): pure Zustand + type tests; no DOM.
- **Component** (Task 2, 3, 4, 5, 7, 8, 9): React Testing Library +
  jsdom; render the sidebar / drawer / indicator in isolation; exercise
  clicks, keyboard, `AnimatePresence` unmount cycles. For motion
  assertions, use `motion/react`'s test utilities or fall back to
  "eventually displays text" patterns via `waitFor`.
- **Integration** (Task 10): render `<JobCreator>` with the bucket
  store seeded; assert the right surface (indicator vs. sidebar)
  appears for the simulated viewport. Use `window.matchMedia` mocks
  to drive `useIsMobile`.
- **Reduced motion**: mock `useReducedMotion` → `true` in the Task 5
  animated-count test; assert the `motion.*` wrappers don't render
  (the component returns `<span>{value} / {total}</span>` bare).

Baseline: every prior plan (P4-P7) ends green. Keep it green at every
commit.

---

## 10. Open items (flag to user before starting)

1. **Default collapse state.** §5a sets `isCollapsed: false` (sidebar
   opens expanded by default on first visit). Alternative: default
   collapsed (showing only the 48 px sliver), user opens deliberately.
   **Default: expanded.** Rationale: discoverability — first-time
   users see the bucket and understand the feature. Once users have
   habituated the pattern, they'll collapse it themselves (state
   persists). Ask if the user prefers collapsed-by-default to save
   horizontal real estate on narrower desktops.

2. **Step-3 auto-collapse.** §1 flags this as optional stretch: when
   the wizard advances to Step 3 (question builder), auto-collapse
   the sidebar so the question textarea has more room. **Default:
   no auto-collapse** — the sidebar's 360 px leaves plenty of room
   for a 640 px-max text area on a 1280 px viewport. Ask if the user
   wants auto-collapse; if yes, add a `useEffect` in `bucket-sidebar.tsx`
   watching the wizard step param (from `job-creator.tsx`'s `nuqs`
   state).

3. **Dark-mode chart tokens.** §4d: chart-1..5 are light-only in
   `globals.css`. OKLCh inheritance gives acceptable legibility on
   dark mode, but a dark-mode design review might flag the
   chart-4 (red/pink, `oklch(0.6 0.18 330)`) against the
   destructive-tinted count span as confusing. **Default: ship
   light-only.** If dark mode flags come in post-merge, add
   `.dark` variants in a follow-up (one-file change).

4. **Keyboard chord.** Ctrl/Cmd+Shift+B. Unused today. If the user
   wants a different chord (Ctrl+B for macOS "Bold" muscle memory
   conflict; Ctrl+Shift+S for staging), flag before shipping.
   **Default: Ctrl/Cmd+Shift+B.**

5. **`AlertDialog` deletion blast radius.** Task 7 deletes the
   AlertDialog imports from `bucket-drawer.tsx`. `components/ui/alert-dialog.tsx`
   stays — other consumers exist (grep shows references outside
   bucket). **Default: no blast radius.** Confirmed by `grep -rn
   "alert-dialog" components/`.

6. **Count bounce intensity.** §5h: `scale: [1, 1.15, 1]` over 300 ms.
   Might feel jumpy in fast bulk-select scenarios (shift-click +200
   items → many rapid pulses). Alternative: debounce the pulse to once
   per 250 ms rolling window, or scale down to `[1, 1.08, 1]`.
   **Default: ship as-specced.** Dial down if it feels excessive in
   user testing.

None of these are blockers. Start at Task 1.
