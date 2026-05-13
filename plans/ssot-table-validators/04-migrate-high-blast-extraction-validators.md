# Plan 04 — Migrate high-blast `convex/extraction/validators.ts` mirrors

## Goal

Apply the SSOT field-object pattern to the four highest-blast extraction mirrors: `extractionPapers`, `extractionJobs`, `extractionResults`, `extractionQuestions`. These four are the most-consumed validators in the codebase (4–7 surfaces each per the audit) and the most likely to drift next. After this plan, the runtime row shape and the wire validator shape are pinned together by the type guard.

## Scope

- Two files:
  - `convex/extraction/validators.ts` — add four field-objects (`extractionPaperFields`, `extractionJobFields`, `extractionResultFields`, `extractionQuestionFields`), rewrite the four mirror validators to spread the field-object, add four `_check_xValidator` guards. Update `paginatedPaperWithResultsValidator` to spread `...extractionPaperFields` instead of `...extractionPaperValidator.fields`.
  - `convex/schema.ts` — replace the four `defineTable({...})` inline literals with `defineTable(xFields)` references.
- Out of scope: remaining extraction validators (plan 05), chat/screening backfill (plan 06), parity test (plan 07).

## Design

Pattern repeats from plan 02. Per-table commits:

### Commit 1: `extractionPapers`

The 70-line field-object lifted verbatim from `convex/schema.ts:617-710`. The `projectionQuestionStates` inner `v.array(v.object({...}))` stays inline inside the field-object — promoting it to a separate validator is a refactor outside this plan's scope.

```ts
export const extractionPaperFields = {
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
  sourceType: v.optional(paperSourceTypeValidator),
  sourceId: v.optional(v.string()),
  ragEntryId: v.optional(v.string()),
  isIndexed: v.optional(v.boolean()),
  indexedAt: v.optional(v.number()),
  indexingBilled: v.optional(v.boolean()),
  workId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  lastError: v.optional(structuredErrorValidator),
  attemptCount: v.optional(v.number()),
  creditsUsed: v.optional(v.number()),
  questionsBilled: v.optional(v.boolean()),
  pdfContentUsed: v.optional(v.boolean()),
  sortTitle: v.optional(v.string()),
  avgConfidence: v.optional(v.number()),
  hasErrors: v.optional(v.boolean()),
  hasPdfSource: v.optional(v.boolean()),
  questionAnswerTokens: v.optional(v.array(v.string())),
  searchText: v.optional(v.string()),
  projectionResultCount: v.optional(v.number()),
  projectionConfidenceSum: v.optional(v.number()),
  projectionQuestionStates: v.optional(
    v.array(
      v.object({
        questionKey: v.string(),
        token: v.optional(v.string()),
        searchPart: v.optional(v.string()),
      }),
    ),
  ),
  projectionErrorQuestionKeys: v.optional(v.array(v.string())),
};

export const extractionPaperValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  ...extractionPaperFields,
});

const _check_extractionPaperValidator: AssertExactDoc<"extractionPapers", typeof extractionPaperValidator> = true;
```

**Also update** `paginatedPaperWithResultsValidator` (line 448 today):

```ts
export const paginatedPaperWithResultsValidator = v.object({
  _id: v.id("extractionPapers"),
  _creationTime: v.number(),
  ...extractionPaperFields,
  results: v.array(extractionResultValidator),
});
```

(Or if commit 1 ships before commit 3's `extractionResultFields`, leave the `results` array referencing `extractionResultValidator` — it stays the same identifier across both commits, the inner change is invisible to the wrapper.)

Schema-side:

```ts
// convex/schema.ts
import { extractionPaperFields } from "./extraction/validators";

extractionPapers: defineTable(extractionPaperFields)
  .index("by_job", ["jobId"])
  .index("by_job_processable", ["jobId", "processable"])
  .index("by_job_status", ["jobId", "status"])
  .index("by_openalex", ["openalexId"])
  .index("by_work", ["workId"])
  .index("by_status_completedAt", ["status", "completedAt"])
  .index("by_ragEntryId_isIndexed", ["ragEntryId", "isIndexed"])
  .searchIndex("search_by_job_text", {
    searchField: "searchText",
    filterFields: ["jobId", "processable"],
  }),
```

### Commit 2: `extractionJobs`

Lift the `defineTable({...})` body at `convex/schema.ts:368-475` into `extractionJobFields`. Note the inline `v.union(...)` for `status`, `pausedFromStatus`, and `mode` — reuse the existing `jobStatusValidator`, `pausedFromStatusValidator`, and `sourceTypeValidator` exports already present in `convex/extraction/validators.ts:1-194`. The `estimatedCredits` inline `v.object` stays inline inside the field-object.

```ts
export const extractionJobFields = {
  userId: v.id("users"),
  mode: v.union(v.literal("extraction"), v.literal("chat")),
  sourceType: v.optional(sourceTypeValidator),
  status: v.optional(jobStatusValidator),
  totalPapers: v.optional(v.number()),
  processedPapers: v.optional(v.number()),
  failedPapers: v.optional(v.number()),
  workflowId: v.optional(v.string()),
  runEpoch: v.optional(v.number()),
  usePdfs: v.optional(v.boolean()),
  pausedAt: v.optional(v.number()),
  pausedFromStatus: v.optional(pausedFromStatusValidator),
  estimatedCredits: v.optional(
    v.object({ low: v.number(), mid: v.number(), high: v.number() }),
  ),
  chatThreadId: v.optional(v.string()),
  chatModelId: v.optional(v.id("models")),
  webSearchEnabled: v.optional(v.boolean()),
  lastMessageAt: v.optional(v.number()),
  messageCount: v.optional(v.number()),
  isGenerating: v.optional(v.boolean()),
  generatingStartedAt: v.optional(v.number()),
  chatGenerationAttemptId: v.optional(v.string()),
  shouldAbort: v.optional(v.boolean()),
  name: v.string(),
  description: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  error: v.optional(structuredErrorValidator),
};

export const extractionJobValidator = v.object({
  _id: v.id("extractionJobs"),
  _creationTime: v.number(),
  ...extractionJobFields,
});

const _check_extractionJobValidator: AssertExactDoc<"extractionJobs", typeof extractionJobValidator> = true;
```

Schema-side: import and use `extractionJobFields`. The five indexes are preserved verbatim.

### Commit 3: `extractionResults`

Same pattern. The `citations` array's inner `v.object` and the `retrievalDiagnostics` inline `v.object` stay where they are (sub-shape inlining is not what this plan refactors). Optionally extract them into `citationValidator` / `retrievalDiagnosticsValidator` references — those already exist at `convex/extraction/validators.ts:142,156` and the schema currently re-declares them inline. **Recommendation**: deduplicate. The schema's inline citation/retrievalDiagnostics shapes were audited identical (2026-05-13) — replace with the existing named validators.

```ts
export const extractionResultFields = {
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  questionKey: v.string(),
  answer: answerValidator,
  confidence: v.optional(v.number()),
  reasoning: v.optional(v.string()),
  citations: v.array(citationValidator),
  citationStatus: citationStatusValidator,
  retrievalDiagnostics: v.optional(retrievalDiagnosticsValidator),
  status: v.optional(resultStatusValidator),
  billed: v.optional(v.boolean()),
  attemptCount: v.optional(v.number()),
  lastError: v.optional(structuredErrorValidator),
  model: v.optional(v.string()),
  provider: v.optional(v.string()),
  pdfContentUsed: v.optional(v.boolean()),
  processedAt: v.number(),
};

export const extractionResultValidator = v.object({
  _id: v.id("extractionResults"),
  _creationTime: v.number(),
  ...extractionResultFields,
});

const _check_extractionResultValidator: AssertExactDoc<"extractionResults", typeof extractionResultValidator> = true;
```

Schema-side: import `extractionResultFields`, `citationValidator`, `retrievalDiagnosticsValidator`. Five indexes preserved.

### Commit 4: `extractionQuestions`

The smallest of the four. Reuse the existing `questionTypeValidator` if exported (it is — declared at the top of `convex/extraction/validators.ts`).

```ts
export const extractionQuestionFields = {
  jobId: v.id("extractionJobs"),
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
  description: v.optional(v.string()),
  order: v.number(),
  createdAt: v.number(),
};

export const extractionQuestionValidator = v.object({
  _id: v.id("extractionQuestions"),
  _creationTime: v.number(),
  ...extractionQuestionFields,
});

const _check_extractionQuestionValidator: AssertExactDoc<"extractionQuestions", typeof extractionQuestionValidator> = true;
```

## TDD sequence

Same R-step (drift attempt) → G-step (revert + commit) discipline as plans 02/03. One drift attempt per commit, reverted before the green commit lands.

For each of the four commits:

1. **R**: omit one optional field from `xFields` while leaving it in the schema. Run `npx tsc --noEmit` — the corresponding `_check_xValidator` guard surfaces the drift. Restore the field.
2. **G**: `npx tsc --noEmit` clean.
3. **Test**: run the existing test suites that consume the validator:
   - `extractionPaperFields`: `npx vitest run convex/extraction/queries convex/extraction/mutations convex/extraction/results`.
   - `extractionJobFields`: `npx vitest run convex/extraction/queries/jobs`.
   - `extractionResultFields`: `npx vitest run convex/extraction/queries/results convex/extraction/mutations/results`.
   - `extractionQuestionFields`: any test file that asserts on `extractionQuestions` rows.

## Files touched

- `convex/extraction/validators.ts:195-451` — four new field-objects, four guard lines, four rewritten validators, one updated `paginatedPaperWithResultsValidator`.
- `convex/schema.ts:368-721` — four `defineTable({...}) → defineTable(xFields)` rewrites; possibly two import additions (`citationValidator`, `retrievalDiagnosticsValidator`) if the inline schema declarations are de-duplicated.

## Migration stance

Pure refactor. No row-shape change on any of the four tables. Field-by-field equivalence verified by the type guard at compile time and by the existing test suites at runtime.

The optional schema-side dedup of inline `citation` / `retrievalDiagnostics` shapes (commit 3) does **NOT** change the wire shape — `citationValidator` and `retrievalDiagnosticsValidator` were audited to match the schema's inline shapes byte-for-byte on 2026-05-13. If the dedup causes the convex push to complain about a shape change, the audit was wrong — revert that piece of the commit and keep the dedup separate.

## Test plan

- `npx tsc --noEmit` after each commit — clean.
- `npx vitest run convex/extraction` after each commit — green.
- `npx vitest run convex/extraction/results.test.ts convex/extraction/queries/jobs.test.ts` specifically — these are the heaviest consumers of the four migrated validators.
- Smoke test: load the `/extractions/<jobId>` page in the dev browser after the four commits land, confirm the paper list and per-question results both render without a validator error in the convex log.

## Deployability gate

After EACH of the four commits:

- `npx pm2 logs convex --lines 5 --nostream` — `✔ Convex functions ready!`.
- No `✖ Error`, no `Schema validator complaint`.
- After commit 1, also run `npx pm2 logs next --lines 5 --nostream` and confirm no `Type error` in any extraction-page route — the new `extractionPaperFields` import propagates via the validator export.
- For commit 1 specifically: spot-check `getJobDetails` and `getJobResultsPage` in the dashboard against a job that has both `questionsBilled` and `indexingBilled` populated — both fields must appear on the wire.

## Acceptance criteria

- Four `xFields` exports in `convex/extraction/validators.ts`.
- Four `_check_xValidator: AssertExactDoc<...> = true;` guards present.
- `paginatedPaperWithResultsValidator` uses `...extractionPaperFields` (no more `...extractionPaperValidator.fields`).
- `convex/schema.ts` imports and uses all four field-objects via `defineTable(xFields)`.
- `npx tsc --noEmit` clean.
- pm2 deployability gate green after each commit.
- All existing `convex/extraction` tests green.

## Known pitfalls

- **`mode: v.union(v.literal("extraction"), v.literal("chat"))`** is inlined in both the schema and the validator. There is no `extractionJobModeValidator` export today. Keep the inline `v.union` inside `extractionJobFields` — do not introduce a new named export just for this. The SSOT pattern shares the field-object; the inline union is identical on both sides.
- **`citations` and `retrievalDiagnostics` schema-side inlines** — these duplicate the existing `citationValidator` / `retrievalDiagnosticsValidator` exports. The audit confirmed they are byte-identical. Deduplication is safe but should be its own one-line edit inside the commit, not a separate commit.
- **`extractionPaperFields.projectionQuestionStates`** inner `v.array(v.object({...}))` stays inline — promoting it is structural churn unrelated to SSOT. Leave it.
- **`paginatedPaperWithResultsValidator`** — must be updated in commit 1 so it uses `extractionPaperFields` directly. Skipping this is a small drift seed (it would still work today via `extractionPaperValidator.fields`, but the new pattern is the field-object spread).
- **The four commits can land in any order** — none of them depend on each other's exports. Recommended: paper → job → result → question in descending blast radius, so the most-consumed validator is guarded first.
- **Convex `Doc<"extractionPapers">` includes the projection bookkeeping fields** (`projectionResultCount`, etc.) per `convex/schema.ts:698-709`. These were intentionally added to the row by the results-scale plan. The validator must mirror them — `AssertExactDoc` enforces this.
- **`isIndexed`, `indexingBilled`, `questionsBilled` are all `v.optional(v.boolean())`** — three independent idempotency gates. Do NOT collapse them or rename. They are referenced by name in `markPaperIndexed`, `finalizePaper`, and `subscribeToJobProgress`.
