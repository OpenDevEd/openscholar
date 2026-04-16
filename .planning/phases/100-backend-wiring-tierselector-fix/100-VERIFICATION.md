---
phase: 100-backend-wiring-tierselector-fix
verified: 2026-04-16T10:10:00Z
status: passed
score: 6/6
overrides_applied: 0
---

# Phase 100: Backend Wiring + TierSelector Fix Verification Report

**Phase Goal:** Ship all the Convex actions and server-side hard rejects that Phases 102, 103, and 104 will consume -- including the 5-edit fix that finally threads TierSelector through createExtractionJob -> workpool -> createCascadeTiers(tier).
**Verified:** 2026-04-16T10:10:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User pastes a list of OpenAlex IDs at the Manual tab and sees them resolved and added to the basket via `resolveManualIds` (SEL-05) | VERIFIED | `convex/openalex/actions.ts` exports `resolveManualIds` action (line 68); accepts `rawInputs: v.array(v.string())`; normalizes via `normalizeOpenAlexId`; batches in groups of 50; calls `api.openalex.org/works?filter=openalex:`; returns `{ resolved, unresolvable }`; exported in generated API (`api.openalex.actions.resolveManualIds`) |
| 2 | When a user attempts to submit an over-limit job, `createExtractionJob` hard-rejects with a typed `EXTRACTION_LIMIT_EXCEEDED` error routed to a localized toast (LIM-07) | VERIFIED | `convex/extraction/mutations.ts` line 49-52: `throw createError("EXTRACTION_LIMIT_EXCEEDED", ...)`; `convex/lib/errors.ts` line 57: `EXTRACTION_LIMIT_EXCEEDED` in ErrorCode union; `lib/toast/error-resolver.ts` line 105: `EXTRACTION_LIMIT_EXCEEDED: "extractionLimitExceeded"` in MESSAGE_KEY_BY_CODE; i18n keys present in all 6 locale files (en-US, en-GB, fr, ja, zh, hi line 521); `extraction-dialog.tsx` line 134-136: catch block uses `resolveToastError` + `getToastMessageKeyForErrorCode` |
| 3 | User selects "accurate" tier in the UI, creates an extraction job, and the job row persists `tier: "accurate"` (TIER-01) | VERIFIED | `convex/schema.ts` line 437: `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))`; `convex/extraction/mutations.ts` line 36: tier in args validator; line 106: `tier: args.tier ?? "auto"` on insert; `extraction-dialog.tsx` line 125: `createJob({ papers, questions: keyedQuestions, tier })` |
| 4 | The workpool action reads `tier` from the job row and calls `createCascadeTiers(tier)` so `auto` runs all 3 tiers, `accurate` runs top tier only, and `cheap` runs bottom tier only (TIER-02) | VERIFIED | `convex/extraction/workpoolActions.ts` line 65: `const tier = job.tier ?? "auto"`; line 192: passes `tier` as 7th arg to `extractAnswers`; `convex/extraction/extract.ts` line 189: `function createCascadeTiers(tier?: ModelTier)` with switch -- `cheap` returns `[allTiers[0]]` (line 218), `accurate` returns `[allTiers[allTiers.length - 1]]` (line 220), `auto`/undefined returns `allTiers` (line 224); `convex/extraction/queries.ts` line 252: `getJobInternal` returns `tier` field; line 271: `tier: job.tier` in return object |
| 5 | A unit test inspects the constructed OpenRouter request payload and asserts tier selection filters the 3-tier cascade as expected (TIER-03) | VERIFIED | `convex/extraction/extract.test.ts` line 651: `describe("tier-based cascade filtering (TIER-03)")` with 3 tests; "cheap" asserts only `google/gemini-2.5-flash-lite`; "accurate" asserts only `anthropic/claude-haiku-4.5`; "auto" forces cascade through all 3 models. All 3 tests pass (vitest run confirms: `3 passed, 0 failed`) |
| 6 | When a user checks a Zotero item with a DOI, `resolveByDoi` returns within 10 seconds with the resolved OpenAlex ID (ZOT-03) | VERIFIED | `convex/openalex/actions.ts` exports `resolveByDoi` action (line 154); calls `api.openalex.org/works?filter=doi:` with `AbortSignal.timeout(DOI_TIMEOUT_MS)` where `DOI_TIMEOUT_MS = 8_000` (line 16); returns paper metadata or null; exported in generated API (`api.openalex.actions.resolveByDoi`). UI wiring deferred to Phase 104 per roadmap. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/schema.ts` | Optional tier field on extractionJobs table | VERIFIED | Line 437: `tier: v.optional(v.union(v.literal("auto"), v.literal("cheap"), v.literal("accurate")))` |
| `convex/extraction/mutations.ts` | tier arg accepted and persisted on job insert | VERIFIED | Line 36: tier in args; line 106: `tier: args.tier ?? "auto"` in insert; line 49-52: `EXTRACTION_LIMIT_EXCEEDED` error |
| `convex/extraction/extract.ts` | createCascadeTiers(tier?) filters cascade by tier selection | VERIFIED | Line 182: `ModelTier` type; line 189: `createCascadeTiers(tier?)` with switch; line 232-240: `extractSingleAnswer` accepts tier; line 477-484: `extractAnswers` accepts tier as 7th param |
| `convex/extraction/workpoolActions.ts` | Workpool reads job.tier and passes to extractAnswers | VERIFIED | Line 65: `const tier = job.tier ?? "auto"`; line 192: tier passed as 7th arg |
| `convex/extraction/extract.test.ts` | TIER-03 unit tests for cascade filtering | VERIFIED | Line 651: describe block with 3 tests; all pass |
| `convex/extraction/queries.ts` | getJobInternal returns tier field | VERIFIED | Line 252: tier in return validator; line 271: `tier: job.tier` in return |
| `convex/lib/errors.ts` | EXTRACTION_LIMIT_EXCEEDED in ErrorCode union | VERIFIED | Line 57: present in union |
| `lib/toast/error-resolver.ts` | Toast routing for extraction limit and already-active errors | VERIFIED | Lines 38-39: `extractionLimitExceeded` and `extractionJobAlreadyActive` in ToastErrorMessageKey; lines 105-106: both in MESSAGE_KEY_BY_CODE |
| `components/extraction/extraction-dialog.tsx` | Migrated error handling using resolveToastError | VERIFIED | Line 20: import of resolveToastError + getToastMessageKeyForErrorCode; line 125: tier passed to createJob; lines 134-136: catch uses resolveToastError; no inline string-matching for EXTRACTION_JOB_ALREADY_ACTIVE; getErrorMessage import removed |
| `messages/en-US.json` | i18n keys for extraction limit exceeded toast | VERIFIED | Line 521-522: both keys present |
| `messages/en-GB.json` | i18n keys for extraction toast messages | VERIFIED | Line 521-522: both keys present |
| `messages/fr.json` | i18n keys for extraction toast messages | VERIFIED | Line 521-522: both keys present |
| `messages/ja.json` | i18n keys for extraction toast messages | VERIFIED | Line 521-522: both keys present |
| `messages/zh.json` | i18n keys for extraction toast messages | VERIFIED | Line 521-522: both keys present |
| `messages/hi.json` | i18n keys for extraction toast messages | VERIFIED | Line 521-522: both keys present |
| `convex/openalex/actions.ts` | resolveManualIds and resolveByDoi Convex actions | VERIFIED | 183 lines; exports both actions; no `"use node"` directive; uses normalizeOpenAlexId import; BATCH_SIZE=50; DOI_TIMEOUT_MS=8000 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `convex/extraction/mutations.ts` | `convex/schema.ts` | `ctx.db.insert('extractionJobs', { tier })` | WIRED | Line 106: `tier: args.tier ?? "auto"` in insert matches schema field at line 437 |
| `convex/extraction/workpoolActions.ts` | `convex/extraction/extract.ts` | `extractAnswers(..., tier)` | WIRED | Line 192: tier passed as 7th arg; extract.ts line 484: `tier?: ModelTier` accepted |
| `convex/extraction/extract.ts` | `createCascadeTiers` | `extractSingleAnswer calls createCascadeTiers(tier)` | WIRED | Line 241: `const tiers = createCascadeTiers(tier)` inside extractSingleAnswer |
| `convex/lib/errors.ts` | `lib/toast/error-resolver.ts` | ErrorCode -> MESSAGE_KEY_BY_CODE mapping | WIRED | errors.ts line 57: `EXTRACTION_LIMIT_EXCEEDED`; error-resolver.ts line 105: maps to `extractionLimitExceeded` |
| `lib/toast/error-resolver.ts` | `extraction-dialog.tsx` | resolveToastError import and call in catch block | WIRED | dialog line 20: import; line 134: `resolveToastError(error, t("jobCreation.error"))` |
| `convex/openalex/actions.ts` | OpenAlex API | fetch() with filter=openalex: and filter=doi: | WIRED | Line 98: `api.openalex.org/works?filter=openalex:${ids}`; line 161: `api.openalex.org/works?filter=doi:` |
| `convex/openalex/actions.ts` | `lib/openalex/normalize.ts` | normalizeOpenAlexId import | WIRED | Line 3: `import { normalizeOpenAlexId } from "../../lib/openalex/normalize"`; source exists at lib/openalex/normalize.ts line 14 |
| `convex/extraction/workpoolActions.ts` | `convex/extraction/queries.ts` | getJobInternal returns tier | WIRED | workpoolActions line 49-51: calls getJobInternal; queries.ts line 252: tier in return validator; line 271: `tier: job.tier` |
| `extraction-dialog.tsx` | `convex/extraction/mutations.ts` | createJob({ ..., tier }) | WIRED | dialog line 125: `{ papers, questions: keyedQuestions, tier }`; mutations line 36: tier in args validator |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `convex/openalex/actions.ts` (resolveManualIds) | `resolved` array | OpenAlex API `fetch()` with response parsing | Yes -- API returns `results` array, parsed via `extractPaperFromWork` | FLOWING |
| `convex/openalex/actions.ts` (resolveByDoi) | return value | OpenAlex API `fetch()` with response parsing | Yes -- API returns single work, parsed via `extractPaperFromWork` | FLOWING |
| `convex/extraction/extract.ts` (createCascadeTiers) | `allTiers` array | Hardcoded model definitions, filtered by switch | Yes -- produces real OpenRouter model objects (not mocks) | FLOWING |
| `convex/extraction/mutations.ts` (createExtractionJob) | `tier` field | Client arg -> persisted to DB | Yes -- `args.tier ?? "auto"` persisted via `ctx.db.insert` | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TIER-03 cascade tests pass | `npx vitest run convex/extraction/extract.test.ts -t "tier-based cascade"` | 3 passed, 0 failed (52ms) | PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | Only pre-existing error in unrelated `prompt-delimiters.test.ts` | PASS |
| resolveManualIds in generated API | `node -e "require('./convex/_generated/api').api.openalex.actions.resolveManualIds"` | Exists (truthy) | PASS |
| resolveByDoi in generated API | `node -e "require('./convex/_generated/api').api.openalex.actions.resolveByDoi"` | Exists (truthy) | PASS |
| All 5 commits verified | `git log --oneline` for e5bcd5f, a77374c, 1860ab1, d6c1c01, 154e9c6 | All present with correct messages | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SEL-05 | Plan 03 | User pastes OpenAlex IDs, resolved via resolveManualIds | SATISFIED | `convex/openalex/actions.ts` exports `resolveManualIds` with batch normalization, API validation, and unresolvable collection |
| LIM-07 | Plan 02 | createExtractionJob hard-rejects over-limit with typed EXTRACTION_LIMIT_EXCEEDED | SATISFIED | mutations.ts line 49-52 throws EXTRACTION_LIMIT_EXCEEDED; error-resolver.ts maps to toast; 6 locale files have i18n keys |
| TIER-01 | Plan 01 | TierSelector value persisted as optional tier field on extractionJobs row | SATISFIED | schema.ts line 437 has tier field; mutations.ts line 36 accepts tier arg; line 106 persists `tier: args.tier ?? "auto"` |
| TIER-02 | Plan 01 | Workpool reads tier from job row and calls createCascadeTiers(tier) to filter cascade | SATISFIED | workpoolActions.ts line 65 reads `job.tier ?? "auto"`; line 192 passes to extractAnswers; extract.ts switch filters cascade |
| TIER-03 | Plan 01 | Unit test asserts tier selection filters cascade as expected | SATISFIED | extract.test.ts line 651: 3 tests for cheap/accurate/auto; all pass |
| ZOT-03 | Plan 03 | resolveByDoi returns within 10 seconds with resolved OpenAlex ID | SATISFIED | `convex/openalex/actions.ts` exports `resolveByDoi` with 8s fetch timeout (DOI_TIMEOUT_MS); returns paper metadata or null |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | -- | -- | -- | -- |

No TODO, FIXME, PLACEHOLDER, HACK, stub returns, or empty implementations found in any phase-modified files. The `return null` values in `resolveByDoi` are correct error/not-found semantics, not stubs.

### Human Verification Required

No items require human verification. All truths are verifiable via code inspection and automated tests.

### Gaps Summary

No gaps found. All 6 roadmap success criteria are met by the implementation. The tier threading path is complete from UI (ExtractionDialog) through mutation args, schema persistence, workpool read, to cascade filtering. The OpenAlex resolve actions are exported and accessible in the generated API. The error system is fully wired with i18n in all 6 locales. The inline string-matching error handler has been cleanly replaced with the standard resolveToastError pattern.

---

_Verified: 2026-04-16T10:10:00Z_
_Verifier: Claude (gsd-verifier)_
