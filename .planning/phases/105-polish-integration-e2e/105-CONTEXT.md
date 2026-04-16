# Phase 105: Polish, Integration, E2E - Context

**Gathered:** 2026-04-16 (auto mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the remaining cross-cutting gaps left by Phases 98-104: (1) ship an ESLint rule that forbids literal `1000` / `200` in the extraction surface area to prevent per-tier-limit drift, (2) author a single end-to-end Playwright spec that traces the full v7.0 user story from Zotero connect through workbench export, (3) verify the basket drawer and workbench views degrade gracefully on mobile with 44px touch targets, (4) ensure every motion in the extraction surface honors `prefers-reduced-motion: reduce`, and (5) prove via a structural test that all new v7.0 i18n keys exist in every one of the 6 locale files, including correct French diacritics.

Requirements: GAP-03 (ESLint rule forbidding literal 1000/200 in `components/extraction/**` + `app/extraction/**`). The other four deliverables are success criteria from ROADMAP.md Phase 105 §1-5 (no dedicated REQ-ID; they close v7.0 polish work that no prior phase owned).

This phase is **integration verification, not feature work**. No new runtime dependencies. No new routes. No new Convex tables, mutations, or queries. Only: one ESLint config, one Playwright spec, targeted CSS + className edits, one key-parity Vitest test.

</domain>

<decisions>
## Implementation Decisions

### ESLint Rule Architecture (GAP-03)
- **D-01:** Bootstrap a project-level ESLint config at the repo root — `eslint.config.mjs` (flat config, ESLint 9 / Next.js 16 default) — currently no ESLint config exists at the repo root. Extend `next/core-web-vitals` and `next/typescript`. Install `eslint`, `eslint-config-next`, and `@typescript-eslint/parser` as devDependencies. Add `"lint": "next lint"` to `package.json` scripts and add `npm run lint` as a step in the `test:ci` composite script.
- **D-02:** Express the literal-number ban via `no-restricted-syntax` with two selectors: `Literal[value=1000]` and `Literal[value=200]`. Scope the rule to two glob overrides: `components/extraction/**/*.{ts,tsx}` and `app/extraction/**/*.{ts,tsx}`. The rule is `error` level (fails CI).
- **D-03:** Allow-list exceptions: (a) `**/*.test.ts` / `**/*.test.tsx` inside those globs (tests may legitimately assert against the cap value), (b) `convex/lib/queryBounds.ts` which defines the constants (not covered by the glob anyway — `convex/**` is outside scope), (c) any file that imports from `convex/lib/queryBounds` or uses the `getExtractionLimit` reactive query (the point of the ban is to force consumers through the limit system, not to prohibit importing the source of truth). Implement the test-file exception via a nested glob override: `components/extraction/**/*.test.{ts,tsx}` → rule disabled.
- **D-04:** Error message: `"Literal '1000'/'200' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER."`. Points devs directly at the correct fix.
- **D-05:** Add a Vitest structural test `tests/extraction/lint-rule.test.ts` that runs ESLint programmatically against a fixture file containing literal `1000` and literal `200` in `components/extraction/` to prove the rule fires — protects against silent rule removal.

### E2E Playwright Spec
- **D-06:** Single comprehensive spec: `e2e/extraction-workbench.spec.ts`. Runs under the **default** Playwright project (not `billing`) — it reuses the existing `e2e/global.setup.ts` Clerk user provisioning. No new project config. No new `workers: 1` requirement — the default `fullyParallel: false` is sufficient since we only add one spec.
- **D-07:** Test structure: one `test.describe("v7.0 extraction workbench end-to-end", ...)` block with `test.beforeAll` for Clerk sign-in (mirrors `e2e/auth.spec.ts` line 14 `signIn(page)` helper — extract to `e2e/helpers/sign-in.ts` for reuse) and three sequential `test()` steps: **(1)** stage papers from 4 tabs + counter updates, **(2)** create job + navigate all 3 views + open evidence drawer, **(3)** export filtered subset in CSV/JSON/XLSX.
- **D-08:** Zotero strategy — **mock via `page.route()`**. Intercept calls to `https://api.zotero.org/**` and return canned JSON fixtures (collections, items with/without DOI). Also intercept the `convex/zotero/actions.ts:startOAuth` call path via `page.route` on the Convex action URL and return a stub indicating "already connected" for the test user. Rationale: live OAuth 1.0a in CI is brittle (requires real Zotero test account + callback URL whitelisting). The mock exercises ZoteroTab UI end-to-end without external dependencies.
- **D-09:** Extraction backend strategy — **seed via Convex internal action**, do NOT run the real LLM cascade. Create a dev-guarded `internal.extraction.testing.seedCompletedJob(jobId, paperCount)` internalAction that inserts an `extractionJobs` row with `status: "completed"` plus N `extractionPapers` + `extractionResults` rows with realistic answer text and evidence spans. The E2E test calls this via Convex `runAction` before navigating to `/extraction/[jobId]`. Rationale: the real cascade takes 1-2 minutes per paper and is tested by the extraction unit suite — the E2E test verifies workbench UI wiring, not the cascade.
- **D-10:** Export verification — use Playwright's `page.waitForEvent("download")` for each of CSV / JSON / XLSX export. Assert filename pattern and byte-size > 0. Parsing the export content is out of scope (unit tests already cover the generators).
- **D-11:** Zotero, Library, Search, Collections, and Manual tabs are all exercised. For each, add 1-2 papers to the basket via UI interaction (click checkboxes, click "Add to basket"). Assert the counter shows the expected count and the basket drawer displays papers grouped by source. Search tab uses a pre-seeded `searchHistory` row (seeded via the same testing action) — we do NOT hit the real OpenAlex search API.
- **D-12:** The spec runs under `npm run test:e2e:auth` style invocation via a new script `npm run test:e2e:workbench` → `playwright test e2e/extraction-workbench.spec.ts --config=playwright.config.ts`. `test:ci` is extended to include this spec alongside `test:e2e:auth`.

### Mobile Responsive Targets
- **D-13:** Basket drawer baseline: full-width shadcn `Sheet side="right"` already renders full-width on mobile (Sheet's default responsive behavior). Verify `w-full sm:max-w-md` pattern is applied to `components/extraction/extraction-basket-drawer.tsx`. Do NOT introduce a dedicated bottom-sheet variant — that is deferred to MOB-F01 (Phase 105 ships the baseline per ROADMAP explicit).
- **D-14:** Workbench view switcher — **auto-switch to table view at viewports `<768px`** and hide the card + split options in `components/extraction/view-switcher.tsx`. Phase 103 D-06 already decided split view falls back to table on mobile; Phase 105 extends the same rule to card view for consistency. Implementation: read viewport via an existing `useIsMobile()` hook (check `hooks/use-is-mobile.ts` or reuse the pattern from `components/shared/sidebar-layout.tsx`) and conditionally render the view switcher options. If `isMobile && activeView !== "table"`, force `activeView = "table"` on mount via the Zustand store.
- **D-15:** Selector page tabs on mobile — shadcn Tabs primitive already supports horizontal overflow scroll via `overflow-x-auto` on the `TabsList`. Verify and enforce in `app/extraction/new/selector-page-client.tsx`. No custom dropdown-on-mobile pattern.
- **D-16:** 44px touch-target enforcement — add `min-h-[44px] min-w-[44px]` to interactive elements in the v7.0 extraction components: `<AddToExtractionButton>`, `<ExtractionCounter>` progress bar container, `<ZoteroItemRow>` checkbox hit area, `<WorkbenchToolbar>` icon buttons, tab triggers on `<SelectorPage>`. Audit scope: v7.0-added files only (anything under `components/extraction/**` or `app/extraction/**` touched by Phases 98-104). Pre-v7.0 components are out of scope.
- **D-17:** Responsive breakpoint source of truth: use Tailwind's `sm:` (640px) and `md:` (768px) tokens consistently. Do NOT introduce new custom breakpoints. At `<640px` (Tailwind `default` / pre-`sm`), the workbench toolbar stacks vertically (filter controls wrap to a second row), the export dropdown condenses to an icon-only button, and the column-visibility popover disappears (column visibility is irrelevant when only the card/list view is available — see D-14).

### Reduced-Motion Implementation
- **D-18:** Hybrid strategy — **wrap the root layout with `<MotionConfig reducedMotion="user">`** from `motion/react`. This globally forces Framer Motion / Motion animations to respect the user's OS-level `prefers-reduced-motion` setting. This handles `AnimatePresence` + `motion.div` in WorkbenchShell, view transitions, drawer slides, and counter progress animations automatically.
- **D-19:** Add a global CSS rule in `app/globals.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
  This covers Tailwind's `transition-*` utilities and any CSS `@keyframes` animations that bypass Motion (e.g., `tw-animate-css` usages). Combined with D-18, every animation in the app respects reduced-motion without per-component refactoring.
- **D-20:** Essential feedback preserved — focus rings, color state changes (hover/active/disabled), and instant layout changes are NOT animations; they are not affected by D-18 or D-19. Progress-bar fills that communicate live state continue to render (the instant-jump is acceptable UX); only the easing is removed.
- **D-21:** Audit existing `useReducedMotion()` usages — grep confirms several components already call the hook (paper-result-card, workbench-shell, question-builder, etc.). Leave these in place — they add per-component fine-grained control on top of the global `MotionConfig`. No refactor needed.
- **D-22:** Verification — add a Playwright test inside the E2E spec that calls `page.emulateMedia({ reducedMotion: "reduce" })` before navigating to `/extraction/[jobId]`, then asserts that the view switcher transition between table and split views completes in `<100ms` (i.e., animation was skipped, not merely shortened). This is a single assertion appended to test step (2) from D-07.

### i18n Audit Methodology
- **D-23:** Create a new Vitest structural test `tests/i18n/v7-key-parity.test.ts` (new `tests/i18n/` subdirectory). The test loads all 6 locale JSON files (`messages/en-GB.json`, `en-US.json`, `fr.json`, `hi.json`, `ja.json`, `zh.json`), flattens each to a dot-separated key set, and asserts perfect set equality across all 6. Pure logic test — runs under the default `node` environment (per `tests/` environment routing in `vitest.config.ts`).
- **D-24:** Scope — the test walks the ENTIRE key tree of each locale, not a hand-picked subset. A v7.0 namespace drift check is built in naturally: if Phase 102 added `extraction.counter.label` to `en-US.json` but not `fr.json`, the test fails with the missing key listed. No namespace whitelist — the whole `messages/*.json` set must agree.
- **D-25:** French diacritic sampling — after the parity check, the test asserts that for a curated sample of 8-10 v7.0 French keys that MUST contain diacritics (`résolution`, `démarrer l'extraction`, `déjà dans le panier`, `éléments Zotéro`, etc.), the stored string value contains at least one character in the set `[éèêëàâäôöûüùïîçÉÈÊËÀÂÄÔÖÛÜÙÏÎÇ]`. This catches accidental transliteration (e.g., `"demarrer"` slipping through a copy-paste from en-US).
- **D-26:** Missing-key policy — the test fails the build. No "optional" locales, no skip list. All 6 locales are production. If this test fails, Phase 105 is not done.
- **D-27:** Do NOT attempt a "used but unused" audit (keys present but never called via `t()`). That is a reverse-direction lint rule that requires AST parsing of every `.tsx` file in the app — explicitly out of scope for this phase.
- **D-28:** Run command — the new test is picked up automatically by `npm run test` via the default Vitest glob. No new script. CI coverage comes for free.

### Claude's Discretion
- Exact fixture JSON shape for the Zotero API mock (collections + items with/without DOI)
- Exact Clerk test user sign-in helper extraction location (`e2e/helpers/sign-in.ts` vs inline in the spec)
- Exact glob patterns for the ESLint `no-restricted-syntax` override block vs test-file exception nesting
- Exact list of 8-10 French diacritic sample keys (curated at implementation time from seeded v7.0 keys)
- Whether the 44px touch-target audit adds a generic wrapper component or inline className patches per mount
- Exact threshold for the `<100ms` reduced-motion assertion (50ms / 100ms / 150ms)
- Test organization: whether `tests/extraction/lint-rule.test.ts` lives under `tests/extraction/` (existing) or `tests/eslint/` (new)

### Folded Todos
None — no pending todos matched Phase 105 scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 105 Scope Source
- `.planning/ROADMAP.md` §"Phase 105: Polish, Integration, E2E" lines 347-364 — Phase goal, depends-on, success criteria (5 items)
- `.planning/REQUIREMENTS.md` GAP-03 line 71 — ESLint rule requirement

### ESLint Bootstrap
- `package.json` — Add `"lint": "next lint"` script; add `eslint`, `eslint-config-next`, `@typescript-eslint/parser` to devDependencies
- `eslint.config.mjs` (NEW) — Flat config file at repo root with `next/core-web-vitals` + `next/typescript` extends + `no-restricted-syntax` rule with glob overrides
- `convex/lib/queryBounds.ts` — `MAX_EXTRACTION_PAPERS_PER_JOB`, `EXTRACTION_LIMITS_BY_TIER` (the approved alternatives the rule points developers toward)
- `convex/extraction/queries.ts:689-710` — `getExtractionLimit` reactive query (the approved reactive alternative)

### E2E Infrastructure
- `playwright.config.ts` — Existing config; default project testDir `./e2e`; ignores `**/billing/**`; webServer runs `npm run build && npm run start`
- `e2e/global.setup.ts` — Clerk user provisioning via `createClerkClient`; loads `.env.local`; reusable
- `e2e/auth.spec.ts` — Reference pattern for the `signIn(page)` helper (lines 14-22); test structure pattern
- `e2e/billing/fixtures.ts` — Reference for billing-test fixture pattern (do NOT copy wholesale — billing uses Stripe bypass; extraction uses Convex seed action)
- `e2e/helpers/sign-in.ts` (NEW) — Extracted Clerk sign-in helper

### E2E Test Seed
- `convex/extraction/testing.ts` (NEW) — Dev-guarded `seedCompletedJob(jobId, paperCount, questionIds)` internalAction
- `convex/extraction/mutations.ts` — `createExtractionJob` reference for the mutation shape the test seed mirrors
- `convex/extraction/queries.ts` — `getExtractionResults`, `getPaperBodyText` — what the E2E test reads back

### Mobile Responsive
- `components/extraction/extraction-basket-drawer.tsx` — Basket drawer (Phase 99); verify `w-full sm:max-w-md`
- `components/extraction/workbench-shell.tsx` — WorkbenchShell (Phase 101); add `useIsMobile` guard on view switcher
- `components/extraction/view-switcher.tsx` — Segmented control (Phase 101); hide non-table options at `<768px`
- `components/extraction/workbench-toolbar.tsx` — Toolbar (Phase 101); stack vertically at `<640px`
- `components/extraction/add-to-extraction-button.tsx` — Add 44px min size
- `components/extraction/extraction-counter.tsx` — Counter progress bar container
- `components/extraction/extraction-basket-drawer.tsx` — Basket drawer action buttons
- `app/extraction/new/selector-page-client.tsx` — Selector page tabs; verify `overflow-x-auto` on TabsList
- `app/extraction/new/zotero-tab.tsx` (Phase 104) — ZoteroItemRow checkboxes
- `hooks/use-is-mobile.ts` OR `components/shared/sidebar-layout.tsx` — Existing `useIsMobile` hook pattern

### Reduced-Motion
- `app/layout.tsx` — Root layout; wrap with `<MotionConfig reducedMotion="user">` (from `motion/react`)
- `app/globals.css` — Add global `@media (prefers-reduced-motion: reduce)` rule
- `components/extraction/workbench-shell.tsx` — Existing `useReducedMotion()` usage (verified via grep); leave in place
- `components/extraction/paper-result-card.tsx` — Existing `useReducedMotion()` usage; leave in place
- `components/extraction/question-builder.tsx` — Existing `useReducedMotion()` usage; leave in place
- `lib/animation-config.ts` — Motion spring presets; verify presets honor reducedMotion or wrap in `useReducedMotion()` checks

### i18n Audit
- `messages/en-US.json` — Source of truth
- `messages/en-GB.json`, `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json` — Target locales
- `tests/i18n/v7-key-parity.test.ts` (NEW) — Structural test file (new `tests/i18n/` directory)
- `tests/locale-detection.test.ts` — Reference for existing locale-handling test pattern
- `vitest.config.ts` — `tests/**/*.test.ts` default glob picks up the new test automatically; `node` environment for pure-logic tests

### Auth
- `lib/auth/use-auth-query.ts` — `useProtectedQuery`; no changes in this phase but referenced for test mocks
- `@clerk/testing/playwright` — Clerk E2E helpers (`clerk.loaded`, `clerk.signIn`, `clerk.signOut`)

### Conventions
- `.planning/codebase/CONVENTIONS.md` — File naming (kebab-case), component naming (PascalCase), i18n key naming
- `.planning/codebase/TESTING.md` — Vitest + Playwright patterns; environment routing; factory usage
- `.planning/codebase/STRUCTURE.md` — Directory layout

### Convex Guidelines
- `convex/_generated/ai/guidelines.md` — Convex API patterns (MUST read before writing any Convex code, including the new seed internalAction)

### Prior Phase Context (cumulative v7.0 state)
- `.planning/phases/98-pre-flight-hard-limit-foundation/98-CONTEXT.md` — `EXTRACTION_LIMITS_BY_TIER` shape, `MAX_EXTRACTION_PAPERS_PER_JOB`, `getExtractionLimit` reactive query
- `.planning/phases/99-selection-basket-core/99-CONTEXT.md` — Basket store, `BasketSource`, sessionStorage persistence
- `.planning/phases/100-backend-wiring-tierselector-fix/100-CONTEXT.md` — Error system, `resolveManualIds`, `resolveByDoi`, TierSelector wiring
- `.planning/phases/101-workbench-primitives/101-CONTEXT.md` — WorkbenchShell, view switcher, toolbar, column visibility
- `.planning/phases/102-entry-points-counter-ux/102-CONTEXT.md` — `<ExtractionCounter>`, `<AddToExtractionButton>`, sidebar badge, bulk-paste drop toast
- `.planning/phases/103-workbench-views-selector-page/103-CONTEXT.md` — 4 views, evidence drawer, `/extraction/new` selector, ExtractionDialog wiring
- `.planning/phases/104-zotero-revival/104-CONTEXT.md` — Settings connect card, `<ZoteroTab>`, lazy DOI resolution, purge action

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `e2e/auth.spec.ts` — Full sign-in helper pattern and `test.describe` structure — reuse signIn helper by extracting to `e2e/helpers/sign-in.ts`
- `e2e/global.setup.ts` — Clerk user provisioning — reuse as-is (no changes required)
- `playwright.config.ts` — Default project auto-picks up new specs in `e2e/` (ignores `billing/**`) — no config change needed for the new workbench spec
- `tests/locale-detection.test.ts` — Pattern for locale-related structural tests — reference for the new key-parity test
- `motion/react` — `MotionConfig` component supports `reducedMotion="user"` prop for global reduced-motion opt-in (no additional dependency)
- `app/globals.css` — Existing Tailwind v4 CSS file with room for one additional `@media` query block
- `components/shared/sidebar-layout.tsx` (or `hooks/use-is-mobile.ts`) — Existing responsive hook pattern for the `<768px` auto-switch
- `lib/animation-config.ts` — Spring presets (if they exist — verify at plan time) for reduced-motion-aware motion configuration
- `vitest.config.ts` — Glob already matches `tests/**/*.test.ts` — new `tests/i18n/v7-key-parity.test.ts` auto-included

### Established Patterns
- Playwright: Clerk sign-in via `@clerk/testing/playwright` → `clerk.loaded({ page }) → clerk.signIn({ page, emailAddress })`; single spec file per domain (matches existing `auth.spec.ts`)
- Playwright network mocking: `page.route("**/api.zotero.org/**", route => route.fulfill({ body: fixtureJson }))`
- Vitest structural tests: file-read + assertion pattern (see `convex/lib/rateLimit.ts` source-shape tests)
- i18n: all 6 locale files under `messages/`, `en-US.json` as source of truth, keys seeded before UI work
- Reduced motion: individual components use `useReducedMotion()` from Motion; hybrid with global `MotionConfig` is the standard upgrade path
- Tailwind v4 responsive: `sm:` (640px), `md:` (768px), `lg:` (1024px) — do NOT introduce custom breakpoints

### Integration Points
- `package.json` scripts — add `"lint": "next lint"`, `"test:e2e:workbench": "playwright test e2e/extraction-workbench.spec.ts --config=playwright.config.ts"`, extend `test:ci` to include lint + workbench E2E
- `eslint.config.mjs` (new at repo root)
- `e2e/extraction-workbench.spec.ts` (new)
- `e2e/helpers/sign-in.ts` (new)
- `convex/extraction/testing.ts` (new) — dev-guarded seed action
- `app/layout.tsx` — wrap with `<MotionConfig>`
- `app/globals.css` — append `@media (prefers-reduced-motion)` rule
- `components/extraction/**` — 44px touch-target className patches, view-switcher mobile guard
- `app/extraction/new/selector-page-client.tsx` — TabsList `overflow-x-auto` verification
- `tests/i18n/v7-key-parity.test.ts` (new)
- `tests/extraction/lint-rule.test.ts` (new)

</code_context>

<specifics>
## Specific Ideas

- **No ESLint currently exists at the repo root.** Phase 105 is responsible for bootstrapping ESLint from zero — install `eslint`, `eslint-config-next`, `@typescript-eslint/parser`, create `eslint.config.mjs`, wire `next lint` into `package.json`. This is not a pure "add-a-rule" phase — it's "bootstrap linting + add a rule". The planner must account for this installation work.
- The Next.js version is 16.1.6 which uses ESLint 9 flat config by default. `eslint-config-next` exports the flat-config preset. Do NOT attempt `.eslintrc.json` legacy format.
- No new runtime dependencies. Dev dependencies only: `eslint`, `eslint-config-next`, `@typescript-eslint/parser` (and `@typescript-eslint/eslint-plugin` if not transitively pulled in by `eslint-config-next`).
- Playwright tests DO NOT go through the real LLM extraction cascade — seed via `internal.extraction.testing.seedCompletedJob(...)`. This is a new testing-only internalAction guarded by a dev-only flag (process.env.CONVEX_ENV === "dev" OR a dedicated `allowTestSeeding` env var). Do not expose publicly.
- Playwright's `page.emulateMedia({ reducedMotion: "reduce" })` is native — no additional library needed. The reduced-motion verification is a 3-line addition to test step (2) in the existing workbench E2E spec.
- The `<MotionConfig reducedMotion="user">` wrapper MUST sit at the root layout (`app/layout.tsx`) — not at the extraction subtree only. A subtree-only wrapper would miss the sidebar badge pulse, basket drawer slide, and other motion outside the extraction surface. User's reduced-motion preference applies globally.
- The i18n parity test is the ONLY deliverable that can catch a Phase 102-104 drift where a key was added to `en-US.json` but forgotten in `fr.json`. Make sure it runs in `npm run test` (picked up by the default Vitest glob).
- Scope guard: the `44px` touch target audit MUST be limited to v7.0-added components (`components/extraction/**`, `app/extraction/**`). Do not audit pre-v7.0 components (library, search, settings) — that is out of scope and would introduce regressions.
- Scope guard: the `prefers-reduced-motion` CSS rule applies globally, but the AUDIT of existing `useReducedMotion()` usages is scoped to v7.0 components. Do not refactor pre-v7.0 motion code.
- Scope guard: the ESLint rule covers `components/extraction/**` + `app/extraction/**` ONLY (per ROADMAP GAP-03). Do NOT extend it to `convex/**` or other top-level directories without an explicit follow-up.
- The E2E spec uses `page.route()` to mock Zotero, NOT a dedicated MSW or Pretender layer. Playwright's built-in route interception is sufficient and matches project patterns.
- If the existing `useIsMobile()` hook doesn't return the right breakpoint (e.g., returns `true` at `<640px` instead of `<768px`), introduce `useIsBelowBreakpoint("md")` as a local helper rather than changing the existing hook's behavior.
- Do NOT add a "bottom sheet" variant for mobile — deferred to MOB-F01 (v7.1). Phase 105 ships the full-width Sheet baseline only.
- Do NOT run the lint rule as a pre-commit hook — this phase wires CI-level enforcement only. Pre-commit hook setup is outside the scope of GAP-03.

</specifics>

<deferred>
## Deferred Ideas

- **Pre-commit lint hook / husky setup** — Not part of GAP-03; defer to a later tech-debt phase if desired.
- **MOB-F01 mobile bottom-sheet drawer variant** — Explicit v7.1 item per ROADMAP.md Future Requirements; Phase 105 ships the Sheet baseline.
- **"Unused i18n keys" audit** (keys present in locale files but never called) — requires AST parsing of every `.tsx` file; different problem from key parity; defer.
- **Full keyboard shortcut support (j/k/e)** — Part of WB-F05 (v7.1 Future).
- **Lint rule extension to `convex/**` / other top-level directories** — ROADMAP GAP-03 scope is UI only; extending the rule is a separate phase.
- **Visual regression testing** — Project-level decision: out of scope (see PROJECT.md Out of Scope list).
- **Storybook / per-component visual snapshots** — Not in scope; project does not use Storybook.

### Reviewed Todos (not folded)
None — no pending todos at the time of discussion.

</deferred>

---

*Phase: 105-polish-integration-e2e*
*Context gathered: 2026-04-16 (auto mode)*
</content>
</invoke>