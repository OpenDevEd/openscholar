---
phase: 105-polish-integration-e2e
verified: 2026-04-16T23:15:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run `npm run test:e2e:workbench` against a provisioned Convex dev deployment + Clerk test user"
    expected: "All 3 tests in e2e/extraction-workbench.spec.ts complete — stage papers (Library/Collections/Search/Manual/Zotero) with counter showing `N/1000`, switch Table/Card/Split views, open evidence drawer, confirm reduced-motion <150ms view-switch, download CSV/JSON/XLSX files each > 0 bytes"
    why_human: "E2E spec requires a live Convex dev deployment + `E2E_CLERK_USER_EMAIL` + Clerk test mode. 105-REVIEW.md warnings (WR-01/WR-02/WR-03/WR-04) flag that some selectors (e.g., `/table view/i` regex, `getByRole('searchbox')`, evidence-drawer click on unwired callback) may need iteration on first live run. Infrastructure exists; first-run green is not guaranteed."
  - test: "Manual mobile viewport check: open any `/extraction/*` route in Chrome DevTools with viewport <=640px"
    expected: "Basket drawer renders full-width; workbench toolbar stacks vertically; view switcher hides Card+Split; each interactive element has a visual hit area >= 44x44 CSS px; no horizontal clipping on tab triggers"
    why_human: "Visual responsive behavior cannot be verified programmatically — the CSS classes are present but rendered layout requires a real browser"
  - test: "Manual reduced-motion check: enable OS `prefers-reduced-motion: reduce`, navigate workbench, switch views"
    expected: "View transitions feel instantaneous with no spring/slide animations; opacity fades may remain; layout does not shift/break"
    why_human: "Subjective UX quality check — programmatic 150ms budget is asserted in E2E but human feel is the real test"
---

# Phase 105: Polish, Integration, E2E — Verification Report

**Phase Goal:** Close the remaining cross-cutting gaps — E2E coverage, mobile responsive drawer, reduced-motion support, i18n audit, and a lint rule that prevents per-tier-limit drift across the extraction codebase.
**Verified:** 2026-04-16T23:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Story

Phase 105 is the v7.0 milestone capstone covering five cross-cutting deliverables across three plans:

- Plan 01 — GAP-03 ESLint rule + Vitest structural test
- Plan 02 — Mobile responsive + reduced-motion + atomic i18n key rename
- Plan 03 — Playwright E2E spec + i18n 6-locale parity test + Convex seed action

The flow is: lint (static) → unit tests (structural protection) → mobile/reduced-motion (user-visible) → i18n parity (structural) → E2E (integration).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An ESLint rule forbids literal `1000`/`200` in extraction UI (SC-1, GAP-03) | VERIFIED | `eslint.config.mjs` lines 19-31 define `no-restricted-syntax` with both selectors. Error messages cite `MAX_EXTRACTION_PAPERS_PER_JOB` / `getExtractionLimit`. Test-file exemption at lines 37-45. Programmatic test `tests/extraction/lint-rule.test.ts` (4 cases) passes in 991ms. `npx eslint components/extraction/ app/extraction/` returns 0 errors (only 4 unrelated warnings). Prepended to `test:ci` |
| 2 | A Playwright E2E flow covers stage → counter → job → views → export (SC-2) | VERIFIED | `e2e/extraction-workbench.spec.ts` (185 lines) defines 3 sequential tests covering all 5 tabs (lib/collections/search/manual/zotero), counter assertion `N/1000`, 3 view transitions (table/card/split), evidence drawer open, reduced-motion 150ms assertion, and CSV/JSON/XLSX downloads. Seed via `npx convex run extraction/testing:seedCompletedJob`. Zotero API mocked via `page.route("**/api.zotero.org/**", ...)` with 2 fixture files (3 collections, 6 items). Wired into `test:ci` as last step |
| 3 | Basket drawer full-width mobile, 44px touch targets, graceful <=640px (SC-3) | VERIFIED | `extraction-basket-drawer.tsx:66` `SheetContent className="flex flex-col p-0 w-full sm:max-w-md"`. `workbench-toolbar.tsx:150` stacks `flex-col sm:flex-row`. `view-switcher.tsx` uses `useIsMobile()` to hide Card+Split. `selector-page-client.tsx` TabsList has `overflow-x-auto`, 5 TabsTriggers with `min-h-[44px]`. 7+ components have `min-h-[44px]`/`min-w-[44px]`. Workbench-shell broadens fallback to `activeView !== "table"` with `mobileViewFallbackToast` |
| 4 | Workbench respects `prefers-reduced-motion: reduce` (SC-4) | VERIFIED | `components/providers/reduced-motion-provider.tsx` exports `<MotionConfig reducedMotion="user">`. `app/layout.tsx` line 14 imports, lines 84-113 wrap children. `app/globals.css` lines 459-466 define global `@media (prefers-reduced-motion: reduce)` clamping all animation/transition durations to `0.01ms !important` with `animation-iteration-count: 1` and `scroll-behavior: auto`. Existing `useReducedMotion()` at `workbench-shell.tsx:177` continues working. E2E spec has programmatic 150ms budget assertion |
| 5 | i18n audit — every v7.0 string in all 6 locales; French diacritics pass (SC-5) | VERIFIED | `tests/i18n/v7-key-parity.test.ts` runs 2 assertions: (a) flattened key sets identical across en-US/en-GB/fr/hi/ja/zh (1540 keys each — verified); (b) 8 curated French v7.0 paths all match `[éèêëàâäôöûüùïîçÉÈÊËÀÂÄÔÖÛÜÙÏÎÇ]`. Test passes in 16ms. en-GB drift cleanup removed 2 orphan `reportBuilder.*` keys. Atomic 3-commit rename `splitMobileToast → mobileViewFallbackToast` preserved parity at every commit. French value `Passage à la vue tableau pour mobile` contains `à` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `eslint.config.mjs` | Flat config with GAP-03 rule + test-file exception | VERIFIED | 50 lines; `defineConfig` with 2 spreads + 2 rule blocks + globalIgnores |
| `tests/extraction/lint-rule.test.ts` | Vitest structural test with >= 3 cases | VERIFIED | 72 lines; 4 `it(...)` cases; all pass in 991ms |
| `components/providers/reduced-motion-provider.tsx` | Client provider wrapping `<MotionConfig reducedMotion="user">` | VERIFIED | 18 lines; `"use client"`; imports from `motion/react` |
| `app/layout.tsx` | Wraps tree in ReducedMotionProvider inside NextIntlClientProvider | VERIFIED | Line 14 import, lines 84-113 wrap |
| `app/globals.css` | Global `@media (prefers-reduced-motion: reduce)` rule | VERIFIED | Lines 459-466 with !important clamps |
| `components/extraction/view-switcher.tsx` | Mobile guard hiding Card+Split | VERIFIED | `useIsMobile()` import line 11, spread conditional line 28 |
| `components/extraction/workbench-shell.tsx` | Broadened fallback: split AND card → table | VERIFIED | Lines 104-106: `activeView !== "table"` + `mobileViewFallbackToast` |
| `components/extraction/workbench-toolbar.tsx` | Mobile-stack flex + hidden sm:inline | VERIFIED | Line 150: `flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-4` |
| `components/extraction/extraction-basket-drawer.tsx` | `w-full sm:max-w-md` on SheetContent | VERIFIED | Line 66 confirms; CTA has min-h-[44px] |
| `components/extraction/extraction-counter.tsx` | min-h-[44px] root wrapper | VERIFIED | Import `MAX_EXTRACTION_PAPERS_PER_JOB` line 9 |
| `components/extraction/add-to-extraction-button.tsx` | min-h-[44px] min-w-[44px] | VERIFIED | Grep match |
| `app/extraction/new/selector-page-client.tsx` | `overflow-x-auto` + 5 TabsTrigger `min-h-[44px]` | VERIFIED | Lines 67-74 confirm |
| `app/extraction/new/zotero-item-row.tsx` | 44x44 min on checkbox + retry | VERIFIED | Grep match |
| `messages/{en-US,en-GB,fr,hi,ja,zh}.json` | 1540 keys each; `mobileViewFallbackToast` in all; `splitMobileToast` gone | VERIFIED | All 6 confirmed at 1540 keys; `grep -c splitMobileToast` = 0; `mobileViewFallbackToast` count = 1 in each |
| `tests/i18n/v7-key-parity.test.ts` | Parity + 8 French diacritic samples | VERIFIED | 108 lines; 2 tests pass |
| `convex/extraction/testing.ts` | `seedCompletedJob` internalAction with triple-condition dev guard | VERIFIED | 59 lines; `"use node"`; `assertDevEnvironment()` + delegates to `testingMutations.insertSeededJob` |
| `convex/extraction/testingMutations.ts` | `insertSeededJob` internalMutation requires `E2E_CLERK_USER_EMAIL` | VERIFIED | 143 lines; throws if env missing; throws if no user found; no "first user" fallback |
| `e2e/helpers/sign-in.ts` | Exports `signIn(page)` + `getTestUserEmail()` | VERIFIED | 27 lines; `auth.spec.ts:3` imports |
| `e2e/fixtures/zotero-collections.json` | 3 collections | VERIFIED | 33 lines; 3 entries |
| `e2e/fixtures/zotero-items.json` | 6 items (mix with/without DOI) | VERIFIED | Present; fixture referenced by `page.route` |
| `e2e/extraction-workbench.spec.ts` | Full v7.0 spec with 3 tests | VERIFIED | 185 lines; uses `execFileAsync` CLI, no ConvexHttpClient import |
| `package.json` | `test:e2e:workbench` + extended `test:ci` | VERIFIED | Line 21 script, line 22 `test:ci` chain ends with `&& npm run test:e2e:workbench` |
| `lib/time-units.ts` (follow-up fix) | `MS_PER_SECOND` for unit-conversion escape | VERIFIED | 14 lines; imported by `job-metrics-panel.tsx:28`, used line 74 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `eslint.config.mjs` | `components/extraction/**/*.{ts,tsx}` | files glob override + no-restricted-syntax | WIRED | Lines 14-31; programmatic test proves fire |
| `package.json scripts.test:ci` | `scripts.lint` | composite command chaining | WIRED | Line 22 starts with `npm run lint &&` |
| `tests/extraction/lint-rule.test.ts` | `eslint.config.mjs` | `new ESLint({cwd: REPO_ROOT})` | WIRED | Line 8, 12; tests pass |
| `app/layout.tsx` | `components/providers/reduced-motion-provider.tsx` | import + wrap | WIRED | Lines 14, 84, 113 |
| `components/providers/reduced-motion-provider.tsx` | `motion/react` | `MotionConfig` import | WIRED | Line 3 |
| `components/extraction/view-switcher.tsx` | `hooks/use-mobile.tsx` | `useIsMobile()` guard | WIRED | Line 11, 20 |
| `components/extraction/workbench-shell.tsx` | `lib/store/extraction-results-view.ts` | `setActiveView("table")` effect | WIRED | Lines 104-106 |
| `e2e/extraction-workbench.spec.ts` | `e2e/helpers/sign-in.ts` | direct import | WIRED | Line 8 import |
| `e2e/extraction-workbench.spec.ts` | `convex/extraction/testing.ts` | CLI `npx convex run` | WIRED | Line 31-32 shell-out |
| `e2e/extraction-workbench.spec.ts` | `api.zotero.org` mock | `page.route(...)` | WIRED | Lines 58, 65 |
| `convex/extraction/testing.ts` | `convex/lib/env.ts` pattern | triple-condition dev guard (mirrored, not imported) | WIRED | Lines 18-27 mirror pattern exactly |
| `tests/i18n/v7-key-parity.test.ts` | `messages/*.json` | `@/messages/*` alias imports | WIRED | Lines 7-12 |

### Data-Flow Trace (Level 4)

Phase 105 is infrastructure (tests, lint config, CSS, i18n, provider) — no dynamic data rendering artifacts. Data flow is not applicable for this verification: ESLint rule receives static AST input; i18n test reads static JSON files at build time; reduced-motion provider is a passthrough; seed action populates test DB.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------|--------|
| `tests/i18n/v7-key-parity.test.ts` | `enUS`, `enGB`, `fr`, `hi`, `ja`, `zh` | static JSON imports | Yes — 1540 keys each | FLOWING |
| `tests/extraction/lint-rule.test.ts` | `result.messages` | ESLint programmatic API | Yes — rule fires on positive cases, 0 on exempt cases | FLOWING |
| `convex/extraction/testingMutations.ts:insertSeededJob` | user record, inserted rows | DB lookup by `by_email` index | Yes — real `ctx.db.insert` calls on extractionJobs/Papers/Questions/Results | FLOWING |
| `ReducedMotionProvider` | (passthrough wrapper) | children prop | N/A — no data rendered | N/A |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Lint rule programmatic test | `npm run test -- tests/extraction/lint-rule.test.ts --run` | 4/4 passed in 1.41s | PASS |
| i18n parity + diacritic test | `npm run test -- tests/i18n/v7-key-parity.test.ts --run` | 2/2 passed in 339ms | PASS |
| GAP-03 rule fires on extraction UI | `npx eslint components/extraction/ app/extraction/` | 0 errors (4 unrelated warnings) — `grep no-restricted-syntax` = 0 matches (pre-existing GAP-03 violations fixed by commit ebfebe0) | PASS |
| Locale key count parity | `node` flatten script for all 6 locales | 1540 keys each | PASS |
| Orphan splitMobileToast removed | `grep -c splitMobileToast messages/*.json` | 0 across all 6 locales | PASS |
| New mobileViewFallbackToast present | `grep -l mobileViewFallbackToast messages/*.json` | Matches all 6 locales, count = 1 in each | PASS |
| French diacritic check | `node -e "require('./messages/fr.json').extraction.workbench.mobileViewFallbackToast"` | Outputs `Passage à la vue tableau pour mobile` (contains `à`) | PASS |
| Full Playwright E2E run | `npm run test:e2e:workbench` | SKIP — requires provisioned Convex dev deployment + Clerk test user | SKIP (human_needed) |
| test:ci chain execution | `npm run test:ci` | SKIP — would run full 5-min build + E2E; pre-existing 1161 lint errors from phases 100-104 would fail the chain before Plan 03 tests run | SKIP (pre-existing) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| GAP-03 | 105-01 | ESLint rule forbidding literal 1000/200 in extraction UI | SATISFIED | Rule in `eslint.config.mjs` lines 19-31, protected by 4-case Vitest structural test, wired into `test:ci`, pre-existing violations fixed by `ebfebe0` |

REQUIREMENTS.md line 174 confirms `GAP-03 | Phase 105 | Complete`. No orphaned requirements — phase 105 maps to exactly 1 REQ-ID (GAP-03) in REQUIREMENTS.md, and that ID is accounted for in plan 105-01's frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `components/extraction/workbench-shell.tsx` | 132 | `void openEvidence;` dead-code suppression (per 105-REVIEW IN-06) | INFO | Dormant callback tied to unwired EvidenceDrawer — CLAUDE.md says no dead code. Phase 105 E2E spec WR-02 asserts a drawer-open flow that won't work until this is wired |
| `e2e/extraction-workbench.spec.ts` | 130, 134, 146, 148 | Regex `/table view/i` etc. won't match icon-only button `title="Table"` (per 105-REVIEW WR-01) | WARNING | E2E spec selectors likely need iteration on first live run. Infrastructure ships; green-run deferred to human verification |
| `e2e/extraction-workbench.spec.ts` | 138-140 | Evidence-drawer click targets unwired feature (per 105-REVIEW WR-02) | WARNING | Same as above |
| `e2e/extraction-workbench.spec.ts` | 163-166 | `getByRole("searchbox")` against `<Input type="text">` — filter skipped silently (per 105-REVIEW WR-03) | WARNING | Test silently degrades to unfiltered export if input not found |
| `e2e/extraction-workbench.spec.ts` | 149-150 | `waitFor("Seeded Paper 0")` non-deterministic reduced-motion timing (per 105-REVIEW WR-04) | WARNING | 150ms budget may not measure what's intended |
| `components/extraction/workbench-toolbar.tsx` | 106-108, 146 | `filteredPaperIds` rebuilt each render (per 105-REVIEW WR-05) | WARNING | Performance-only issue; does not block SC |

**Disposition:** All 5 warnings and 1 info were identified in `105-REVIEW.md`. Per notes: "warnings mostly in the E2E spec about Playwright selectors that may not match element accessible names. E2E infrastructure exists but selectors may need iteration on first live run. These are advisory and do NOT invalidate SC-2 (the coverage criterion is about test SPEC existence, not first-run green)." IN-06 dead-code pattern is tracked but not SC-blocking.

Pre-existing test failures (`convex/extraction/extract.test.ts`, `convex/zotero/purge.test.ts`) from phases 100/104, and DEF-105-01 / DEF-105-02 explicitly deferred items — not flagged as gaps per verification notes.

### Deferred Items

Per `.planning/phases/105-polish-integration-e2e/deferred-items.md`:

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | DEF-105-01: `tests/crash-prevention/prompt-delimiters.test.ts` TS1501 regex-flag error | Future cleanup phase | Origin commit `9955fce` (Phase 94) — predates Phase 105 scope |
| 2 | DEF-105-02: `tests/extraction-results-view-store.test.ts` pageSize drift | Future cleanup phase | Origin commit `db436b0` (Phase 103) — test drifted, store correct |

Also noted: 1161 pre-existing ESLint errors (mostly `react-hooks/exhaustive-deps`, `@typescript-eslint/no-unused-vars`, `react-hooks/set-state-in-effect`) introduced by phases 100-104 outside Phase 105's scope. Flagged in 105-01-SUMMARY under "Issues Encountered" as a dedicated lint-cleanup concern for a later phase.

### Human Verification Required

Three items need human testing before the phase can be fully declared green. The Phase 105 GOAL — "close the remaining cross-cutting gaps" — is substantively achieved: every codified deliverable exists and is wired. The three items below verify integration behaviors that cannot be checked programmatically without live infrastructure or human judgment.

#### 1. Full E2E Playwright run with live Convex + Clerk

**Test:** Run `npm run test:e2e:workbench` with:
  - Local Convex dev deployment running (`npm run dev:convex`)
  - `E2E_CLERK_USER_EMAIL` set to a valid Clerk test user
  - Clerk test mode enabled

**Expected:** All 3 tests pass: (a) stage papers across 5 tabs with counter showing `N/1000`; (b) navigate Table→Card→Split views, open evidence drawer, reduced-motion <150ms; (c) download CSV/JSON/XLSX files all > 0 bytes.

**Why human:** Spec infrastructure is complete but REVIEW warnings WR-01/WR-02/WR-03/WR-04 flag selector issues that may need iteration on first live run. The phase notes explicitly state: "These are advisory and do NOT invalidate SC-2 (the coverage criterion is about test SPEC existence, not first-run green)."

#### 2. Mobile viewport visual check

**Test:** Open `/extraction/new`, `/extraction/{jobId}`, and the basket drawer in Chrome DevTools with viewports at 360px, 480px, and 640px.

**Expected:**
  - Basket drawer renders full-width (no horizontal scroll)
  - Workbench toolbar stacks vertically at <640px
  - View switcher hides Card + Split options at <768px
  - All interactive buttons/checkboxes/tabs have visual hit area >= 44x44 CSS px
  - Selector-page TabsList scrolls horizontally without clipping

**Why human:** CSS classes are confirmed present, but rendered layout requires a real browser context. Visual QA cannot be automated cheaply.

#### 3. Reduced-motion OS-level behavior

**Test:** Enable `prefers-reduced-motion: reduce` at the OS level (macOS System Settings > Accessibility > Display; Windows Settings > Accessibility > Visual Effects; browser DevTools Rendering > Emulate CSS prefers-reduced-motion). Navigate workbench, switch views, open/close basket drawer.

**Expected:**
  - Spring animations are skipped (view transitions feel instant)
  - Opacity fades may remain (per Motion's default reducedMotion="user" semantics)
  - No layout breakage; no elements stuck mid-animation

**Why human:** Subjective UX quality check; programmatic 150ms budget is asserted in E2E but human feel is the real SC-4 test.

### Gaps Summary

**No blocking gaps.** All 5 Success Criteria are substantively met:
  - SC-1 (lint rule): VERIFIED — rule fires, test protects, `test:ci` wired
  - SC-2 (E2E spec): VERIFIED — spec exists, 3 tests covering the full user story, seed + Zotero mocks in place
  - SC-3 (mobile): VERIFIED — classes present at every specified site, confirmed via grep
  - SC-4 (reduced-motion): VERIFIED — MotionConfig + CSS fallback + existing hook consumers compose correctly
  - SC-5 (i18n): VERIFIED — 6-locale parity test passes at 1540 keys each, 8 French diacritic samples confirmed, atomic rename executed cleanly

**Advisory warnings** (from 105-REVIEW, non-SC-blocking):
  - E2E spec selectors may need iteration on first live run (WR-01/02/03/04)
  - Performance micro-optimization deferred (WR-05)
  - Dead-code `void openEvidence;` pattern (IN-06) — conflicts with CLAUDE.md "no dead code" rule but is scoped to the next evidence-drawer integration phase

Human verification is required for behaviors that need live infrastructure or visual judgment — this is the escalation gate, not a gap.

---

*Verified: 2026-04-16T23:15:00Z*
*Verifier: Claude (gsd-verifier)*
