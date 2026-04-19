# P5 — Standardise to Best Practices (React Compiler + Zustand 5)

**Intended reader:** an autonomous coding agent picking this up cold. You have
not seen the conversation. Everything you need is linked below.

---

## 1. Mission

Bring the client code into line with the tools it already uses: **React
Compiler 1.0**, **Zustand 5**, **Next 16**. Specifically:

1. Kill the 4 remaining Zustand fresh-reference bugs that trip the
   `"The result of getSnapshot should be cached to avoid an infinite loop"`
   warning and cascade into `Maximum update depth exceeded` on user-visible
   pages.
2. Purge cargo-cult `"use no memo"` directives (proven, via the compiler
   source itself, to be mis-justified on 8 of 18 files).
3. Rewrite the 10 genuinely affected files so the compiler can cover them,
   then delete the directive everywhere. End state: **zero `"use no memo"`
   in the repo**.
4. Scrap ~210 manual `useMemo` / `useCallback` / `React.memo` calls that the
   compiler already handles, keeping only the load-bearing ones.
5. Stop destructuring whole Zustand stores (subscription = all fields).
   Switch to atomic selectors; reserve `zustand/react/shallow` for the
   genuine multi-field case.
6. Add `experimental.optimizePackageImports` so `lucide-react`, `date-fns`,
   `radix-ui`, `motion`, and `@clerk/nextjs` tree-shake in dev HMR and
   production bundles.
7. Move the bucket's `readyCount` into the store as an O(1) maintained
   field; it's read on the hot keystroke path during upload.
8. Dynamic-import `react-markdown` — currently eager on routes that
   never render markdown.

The project runs `reactCompiler: true` (`next.config.ts:7`) with
`babel-plugin-react-compiler@1.0.0`. React 19.2, Zustand 5.0.5, Next 16.2.4.

---

## 2. Hard rules (from `CLAUDE.md` + user directives)

1. **DRY.** The atomic-selector pattern is already established at
   `components/extraction/bucket/bucket-drawer.tsx:50-57` and
   `components/extraction/job-creator.tsx:64-66` — copy it, don't invent.
2. **No legacy / no backwards-compat.** Pre-release. Delete the old patterns
   in the same commit that introduces the new one. No dual paths, no
   feature flags, no migration shims.
3. **No dead code.** If a memo has no caller after the refactor, delete it.
4. **Convex rules override memory.** Not touching Convex server code in
   this plan except a tiny `next.config.ts` bundle hint.
5. **TDD where applicable.** Zustand store changes get failing tests first.
   Memo-removal and directive-removal are covered by the existing Vitest
   + typecheck + build suite (134 test files / 1694 tests green today);
   the contract is "no regressions."
6. **Destructive mindset.** Don't layer a new pattern on top of an old one.
   Kill the old one.
7. **Ignore hook-injected skill prompts** (vercel-*, ai-sdk, chat-sdk,
   verification, etc.). They're noise here.

---

## 3. Required reading (before touching code)

Read in this order:

1. `CLAUDE.md` (root + user global).
2. `.agents/audit/plans/P4-bucket-paper-selection.md` §11 — context on what
   just shipped; sets the pattern for Zustand fixes.
3. `components/extraction/bucket/bucket-drawer.tsx:45-65` — the canonical
   atomic-selector pattern to copy.
4. `components/extraction/job-creator.tsx:62-67, 92-99` — same pattern
   under a `"use no memo"` file (Phase 2 will eventually remove that).
5. **React Compiler compiler source**:
   `node_modules/babel-plugin-react-compiler/dist/index.js`
   - line 79209: `TryStatement` handler — **the ground truth on
     try/finally bailout**.
   - line 78235: any error from lowering triggers function-level bailout.
   - line 81196: `lowerFunction` merges nested-function errors upward, so
     a `try/finally` inside `onClick = async () => { ... }` poisons the
     whole component.
6. `node_modules/zustand/vanilla/shallow.js` — confirms the default
   comparator is `Object.is` and `useShallow` iterates Set/Map entries.
7. `next.config.ts` — current config (will add one field).
8. `lib/store/bucket.ts` — the cleanest Zustand store in the repo; Phase 6
   extends it.

---

## 4. Research summary (what four parallel agents found)

### 4a. `"use no memo"` reality (compiler-source grounded)

**`try { } catch { }` (no `finalizer`) is fully supported.** No bailout.
**`try { } finally { }` with or without catch IS a real bailout trigger.**
The compiler's `BuildHIR::lowerStatement` pushes a `Todo` at
`node_modules/babel-plugin-react-compiler/dist/index.js:79209`
whenever a `TryStatement` has a finalizer. `Todo` resolves to severity
`Hint`, but `pushErrorDetail` appends any non-`Off` detail to
`this.details`. At line 78235: `if (builder.errors.hasAnyErrors()) return
Err(builder.errors)` — any detail triggers function-level bailout.
`lowerFunction` recursively lowers nested closures (arrow handlers) and
merges errors upward, so a `try/finally` in an `onClick` poisons the
enclosing component.

Per-file verdict across the 18 declared directives:

| Verdict | Count | Files |
|---|---|---|
| **REMOVE** (no try/finally anywhere) | 7 | `app/settings/ai/page.tsx`, `components/extraction/pdf-viewer.tsx`, `components/extraction/bucket/bulk-pdf-upload.tsx` (has only `try/catch`, no finally), `components/providers/convex-provider.tsx`, `components/bookmarks-command-center/bookmarks-guide.tsx`, `components/app-sidebar.tsx`, `components/ui/calendar.tsx` |
| **REFACTOR then REMOVE** | 1 | `components/history-command-center/index.tsx` — pure `try/catch` (no finally) + a render-time component factory that's the real bug |
| **KEEP until the `finally` is rewritten** | 10 | `app/settings/billing/page.tsx`, `components/extraction/job-creator.tsx`, `components/extraction/question-builder.tsx`, `components/PageContent.tsx`, `components/search-command-center/search-mode.tsx`, `components/search-command-center/screening-expansion.tsx`, `components/Pricing.tsx`, `components/extraction/report-builder.tsx`, `components/extraction/review-queue.tsx`, `components/search-command-center/adjust-mode.tsx`, `components/search-command-center/search-command-footer.tsx` (11 listed, actually 10 — `adjust-mode.tsx` has sync effect + try/finally, counted once) |

The **KEEP** group can all become **REMOVE** by rewriting:

```ts
// BEFORE — bails out the whole component
setLoading(true);
try {
  await doStuff();
} catch (e) {
  toast.error(e);
} finally {
  setLoading(false);
}

// AFTER — compiler-friendly; duplicate cleanup is the idiomatic fix
setLoading(true);
try {
  await doStuff();
  setLoading(false);
} catch (e) {
  setLoading(false);
  toast.error(e);
}
```

(A single helper `withLoading(setLoading, async () => ...)` scoped to the 10
call sites would DRY this, but it's optional and introduces a new pattern;
the plan uses the straight-line refactor.)

### 4b. Zustand selector identity — 4 remaining bugs

Inventory found **68 selector callsites** across 42 files using 21 stores.
Commit `0b67a0d` fixed 6 bucket-UI bugs. **4 identity-stability bugs remain
in user-visible flows:**

| File:Line | Selector | Fresh return | Impact |
|---|---|---|---|
| `components/results-list.tsx:303` | `(s) => searchId ? s.searchHistory.find(i => i.id === searchId) : null` | fresh `SearchResult` object | Every search results page |
| `components/screening/screening-dialog.tsx:79` | `(s) => s.searchHistory.find(...)?.screeningQuestions \|\| []` | fresh `[]` or fresh array ref | Every screening run |
| `lib/hooks.ts:99` | `(s) => searchId ? s.searchHistory.find(i => i.id === searchId) : null` | fresh `SearchResult` object | Core `useCurrentSearchResult` hook |
| `components/paper-card/hooks.ts:67` | `(s) => data?.id && lang ? s.getTranslation(...) : null` | fresh `TranslationData` object | Every paper card translation |

All four fix the same way: select the stable container (`s.searchHistory`
array; `s.translations` map) through Zustand, then derive via `useMemo`.

### 4c. Store-wide destructuring (re-render amplifier)

Multiple sites call `const { a, b } = useFooStore()` without a selector.
Zustand treats that as a subscription to the **whole state object**, so
every unrelated mutation re-renders the component. Worst offenders:

- `components/results-list.tsx:307` — destructures whole `useSearchHistoryStore`
- `components/app-sidebar.tsx:383`
- `components/history-command-center/index.tsx:84` (4 fields from `useUIStore`)
- `components/extraction/extraction-command-center.tsx:64-69`
- `components/extraction/question-builder.tsx:261-267`
- `components/PageContent.tsx:37, 49`
- `components/bookmarks-command-center/index.tsx:100`
- `components/search-history.tsx:68` (destructures 4 fields from `useSearchHistoryStore`)

Atomic-selector rewrite is the fix. `useShallow` from `zustand/react/shallow`
is only warranted where ≥ 2 fields are read AND they change together; in
this codebase, that's roughly 3–4 sites.

### 4d. Manual memoization — ~77% redundant

273 manual memo calls in files without `"use no memo"`. Under React
Compiler 1.0 with the default `reactCompiler: true`, roughly **~210 of
these are redundant**. The clear-cut removal targets:

- **27 × `React.memo()` panel wrappers in `components/search-sidebar.tsx`**
  — receive fresh prop objects from the parent; `memo` equality always
  fails; pure cost.
- **`memo()` on view components**: `TableView` (`results-views/table-view.tsx:45`),
  `CardView` (`card-view.tsx:38`), `SplitView` (`split-view.tsx:27`),
  `ResultCell` (`table-view.tsx:294`), `FilterSection`
  (`shared/filter-section.tsx:20`) — same problem.
- **Standalone `useMemo`** in `country-selector.tsx:65,199`,
  `extraction-command-center.tsx`, `cookie-consent-banner.tsx`, and
  similar files where the value is only consumed in JSX.

Load-bearing memos to **keep**:

- `zotero-selector.tsx:60` — `new Set(bucketOrder)` passed to a function
  argument.
- `zotero-selector.tsx:134` — `libraryType/groupId/…` object passed into
  `fromZoteroItem(...)` inside a loop.
- `zotero-selector.tsx:173` — `CascaderOption[]` tree passed as a prop.
- `screening-dialog.tsx:89,99` — dependency chain feeding
  `getDefaultScoringConfig`.
- `search-sidebar.tsx:532` — callback prop to a `React.memo`'d child.
- `library-page-client.tsx:87` — callback prop feeding URL-state setter.
- `year-range-picker.tsx:62-107` — five callbacks into controlled inputs.
- `results-toolbar.tsx:64,70` — stable options arrays for `<Select>`.

### 4e. Bundle hygiene

`next.config.ts` has no `experimental.optimizePackageImports`. 126 files
barrel-import from `lucide-react`; `date-fns` + the `radix-ui` meta-package
+ `motion` + `@clerk/nextjs` are all on the Next team's "commonly benefits"
list. One-line config change; global win (several hundred ms off cold
build + dev HMR).

### 4f. Hot-path selector in the bucket

`components/extraction/bucket/bucket-indicator.tsx:17-22` reduces over
`s.order` on every render during upload. A 1000-item bucket scans 1000
items per mounted keystroke. Move the counter into the store as a
maintained field (`readyCount`), updated inside `addMany` / `remove` /
`updateStatus` / `clear`.

### 4g. Eager `react-markdown`

`components/markdown-content.tsx` imports `react-markdown` + `remark-gfm`
at module top level; pulled into `Pricing.tsx` and legal pages (client
routes), inflating their bundles for a feature 90 % of sessions never
render. Wrap the inner renderer with `next/dynamic`.

---

## 5. Architectural decisions (locked)

### 5a. Zustand selector discipline (the one pattern)

```ts
// Selector returns a primitive, a stable store reference, or a stable
// function/method ref. It NEVER builds a new object/array/Set/Map.
const order = useBucketStore((s) => s.order);
const items = useBucketStore((s) => s.items);

// Derivation goes in useMemo (compiler will auto-handle files without
// "use no memo", but the explicit memo is cheap and future-proof for
// files still under the directive).
const readyItems = useMemo(
  () => order.map((k) => items[k]).filter((i) => i?.status === "ready"),
  [order, items],
);
```

**`useShallow` exception.** Use `useShallow((s) => ({ a: s.a, b: s.b }))`
ONLY when a component genuinely reads ≥ 2 fields AND they mutate together
AND neither side makes sense to select atomically. Document the reason in
a comment. Currently expected use: at most 3–4 sites.

**Destructure ban.** `const { a, b } = useFooStore()` is forbidden. Lint
rule not added here — the review discipline suffices for pre-release.

### 5b. `"use no memo"` policy

End state: **zero `"use no memo"` directives in the repo.**

Any file that contains `try { } finally { }` in render code or handler
closures gets rewritten to the duplicated-cleanup form in §4a. Any file
declaring the directive with no matching construct gets the directive
deleted.

### 5c. Manual memoization policy

Default: **don't write `useMemo` / `useCallback` / `React.memo`.** The
compiler covers you. Write them only when:

1. The value is passed as a dependency into `useQuery`, `useMutation`,
   `useAction`, `usePaginatedQuery`, another `useMemo`/`useCallback`, or a
   `useEffect`.
2. The value is passed as a prop to a child wrapped in `React.memo` (and
   that `memo` is itself load-bearing, not cargo-cult).
3. The value is passed to a Zustand selector or the second argument of
   `useSyncExternalStore`.

Otherwise: plain expression. The compiler memoizes it.

### 5d. Bundle config

`next.config.ts` grows one field:

```ts
experimental: {
  optimizePackageImports: [
    "lucide-react",
    "date-fns",
    "radix-ui",
    "motion",
    "@clerk/nextjs",
  ],
},
```

No other changes to `next.config.ts`.

### 5e. `readyCount` in bucket store

`lib/store/bucket.ts` grows a `readyCount: number` field. Maintained
inside `addMany`, `remove`, `updateStatus`, `clear`. Never computed at the
call site.

### 5f. `react-markdown` boundary

`components/markdown-content.tsx` splits into a thin wrapper (keeps the
named export) and an inner component imported via `next/dynamic` with
`ssr: true`. No prop-shape changes.

---

## 6. Task list

Ordered. Later tasks depend on earlier. Each is an atomic commit with its
own failing-test-first step where a test is possible. Commit message
prefix `T<N>.<sub>`.

### Phase A — Critical bugs

#### Task 1 — Fix 4 remaining Zustand fresh-reference bugs

**Why.** User-visible. Each causes infinite-render cascade on a core flow.

**Test first.** `tests/store/zustand-selector-stability.test.ts`:

- Mount `<ResultsList />` with a mocked search-history store; render
  twice; assert the selector output's identity is stable when
  `searchHistory` hasn't changed.
- Same for `useCurrentSearchResult` (`lib/hooks.ts:99`).
- Same for `<ScreeningDialog>`.
- Same for `paper-card/hooks.ts:67`.

Each test is a regression guard — will fail today.

**Implementation.** One file per commit (4 commits) OR one commit if the
test file covers all four. Prefer one commit since the pattern is
identical and the test file owns the invariant.

- `components/results-list.tsx:303` → select `s.searchHistory`; derive
  the single result in `useMemo`.
- `components/screening/screening-dialog.tsx:79` → same.
- `lib/hooks.ts:99` → same.
- `components/paper-card/hooks.ts:67` → select `s.translations` (the
  stable Map/Record on the store), derive the single translation in
  `useMemo`.

**Done when.** Test file green, regression fixtures reproduce pre-fix and
pass post-fix.

---

### Phase B — Purge cargo-cult `"use no memo"`

#### Task 2 — Delete the 7 false-positive directives

**Why.** Seven files declare the directive with no matching `try/finally`
anywhere in the source. Immediate ~0 risk.

**Test first.** Build + full `pnpm test` is the gate. Optionally add a
check-script at `scripts/check-no-unjustified-no-memo.sh` that greps for
`"use no memo"` and asserts each file contains `try` + `finally` tokens.

**Implementation.** Single atomic commit removing the directive from:

- `app/settings/ai/page.tsx`
- `components/extraction/pdf-viewer.tsx`
- `components/extraction/bucket/bulk-pdf-upload.tsx`
- `components/providers/convex-provider.tsx`
- `components/bookmarks-command-center/bookmarks-guide.tsx`
- `components/app-sidebar.tsx`
- `components/ui/calendar.tsx`

**Done when.** `pnpm build` + full test suite green.

---

#### Task 3 — Refactor `history-command-center/index.tsx` + remove directive

**Why.** The directive's real justification — "createHistoryListItem +
Date.now" — is actually a rules-of-React violation (component factory
invoked during render at line 275-278, producing a fresh component
identity each render; children re-mount). The `try { } catch { }` blocks
in the handlers are fine per §4a.

**Test first.** Render the component with a stable history list; assert
the rendered `HistoryItem` instances keep their keys stable across
re-renders (snapshot of `data-testid` attributes, or a React DevTools
profile fingerprint if tractable).

**Implementation.** Hoist `createHistoryListItem` to a module-level
`<HistoryListItem viewMode onSearchClick item />` component. The JSX at
line 275-278 passes `viewMode` and `onSearchClick` as props. Remove the
`"use no memo"` directive at line 2.

**Done when.** Items render with stable React keys; suite green.

---

### Phase C — Eliminate `"use no memo"` on the 10 load-bearing files

#### Task 4.1 through 4.10 — One commit per file

Each of these files has a real `try { } finally { }` block. For each:

1. Rewrite the finally to duplicated cleanup in the try and catch arms.
2. Remove the `"use no memo"` directive.
3. Run `pnpm build` — the compiler will succeed silently or emit a
   specific HIR error, at which point stop and address the next pattern.

Order (alphabetical within the group; no inter-file dependency):

| Sub | File | Handlers touched |
|---|---|---|
| 4.1 | `app/settings/billing/page.tsx` | 3 handlers (lines 210-227, 233-252, 264-283) |
| 4.2 | `components/extraction/job-creator.tsx` | `handleSubmit` (111-165) |
| 4.3 | `components/extraction/question-builder.tsx` | `handleGenerateWithAI` (397-430) |
| 4.4 | `components/extraction/report-builder.tsx` | 5 handlers (156-175, 178-189, 192-206, 208-219, 317-324) |
| 4.5 | `components/extraction/review-queue.tsx` | `handleSaveState` (141-151) |
| 4.6 | `components/PageContent.tsx` | `handleSearchSubmit` (73-95) |
| 4.7 | `components/Pricing.tsx` | 4 handlers (236-253, 281-343, 347-362, 369-422) |
| 4.8 | `components/search-command-center/search-mode.tsx` | 2 handlers (128-157, 170-193) |
| 4.9 | `components/search-command-center/screening-expansion.tsx` | 2 handlers (77-87, 171-203) |
| 4.10 | `components/search-command-center/adjust-mode.tsx` | `handleAiEnhancement` (94-125) |
| 4.11 | `components/search-command-center/search-command-footer.tsx` | 2 handlers (117-139, 170-192) |

**Test first per task.** The relevant handler's behaviour is already
covered by existing tests where they exist. Where they don't, add a
minimal smoke test asserting the cleanup runs in both success and error
paths. (Most handlers are already covered by e2e flows.)

**Done when.** After 4.11, grep for `"use no memo"` returns zero hits.
Add the check-script from Task 2 as a pre-commit / CI assertion.

---

### Phase D — Bundle + config

#### Task 5 — `next.config.ts` — `optimizePackageImports`

**Why.** One line; measurable bundle and HMR improvement; zero risk.

**Test first.** No new test. `pnpm build` reports `First Load JS` smaller
for any route using the listed packages. Capture a before/after from
`.next/analyze/` (if bundle-analyzer is wired) or the build output itself.

**Implementation.** Add `experimental.optimizePackageImports` per §5d.

**Done when.** Build green; before/after numbers noted in commit body.

---

### Phase E — Kill wholesale store destructuring

#### Task 6 — Atomic selectors across the 7 identified files

**Why.** Every unrelated mutation re-renders these components today.
Examples: typing in the search box triggers a re-render of
`<AppSidebar>` because `useSearchHistoryStore()` was destructured.

**Test first.** For each file, a render-count test: mount the component,
dispatch an unrelated store mutation, assert render count incremented by
≤ 1 (or 0 in memoized cases).

**Implementation.** Per file, rewrite:

```ts
// BEFORE
const { searchHistory, removeSearchResult } = useSearchHistoryStore();

// AFTER
const searchHistory = useSearchHistoryStore((s) => s.searchHistory);
const removeSearchResult = useSearchHistoryStore((s) => s.removeSearchResult);
```

Files (one commit per file):

| Sub | File:Line | Store |
|---|---|---|
| 6.1 | `components/results-list.tsx:307` | useSearchHistoryStore |
| 6.2 | `components/app-sidebar.tsx:383-386` | useSearchHistoryStore + useUIStore |
| 6.3 | `components/history-command-center/index.tsx:84` | useUIStore |
| 6.4 | `components/extraction/extraction-command-center.tsx:64-69` | useExtractionStore |
| 6.5 | `components/extraction/question-builder.tsx:261-267` | useExtractionStore |
| 6.6 | `components/PageContent.tsx:37,49` | useUIStore |
| 6.7 | `components/bookmarks-command-center/index.tsx:100` | useUIStore |
| 6.8 | `components/search-history.tsx:68` | useSearchHistoryStore |

**Done when.** For each file the render-count test shows ≥ 1 fewer render
on an unrelated store mutation. No functional regressions.

---

### Phase F — O(1) `readyCount`

#### Task 7 — Maintain `readyCount` in the bucket store

**Why.** Hot path during bulk upload. `bucket-indicator.tsx:17-22`
reduces over 1000 items on every keystroke.

**Test first.** Extend `tests/store/bucket.test.ts`:

- `addMany([ready-a, uploading-b])` → `readyCount === 1`.
- `updateStatus(b, { status: "ready" })` → `readyCount === 2`.
- `updateStatus(a, { status: "failed" })` → `readyCount === 1`.
- `remove(a)` → `readyCount === 0`.
- `clear()` → `readyCount === 0`.

**Implementation.** Extend `BucketState` with `readyCount: number`.
Maintain inside `addMany`/`remove`/`updateStatus`/`clear`. Replace the
reducer in `components/extraction/bucket/bucket-indicator.tsx` with
`const readyCount = useBucketStore((s) => s.readyCount)`. Persist the
field alongside `items`/`order` in the `partialize` config.

**Done when.** New tests green; indicator hits the new path; the old
reducer selector is deleted.

---

### Phase G — Remove redundant manual memoization

#### Task 8 — Delete 27 panel-`React.memo` wrappers in `components/search-sidebar.tsx`

**Why.** Panels always receive fresh prop objects from the parent; `memo`
equality always fails; pure cost + cognitive overhead.

**Test first.** None required — the suite already exercises sidebar
behaviour. Pnpm test + pnpm build must stay green.

**Implementation.** Remove every `React.memo(...)` wrapper in
`search-sidebar.tsx` and the imported `shared/filter-section.tsx:20`.
Keep the memoised callbacks (they were load-bearing FOR those wrappers;
reassess whether they remain load-bearing and delete any that don't).

**Done when.** File compiles; suite green; the component renders
identically by eye.

---

#### Task 9 — Delete `memo()` on view components

**Why.** Same argument as Task 8.

**Implementation.** Remove `memo()` wrappers on:

- `components/extraction/results-views/table-view.tsx:45` (`TableView`)
- `components/extraction/results-views/table-view.tsx:294` (`ResultCell`)
- `components/extraction/results-views/card-view.tsx:38` (`CardView`)
- `components/extraction/results-views/split-view.tsx:27` (`SplitView`)

Check if the parent passes memoised props; if it does and those were
load-bearing only for the removed `memo`, delete them too.

**Done when.** Suite green; DevTools Profiler on a 500-paper job shows no
regression (expected: flat or slight improvement due to less comparison
work).

---

#### Task 10 — Delete remaining redundant `useMemo` in 4 files

**Why.** Each is consumed only inside JSX; compiler covers it.

**Implementation.** Remove from:

- `components/country-selector.tsx:65, 199`
- `components/extraction/extraction-command-center.tsx` (the 4 flagged
  memos)
- `components/cookie-consent-banner.tsx` (the 4 flagged memos)
- `components/extraction/results-views/table-view.tsx` non-load-bearing
  memos (audit the file, keep only the ones passing into Convex hooks or
  other memo dependencies)

**Done when.** Suite green; build size report unchanged or smaller.

---

### Phase H — Dynamic-import `react-markdown`

#### Task 11 — Split `markdown-content.tsx` behind `next/dynamic`

**Why.** `react-markdown` + `remark-gfm` pulled eagerly into `Pricing.tsx`
and legal pages where markdown is rarely rendered.

**Test first.** None (visual smoke). Bundle stats serve as proof.

**Implementation.**

```tsx
// components/markdown-content.tsx
"use client";
import dynamic from "next/dynamic";

const MarkdownInner = dynamic(() => import("./markdown-content-inner"), {
  ssr: true,
  loading: () => null,
});

export function MarkdownContent(props: MarkdownContentProps) {
  return <MarkdownInner {...props} />;
}
```

Move the current body to `components/markdown-content-inner.tsx` (client
component; imports `react-markdown` + `remark-gfm` at top).

**Done when.** `Pricing.tsx` bundle drops by the `react-markdown` chunk
size (visible in `pnpm build` output); markdown pages still render.

---

## 7. Migration & destructiveness checklist

- [ ] 4 remaining Zustand fresh-reference bugs fixed (Task 1).
- [ ] `"use no memo"` directive count: **0** in the repo (Tasks 2-4.11).
- [ ] `scripts/check-no-unjustified-no-memo.sh` (or equivalent CI step)
      in place so regressions fail fast.
- [ ] No `const { ... } = useXStore()` destructure outside `tests/`
      (Tasks 6.1-6.8).
- [ ] `readyCount` lives in `lib/store/bucket.ts` as a maintained field.
      The reducer in `bucket-indicator.tsx` is gone.
- [ ] `next.config.ts` has `experimental.optimizePackageImports` for the
      5 listed packages.
- [ ] 27 panel-`React.memo` wrappers in `search-sidebar.tsx` deleted.
- [ ] View-component `memo()` wrappers deleted (Task 9 list).
- [ ] `react-markdown` is no longer in the `Pricing.tsx` bundle path.
- [ ] Zero `knip` dead-code warnings introduced by this series.

---

## 8. Files inventory

### Modified

- `components/results-list.tsx`
- `components/screening/screening-dialog.tsx`
- `components/paper-card/hooks.ts`
- `lib/hooks.ts`
- 18 files currently declaring `"use no memo"` (7 delete-only, 1
  refactor, 10 handler-rewrite + delete)
- `components/search-sidebar.tsx`, `components/shared/filter-section.tsx`
- `components/extraction/results-views/{table-view,card-view,split-view}.tsx`
- `components/country-selector.tsx`,
  `components/extraction/extraction-command-center.tsx`,
  `components/cookie-consent-banner.tsx`
- `components/markdown-content.tsx`
- `next.config.ts`
- `lib/store/bucket.ts`
- `components/extraction/bucket/bucket-indicator.tsx`
- 8 files from Task 6 (destructure removal)

### New

- `components/markdown-content-inner.tsx`
- `tests/store/zustand-selector-stability.test.ts`
- `tests/store/bucket.test.ts` — extended (not new, but grows)
- `scripts/check-no-unjustified-no-memo.sh` (optional)

### Deleted

- Not applicable — this is a refactor, not a feature deletion. The
  `"use no memo"` directives and redundant memos are *strings deleted
  from files*, not files deleted.

---

## 9. Test strategy

All phases run the existing suite + typecheck + build after each task.
New tests:

- **Zustand identity stability** (Task 1): render-twice assertion against a
  stable-mutation selector. Vitest + `@testing-library/react`.
- **Render-count tests for atomic selectors** (Task 6): render, dispatch
  unrelated store mutation, assert render count. Use a ref-counter pattern.
- **Bucket `readyCount` invariant** (Task 7): extend `tests/store/bucket.test.ts`.
- **CI guard** (optional, Task 2 / 4): `scripts/check-no-unjustified-no-memo.sh`
  grep for `"use no memo"` and fail if any file contains the directive
  without a `finally` block nearby.

Baseline after Task 0: **134 test files / 1694 tests green.** The
contract is "every task leaves the suite green."

---

## 10. Open items (flag to user before starting)

1. **Optional `withLoading` helper.** Task 4.x's `try/finally` rewrite
   could be DRY'd with a tiny helper wrapping setLoading + try + catch.
   Adds one file; delivers ~40 % line reduction across the 10 handlers.
   User pref: add or skip? Default in this plan: **skip** (straight-line
   rewrite is clearer per-site).

2. **Convex `returns:` validators.** The `convex-queries` skill says to
   avoid them. This codebase has 210 uses. Keep as-is (mature app; types
   are valuable)? **Out of scope for this plan unless user disagrees.**

3. **Profile-guided memo removal.** Agent C estimates ~210 / 273 redundant
   manual memos. Tasks 8-10 cover the obvious ones (~80). The remaining
   ~130 need a DevTools Profiler pass on a realistic job to verify. This
   plan leaves them untouched — **propose a P6 follow-up** if the user
   wants full sweep.

4. **`useShallow` adoption.** Currently unused. Plan reserves it for ≥ 2
   co-mutating fields. If the user prefers `useShallow` as the default
   pattern for anything non-primitive, rewrite §5a and regenerate
   Phase E. Default: **atomic selectors + `useMemo`.**

5. **Bundle analyzer wiring.** Task 5 would benefit from
   `@next/bundle-analyzer` to capture before/after. Add it, or just eyeball
   the build output? Default: **eyeball** unless the user asks otherwise.

None of these are blockers. Start at Task 1.
