# Phase 45: Type Safety Sweep - Research

**Researched:** 2026-03-03
**Domain:** Convex validator typing, TypeScript `any`-cast elimination, query return validators
**Confidence:** HIGH

## Summary

Phase 45 targets three distinct categories of type safety improvements: (1) creating shared Convex validators and using them to replace `v.any()` in extraction query return types (TYPE-01, TYPE-02), (2) eliminating `as any` casts in extraction helper functions and migration code (TYPE-03, TYPE-04), and (3) fixing the `getJobDetails` `.take(100)` cap that silently drops papers from jobs with more than 100 papers (BUG-02).

The codebase already has a well-established pattern for shared validators in `convex/lib/validators.ts` (e.g., `userValidator`, `subscriptionValidator`, `creditTransactionValidator`) and a `statusResultValidator` helper in `convex/lib/query_states.ts`. The extraction domain is the last major area still using `v.any()` in return validators. The schema definitions in `convex/schema.ts` already contain the complete typed shapes for every extraction table -- the validators just need to be extracted into reusable objects.

For the `as any` casts in extraction and mutation code, the root causes are well-understood: (a) `question.type` from `Doc<"extractionQuestions">` is compatible with `QuestionType` from `lib/extraction/insights.ts` -- the casts are unnecessary, (b) `result.citationStatus` and `review.state` from Convex docs are compatible with `CitationStatus` and `ReviewState` types -- casts are unnecessary, (c) `attachReviewMetadata` uses `Map<string, any>` and `review: any` where `Doc<"extractionResultReviews">` is the correct type, (d) `migrateSearchHistoryState` uses `persistedState: any` and `(item: any)` throughout -- proper input/output types should be defined.

**Primary recommendation:** Create `convex/extraction/validators.ts` with typed validators matching the schema, replace all `v.any()` return validators in 7 public queries, remove `as any` casts in queries.ts and mutations.ts, add typed shapes to `migrateSearchHistoryState`, and change `.take(100)` to `.collect()` in `getJobDetails`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TYPE-01 | Create shared `convex/extraction/validators.ts` with typed validator objects for extraction document shapes | Schema at lines 196-635 has full typed definitions for all 8 extraction tables; pattern established in `convex/lib/validators.ts` with `userValidator`, `subscriptionValidator`, etc. |
| TYPE-02 | Replace `v.any()` return validators in 7 extraction queries with typed validators from TYPE-01 | 7 public queries identified: `getJobDetails`, `getPaperResults`, `getJobResults`, `getJobInsights`, `getQuestionInsights`, `getQuestionDisagreements`, `getReviewQueue` -- plus 4 more (`getSavedViews`, `getReportSnapshots`, `getRunDiff`, `subscribeToJobProgress`) |
| TYPE-03 | Replace `Map<string, any>` and `review: any` in `attachReviewMetadata` with `Doc<"extractionResultReviews">` | Function at queries.ts:104-129 uses `Map<string, any>` (L113) and `review: any` (L114, L118); all values come from `extractionResultReviews` table query |
| TYPE-04 | Add typed migration input/output shapes for all 7 `migrateSearchHistoryState` version steps | Function at lib/store.ts:178-282 uses `persistedState: any` parameter and `(item: any)` in all 7 map callbacks; `SearchResult` interface from `lib/types/search.types.ts` defines the final shape |
| BUG-02 | Remove `.take(100)` cap in `getJobDetails` -- replace with `.collect()` (bounded by ~200-paper job cap) | queries.ts:294 uses `.take(100)` which silently drops papers from jobs with 101-200 papers; upstream job cap of ~200 papers makes `.collect()` safe |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Convex validators (`v.*`) | Convex runtime | Runtime type validation for query return types | Built-in Convex feature; validators enforce type safety at runtime, not just compile time |
| TypeScript | Project version | Static type checking | Ensures `as any` casts are eliminated and types flow correctly |
| `Doc<"tableName">` | Auto-generated | Document type references | Generated from schema, always accurate |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `statusResultValidator` | Local (`convex/lib/query_states.ts`) | Helper to wrap query results in ok/unauthenticated/no_access union | Every public query that uses the `ok()` pattern |
| `paginationResultValidator` | Convex built-in (`convex/server`) | Typed pagination result wrapper | Paginated queries (`getJobResultsPaginated`) |

### Alternatives Considered

None. All tools needed are already in the codebase.

## Architecture Patterns

### Recommended Project Structure

```
convex/extraction/
  validators.ts          # NEW: shared validators for extraction documents
  queries.ts             # MODIFIED: replace v.any() returns with typed validators
  mutations.ts           # MODIFIED: remove as any casts
  types.ts               # EXISTING: TypeScript interfaces (unchanged)
convex/lib/
  validators.ts          # EXISTING: shared validators for user/credits/subscriptions
  query_states.ts        # EXISTING: statusResultValidator helper
lib/
  store.ts               # MODIFIED: typed migration function
  extraction/insights.ts # EXISTING: InsightEntry, QuestionType, etc. (unchanged)
```

### Pattern 1: Extraction Validator Module

**What:** Create `convex/extraction/validators.ts` exporting reusable validator objects that mirror the schema definitions.

**When to use:** Any query return type that currently uses `v.any()` for extraction documents.

**Example:**
```typescript
// Source: convex/lib/validators.ts (existing pattern)
import { v } from "convex/values";

// Job status union (reused in multiple validators)
export const jobStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading_pdfs"),
  v.literal("indexing"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

// Paper status union
export const paperStatusValidator = v.union(
  v.literal("pending"),
  v.literal("downloading"),
  v.literal("download_failed"),
  v.literal("indexing"),
  v.literal("indexing_failed"),
  v.literal("extracting"),
  v.literal("completed"),
  v.literal("failed")
);

// Question type union
export const questionTypeValidator = v.union(
  v.literal("string"),
  v.literal("boolean"),
  v.literal("number"),
  v.literal("array")
);

// Answer value union (used in results and reviews)
export const answerValueValidator = v.union(
  v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()
);

// Citation status union
export const citationStatusValidator = v.union(
  v.literal("grounded"),
  v.literal("best_effort"),
  v.literal("insufficient_evidence"),
  v.literal("extraction_error")
);

// Review state union
export const reviewStateValidator = v.union(
  v.literal("unreviewed"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("needs_followup")
);

// Full document validators (matching schema exactly)
export const extractionJobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  userId: v.id("users"),
  sourceType: v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")),
  // ... all fields from schema
});
```

**Key rule:** Validators must match the schema exactly. Extract from `convex/schema.ts` lines 196-635.

### Pattern 2: Typed Return Validators in Queries

**What:** Replace `v.any()` with specific validators in query `returns` declarations.

**When to use:** Every extraction query that currently returns `v.any()`.

**Example:**
```typescript
// BEFORE:
returns: v.union(
  v.object({
    status: v.literal("ok"),
    job: v.any(),
    questions: v.array(v.any()),
    papers: v.array(v.any()),
  }),
  ...
),

// AFTER:
returns: v.union(
  v.object({
    status: v.literal("ok"),
    job: extractionJobValidator,
    questions: v.array(extractionQuestionValidator),
    papers: v.array(extractionPaperValidator),
  }),
  ...
),
```

### Pattern 3: Typed `attachReviewMetadata`

**What:** Replace `any` annotations in the `attachReviewMetadata` helper with `Doc<"extractionResultReviews">`.

**Example:**
```typescript
// BEFORE (queries.ts:113-118):
const reviewByResultId = new Map<string, any>(
  reviews.map((review: any) => [review.resultId, review] as [string, any])
);
return results.map((result) => {
  const review: any = reviewByResultId.get(result._id);

// AFTER:
const reviewByResultId = new Map<string, Doc<"extractionResultReviews">>(
  reviews.map((review) => [review.resultId, review])
);
return results.map((result) => {
  const review = reviewByResultId.get(result._id);
```

### Pattern 4: Typed Migration Steps

**What:** Define input/output types for the `migrateSearchHistoryState` function.

**Example:**
```typescript
// Define a partial type representing the evolving persisted state shape
interface PersistedSearchHistoryState {
  searchHistory?: Array<Record<string, unknown>>;
}

// Type the function properly (Zustand persist migration contract)
export function migrateSearchHistoryState(
  persistedState: PersistedSearchHistoryState,
  version: number
): PersistedSearchHistoryState {
  // Each migration step can cast the item within its block
  if (version === 0) {
    if (persistedState.searchHistory) {
      persistedState.searchHistory = persistedState.searchHistory.map((item) => ({
        ...item,
        isYearRangeEnabled: /* ... */
      }));
    }
  }
  // ...
}
```

### Anti-Patterns to Avoid

- **Typing `searchFilters` as a specific validator in schema:** The `searchFilters: v.record(v.string(), v.any())` pattern in the schema is intentional -- it stores arbitrary filter state with mixed value types (strings, numbers, booleans, arrays). Changing this would require a schema migration and is out of scope. Leave `searchFilters` as `v.record(v.string(), v.any())` everywhere.
- **Over-typing `migrateSearchHistoryState`:** The migration function handles partially-migrated state from any version. Don't try to define precise types per version step -- use a loose record type and keep internal `item` casts narrow.
- **Creating separate validators for query-specific return shapes:** If a query returns a computed object (like insights with `topAnswers`, `citationStatusMix`), define the validator inline in the query rather than adding it to `validators.ts`. Only extract to `validators.ts` when the shape matches a document or is reused by 2+ queries.
- **Removing `paginatedAnyResultValidator`:** The paginated query (`getJobResultsPaginated`) can be improved, but its pagination shape depends on Convex's `paginationResultValidator`. Focus on the `page` items being typed, not the pagination wrapper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Document validators | Manual v.object() with guessed fields | Extract from `convex/schema.ts` table definitions exactly | Schema is the source of truth; validators must match 1:1 |
| Status result wrapping | Per-query v.union(ok, unauthenticated, no_access) | `statusResultValidator()` from `convex/lib/query_states.ts` | Already exists, DRY pattern |
| TypeScript types from validators | Manual interface definitions | `Infer<typeof validator>` from `convex/values` | Auto-derives TS type from validator |

**Key insight:** The schema already has all the typed shapes. The task is mechanical extraction, not design.

## Common Pitfalls

### Pitfall 1: Validator-Schema Mismatch

**What goes wrong:** Creating a validator that doesn't exactly match the schema causes runtime validation errors when the query returns data.
**Why it happens:** Copy-paste errors, forgetting optional fields, mismatched union members.
**How to avoid:** Copy each table's schema definition verbatim into the validator. Use diff to verify. Test by deploying to dev and calling each query.
**Warning signs:** Convex runtime error: "Validator error: ..." on query response.

### Pitfall 2: Computed Fields in Return Types

**What goes wrong:** Queries like `getJobInsights` and `getQuestionInsights` return computed objects (aggregations, diagnostics) that don't match any schema table. Using a document validator for these fails.
**Why it happens:** The return shape includes both document fields AND computed fields.
**How to avoid:** For computed return shapes, define inline validators in the query's `returns` declaration. Only use document validators from `validators.ts` for fields that ARE documents.
**Warning signs:** Runtime error when returning a field not in the validator.

### Pitfall 3: `attachReviewMetadata` Return Shape

**What goes wrong:** After typing `attachReviewMetadata`, the returned objects include `Doc<"extractionResults">` fields PLUS review overlay fields (`reviewState`, `reviewNote`, `correctedAnswer`, `reviewedAt`, `reviewedBy`). The return validator must account for this merged shape.
**Why it happens:** The function spreads result fields and adds review fields.
**How to avoid:** Define a result-with-review validator that extends the extraction result shape with optional review fields. Or use `v.any()` specifically for the merged result items within a typed outer structure.
**Warning signs:** Validator rejecting the merged object because review fields aren't in the result validator.

### Pitfall 4: `getJobDetails` `.collect()` Boundary

**What goes wrong:** Changing `.take(100)` to `.collect()` could theoretically load hundreds of papers in a single query.
**Why it happens:** The upstream job cap of ~200 papers means `.collect()` returns at most ~200 records.
**How to avoid:** The STATE.md confirms "getJobDetails .collect() safe because ~200-paper job cap is enforced upstream." This is a documented, accepted decision.
**Warning signs:** None expected. Monitor query performance after deploy.

### Pitfall 5: Zustand Migration Type Strictness

**What goes wrong:** Typing `migrateSearchHistoryState` too strictly breaks the Zustand `persist` `migrate` contract.
**Why it happens:** Zustand's `migrate` expects `(state: any, version: number) => any`. Changing to a strict type may cause the persist middleware to reject the function.
**How to avoid:** Keep the function signature compatible with Zustand's expectations. Use a loose interface for the outer shape and type individual migration steps with narrower casts. The `persistedState: any` in the public signature may need to stay as `any` for Zustand compatibility, with internal narrowing.
**Warning signs:** TypeScript error at the `migrate: migrateSearchHistoryState` assignment.

### Pitfall 6: `workflowId as any` Cast in Mutations

**What goes wrong:** `job.workflowId` is `v.optional(v.string())` in the schema, but `workflow.cancel()` expects a `WorkflowId` type from `@convex-dev/workflow`.
**Why it happens:** The stored `workflowId` is a plain string, but the library expects its own branded ID type.
**How to avoid:** This `as any` cast may be necessary unless `@convex-dev/workflow` exports a type-safe way to pass string workflow IDs. Mark as out-of-scope for this phase (it's not in the requirements).
**Warning signs:** N/A -- keep the cast.

## Code Examples

### Creating `convex/extraction/validators.ts` (TYPE-01)

The validators must be extracted from the schema definitions at `convex/schema.ts:196-635`. Key validators to create:

```typescript
import { v } from "convex/values";

// === Shared unions (reused across validators) ===

export const jobStatusValidator = v.union(
  v.literal("pending"), v.literal("downloading_pdfs"), v.literal("indexing"),
  v.literal("extracting"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")
);

export const paperStatusValidator = v.union(
  v.literal("pending"), v.literal("downloading"), v.literal("download_failed"),
  v.literal("indexing"), v.literal("indexing_failed"), v.literal("extracting"),
  v.literal("completed"), v.literal("failed")
);

export const questionTypeValidator = v.union(
  v.literal("string"), v.literal("boolean"), v.literal("number"), v.literal("array")
);

export const answerValidator = v.union(
  v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()
);

export const citationStatusValidator = v.union(
  v.literal("grounded"), v.literal("best_effort"),
  v.literal("insufficient_evidence"), v.literal("extraction_error")
);

export const reviewStateValidator = v.union(
  v.literal("unreviewed"), v.literal("accepted"),
  v.literal("rejected"), v.literal("needs_followup")
);

export const sourceTypeValidator = v.union(
  v.literal("history"), v.literal("zotero"), v.literal("manual"), v.literal("mixed")
);

// === Citation validator (nested in results) ===

export const citationValidator = v.object({
  evidenceId: v.string(),
  page: v.number(),
  charRange: v.array(v.number()),
  quote: v.string(),
  retrieval: v.object({
    denseScore: v.optional(v.number()),
    lexicalScore: v.optional(v.number()),
    fusedScore: v.optional(v.number()),
    rerankScore: v.optional(v.number()),
  }),
  validated: v.boolean(),
});

// === Retrieval diagnostics validator ===

export const retrievalDiagnosticsValidator = v.object({
  denseCandidates: v.number(),
  lexicalCandidates: v.number(),
  fusedCandidates: v.number(),
  rerankedCandidates: v.number(),
  validatedCitations: v.number(),
  strictNull: v.boolean(),
});

// === Document validators ===
// These must match the schema in convex/schema.ts exactly

export const extractionJobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  userId: v.id("users"),
  sourceType: sourceTypeValidator,
  sourceHistoryId: v.optional(v.string()),
  sourceZoteroCollection: v.optional(v.string()),
  sourceHistoryEntries: v.optional(v.array(v.object({
    historyId: v.string(),
    searchFilters: v.record(v.string(), v.any()),  // intentionally v.any() -- mixed value types
  }))),
  // ... (full definition from schema)
  searchFilters: v.optional(v.record(v.string(), v.any())),
  status: jobStatusValidator,
  totalPapers: v.number(),
  processedPapers: v.number(),
  failedPapers: v.number(),
  workflowId: v.optional(v.string()),
  name: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const extractionQuestionValidator = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
});

export const extractionPaperValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  jobId: v.id("extractionJobs"),
  openalexId: v.string(),
  title: v.string(),
  doi: v.optional(v.string()),
  publicationYear: v.optional(v.number()),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  isOpenAccess: v.optional(v.boolean()),
  processable: v.optional(v.boolean()),
  status: paperStatusValidator,
  pdfUrl: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  pdfDownloadError: v.optional(v.string()),
  sourceType: v.optional(v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"))),
  sourceId: v.optional(v.string()),
  ragEntryId: v.optional(v.string()),
  isIndexed: v.optional(v.boolean()),
  indexedAt: v.optional(v.number()),
  workId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  errorMessage: v.optional(v.string()),
  creditsUsed: v.optional(v.number()),
  pdfContentUsed: v.optional(v.boolean()),
});

export const extractionResultValidator = v.object({
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  processedAt: v.number(),
});

// Result with review overlay (returned by attachReviewMetadata)
export const extractionResultWithReviewValidator = v.object({
  // All fields from extractionResultValidator
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  processedAt: v.number(),
  // Review overlay fields (optional, added by attachReviewMetadata)
  reviewState: v.optional(reviewStateValidator),
  reviewNote: v.optional(v.string()),
  correctedAnswer: v.optional(answerValidator),
  reviewedAt: v.optional(v.number()),
  reviewedBy: v.optional(v.id("users")),
});
```

### Fixing `attachReviewMetadata` (TYPE-03)

```typescript
// BEFORE (queries.ts:104-129):
async function attachReviewMetadata(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">,
  results: Doc<"extractionResults">[]
) {
  const reviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_paper", (q) => q.eq("paperId", paperId))
    .collect();
  const reviewByResultId = new Map<string, any>(
    reviews.map((review: any) => [review.resultId, review] as [string, any])
  );
  return results.map((result) => {
    const review: any = reviewByResultId.get(result._id);
    // ...
  });
}

// AFTER:
async function attachReviewMetadata(
  ctx: QueryCtx,
  paperId: Id<"extractionPapers">,
  results: Doc<"extractionResults">[]
) {
  const reviews = await ctx.db
    .query("extractionResultReviews")
    .withIndex("by_paper", (q) => q.eq("paperId", paperId))
    .collect();
  const reviewByResultId = new Map<string, Doc<"extractionResultReviews">>(
    reviews.map((review) => [review.resultId, review])
  );
  return results.map((result) => {
    const review = reviewByResultId.get(result._id);
    if (!review) return result;
    return {
      ...result,
      reviewState: toReviewState(review.state),
      reviewNote: review.note,
      correctedAnswer: review.correctedAnswer,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
    };
  });
}
```

### Fixing `getJobDetails` BUG-02

```typescript
// BEFORE (queries.ts:288-294):
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_processable", (q) =>
    q.eq("jobId", args.jobId).eq("processable", true)
  )
  .order("asc")
  .take(100);

// AFTER:
const papers = await ctx.db
  .query("extractionPapers")
  .withIndex("by_job_processable", (q) =>
    q.eq("jobId", args.jobId).eq("processable", true)
  )
  .order("asc")
  .collect();
```

### Removing `as any` Casts in Mutations (partial TYPE-03 scope)

```typescript
// mutations.ts:93 - citationStatus cast
// BEFORE:
citationStatus: result?.citationStatus as any,
// AFTER:
citationStatus: result?.citationStatus,

// mutations.ts:95 - review state cast
// BEFORE:
reviewState: (review?.state as any) || "unreviewed",
// AFTER:
reviewState: review?.state || "unreviewed",

// mutations.ts:801-802, 835 - question.type cast
// BEFORE:
aggregate: aggregateQuestionInsights(entries, question.type as any),
// AFTER:
aggregate: aggregateQuestionInsights(entries, question.type as QuestionType),
// OR simply:
aggregate: aggregateQuestionInsights(entries, question.type),
// (Both should work since Doc<"extractionQuestions">["type"] is compatible with QuestionType)
```

### Typing `migrateSearchHistoryState` (TYPE-04)

```typescript
// Define the evolving persisted state shape
interface SearchHistoryPersistedState {
  searchHistory?: Array<Record<string, unknown>>;
}

// Keep function signature compatible with Zustand's migrate contract
// Zustand expects (state: any, version: number) => any but we narrow internally
export function migrateSearchHistoryState(
  persistedState: SearchHistoryPersistedState,
  version: number
): SearchHistoryPersistedState {
  if (version === 0) {
    if (persistedState.searchHistory) {
      persistedState.searchHistory = persistedState.searchHistory.map((item) => ({
        ...item,
        isYearRangeEnabled: (() => {
          const yearRange = item.yearRange as [number, number] | undefined;
          if (yearRange && Array.isArray(yearRange)) {
            return yearRange[0] !== MIN_YEAR || yearRange[1] !== new Date().getFullYear();
          }
          return false;
        })(),
      }));
    }
  }
  // ... (similar pattern for each version step)
  return persistedState;
}
```

**Important:** The Zustand `persist` middleware's `migrate` option is typed as `(state: any, version: number) => any` in Zustand 4.x. The function must remain assignable to this signature. Using `SearchHistoryPersistedState` should still work since it's assignable to/from `any`.

## Complete Inventory of Changes

### Queries with `v.any()` in Return Validators (TYPE-02)

| # | Query | Line | Fields Using v.any() | Replacement |
|---|-------|------|---------------------|-------------|
| 1 | `getJobDetails` | 261-263 | `job: v.any()`, `questions: v.array(v.any())`, `papers: v.array(v.any())` | Use document validators |
| 2 | `getPaperResults` | 328-329 | `paper: v.any()`, `results: v.array(v.any())` | Use document + result-with-review validator |
| 3 | `getJobResults` | 411-413 | `job: v.any()`, `questions: v.array(v.any())`, `papers: v.any()` | Use document validators |
| 4 | `getJobInsights` | 533-536 | `job: v.any()`, `summary: v.any()`, `questions: v.array(v.any())`, `diagnostics: v.any()` | Inline typed validators for computed shapes |
| 5 | `getQuestionInsights` | 668, 681, 688-690 | `question: v.any()`, `citationStatusMix: v.any()`, `topAnswers: v.array(v.any())`, `rawAnswerDistribution: v.array(v.any())`, `entityDistribution: v.optional(v.array(v.any()))` | Inline typed validators matching aggregate output |
| 6 | `getQuestionDisagreements` | 779, 785 | `question: v.any()`, `clusters: v.array(v.any())` | Inline typed validators matching cluster output |
| 7 | `getReviewQueue` | 892-893 | `counts: v.any()`, `items: v.array(v.any())` | Inline typed validators for counts and review items |
| 8 | `getSavedViews` | 985 | `views: v.array(v.any())` | Use saved view document validator |
| 9 | `getReportSnapshots` | 1054 | `reports: v.array(v.any())` | Use report snapshot document validator |
| 10 | `getRunDiff` | 1083 | `diff: v.union(v.null(), v.any())` | Use run diff document validator |
| 11 | `subscribeToJobProgress` | 1286-1288 | `job: v.any()`, `statusCounts: v.any()`, `recentPapers: v.array(v.any())` | Use document + inline validators |

Also affected but lower priority (paginated/utility):
| 12 | `getJobResultsPaginated` | 472-473 | `paginatedAnyResultValidator` (L172) | Typed pagination result |
| 13 | `getMyJobs` | 197, 209 | `searchFilters: v.record(v.string(), v.any())` | Keep as-is (schema-level) |
| 14 | `getWorkflowTemplates` | 1015 | `searchFilters: v.record(v.string(), v.any())` | Keep as-is (schema-level) |

### `as any` Casts to Remove

| # | File | Line(s) | Cast | Replacement |
|---|------|---------|------|-------------|
| 1 | `queries.ts` | 113-114 | `Map<string, any>`, `(review: any)` | `Map<string, Doc<"extractionResultReviews">>` |
| 2 | `queries.ts` | 118 | `const review: any` | `const review` (typed by Map) |
| 3 | `queries.ts` | 583 | `(result: any)` | Remove cast (typed by Map) |
| 4 | `queries.ts` | 586 | `const result: any` | Remove cast |
| 5 | `queries.ts` | 604 | `question.type as any` | `question.type` or explicit `as QuestionType` |
| 6 | `queries.ts` | 715 | `(row: any)` | Typed from `attachReviewMetadata` return |
| 7 | `queries.ts` | 730 | `question.type as any` | `question.type` |
| 8 | `queries.ts` | 839 | `question.type as any` | `question.type` |
| 9 | `queries.ts` | 909, 914, 920, 933, 936-941 | Multiple `(result as any).*` | Properly typed via `attachReviewMetadata` return |
| 10 | `mutations.ts` | 93 | `result?.citationStatus as any` | Remove cast |
| 11 | `mutations.ts` | 95 | `(review?.state as any)` | Remove cast |
| 12 | `mutations.ts` | 801-802 | `question.type as any` (x2) | Remove cast |
| 13 | `mutations.ts` | 835 | `row.question.type as any` | Remove cast |
| 14 | `mutations.ts` | 959 | `result.citationStatus as any` | Remove cast |
| 15 | `mutations.ts` | 807, 814, 815, 818, 824 | `(row: any)` (x5) | Type from insight data |
| 16 | `workpoolActions.ts` | 778 | `storageId: storedId as any` | Remove cast (types should match) |

### `as any` Casts OUT OF SCOPE (keep as-is)

| File | Line | Cast | Reason |
|------|------|------|--------|
| `mutations.ts` | 257 | `job.workflowId as any` | String-to-WorkflowId bridge; @convex-dev/workflow typing issue |
| `test_automation.ts` | 28, 31, 56, 65 | Multiple `as any` | Test utility code, not production |
| `testWorkflow.ts` | 51 | `as any` | Test utility code |
| `debug_job_citations.ts` | 156-271 | Multiple `as any` | Debug tooling, not production |
| `test_runner.ts` | 21, 124 | `returns: v.any()` | Test runner, not production queries |
| `testActions.ts` | 17 | `returns: v.any()` | Test actions |
| `debug.ts` | 16 | `returns: v.any()` | Debug endpoint |
| `debug_errors.ts` | 16 | `returns: v.any()` | Debug endpoint |
| `create_test_job.ts` | 17 | `returns: v.any()` | Test utility |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `v.any()` in query returns | Typed validators matching schema | Convex has supported return validators since v1.x | Runtime validation catches mismatches; TypeScript inference for consumers |
| `as any` to bridge compatible types | Direct assignment (types are compatible) | Always been possible | Catches future regressions |
| `.take(100)` hard cap | `.collect()` bounded by upstream job cap | Decision documented in STATE.md | All papers visible in job details |

## Open Questions

1. **Should `searchFilters: v.record(v.string(), v.any())` be replaced?**
   - What we know: This appears in the schema (3 places), mutations (5 places), and query return types (3 places). The values are mixed types (strings, numbers, booleans, arrays).
   - What's unclear: Whether Convex supports `v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()), v.null()))` as a replacement.
   - Recommendation: Leave `searchFilters` as `v.record(v.string(), v.any())`. It's in the schema definition and changing it is a schema migration concern. The `v.any()` here is intentional for storing arbitrary filter state. Focus on the return-type `v.any()` instead.

2. **Should `getJobResultsPaginated` be typed?**
   - What we know: It uses `paginatedAnyResultValidator` (L172) which wraps `v.any()` in the pagination result. The `page` items are augmented with results.
   - What's unclear: Whether the pagination result can be cleanly typed while keeping the pagination fields.
   - Recommendation: Include it if time permits, but it's lower priority than the 11 queries with direct `v.any()` in their return objects. The pagination wrapper adds complexity.

3. **How strict should `migrateSearchHistoryState` typing be?**
   - What we know: Zustand's `persist` middleware expects `(state: any, version: number) => any`. The function processes partially-migrated state.
   - What's unclear: Whether TypeScript will accept a more specific signature at the `migrate:` assignment site.
   - Recommendation: Try `SearchHistoryPersistedState` first. If Zustand rejects the assignment, keep the public signature as `any` but add a `// TYPE-04: Internal migration typing` comment and type the internal operations.

## Sources

### Primary (HIGH confidence)

- `convex/schema.ts:196-635` -- All extraction table definitions with complete typed shapes
- `convex/extraction/queries.ts` -- All 15 export queries inspected, 11 with `v.any()` in returns
- `convex/extraction/mutations.ts` -- 7 `as any` casts identified with root causes
- `convex/extraction/types.ts` -- Existing TypeScript interfaces and validator schemas
- `convex/lib/validators.ts` -- Established pattern for shared validators
- `convex/lib/query_states.ts` -- `statusResultValidator` helper
- `lib/store.ts:178-282` -- Full `migrateSearchHistoryState` with 7 version steps
- `lib/extraction/insights.ts:1-110` -- `InsightEntry`, `QuestionType`, `CitationStatus`, `RunDiffRecord` types
- `lib/types/extraction.types.ts` -- Frontend extraction type definitions
- `tests/store-migrations.test.ts` -- Existing migration tests covering all 7 version steps

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` -- Confirms "getJobDetails .collect() safe because ~200-paper job cap is enforced upstream"
- `.planning/milestones/v2.3-phases/36-type-safety-sweep/36-RESEARCH.md` -- Prior type safety research (Phase 36 handled ctx/internal/components casts)

### Tertiary (LOW confidence)

- Zustand persist `migrate` type signature -- Based on training knowledge of Zustand 4.x API. Should be verified if typing issues arise.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are built-in Convex features and existing project patterns
- Architecture: HIGH - Pattern established in `convex/lib/validators.ts`; schema is the single source of truth
- Pitfalls: HIGH - All identified from direct code inspection; `searchFilters` v.any() exception documented

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable -- Convex validators are a stable feature)
