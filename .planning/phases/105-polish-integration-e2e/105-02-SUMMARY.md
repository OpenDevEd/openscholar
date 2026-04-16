---
phase: 105-polish-integration-e2e
plan: 02
subsystem: ui
tags: [accessibility, motion, reduced-motion, mobile-responsive, touch-target, i18n, next-intl, motion-react, tailwind, atomic-rename]

# Dependency graph
requires:
  - phase: 103-workbench-views-selector-page
    provides: ViewSwitcher component + ActiveView store + workbench-shell useEffect force-switch + existing splitMobileToast key
  - phase: 104-zotero-revival
    provides: ZoteroItemRow State-4 retry button + selector page ZoteroTab
provides:
  - Global MotionConfig reducedMotion="user" honoring OS prefers-reduced-motion via dedicated client-provider file
  - Global CSS @media (prefers-reduced-motion: reduce) fallback covering non-Motion CSS transitions (Tailwind + tw-animate-css)
  - Atomic 3-step i18n rename splitMobileToast → mobileViewFallbackToast across all 6 locales preserving parity at every intermediate commit
  - ViewSwitcher mobile guard hiding Card + Split options on <768px
  - workbench-shell broadened fallback effect forcing BOTH card AND split → table on mobile with new toast key
  - 44px min-w/min-h touch-target compliance on 7 interactive elements across extraction surface
  - Mobile workbench-toolbar vertical stack via flex-col sm:flex-row
  - Mobile export-button label collapse via <span className="hidden sm:inline"> (DropdownMenu wrapper unchanged)
  - Basket drawer full-width on mobile capped at sm:max-w-md
  - Selector-page TabsList overflow-x-auto for narrow viewports
affects: [105-03-polish-validation, future-mobile-work, future-accessibility-audits]

# Tech tracking
tech-stack:
  added: []  # motion already installed; no new runtime deps
  patterns:
    - "Dedicated client-provider file (ReducedMotionProvider) as the pattern for wrapping client-only libraries inside an async RSC root layout (Pitfall 4). Re-applicable to any future motion/<DndProvider>/<SocketProvider>/etc. wrap."
    - "Atomic 3-step i18n key rename: (1) add new keys to all 6 locales together, (2) switch source code reference, (3) delete old keys from all 6 locales together. Ensures locale set-parity is preserved at every intermediate commit so parity tests never false-fail on an in-flight tree."
    - "`min-h-[44px] min-w-[44px]` (or `min-h-[44px]` alone when vertical-only) as the repo-wide touch-target idiom appended via cn() without altering shadcn `size` props (inflates hit area while preserving visual icon size)."
    - "`satisfies CompactIconToggleOption<ActiveView>[]` annotation for conditional view-option arrays — preserves literal-type narrowing without casts."
    - "Responsive flex stack: `flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-4` as the canonical toolbar mobile-stack incantation."
    - "Mobile label collapse: `<span className=\"hidden sm:inline\">` wrapping text children while leaving icons + wrapper Button structure untouched."

key-files:
  created:
    - components/providers/reduced-motion-provider.tsx
    - .planning/phases/105-polish-integration-e2e/deferred-items.md
  modified:
    - app/layout.tsx
    - app/globals.css
    - components/extraction/view-switcher.tsx
    - components/extraction/workbench-shell.tsx
    - components/extraction/workbench-toolbar.tsx
    - components/extraction/extraction-basket-drawer.tsx
    - components/extraction/extraction-counter.tsx
    - components/extraction/add-to-extraction-button.tsx
    - app/extraction/new/selector-page-client.tsx
    - app/extraction/new/zotero-item-row.tsx
    - messages/en-US.json
    - messages/en-GB.json
    - messages/fr.json
    - messages/hi.json
    - messages/ja.json
    - messages/zh.json

key-decisions:
  - "Wrap MotionConfig in a dedicated client-provider file (components/providers/reduced-motion-provider.tsx) instead of inlining in app/layout.tsx, because app/layout.tsx is an async RSC that must continue to call getLocale()/getMessages()/preloadQuery() server-side (Pitfall 4)."
  - "Place ReducedMotionProvider INSIDE NextIntlClientProvider but OUTSIDE ThemeProvider — matches the existing tree's client-boundary expectations and allows any useTranslations() calls inside motion components to resolve."
  - "Use 0.01ms rather than 0 for animation/transition duration in the CSS fallback — avoids the edge-case where some browsers treat `0` as 'instant cancel' with odd animationend firing (RESEARCH.md Pattern 6)."
  - "Include animation-iteration-count: 1 in the CSS fallback — prevents infinite spinners from becoming infinite-instant loops."
  - "Atomic 3-commit rename sequence (add → switch source → delete) preserves locale key-parity between commits so Plan 03's parity test never false-fails on an in-flight tree."
  - "Reuse canonical useIsMobile() hook (@/hooks/use-mobile) rather than introducing a new useIsBelowBreakpoint helper — MOBILE_BREAKPOINT = 768 matches D-14's exact threshold, avoids DRY violation."
  - "`satisfies CompactIconToggleOption<ActiveView>[]` annotation on the conditional view-option spread — preserves literal-type narrowing of card/split values without `as const` widening."
  - "Preserve <DropdownMenu><DropdownMenuTrigger asChild><Button> wrapper exactly as-is in workbench-toolbar export — only wrap the literal text label in <span className=\"hidden sm:inline\"> (DO NOT restructure)."
  - "`min-h-[44px] min-w-[44px]` inflation via cn() merge without touching shadcn `size` props — preserves visual icon size while expanding the hit area."
  - "French translation 'Passage à la vue tableau pour mobile' includes the diacritic `à` satisfying D-25 diacritic-sampling requirement for Plan 03's key-parity test."
  - "Translations for hi/ja/zh chosen as direct equivalents of the en-US string (Hindi: 'मोबाइल के लिए तालिका दृश्य पर स्विच किया गया'; Japanese: 'モバイルではテーブル表示に切り替えました'; Chinese: '已切换到移动版表格视图')."

patterns-established:
  - "Atomic 3-step i18n rename sequence (add → switch source → delete) guarantees parity invariant across all intermediate commits."
  - "Client-provider wrapper file pattern for crossing the RSC→client boundary without migrating the whole layout to a client component."
  - "Global CSS `@media (prefers-reduced-motion: reduce)` + `<MotionConfig reducedMotion=\"user\">` dual coverage — Motion components AND Tailwind/tw-animate-css CSS transitions."
  - "44×44 touch-target inflation via className merge (preserves visual size via shadcn size props)."
  - "Export-button label collapse pattern: `<span className=\"hidden sm:inline\">{label}</span>` wrapping text only, preserving DropdownMenuTrigger asChild Button structure."

requirements-completed: []  # Plan frontmatter `requirements` field is empty; SC-3 and SC-4 are success criteria tracked via `success_criteria_addressed`

# Metrics
duration: 2h 5m
completed: 2026-04-16
---

# Phase 105 Plan 02: Mobile Polish + Reduced-Motion Global Wiring Summary

**Global MotionConfig reducedMotion="user" + @media (prefers-reduced-motion: reduce) CSS fallback for OS-level motion preference, atomic 3-commit i18n rename splitMobileToast → mobileViewFallbackToast across 6 locales, ViewSwitcher mobile guard hiding Card + Split, and 44px touch-target compliance across 7 interactive elements in the v7.0 extraction surface.**

## Performance

- **Duration:** 2h 5m (spanning earlier-agent work on Tasks 1–2 steps 1–2 + this agent's completion of Task 2 step 3 + Task 3)
- **Started:** 2026-04-16T17:56:49Z (first 105-02 commit `086a6a5`)
- **Completed:** 2026-04-16T20:01:39Z (final 105-02 commit `42bf874`)
- **Tasks:** 3
- **Commits:** 5 (Task 1 = 1 commit; Task 2 = 3 commits per atomic rename; Task 3 = 1 commit)
- **Files created:** 2 (reduced-motion-provider.tsx, deferred-items.md)
- **Files modified:** 15 (2 global + 8 component/page TSX + 6 locale JSON — minus any same-file double-count)

## Accomplishments

- Global reduced-motion support landed: `<MotionConfig reducedMotion="user">` wraps every client subtree, and a global CSS `@media (prefers-reduced-motion: reduce)` rule clamps all non-Motion `animation-duration`/`transition-duration` to `0.01ms` with `animation-iteration-count: 1` and `scroll-behavior: auto`. Existing per-component `useReducedMotion()` consumers (workbench-shell, paper-result-card, question-builder) continue to work unchanged — they compose with the global config.
- Atomic 3-commit i18n rename executed without ever leaving the tree in a parity-broken state:
  1. Commit `3329822` added `mobileViewFallbackToast` alongside the old key in all 6 locales.
  2. Commit `c7c04a4` switched `workbench-shell.tsx` + `view-switcher.tsx` to the new key and broadened the force-switch effect from `activeView === "split"` to `activeView !== "table"`.
  3. Commit `c9f0f81` deleted the orphan `splitMobileToast` key from all 6 locales in a single commit.
  At every commit-boundary, all 6 locales hold identical sets (either `{old, new}` or `{new}` only), so Plan 03's key-parity test is guaranteed to pass on any slice of the branch.
- ViewSwitcher hides Card + Split options at `<768px` via `useIsMobile()`; workbench-shell's fallback effect now handles BOTH card AND split → table on mobile with the new locale-specific toast.
- 44×44 touch-target compliance applied to 7 interactive elements across the extraction surface (workbench-toolbar search-clear + export button, basket-drawer CTA, extraction-counter wrapper, add-to-extraction button, 5 selector TabsTrigger elements, zotero-item-row checkbox wrapper + State-4 retry button).
- Mobile toolbar vertical stack at `<640px` via `flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-4`; export button text label collapses to icon-only on mobile via `<span className="hidden sm:inline">` (DropdownMenu wrapper preserved exactly).
- Basket drawer renders full-width on mobile capped at `sm:max-w-md` via Tailwind last-wins cascade over shadcn sheet defaults.
- Selector-page TabsList scrolls horizontally via `overflow-x-auto` on narrow viewports, never clipping.

## Task Commits

Each task was committed atomically. Task 2 used a 3-commit atomic-rename sequence per the plan's parity-preservation requirement.

1. **Task 1: Wire global reduced-motion support** — `086a6a5` (feat)
   - `app/layout.tsx`, `app/globals.css`, `components/providers/reduced-motion-provider.tsx` (new)
2. **Task 2 Step 1: Add mobileViewFallbackToast key to all 6 locales** — `3329822` (feat/i18n)
   - `messages/{en-US,en-GB,fr,hi,ja,zh}.json` (new key added; old key preserved)
3. **Task 2 Step 2: Switch source to new key + hide card/split on mobile** — `c7c04a4` (feat/extraction)
   - `components/extraction/view-switcher.tsx`, `components/extraction/workbench-shell.tsx`
4. **Task 2 Step 3: Remove orphan splitMobileToast key from all 6 locales** — `c9f0f81` (chore/i18n)
   - `messages/{en-US,en-GB,fr,hi,ja,zh}.json` (old key removed)
5. **Task 3: 44px touch-target audit + mobile toolbar stack + basket drawer width** — `42bf874` (feat/extraction)
   - `components/extraction/{workbench-toolbar,extraction-basket-drawer,extraction-counter,add-to-extraction-button}.tsx`, `app/extraction/new/{selector-page-client,zotero-item-row}.tsx`

## Files Created/Modified

### Created

- `components/providers/reduced-motion-provider.tsx` — Client-only wrapper rendering `<MotionConfig reducedMotion="user">{children}</MotionConfig>`. Allows the async RSC `app/layout.tsx` to mount `MotionConfig` without becoming a client component (Pitfall 4).
- `.planning/phases/105-polish-integration-e2e/deferred-items.md` — Logs pre-existing, out-of-scope TS + test failures encountered during verification sweep.

### Modified

- `app/layout.tsx` — Imports `ReducedMotionProvider`; wraps the tree inside `<NextIntlClientProvider>` and outside `<ThemeProvider>`.
- `app/globals.css` — Appends global `@media (prefers-reduced-motion: reduce)` rule with `animation-duration: 0.01ms`, `animation-iteration-count: 1`, `transition-duration: 0.01ms`, `scroll-behavior: auto` — all `!important`.
- `components/extraction/view-switcher.tsx` — Imports `useIsMobile`; spreads card + split options only when `!isMobile`; `satisfies` annotation preserves `ActiveView` narrowing.
- `components/extraction/workbench-shell.tsx` — Broadens the D-06 fallback effect guard from `activeView === "split"` to `activeView !== "table"`; swaps toast key from `splitMobileToast` to `mobileViewFallbackToast`.
- `components/extraction/workbench-toolbar.tsx` — Toolbar root switches to mobile-stack flex; search-clear button inflated to 44×44; export-button label wrapped in `<span className="hidden sm:inline">` (DropdownMenu wrapper preserved).
- `components/extraction/extraction-basket-drawer.tsx` — `SheetContent` adds `w-full sm:max-w-md`; primary CTA Button adds `min-h-[44px]`.
- `components/extraction/extraction-counter.tsx` — Root wrapper gets `min-h-[44px] flex flex-col justify-center` via cn().
- `components/extraction/add-to-extraction-button.tsx` — Button className merges in `min-h-[44px] min-w-[44px]` without altering `size="icon-sm"` prop.
- `app/extraction/new/selector-page-client.tsx` — `TabsList` gains `overflow-x-auto`; each of 5 `TabsTrigger` gains `min-h-[44px]`.
- `app/extraction/new/zotero-item-row.tsx` — Checkbox wrapper and State-4 retry `<button>` each get `min-h-[44px] min-w-[44px]` (retry button also gets `flex items-center justify-center` for icon centering inside the inflated hit-area).
- `messages/en-US.json`, `messages/en-GB.json`, `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json` — Atomic rename: new `mobileViewFallbackToast` key added in step 1, old `splitMobileToast` key removed in step 3. French value `"Passage à la vue tableau pour mobile"` carries the required diacritic.

## Decisions Made

See `key-decisions:` in frontmatter — 11 total. Highlights:

- **Client-provider file over inline MotionConfig in RSC layout.** `app/layout.tsx` is an `async` Server Component calling `getLocale()`/`getMessages()`/`preloadQuery()`; inlining a `"use client"` boundary there would strip those server-side calls. A dedicated `components/providers/reduced-motion-provider.tsx` client file matches the project convention (`ConvexClientProvider`, `ThemeProvider`).
- **Atomic 3-commit i18n rename.** Plan 03 adds a locale key-parity test. Executing the add → switch-source → delete sequence as separate commits with all-6-locales edits bundled into each commit keeps set-parity invariant at every commit boundary.
- **Reuse `useIsMobile()` over a new `useIsBelowBreakpoint`.** The existing `@/hooks/use-mobile` hook already uses `MOBILE_BREAKPOINT = 768`, which matches D-14 exactly — a new helper would be DRY-violating.
- **Do NOT restructure the DropdownMenu wrapper for export button.** The only change is wrapping the literal text label in `<span className="hidden sm:inline">`. The `<DropdownMenu><DropdownMenuTrigger asChild><Button>` structure stays untouched (Radix delegation semantics preserved).
- **Touch-target inflation via className merge, not `size` prop.** Using `min-h-[44px] min-w-[44px]` through `cn()` leaves shadcn `size="icon-sm"` visual padding untouched — the icon stays the same size, only the hit area grows.
- **French value includes `à` diacritic.** `"Passage à la vue tableau pour mobile"` satisfies Plan 03's D-25 diacritic-sampling requirement without awkward wording.

## Deviations from Plan

### Auto-fixed Issues

None. All 3 tasks executed exactly per plan with no Rule 1/2/3 auto-fixes required. The plan's action sections were sufficiently prescriptive (exact className recipes, verbatim translations, structural anchors) that no inferred fixes were necessary.

### Deferred Issues (out of plan scope)

Two pre-existing failures were encountered during the verification sweep but are NOT caused by Plan 105-02 work. Logged to `.planning/phases/105-polish-integration-e2e/deferred-items.md`:

1. **DEF-105-01** — `tests/crash-prevention/prompt-delimiters.test.ts` TS1501 (regex flag requires es2018+). Origin: commit `9955fce` (Phase 94).
2. **DEF-105-02** — `tests/extraction-results-view-store.test.ts` — 2 tests expect the old `migrateViewState` shape without `pageSize: 25`, but the store was updated in commit `db436b0` (Phase 103) without updating the tests. Tests drifted, not the store.

Both are pre-existing; not fixed per executor scope-boundary rule (Plan 105-02 touches zero lines of either file).

---

**Total deviations:** 0 auto-fixed; 2 pre-existing issues logged to deferred-items.md.
**Impact on plan:** Plan executed exactly as written; no scope creep.

## Issues Encountered

None beyond the two deferred pre-existing issues above.

### Verification sweep

- **TypeScript:** `./node_modules/.bin/tsc --noEmit` produces exactly ONE pre-existing error (DEF-105-01 above) and ZERO errors in files affected by Plan 105-02 (filtered grep confirms).
- **Locale JSON parse:** All 6 `messages/*.json` files parse cleanly via `python3 json.load`.
- **Orphan key removal:** `grep -c 'splitMobileToast'` across all 6 locales returns 0; `grep -c 'mobileViewFallbackToast'` returns 1 each.
- **French diacritic:** `grep 'à' messages/fr.json` confirms the `à` is present in the new translation.
- **Acceptance-criteria greps:** All pass — see `<acceptance_criteria>` checklist in `105-02-PLAN.md` Tasks 1/2/3.
- **Locale-detection regression test:** `npx vitest run tests/locale-detection.test.ts` → 7 passed, 0 failed.
- **Provider-nesting order:** `grep -n` confirms line order `NextIntlClientProvider` (83) → `ReducedMotionProvider` (84) → `ThemeProvider` (85) in `app/layout.tsx`.

### Threat flags

None. Plan 02 introduces zero new attack vectors per the threat register (`<threat_model>` in PLAN.md) — `T-105-05` through `T-105-09` all `accept` or `mitigate` with single-file provider control. No new network endpoints, auth paths, or schema changes at trust boundaries.

### Known stubs

None. Grep for `TODO|FIXME|placeholder|coming soon|not available` across modified files returned only legitimate HTML `placeholder=` attributes on form inputs (i18n-backed).

## Next Phase Readiness

- SC-3 (mobile-responsive) and SC-4 (reduced-motion) are closed for the v7.0 extraction surface.
- Plan 03 can now:
  - Run locale key-parity test (all 6 locales hold identical sets with only `mobileViewFallbackToast` — no drift).
  - Run E2E touch-target assertions (`getBoundingClientRect` min-dim ≥ 44 on all 7 elements).
  - Run reduced-motion E2E (emulated `prefers-reduced-motion: reduce` + view-switch completes <150ms).
  - Run French diacritic sampling test (value contains `à`).
- No blockers; no open decisions.

## Self-Check: PASSED

### Commits verified present in git log

- `086a6a5` — Task 1 (reduced-motion): FOUND
- `3329822` — Task 2 Step 1 (add locale keys): FOUND
- `c7c04a4` — Task 2 Step 2 (switch source): FOUND
- `c9f0f81` — Task 2 Step 3 (delete orphan): FOUND
- `42bf874` — Task 3 (touch-targets + stack + drawer): FOUND

### Files verified existing

- `components/providers/reduced-motion-provider.tsx` — FOUND
- `.planning/phases/105-polish-integration-e2e/deferred-items.md` — FOUND
- All 16 modified files — FOUND (grep confirms each acceptance-criteria marker)

---

*Phase: 105-polish-integration-e2e*
*Plan: 02*
*Completed: 2026-04-16*
