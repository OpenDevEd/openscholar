---
phase: 22-schema-rating-bridge
verified: 2026-02-28T21:45:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 22: Schema & Rating Bridge Verification Report

**Phase Goal:** Schema & Rating Bridge — Convex libraryItems table, trimPaperData utility, saveToLibrary upsert mutation, and dual-path rating bridge in UI components.
**Verified:** 2026-02-28T21:45:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | trimPaperData extracts exactly 10 fields from an OpenAlex Work object and produces a slim object under 1.5 KB | VERIFIED | `lib/library/trim-paper-data.ts` returns 10-field object; all 7 vitest tests pass including size assertion (`< 1500 bytes`) |
| 2  | saveToLibrary mutation inserts a new library item for a user+paper combination that does not exist | VERIFIED | `convex/library/mutations.ts` line 46: `ctx.db.insert("libraryItems", ...)` path executes when `existing` is null |
| 3  | saveToLibrary mutation updates only rating and updatedAt when re-rating an existing library item (upsert) | VERIFIED | `convex/library/mutations.ts` line 37-41: patch patches only `rating`, `searchableText`, `updatedAt`; `savedAt` and metadata fields preserved |
| 4  | saveToLibrary mutation rejects unauthenticated callers | VERIFIED | `convex/library/mutations.ts` line 21: `const user = await requireAuth(ctx)` — requireAuth throws UNAUTHENTICATED for anonymous callers |
| 5  | Signed-in user rates a paper on search results and it saves to their Convex library via the saveToLibrary mutation | VERIFIED | `components/rating-selector.tsx` lines 53-77: `useMutation(api.library.mutations.saveToLibrary)` called when `phase === "authenticated"` and `newRating !== null` |
| 6  | Anonymous user rates a paper and it persists in localStorage only (Zustand behavior unchanged) | VERIFIED | `components/rating-selector.tsx` lines 61-65: `setRating` (Zustand) always called unconditionally; Convex mutation only fires inside `phase === "authenticated"` guard |
| 7  | Rating from focus mode keyboard shortcuts also triggers the Convex library save for signed-in users | VERIFIED | `components/ui/focus-mode.tsx` lines 544-571: `handleRatingChange` useCallback includes `saveToLibraryMutation` with identical auth guard and `papers.find()` lookup |
| 8  | Rating removal (no-rating) clears the Zustand rating but does NOT delete from library | VERIFIED | `components/rating-selector.tsx` line 68: `newRating !== null` guard prevents mutation call on "no-rating"; FocusMode line 556: same guard applied |
| 9  | Mutation failure does not block the rating UI (fire-and-forget with console.error) | VERIFIED | `components/rating-selector.tsx` line 73: `.catch((error) => { console.error(...) })` — Zustand updated first on line 61-65, mutation is async fire-and-forget |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `convex/schema.ts` | libraryItems table with 5 regular indexes + 1 search index | VERIFIED | Lines 633-658: table defined with userId, openalexId, rating, title, authors, doi, abstract, publicationYear, journal, citedByCount, isOpenAccess, oaStatus, searchableText, savedAt, updatedAt (15 fields). Indexes: by_user, by_user_openalexId, by_user_rating, by_user_savedAt, by_user_year (5 regular) + search_library (1 search index on searchableText filtering by userId+rating) |
| `lib/types/library.types.ts` | TrimmedPaperData interface shared between client and display | VERIFIED | Exports `TrimmedPaperData` with exactly 10 fields: openalexId, title, authors, doi, abstract, publicationYear, journal, citedByCount, isOpenAccess, oaStatus |
| `lib/library/trim-paper-data.ts` | Pure function extracting 10 metadata fields from OpenAlex Work | VERIFIED | Exports `trimPaperData(work: Record<string, any>): TrimmedPaperData`; imports TrimmedPaperData from `@/lib/types/library.types`; handles optional chaining, `||` for strings, `??` for booleans/numbers |
| `convex/library/mutations.ts` | saveToLibrary upsert mutation with requireAuth | VERIFIED | Exports `saveToLibrary` mutation; lines 21-53: requireAuth + upsert logic via withIndex("by_user_openalexId") + patch-or-insert pattern |
| `tests/library/trim-paper-data.test.ts` | Unit tests for trimPaperData (min 40 lines) | VERIFIED | 129 lines, 7 test cases; all pass via `npx vitest run` (confirmed 2026-02-28): full extraction, minimal work, display_name fallback, author flattening, missing names, empty authorships, size assertion |
| `components/rating-selector.tsx` | Dual-path rating bridge: Zustand (always) + Convex mutation (signed-in) | VERIFIED | Imports useMutation, api, trimPaperData, useAuthReadiness; conditional saveToLibrary call wired at lines 68-77 |
| `components/ui/focus-mode.tsx` | FocusMode handleRatingChange with Convex mutation bridge | VERIFIED | Imports useMutation, api, trimPaperData, useAuthReadiness at lines 53-56; hooks at lines 389-390; handleRatingChange at lines 544-571 includes full dual-path logic |
| `components/paper-card/paper-card-list-detail.tsx` | Passes result object to RatingSelector | VERIFIED | Lines 336, 406: `<RatingSelector paperId={result.id} paperResult={result} variant="compact" />` (both mobile and desktop instances) |
| `components/paper-card/paper-card-list-simple.tsx` | Passes result object to RatingSelector | VERIFIED | Line 82: `<RatingSelector paperId={result.id} paperResult={result} variant="compact" />` |
| `components/paper-card/paper-card-grid.tsx` | Passes result object to RatingSelector | VERIFIED | Line 184: `<RatingSelector paperId={result.id} paperResult={result} variant="compact" />` |

---

### Key Link Verification

**Plan 01 key links:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `convex/library/mutations.ts` | `convex/schema.ts` | `ctx.db.query('libraryItems')` and `ctx.db.insert('libraryItems')` | WIRED | Lines 28-33 query by_user_openalexId; line 46 inserts to libraryItems; line 37 patches libraryItems |
| `convex/library/mutations.ts` | `convex/lib/auth.ts` | `requireAuth(ctx)` | WIRED | Line 3 imports requireAuth; line 21 calls `const user = await requireAuth(ctx)` |
| `lib/library/trim-paper-data.ts` | `lib/types/library.types.ts` | return type annotation | WIRED | Line 1 imports TrimmedPaperData; function signature declares `): TrimmedPaperData` |

**Plan 02 key links:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `components/rating-selector.tsx` | `convex/library/mutations.ts` | `useMutation(api.library.mutations.saveToLibrary)` | WIRED | Line 54: `const saveToLibrary = useMutation(api.library.mutations.saveToLibrary)`; called at line 70 |
| `components/rating-selector.tsx` | `lib/library/trim-paper-data.ts` | `import { trimPaperData }` | WIRED | Line 41 imports trimPaperData; line 69 calls `trimPaperData(paperResult)` |
| `components/rating-selector.tsx` | `components/providers/convex-provider.tsx` | `useAuthReadiness()` for phase check | WIRED | Line 42 imports useAuthReadiness; line 53 calls `const { phase } = useAuthReadiness()`; line 68 guards on `phase === "authenticated"` |
| `components/ui/focus-mode.tsx` | `convex/library/mutations.ts` | `useMutation(api.library.mutations.saveToLibrary)` | WIRED | Line 390: `const saveToLibraryMutation = useMutation(api.library.mutations.saveToLibrary)`; called at line 561 |
| `components/paper-card/paper-card-list-detail.tsx` | `components/rating-selector.tsx` | `paperResult={result}` prop | WIRED | Lines 336 and 406 both pass `paperResult={result}` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| LIB-01 | 22-01 + 22-02 | Rating a paper (signed-in user) saves/upserts it to the user's Convex-backed library with slim normalized metadata | SATISFIED | saveToLibrary mutation exists and is wired to all rating entry points for authenticated users |
| LIB-02 | 22-01 | Library stores trimmed paper data (title, authors, DOI, abstract, year, journal, cited_by_count, open access status, OpenAlex ID) — not the full Work blob | SATISFIED | TrimmedPaperData interface has exactly these 10 fields; trimPaperData extracts them; mutation args are explicitly typed (no v.any()) |
| LIB-12 | 22-02 | Anonymous users retain existing localStorage rating behavior (Zustand fallback) | SATISFIED | Zustand setRating is always called unconditionally before auth check; Convex mutation only fires for `phase === "authenticated"` |

No orphaned requirements: REQUIREMENTS.md traceability table maps LIB-01, LIB-02, LIB-12 to Phase 22. All three are claimed and satisfied by these plans.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `components/rating-selector.tsx` | 99, 122 | `placeholder={t('noRating')}` | INFO | Legitimate UI i18n placeholder string in a Select component — not a stub marker |

No blockers or warnings found. The two "placeholder" matches are React Select component UI strings using the i18n translation system, not stub indicators.

---

### Commit Verification

All five commits documented in the summaries are verified in git history:

| Commit | Message | Status |
|--------|---------|--------|
| `abe3236` | test(22-01): add TrimmedPaperData type and failing trimPaperData tests | VERIFIED |
| `8a189f5` | feat(22-01): implement trimPaperData utility and TrimmedPaperData type | VERIFIED |
| `78d5104` | feat(22-01): add libraryItems schema table and saveToLibrary upsert mutation | VERIFIED |
| `75b230f` | feat(22-02): add dual-path rating bridge to RatingSelector | VERIFIED |
| `1906983` | feat(22-02): wire FocusMode and paper cards to library save mutation | VERIFIED |

---

### Human Verification Required

#### 1. Live Convex mutation save (authenticated user)

**Test:** Sign in to the app. Search for any paper. Rate it with 1-5 stars. Open the Convex dashboard and inspect the libraryItems table.
**Expected:** A new document appears in libraryItems with the correct userId, openalexId, rating, title, and trimmed metadata fields. Re-rating the same paper updates rating and updatedAt but preserves savedAt.
**Why human:** Convex mutation execution against a live database cannot be verified via static code analysis alone. Requires a running Convex backend.

#### 2. Anonymous user localStorage isolation

**Test:** While signed out, rate a paper. Inspect browser localStorage. Verify the rating appears there. Sign in and rate a different paper. Verify the anonymous rating was not pushed to Convex.
**Expected:** Anonymous ratings stay in localStorage only; signed-in ratings go to Convex (and also to localStorage via Zustand).
**Why human:** Zustand localStorage persistence and auth state transitions require a running browser environment.

#### 3. Focus mode keyboard shortcut library save

**Test:** Sign in. Search for papers. Open focus mode (click a paper card). Use keyboard shortcuts to rate (1-5 keys). Check the Convex dashboard for the saved libraryItem.
**Expected:** Keyboard rating in focus mode saves to Convex library with the correct paper metadata.
**Why human:** Keyboard event handling and focus mode UI requires a running browser.

---

### TypeScript Compilation

The three TypeScript errors reported by `npx tsc --noEmit` are pre-existing and unrelated to Phase 22:

- `tests/credit_grant_missing_credits_row.test.ts`: Type mismatch in test fixture (pre-existing)
- `tests/live-billing/extended.test.ts`: Missing property on billing type (pre-existing)
- `tests/live-billing/required.test.ts`: Missing property on billing type (pre-existing)

Zero TypeScript errors in any Phase 22 file (rating-selector.tsx, focus-mode.tsx, paper-card-*.tsx, trim-paper-data.ts, library.types.ts, mutations.ts).

---

## Summary

Phase 22 goal is fully achieved. All 9 observable truths are verified against the actual codebase. All 10 required artifacts exist, are substantive, and are properly wired. All 5 key links from both plans are confirmed with specific file line references. All 3 required requirements (LIB-01, LIB-02, LIB-12) are satisfied with code evidence. No anti-pattern blockers found.

The backend foundation (Plan 01) delivered: libraryItems Convex schema with 15 fields and 6 indexes, TrimmedPaperData type, trimPaperData utility with 7 passing tests, and saveToLibrary upsert mutation with requireAuth.

The UI bridge (Plan 02) delivered: dual-path rating logic in RatingSelector (Zustand always + Convex for authenticated), identical bridge in FocusMode's handleRatingChange, and paperResult prop passed in all 3 paper card components (including both instances in list-detail).

The phase is ready for Phase 23 (Library UI) which can build directly on the 6 pre-defined indexes and the saveToLibrary mutation.

---

_Verified: 2026-02-28T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
