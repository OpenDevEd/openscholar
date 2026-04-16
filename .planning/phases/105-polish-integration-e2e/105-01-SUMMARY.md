---
phase: 105-polish-integration-e2e
plan: 01
subsystem: testing
tags: [eslint, eslint-config-next, nextjs, vitest, ast-linting, no-restricted-syntax, gap-03]

# Dependency graph
requires:
  - phase: 98-pre-flight-hard-limit-foundation
    provides: MAX_EXTRACTION_PAPERS_PER_JOB, EXTRACTION_LIMITS_BY_TIER, getExtractionLimit (the approved alternatives the rule points developers toward)
provides:
  - ESLint 9 flat config bootstrapped at repo root (no prior config existed)
  - GAP-03 rule blocking literal 1000 and 200 in components/extraction/** and app/extraction/**
  - Structural Vitest test that protects the rule from silent removal
  - "lint" script in package.json + "npm run lint" prepended to test:ci
  - Surfaced 2 pre-existing GAP-03 violations in production extraction code for downstream plans
affects: [105-02-mobile-polish-reduced-motion, 105-03-e2e-extraction-workbench, future extraction plans, tier-limit enforcement across v7.x]

# Tech tracking
tech-stack:
  added:
    - eslint@^9.39.4 (devDep)
    - eslint-config-next@^16.2.4 (devDep; transitively pulls @typescript-eslint/parser@8.58.2 and @next/eslint-plugin-next@16.2.4)
  patterns:
    - "ESLint 9 flat config with glob-scoped rule + separate more-specific test-file exception (no nested overrides)"
    - "Programmatic ESLint testing via new ESLint({cwd}).lintText() with virtual filePath matching the rule's files glob"
    - "npm run lint fails fast before build in test:ci pipeline"

key-files:
  created:
    - eslint.config.mjs (flat config, GAP-03 rule, test-file exception, globalIgnores)
    - tests/extraction/lint-rule.test.ts (4 structural test cases)
  modified:
    - package.json (added lint script, prepended lint to test:ci, added eslint + eslint-config-next devDeps)
    - pnpm-lock.yaml (lockfile updates for new devDeps)

key-decisions:
  - "D-01 adjusted: 'lint': 'eslint .' instead of 'next lint' (Next.js 16 removed next lint command per RESEARCH.md §State of the Art A6)"
  - "Installed only eslint + eslint-config-next explicitly; did NOT add @typescript-eslint/parser (transitively pulled by eslint-config-next/typescript at 16.2.x) to avoid version-mismatch churn"
  - "Task 2 test count extended to 4 cases (positive 1000, positive 200, test-file exemption, out-of-glob exemption) — plan specified three minimum but scope verification case adds silent-removal protection"
  - "test:ci prepends lint (npm run lint && npm run test && ...) so a broken config fails fast before the expensive npm run build step"
  - "Did NOT fix pre-existing GAP-03 violations (extraction-counter.tsx:28, job-metrics-panel.tsx:73) — plan explicitly instructs to surface them here for later plans to triage"

patterns-established:
  - "ESLint 9 flat config file shape: spread-import Next.js presets, scope domain rules via files globs, layer progressively-more-specific config objects for exceptions, centralize ignores via globalIgnores()"
  - "Programmatic lint-rule test: new ESLint({cwd: REPO_ROOT}).lintText(source, {filePath}) where filePath matches the rule's files glob; filter messages by ruleId === 'no-restricted-syntax'"
  - "Error messages in no-restricted-syntax point developers at approved alternative (MAX_EXTRACTION_PAPERS_PER_JOB / getExtractionLimit) rather than just forbidding the literal"

requirements-completed: [GAP-03]

# Metrics
duration: 7m47s
completed: 2026-04-16
---

# Phase 105 Plan 01: ESLint Bootstrap + GAP-03 Rule Summary

**Bootstrapped ESLint 9 flat config at repo root from zero, shipped the GAP-03 no-restricted-syntax rule blocking literal 1000 and 200 in extraction UI globs, and wired a programmatic Vitest structural test that protects the rule against silent removal.**

## Performance

- **Duration:** 7m 47s
- **Started:** 2026-04-16T19:10:23Z
- **Completed:** 2026-04-16T19:18:10Z
- **Tasks:** 2
- **Files created:** 2 (eslint.config.mjs, tests/extraction/lint-rule.test.ts)
- **Files modified:** 2 (package.json, pnpm-lock.yaml)

## Accomplishments

- **ESLint 9 flat config bootstrapped** at repo root (no prior ESLint config existed) extending `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript` using the native `defineConfig` helper from `eslint/config`.
- **GAP-03 rule implemented verbatim from D-02/D-04:** `no-restricted-syntax` with two selectors `Literal[value=1000]` and `Literal[value=200]`, scoped to `components/extraction/**/*.{ts,tsx}` + `app/extraction/**/*.{ts,tsx}`. Error messages point developers at `MAX_EXTRACTION_PAPERS_PER_JOB` / `getExtractionLimit` from `convex/lib/queryBounds`.
- **Test-file exception (D-03)** implemented as a second, more-specific config object (`**/*.test.{ts,tsx}`) that turns the rule `off` — using flat-config's later-wins semantics rather than legacy `overrides:` nesting.
- **Silent-removal protection (D-05)** via `tests/extraction/lint-rule.test.ts` — 4 test cases exercising positive 1000, positive 200, test-file exemption, and out-of-glob exemption. All 4 pass in under 1.4 seconds.
- **`npm run lint` wired into `test:ci` as the FIRST step**, so a broken config or GAP-03 violation fails fast before the expensive `npm run build` step.
- **Pre-existing GAP-03 violations surfaced** in production extraction code (see "Deferred Issues" below) for Plan 02 / 03 executors to triage.

## Task Commits

Each task was committed atomically:

1. **Task 1: ESLint 9 flat config + `lint` script wiring** — `c7c3d49` (chore)
2. **Task 2: Vitest structural test protecting the rule** — `08e1515` (test)

_Note: Task 1 is a `chore` rather than `feat` because it bootstraps tooling/configuration rather than shipping user-visible behavior. Task 2 is `test` because the file is test-only structural verification. Both task types match the conventional-commits style used elsewhere in the repo._

## Files Created/Modified

- **`eslint.config.mjs`** (NEW, repo root, 47 lines) — Flat config with:
  - `defineConfig([...nextVitals, ...nextTs, extractionRule, testException, globalIgnores([...])])` structure
  - Extraction-glob rule: `files: ["components/extraction/**/*.{ts,tsx}", "app/extraction/**/*.{ts,tsx}"]`, `rules["no-restricted-syntax"]: ["error", {selector: "Literal[value=1000]", ...}, {selector: "Literal[value=200]", ...}]`
  - Test-file exception: `files: ["components/extraction/**/*.test.{ts,tsx}", "app/extraction/**/*.test.{ts,tsx}"]`, `rules["no-restricted-syntax"]: "off"`
  - Global ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- **`tests/extraction/lint-rule.test.ts`** (NEW, 73 lines) — Four test cases using `new ESLint({cwd: REPO_ROOT}).lintText(source, {filePath})`. REPO_ROOT computed via `path.resolve(__dirname, "../..")` per RESEARCH.md Pitfall 1.
- **`package.json`** (MOD) — Added `"lint": "eslint ."` alphabetically positioned near `test:*` scripts. Prepended `npm run lint &&` to `test:ci`. Added `eslint@^9.39.4` and `eslint-config-next@^16.2.4` to `devDependencies`.
- **`pnpm-lock.yaml`** (MOD) — Dependency graph updates for the two new devDeps (pre-staged on the working tree per sequential executor context).

## Decisions Made

- **D-01 adjustment (documented in plan objective, not a deviation):** CONTEXT.md D-01 literally says `"lint": "next lint"`. Next.js 16 removed the `next lint` command (verified in RESEARCH.md §"State of the Art" A6). Shipped as `"lint": "eslint ."` — functionally equivalent, mechanically required by the new tooling. Preserves D-01's intent of wiring ESLint into package.json scripts via the current Next.js 16 syntax.
- **No explicit `@typescript-eslint/parser` install:** RESEARCH.md §"Installation" confirms `eslint-config-next@16.2.4/typescript` pulls it in transitively. Adding it explicitly would risk version-mismatch churn.
- **Test-file glob placement inside the extraction glob, not universal:** Per D-03, the exemption targets `components/extraction/**/*.test.{ts,tsx}` + `app/extraction/**/*.test.{ts,tsx}` — specifically tests within the guarded directories. Non-extraction test files are outside the rule's scope anyway (no rule to disable).
- **Four `it` cases instead of three minimum:** The plan specified three required cases. Added a fourth "does NOT flag literal 1000 outside the extraction glob" case because scope verification is the other half of silent-removal protection — if a future PR widens the rule's `files` glob by accident (e.g., to `**/*.tsx`), this fourth test catches it.
- **`test:ci` runs `lint` FIRST, not last:** A broken config or GAP-03 violation causes CI to fail in ~3 seconds instead of waiting 5 minutes for the build step. Fail-fast optimization per plan instruction.

## Deviations from Plan

None - plan executed exactly as written. The D-01 `next lint` → `eslint .` adjustment was explicitly pre-declared in the plan's `<objective>` block, not a runtime deviation. The 4th test case was beyond the minimum three `it` cases the plan specified but within the plan's "at least THREE" phrasing and explicitly aligned with D-05's silent-removal protection intent.

## D-04 Error Message Verification

Both `no-restricted-syntax` selector `message` fields match D-04 verbatim:

> "Literal '1000' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER."

Substituting "1000" → "200" for the second selector. Both messages are verified by `grep -c "MAX_EXTRACTION_PAPERS_PER_JOB" eslint.config.mjs` returning `2`, and by the Task 2 test `expect(restricted[0].message).toContain("MAX_EXTRACTION_PAPERS_PER_JOB")` passing for the 1000 case and `expect(restricted[0].message).toContain("getExtractionLimit")` passing for the 200 case.

## Pre-existing GAP-03 Violations Surfaced (for Plan 02 / 03 executors)

Running `npx eslint components/extraction app/extraction` after the rule is installed surfaces **two existing violations**. These were NOT fixed in this plan per success criteria: "if `npm run lint` doesn't pass on current extraction code, surface violations in SUMMARY.md — do NOT rewrite production code without user approval":

| File | Line:Col | Selector | Action for downstream plan |
|------|----------|----------|----------------------------|
| `components/extraction/extraction-counter.tsx` | 28:42 | `Literal[value=1000]` | Likely the hard-coded cap display. Replace with `MAX_EXTRACTION_PAPERS_PER_JOB` import from `convex/lib/queryBounds` or reactive `getExtractionLimit` query per D-04 error message. |
| `components/extraction/job-metrics-panel.tsx` | 73:28 | `Literal[value=1000]` | Possibly a budget/progress scale constant. Investigate intent: either thread the tier limit through or add an inline `eslint-disable` with justification (note T-105-02: rule is `error` level; disable comments still visible in code review). |

**Recommended target plan:** Plan 105-03 (E2E) touches extraction UI extensively and is the natural place to sweep these fixes in alongside the workbench spec. Alternatively, Plan 105-02 (mobile polish) touches `extraction-counter.tsx` directly for 44px touch-target work and could fix it in situ while the file is already open.

**CI status until fixed:** `npm run test:ci` will fail at the `lint` step on main branch. If this blocks CI before Plan 02/03 ships the fix, the two violations must be addressed in a dedicated fix-forward commit (recommend: import `MAX_EXTRACTION_PAPERS_PER_JOB` in both files and use the constant, mirroring how `convex/extraction/mutations.ts` already uses it).

## test:ci Script Evolution (Intentional Two-Phase)

This plan sets `test:ci` to:

```
npm run lint && npm run test && npm run build && npm run test:e2e:auth
```

Plan 03 will later append ` && npm run test:e2e:workbench` after the workbench spec is authored. The two-phase evolution is deliberate: pre-declaring `test:e2e:workbench` here would reference a script that runs a non-existent spec file and fail fast on the first `test:ci` invocation between plans 01 and 03.

## Issues Encountered

- **Pre-staged package.json + pnpm-lock.yaml from sequential executor bootstrap:** The sequential executor context explicitly documented that `eslint` and `eslint-config-next` were already present as `devDependencies` and that `node_modules` had them installed. Verified with `npm ls eslint` (returned 9.39.4) and `npm ls eslint-config-next` (returned 16.2.4). No additional install command was needed; the Task 1 acceptance criterion `npx eslint --version` returning `v9.39.4` confirmed readiness.
- **Pre-existing ESLint violations across the full codebase (1163 errors, 6454 warnings):** Running `npx eslint .` across the entire repo surfaces many errors/warnings in non-extraction code (mostly `react-hooks/exhaustive-deps`, `@typescript-eslint/no-unused-vars`, `react-hooks/set-state-in-effect`). These are OUT OF SCOPE for Plan 01 per its scope boundary ("GAP-03 rule only, not a general lint cleanup"). They are relevant to `npm run test:ci` passing at the phase level — this will need addressing during/after Plan 05 or in a dedicated lint-cleanup phase. Logged here for visibility; NOT blocking this plan's completion.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 105-02 readiness:** Plan 02 (mobile polish + reduced-motion) is independent — it touches the same extraction components but for different reasons (44px touch targets + MotionConfig wrapper). Plan 02 can proceed immediately. If Plan 02 touches `extraction-counter.tsx` (which it will, per D-16 listing it), the executor should opportunistically fix the GAP-03 violation on line 28 while the file is already open.
- **Plan 105-03 readiness:** Plan 03 (E2E workbench spec) will extend `test:ci` to append `npm run test:e2e:workbench`. Plan 03 is the ultimate beneficiary of the GAP-03 rule — any new extraction code it writes will be caught at lint time.
- **CI pipeline concern:** Until the two pre-existing violations are fixed, `npm run test:ci` fails at the `lint` step. The phase-level gate (all three plans merged + green `test:ci`) requires these to be resolved. Recommend tracking as a mandatory fix-forward for Plan 03 (or a small follow-up commit between plans).

## Self-Check: PASSED

- `eslint.config.mjs` exists at repo root: verified via `test -f eslint.config.mjs` → OK
- `tests/extraction/lint-rule.test.ts` exists: verified via `test -f tests/extraction/lint-rule.test.ts` → OK
- Task 1 commit `c7c3d49` exists: verified via `git log --oneline --all | grep -q "c7c3d49"` → FOUND
- Task 2 commit `08e1515` exists: verified via `git log --oneline --all | grep -q "08e1515"` → FOUND
- All 4 Vitest cases pass in 1.35s: verified via `npm run test -- tests/extraction/lint-rule.test.ts --run` → 4 passed
- `npx eslint --version` returns 9.39.4: verified → OK
- `package.json` `scripts.lint === "eslint ."`: verified → OK
- `package.json` `scripts["test:ci"]` starts with `npm run lint &&`: verified → OK

---

*Phase: 105-polish-integration-e2e*
*Plan: 01 (ESLint bootstrap + GAP-03 rule)*
*Completed: 2026-04-16*
