# Plan 05 — Migrate remaining extraction validators

## Goal

Finish the extraction-tree migration started in plan 04. Apply the SSOT field-object pattern to the six remaining row-mirror validators in `convex/extraction/validators.ts`:

1. `extractionPaperErrorValidator`
2. `extractionEvidenceUnitValidator`
3. `extractionSavedViewValidator`
4. `extractionReportSnapshotValidator`
5. `extractionRunDiffValidator`
6. `workflowTemplateValidator` (which carries a latent drift in `bucketItems` — see § Design)

After plan 05 lands, every existing row-mirror validator across `convex/lib/validators.ts` and `convex/extraction/validators.ts` is the spread of a field-object, fronted by an `AssertExactDoc<>` guard. Schema and validator can no longer drift undetected.

## Scope

- Two files:
  - `convex/extraction/validators.ts` — add six field-objects, six `_check_` guards, plus one new `templateBucketItemValidator` (see § Design).
  - `convex/schema.ts` — change six `defineTable({...})` calls to `defineTable(xFields)`, deduplicate the inline `bucketItems` shape in `extractionWorkflowTemplates` by importing the new `templateBucketItemValidator`.
- Out of scope: chat/screening backfill (plan 06), parity test (plan 07).

## Design

### Commit 1: `extractionPaperErrors`

```ts
export const extractionPaperErrorFields = {
  paperId: v.id("extractionPapers"),
  jobId: v.id("extractionJobs"),
  attempt: v.number(),
  at: v.number(),
  code: errorCodeValidator,
  message: v.string(),
  httpStatus: v.optional(v.number()),
  providerName: v.optional(v.string()),
  context: v.optional(v.any()),
};

export const extractionPaperErrorValidator = v.object({
  _id: v.id("extractionPaperErrors"),
  _creationTime: v.number(),
  ...extractionPaperErrorFields,
});

const _check_extractionPaperErrorValidator: AssertExactDoc<
  "extractionPaperErrors",
  typeof extractionPaperErrorValidator
> = true;
```

Schema swap is mechanical: `defineTable(extractionPaperErrorFields).index("by_paper", ["paperId"]).index("by_job", ["jobId"])`.

### Commit 2: `extractionEvidenceUnits`

```ts
export const extractionEvidenceUnitFields = {
  jobId: v.id("extractionJobs"),
  paperId: v.id("extractionPapers"),
  evidenceId: v.string(),
  page: v.number(),
  charRange: v.array(v.number()),
  text: v.string(),
  section: v.optional(v.string()),
  tokens: v.array(v.string()),
  anchorConfidence: v.number(),
  source: v.string(),
  createdAt: v.number(),
};

export const extractionEvidenceUnitValidator = v.object({
  _id: v.id("extractionEvidenceUnits"),
  _creationTime: v.number(),
  ...extractionEvidenceUnitFields,
});

const _check_extractionEvidenceUnitValidator: AssertExactDoc<
  "extractionEvidenceUnits",
  typeof extractionEvidenceUnitValidator
> = true;
```

Schema swap preserves all four indexes (`by_paper`, `by_paper_evidence`, `by_paper_page`, `by_job`).

### Commit 3: `extractionSavedViews`

```ts
export const extractionSavedViewFields = {
  jobId: v.id("extractionJobs"),
  userId: v.id("users"),
  name: v.string(),
  filters: v.object({
    searchQuery: v.string(),
    confidenceRange: v.array(v.number()),
    statusFilters: v.array(v.string()),
  }),
  sortBy: v.optional(v.string()),
  viewMode: v.optional(v.string()),
  selectedQuestionKeys: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const extractionSavedViewValidator = v.object({
  _id: v.id("extractionSavedViews"),
  _creationTime: v.number(),
  ...extractionSavedViewFields,
});

const _check_extractionSavedViewValidator: AssertExactDoc<
  "extractionSavedViews",
  typeof extractionSavedViewValidator
> = true;
```

Note the inline `filters` object stays inline — it is a one-off nested shape used nowhere else and lifting it would be premature DRY. The `_check_` guard still proves alignment.

### Commit 4: `extractionReportSnapshots`

```ts
export const extractionReportSnapshotFields = {
  jobId: v.id("extractionJobs"),
  userId: v.id("users"),
  name: v.string(),
  scope: v.object({
    filteredPaperIds: v.optional(v.array(v.id("extractionPapers"))),
    selectedQuestionKeys: v.optional(v.array(v.string())),
    viewName: v.optional(v.string()),
  }),
  sections: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      body: v.string(),
    }),
  ),
  metrics: v.object({
    totalPapers: v.number(),
    answeredRate: v.number(),
    groundedRate: v.number(),
    bestEffortRate: v.number(),
  }),
  generatedAt: v.number(),
  createdAt: v.number(),
};

export const extractionReportSnapshotValidator = v.object({
  _id: v.id("extractionReportSnapshots"),
  _creationTime: v.number(),
  ...extractionReportSnapshotFields,
});

const _check_extractionReportSnapshotValidator: AssertExactDoc<
  "extractionReportSnapshots",
  typeof extractionReportSnapshotValidator
> = true;
```

The three inline objects (`scope`, `sections`, `metrics`) stay inline — same reasoning as `extractionSavedViews`.

### Commit 5: `extractionRunDiffs`

`extractionRunDiffs.changes[]` carries a large inline object with `previousAnswer` / `nextAnswer` that the schema declares as `v.optional(v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()))`. The validator at `convex/extraction/validators.ts:525-528` uses `v.optional(answerValidator)` — already deduplicated. Field-object stays close to current shape:

```ts
export const extractionRunDiffChangeValidator = v.object({
  openalexId: v.string(),
  title: v.string(),
  questionKey: v.string(),
  changeType: v.union(
    v.literal("new"),
    v.literal("changed"),
    v.literal("removed"),
    v.literal("confidence_shift"),
    v.literal("newly_insufficient_evidence"),
  ),
  previousAnswer: v.optional(answerValidator),
  nextAnswer: v.optional(answerValidator),
  previousConfidence: v.optional(v.number()),
  nextConfidence: v.optional(v.number()),
});

export const extractionRunDiffFields = {
  jobId: v.id("extractionJobs"),
  baselineJobId: v.id("extractionJobs"),
  userId: v.id("users"),
  summary: v.object({
    newAnswers: v.number(),
    changedAnswers: v.number(),
    removedAnswers: v.number(),
    confidenceShifts: v.number(),
    newlyInsufficientEvidence: v.number(),
    totalCompared: v.number(),
  }),
  changes: v.array(extractionRunDiffChangeValidator),
  generatedAt: v.number(),
  createdAt: v.number(),
  isTruncated: v.optional(v.boolean()),
  totalChanges: v.optional(v.number()),
};

export const extractionRunDiffValidator = v.object({
  _id: v.id("extractionRunDiffs"),
  _creationTime: v.number(),
  ...extractionRunDiffFields,
});

const _check_extractionRunDiffValidator: AssertExactDoc<
  "extractionRunDiffs",
  typeof extractionRunDiffValidator
> = true;
```

Schema swap: replace the inline `changes` array (which still uses the raw `v.union(v.string(), ..., v.null())`) with `v.array(extractionRunDiffChangeValidator)`, then `defineTable(extractionRunDiffFields)`. This deduplicates the answer-shape union to use `answerValidator` on the schema side too.

### Commit 6: `extractionWorkflowTemplates` (closes a latent drift)

**Drift fact** (audited 2026-05-13): `workflowTemplateValidator.bucketItems` uses `bucketItemInputValidator` (validators.ts:281-292), which declares `citedByCount`, `venueName`, `workType` as optional fields. The schema's inline `bucketItems` array (schema.ts:889-915) does NOT include those three fields. This is a validator-wider-than-table drift. It does not corrupt return payloads (the three fields are optional, so the runtime row simply lacks them), but `AssertExactDoc<"extractionWorkflowTemplates", typeof workflowTemplateValidator>` collapses to the `"validator has fields the table does not"` literal and fails the TS compile.

**Fix**: introduce a `templateBucketItemValidator` that mirrors the schema's actual `bucketItems[]` shape (no `citedByCount`, no `venueName`, no `workType`). Leave `bucketItemInputValidator` as the wider input validator for `startJob` / `saveWorkflowTemplate` mutation args — those mutations accept the extra three OpenAlex-derived fields for live job submission, but the template persists only the subset that round-trips through OpenAlex re-fetch.

```ts
// validators.ts — new export, placed directly under bucketItemInputValidator
/**
 * Persisted bucket-item shape on `extractionWorkflowTemplates.bucketItems`.
 * Narrower than `bucketItemInputValidator` because the three OpenAlex-derived
 * signals (`citedByCount`, `venueName`, `workType`) are re-fetched at template
 * re-run time rather than frozen onto the row — the template is the seed, not
 * the snapshot.
 */
export const templateBucketItemValidator = v.object({
  bucketKey: v.string(),
  source: v.union(
    v.literal("history"),
    v.literal("library"),
    v.literal("collection"),
    v.literal("zotero"),
    v.literal("upload"),
  ),
  sourceRefId: v.string(),
  title: v.string(),
  authors: v.array(v.string()),
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
  openalexId: v.optional(v.string()),
  abstract: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  searchFilters: v.optional(searchFiltersValidator),
  libraryType: v.optional(v.union(v.literal("user"), v.literal("group"))),
  groupId: v.optional(v.string()),
  zoteroUserId: v.optional(v.string()),
  collectionKey: v.optional(v.string()),
  includeDescendants: v.optional(v.boolean()),
});

export const workflowTemplateFields = {
  userId: v.id("users"),
  name: v.string(),
  description: v.optional(v.string()),
  sourceType: sourceTypeValidator,
  bucketItems: v.array(templateBucketItemValidator),
  questions: v.array(questionInputValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const workflowTemplateValidator = v.object({
  _id: v.id("extractionWorkflowTemplates"),
  _creationTime: v.number(),
  ...workflowTemplateFields,
});

const _check_workflowTemplateValidator: AssertExactDoc<
  "extractionWorkflowTemplates",
  typeof workflowTemplateValidator
> = true;
```

Schema swap:

```ts
// convex/schema.ts
import {
  // …existing imports…
  workflowTemplateFields,
  templateBucketItemValidator,
} from "./extraction/validators";

extractionWorkflowTemplates: defineTable(workflowTemplateFields)
  .index("by_user", ["userId"])
  .index("by_user_name", ["userId", "name"]),
```

The schema-side inline `bucketItems` block (schema.ts:889-915) and inline `questions` block (916-928) collapse into the imported field-object. The schema becomes considerably shorter.

## TDD sequence

Each commit follows the drift-attempt → revert → confirm pattern from plans 02–04.

1. **Commit 1 (extractionPaperErrors)**:
   - R: omit `attempt` from `extractionPaperErrorFields`. `npx tsc --noEmit` errors on `_check_extractionPaperErrorValidator` with the validator-narrower message. Restore.
   - G: clean.
   - Test: `convex/extraction/paperErrors.test.ts` (or the closest existing paper-errors test) passes.

2. **Commit 2 (extractionEvidenceUnits)**:
   - R: omit `anchorConfidence`. `tsc` errors. Restore.
   - G: clean.
   - Test: existing evidence-unit query tests pass.

3. **Commit 3 (extractionSavedViews)**:
   - R: omit `viewMode`. `tsc` errors. Restore.
   - G: clean.

4. **Commit 4 (extractionReportSnapshots)**:
   - R: omit `metrics` from the field-object. `tsc` errors. Restore.
   - G: clean.

5. **Commit 5 (extractionRunDiffs)**:
   - R: omit `isTruncated`. `tsc` errors. Restore.
   - G: clean.

6. **Commit 6 (workflowTemplate, closes drift)**:
   - R: keep `workflowTemplateFields.bucketItems` as `v.array(bucketItemInputValidator)` (the pre-existing wider validator). Add the `_check_workflowTemplateValidator` line. `npx tsc --noEmit` errors with `"validator has fields the table does not (validator is wider)"` — proves the drift was real and the guard fires.
   - G: swap to `v.array(templateBucketItemValidator)`. `tsc` clean.
   - Test: any `saveWorkflowTemplate` / `runFromTemplate` test passes. If none exists, add a focused vitest that seeds a template via `convexTest.run` and asserts the returned validator's `bucketItems[0]` does NOT carry `citedByCount` (it never did at the wire level either; the prior validator was a lie about the wire shape).

## Files touched

- `convex/extraction/validators.ts:280-535` — add `templateBucketItemValidator`, six field-objects, lift `extractionRunDiffChangeValidator`, six `_check_` guards, rewrite six row validators as `v.object({_id, _creationTime, ...xFields})`.
- `convex/schema.ts:731-1011` — six schema swaps. Indexes preserved verbatim.

## Migration stance

Five pure refactors (commits 1–5) + one drift correction (commit 6).

- **Commits 1–5**: no row-shape change. No dev DB action. Convex push must show `✔ Convex functions ready!`.
- **Commit 6**: validator narrows by three fields (`citedByCount`, `venueName`, `workType`) on `workflowTemplate.bucketItems`. The schema never persisted those fields anyway, so no existing row carries them — the narrowing is a no-op at the row level. The wire shape becomes correct: prior, callers were told the field could exist; now the type matches reality.

If any code reads `template.bucketItems[i].citedByCount` and depends on the field being present, it will now be a TypeScript error at the call site. Fix the call site — the field was never there at runtime.

## Test plan

- `npx tsc --noEmit` clean after each of six commits.
- `npx vitest run convex/extraction convex/chat/sourceReadModel` green after each commit. (sourceReadModel is in chat/ but exercises `extractionJobSources` shape which interacts with bucket-item validators.)
- `npx vitest run` full suite green after the final commit.
- Manual drift test (R-step) performed once per commit and reverted before each green commit.

## Deployability gate

After EACH of the six commits:

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
- No `✖ Error`. No `Schema validator complaint`.
- After commit 6 specifically: confirm in the convex dashboard's Data view that no existing `extractionWorkflowTemplates` row has a populated `citedByCount` on any bucket item (it should be a no-op narrowing). If one exists, the audit was wrong — STOP and write a NN-BLOCKER.md.

## Acceptance criteria

- Six new field-objects exported from `convex/extraction/validators.ts`: `extractionPaperErrorFields`, `extractionEvidenceUnitFields`, `extractionSavedViewFields`, `extractionReportSnapshotFields`, `extractionRunDiffFields`, `workflowTemplateFields`.
- `templateBucketItemValidator` exported. `bucketItemInputValidator` unchanged (still the wider input validator).
- `extractionRunDiffChangeValidator` exported as a top-level reusable.
- Six `_check_xValidator: AssertExactDoc<...> = true;` guards present.
- Six schema swaps in `convex/schema.ts`.
- `npx tsc --noEmit` clean.
- pm2 deployability gate green after each commit.
- All existing extraction/chat/billing tests green.
- Demonstrated (and reverted) drift on the workflowTemplate `bucketItems` shape during commit 6 R-step.

## Known pitfalls

- **`paginatedPaperWithResultsValidator`** (validators.ts:448) already spreads `...extractionPaperValidator.fields`. After plan 04, that spread is equivalent to `...extractionPaperFields` and the line keeps working. Do not "fix" it during plan 05 — plan 04 owns that surface.
- **`workflowTemplateValidator` consumers**: any code that destructured `template.bucketItems[i].venueName` will now fail TS. The fix is to drop the read — the field was always `undefined` at runtime. Do NOT add the field back to the validator "for compatibility"; that re-introduces the drift.
- **`extractionRunDiffChangeValidator`** is a new top-level export. If a future plan wants to reuse `previousAnswer`/`nextAnswer` shape for an alerts feed, it now has a single anchor. Do not duplicate it inline elsewhere.
- **Schema imports growing**: after plans 03/04/05, `convex/schema.ts` imports from `./extraction/validators` the following: `errorCodeValidator`, `searchFiltersValidator`, `structuredErrorValidator`, `extractionJobFields`, `extractionPaperFields`, `extractionQuestionFields`, `extractionResultFields`, `extractionPaperErrorFields`, `extractionEvidenceUnitFields`, `extractionSavedViewFields`, `extractionReportSnapshotFields`, `extractionRunDiffFields`, `workflowTemplateFields`, `templateBucketItemValidator`. Group them in one import block at the top of `schema.ts` to keep the file readable.
- **`v.any()` on `extractionPaperErrors.context`**: declared `v.optional(v.any())` in both validator and schema. `Infer<v.any()>` is `any`, which is bidirectionally assignable to/from `Doc<>.context`. `AssertExactDoc` passes. Do not panic and try to narrow it — the field genuinely carries unstructured taxonomy context and 4 KB-capped at the classifier.
- **`extractionRunDiffs.changes[]` inline answer shape**: after commit 5, the schema-side `previousAnswer`/`nextAnswer` shape changes from raw `v.optional(v.union(v.string(), v.boolean(), v.number(), v.array(v.string()), v.null()))` to `v.optional(answerValidator)`. The Convex push validates that runtime rows match the new shape — they will, because `answerValidator` is the same set of literals. If push complains, the prior validator was different from what was assumed.
