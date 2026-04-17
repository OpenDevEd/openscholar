# P2 — Refactor, DRY, Modernize

**Intended reader:** an autonomous coding agent picking this up cold. Assumes **P0 and P1 are complete and merged**. P2 is structural cleanup — splitting god files, deleting dead code, consolidating duplication, tightening the public API, and adopting modern Convex patterns. Nothing here is a behavior change; every test that passed before must still pass after.

---

## 1. Mission

`convex/extraction/` is 32 files and ~9,600 lines, but 5,100 of those lines sit in three god files (`mutations.ts` 2288, `queries.ts` 1659, `workpoolActions.ts` 1191). Six near-identical test fixture files duplicate each other. Seven debug files overlap. `index.ts` exposes internal workflow contracts to the public API. Pure helpers sit trapped behind `"use node"` directives where they don't belong. The OCC-prone counter should be a `@convex-dev/aggregate`.

Split, deduplicate, delete, and modernize. Goal: same behavior, half the surface area, cleaner boundaries.

---

## 2. Hard rules (from `CLAUDE.md`)

Same as P0/P1. Especially relevant here:

1. **DRY.** The architecture audit already maps every duplication — consolidate per the map, don't redesign it.
2. **No legacy.** Delete old files in the same commit as the replacement; no parallel `.old` shims.
3. **No dead code.** Every commit should shrink the codebase, not grow it.
4. **Best practices.** Use `internalQuery`/`internalMutation` for everything not literally on the client path; `Id<"table">` not `string`; add `returns:` validators to internal functions; remove `"use node"` where nothing needs Node.
5. **Behavior preservation.** P2 must not change observable behavior. If a test fails after a refactor, the refactor is wrong.

---

## 3. Required reading

1. **Consolidated report** — `.agents/audit/00-CONSOLIDATED.md` (§P2)
2. **Architecture report** — the master plan: `.agents/audit/05-architecture.md`. Contains exact function→file line maps.
3. **Convex best-practices report** — `.agents/audit/04-convex-best-practices.md`
4. **Barrel file** — `convex/extraction/index.ts`
5. **Sibling modules for pattern reference** — `convex/library/`, `convex/screening/`, `convex/wallet/` (these are sanely sized; mirror their file-split conventions)
6. **Convex guidelines** — `convex/_generated/ai/guidelines.md`

---

## 4. Task list

Tasks are ordered. Each is its own commit. Several are mechanical file moves — do them with care and run `npx convex typecheck` after every single one.

---

### Task 1: Delete confirmed dead code

**Why:** Zero-caller code. Dead weight.

**Delete these files:**

- `convex/extraction/guard.ts` — 4 lines, comment-only stub pointing to `convex/featureFlags/guard.ts`.
- `convex/extraction/test_helpers.ts` — unreferenced anywhere except `_generated/api.d.ts`.
- `convex/extraction/testWorkflow.ts` — `testSimpleWorkflow` not wired to any runner.
- `convex/extraction/debug_papers.ts` — strict subset of `debug_errors.ts`.

**Delete these exports (the function but not the file):**

- `convex/extraction/chunking.ts` — remove `extractAndChunkPdf`, `formatChunkWithMetadata`, `prepareChunksForRag` (no callers). Keep `extractTextByPages`, `chunkPagesWithMetadata`.
- `convex/extraction/prompts.ts:118` — `detectQuestionType` (no callers).
- `convex/extraction/queries.ts:1648` — `getCurrentUserInternal` (should already be gone from P0 Task 7 — verify).
- `convex/extraction/mutations.ts` — `handlePaperFetchComplete`, `getUserIdFromJob` (bug audit flags these as dead).
- Pick one of `convex/extraction/queries.ts:1422` or `convex/debug.ts:5` `debugRecentPapers` and delete the other.

**Delete legacy schema fallback:**

- `convex/extraction/workflow.ts:65-69` — the `job.searchFilters ? [{ historyId: job.sourceHistoryId || "history", searchFilters: ... }] : []` fallback. After P1 Task 4, `sourceHistoryEntries` is the only source-of-truth.
- `convex/schema.ts` — if `sourceHistoryId`, `sourceZoteroCollection`, `searchFilters` fields still exist on `extractionJobs`, delete them now. (Should already be gone from P1 Task 4.)

**Also update:**

- `tests/debug-internal.test.ts` — the `DEBUG_FILES` array lists 12 debug/test files. Update it to match reality after deletions.
- `convex/extraction/index.ts` — remove any re-exports of deleted items.

**Acceptance:**

- [ ] Each listed file no longer exists OR each listed export is gone from its file.
- [ ] `npx convex typecheck` clean.
- [ ] `npm test` green.
- [ ] `grep -rn "extractAndChunkPdf\|detectQuestionType\|getCurrentUserInternal\|handlePaperFetchComplete\|getUserIdFromJob\|testSimpleWorkflow" convex` returns zero hits.

---

### Task 2: Consolidate 6 test fixture files into one

**Why:** `testActions.ts`, `test_runner.ts`, `test_automation.ts`, `test_automation_internal.ts`, `create_test_job.ts`, `testWorkflow.ts` all build the same "job + questions + sources" fixture. Six copies of the same pattern.

**Target structure:**

```
convex/extraction/tests/
├── fixtures.ts   # createTestJob({ questions, source, pdfOnly })
│                 # getTestJobStatus(jobId)
│                 # getTestJobResults(jobId)
└── runners.ts    # runPdfTestNow (the one "use node" action)
```

**Files to merge/delete:**

- `convex/extraction/testActions.ts` → fold into `tests/fixtures.ts`
- `convex/extraction/test_runner.ts` → fold into `tests/fixtures.ts`
- `convex/extraction/test_automation.ts` → fold into `tests/runners.ts`
- `convex/extraction/test_automation_internal.ts` → fold into `tests/fixtures.ts`
- `convex/extraction/create_test_job.ts` → fold into `tests/fixtures.ts`

**Each consolidated function:**

- Keeps the env-gate from P1 Task 8 (`assertNonProd()`).
- Takes explicit parameters instead of being one-shot variants.

**Acceptance:**

- [ ] 6 files collapsed to 2.
- [ ] `convex/extraction/index.ts` imports from the new paths (or stops exporting them entirely).
- [ ] `grep -rn "createTestJob\|createTestJobForFix\|runPdfTestNow\|testSimpleWorkflow\|createAndRunTestJob" convex` shows all callers use the consolidated exports.
- [ ] Typecheck + tests pass.

---

### Task 3: DRY — consolidate cross-file duplications

Per architecture audit §2. Each sub-item is small; batch into one commit only if each still compiles independently.

#### 3a. `GENERIC_ARRAY_TERMS` triplicated

- `lib/extraction/insights.ts` — canonical.
- `convex/extraction/workpoolActions.ts:117` (`ARRAY_GENERIC_TERMS`) — delete local copy, import canonical.
- `convex/extraction/debug_job_citations.ts:11` — delete local copy (and `normalizeArrayEntity` / `isGenericArrayEntity` duplicates), import canonical.

#### 3b. 8-step cascade delete helper

- `convex/extraction/mutations.ts:1058-1201` — 8 near-identical iterate-index → collect → delete-by-id blocks with batch size 100.
- Extract `batchDeleteByIndex(ctx, table, indexName, fieldName, value)` in `lib/convex-helpers/cascade.ts`.
- `deleteExtractionInternal` becomes ~10 lines of orchestration.

#### 3c. Ownership helpers unified

- `convex/extraction/mutations.ts:37` `assertJobOwnership` + `queries.ts` `resolveOwnedJob` / `resolveOwnedPaper` — move all three to `lib/auth.ts` (or `convex/lib/auth.ts`; follow project convention). One export each.

#### 3d. 3× onComplete handlers with identical switch

- `convex/extraction/mutations.ts:1853, 1951, 2031` — `handleDownloadAndIndexComplete`, `handleExtractionComplete`, `handlePaperFetchComplete` (note: the third is dead per Task 1).
- Extract `handleWorkpoolResult({ onSuccess, onFailed, onCanceled })` in `lib/convex-helpers/workpool.ts`.
- Each handler becomes 3 arrow fns passed to the helper.

#### 3e. `finalizeJob` vs `finalizeJobIfDone` merged

- Should already be merged from P1 Task 1. Verify. If both still exist, merge to a single `maybeFinalizeJob` with a private `computeJobTermination` helper.

#### 3f. `sourceType` validator

- `v.union(v.literal("history"), v.literal("zotero"), v.literal("manual"))` inlined ~5 times.
- Export `sourceTypeValidator` from `convex/extraction/validators.ts`.
- Replace inline uses.

#### 3g. Inline workflow-template validator

- `queries.ts:1315` (`getWorkflowTemplates`) — import from `validators.ts` instead of inlining.

**Acceptance:**

- [ ] `grep -n "GENERIC_ARRAY_TERMS" convex/extraction` returns zero hits (only in `lib/extraction/insights.ts`).
- [ ] `grep -c "^async function.*deleteBy\|^const.*deleteByIndex" convex/extraction/mutations.ts` shows significant reduction.
- [ ] `grep -c "v.literal(\"history\")" convex/extraction/**/*.ts` returns at most 1 (the validator export site).
- [ ] Typecheck + tests pass.

---

### Task 4: Split `mutations.ts` (2288 lines → 9 files)

**Why:** Architecture audit §1a provides the exact function → file map. Target directory:

```
convex/extraction/mutations/
├── jobs.ts
├── papers.ts
├── results.ts
├── templates.ts
├── savedViews.ts
├── reports.ts
├── evidence.ts
└── internal/
    ├── lifecycle.ts
    ├── onComplete.ts
    └── admin.ts
```

**Function-to-file map:** see `.agents/audit/05-architecture.md` §1a for the complete list with current line numbers.

**Helpers at file top** (`assertJobOwnership`, `loadJobDataForReporting`, `toInsightEntry`):

- `assertJobOwnership` → already moved to `lib/auth.ts` (Task 3c).
- `loadJobDataForReporting` + `toInsightEntry` → `lib/extraction/report-builder.ts` (these are pure data-shaping, not Convex-specific).
- The `createExtractionReportSnapshot` body is 204 lines of pure shaping followed by one DB write — move the shaping to `lib/extraction/report-builder.ts` too. Leave only the DB write in the mutation.

**Execution procedure:**

1. Create `convex/extraction/mutations/` folder. Empty initially.
2. Create one destination file at a time. Move functions per the map. Update imports. Run `npx convex typecheck` after every file.
3. Keep the old `mutations.ts` present until every function is moved.
4. Once empty, delete `mutations.ts` (but update `index.ts` barrel first).
5. `index.ts` now re-exports from `mutations/jobs`, `mutations/papers`, etc. — only public mutations.

**Acceptance:**

- [ ] `mutations.ts` no longer exists.
- [ ] New directory has the files listed above.
- [ ] `index.ts` exports public mutations; does NOT export `createJobDirect`, `createQuestionDirect`, `setJobWorkflowId`, `enqueuePaperProcessing`, `handle*Complete`, `updatePaperStatus`, `setPaperStorage` — those are `internalMutation` only, consumed by workflow/workpool via `internal.extraction.mutations.internal.*`.
- [ ] `npx convex typecheck` clean.
- [ ] `npm test` green. No test regressions.
- [ ] `wc -l convex/extraction/mutations/*.ts` — each file ≤ 500 lines.

---

### Task 5: Split `queries.ts` (1659 lines → 9 files)

**Structure:**

```
convex/extraction/queries/
├── jobs.ts
├── papers.ts
├── results.ts
├── insights.ts
├── reviews.ts
├── views.ts
├── templates.ts
├── reports.ts
└── internal.ts
```

**Function-to-file map:** `.agents/audit/05-architecture.md` §1b.

**Key moves:**

- All `*Internal` queries (lines 424, 435, 1415, 1442, 1454, 1470, 1477, 1487, 1648 per audit) → `queries/internal.ts`. Makes internal vs public visible at a glance.
- Shared helpers (`loadJobPapersAndResults`, `attachReviewMetadata`, `buildQuestionInfoByKey`) → `lib/extraction/query-helpers.ts` (pure) or `convex/extraction/queries/_shared.ts` (if Convex-specific).

**Acceptance:**

- [ ] `queries.ts` no longer exists.
- [ ] `wc -l convex/extraction/queries/*.ts` — each ≤ 400 lines.
- [ ] `index.ts` exports only the public queries listed in the current `index.ts` (minus `getCurrentUserInternal` already gone).
- [ ] Typecheck + tests pass.

---

### Task 6: Split `workpoolActions.ts` (1191 → 2 thin actions + pure helpers)

**Structure:**

```
convex/extraction/actions/
├── downloadAndIndex.ts     # action only
└── waitAndExtract.ts       # action only

lib/extraction/
├── evidence-policy.ts      # pure: normalizeExtractionOutputForQuestion, validateSupportEvidenceIds,
│                           #       applyEvidencePolicy, isUsableAbstract, applyAbstractOnlyPolicy
└── retrieval.ts            # pure: parseDenseScores, runDenseSearch, buildCitations,
                            #       toEvidenceContext, resolvePdfBlob, buildEvidenceUnitsFromPdf
```

**Why `lib/`?** The pure helpers at `workpoolActions.ts:267-387` have no Convex dependencies. They're trapped behind `"use node"` today, blocking reuse from the V8 runtime. Move them to `lib/extraction/`, no directive needed.

**After the move:**

- `actions/downloadAndIndex.ts` — thin wrapper, imports from `lib/extraction/retrieval.ts` and mutations.
- `actions/waitAndExtract.ts` — thin wrapper, imports from `lib/extraction/evidence-policy.ts`, calls LLM, delegates billing to `saveExtractionResultsAndComplete` (from P0 Task 6).
- `workpoolActions.ts` — deleted.
- `actions.ts` (OpenAlex fetch) — rename to `actions/openAlexFetch.ts` or move OpenAlex-specific logic to `lib/openalex/` and keep only the thin action wrapper.
- `testActions.ts` — already consolidated in Task 2.

**Acceptance:**

- [ ] `workpoolActions.ts` no longer exists.
- [ ] `"use node"` appears only on files that actually use Node built-ins (check: `grep -rn "from \"node:" convex/extraction`).
- [ ] `wc -l convex/extraction/actions/*.ts` — each ≤ 500 lines.
- [ ] Pure helpers in `lib/extraction/` are covered by unit tests independent of Convex.
- [ ] Typecheck + tests pass.

---

### Task 7: Tighten public API surface (`convex/extraction/index.ts`)

**Why:** Today `index.ts` re-exports workflow-internal contracts (`createJobDirect`, `createQuestionDirect`, `setJobWorkflowId`, `enqueuePaperProcessing`, `handle*Complete`, `updatePaperStatus`, `setPaperStorage`, `setJobWorkflowId`, `markPaperIndexed`, `replacePaperEvidenceUnits`) as if they were part of the public API. They are not. Clients should not touch them.

**Target:**

1. Split `convex/extraction/index.ts` into two barrels:
   - `index.ts` — public only: functions explicitly called from UI code or public HTTP endpoints.
   - `internal.ts` — internal re-exports consumed via `internal.extraction.*` by workflow/workpool.
2. Any function that is only reached via `internal.extraction.mutations.*` should NOT be re-exported from `index.ts`.
3. Verify every re-export is still reachable by its call sites.

**Acceptance:**

- [ ] Audit `convex/extraction/index.ts` against the UI code (`grep -rn "api.extraction\." app/ components/ hooks/ lib/ --include="*.ts" --include="*.tsx"`). Every function in `index.ts` must have at least one UI caller.
- [ ] `grep -rn "api.extraction.createJobDirect\|api.extraction.handleExtractionComplete\|api.extraction.enqueuePaperProcessing" app/ components/` returns zero — clients don't call these.
- [ ] Typecheck + tests pass.

---

### Task 8: Remove unjustified `"use node"` directives

**Why:** Per convex-best-practices audit, 4 files carry `"use node"` without needing any Node built-in. This forces them into the Node runtime unnecessarily and prevents imports from V8 contexts.

**Files to check and strip:**

- `convex/extraction/actions.ts` (OpenAlex fetch — uses `fetch`, not Node builtins; `fetch` is available in the default runtime)
- `convex/extraction/prompts.ts`
- `convex/extraction/test_helpers.ts` — already deleted in Task 1
- `convex/extraction/chunking.ts`

**Procedure:** For each file:

1. `grep "from \"node:" <file>` — if zero hits, remove the directive.
2. Run typecheck — if it fails, one of the transitive imports needs Node. Put the directive back and note why.

**Acceptance:**

- [ ] `grep -l "\"use node\"" convex/extraction/*.ts convex/extraction/**/*.ts` — only files that truly need it.
- [ ] Typecheck + tests pass.

---

### Task 9: Add missing `returns:` validators on internal functions

**Why:** Convex best-practices audit flags ~20 internal queries/mutations without `returns:`. Adds narrow types for callers and guards against shape drift.

**Procedure:**

1. `grep -rn "internalQuery\s*({" convex/extraction` and `grep -rn "internalMutation\s*({" convex/extraction`.
2. For each function lacking `returns:`, infer the actual return type from the handler and add a `v.*` validator.
3. Prefer `v.object({...})` over `v.any()`. If the return is polymorphic, use `v.union(...)`. If it's `null`, use `v.null()`.

**Acceptance:**

- [ ] `grep -A 3 "internalQuery\|internalMutation" convex/extraction/**/*.ts | grep -c "returns:"` ≈ number of internal functions.
- [ ] No new `v.any()` introductions (except where genuinely unavoidable, with a comment explaining why).
- [ ] Typecheck + tests pass.

---

### Task 10: Add `assertValidJobTransition` guard

**Why:** Bug audit flagged illegal state transitions possible (`cancelled → running`, `completed → failed`). Some patches land on `extractionJobs.status` without any check. After P0 Task 1, terminal states are sticky, but defensive central validation catches future regressions.

**New file:** `convex/extraction/lib/stateMachine.ts` (or `convex/extraction/internal/stateMachine.ts`):

```ts
export const JOB_STATUSES = [
  "pending", "fetching_papers", "downloading_pdfs",
  "indexing", "extracting",
  "completed", "failed", "cancelled",
] as const;
export type JobStatus = typeof JOB_STATUSES[number];

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ["fetching_papers", "cancelled", "failed"],
  fetching_papers: ["downloading_pdfs", "indexing", "cancelled", "failed"],
  // … enumerate the real state machine based on what workflow.ts does
  completed: [],       // terminal
  failed: [],          // terminal
  cancelled: [],       // terminal
};

export function assertValidJobTransition(from: JobStatus, to: JobStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`invalid job transition: ${from} → ${to}`);
  }
}
```

Call from every `ctx.db.patch(jobId, { status })` site. There are ~10; grep them.

Also mirror for `extractionPapers.status`.

**Acceptance:**

- [ ] Every `db.patch(*, { status })` on extraction tables is preceded by `assertValidJobTransition` (or the paper equivalent).
- [ ] Test: attempt `cancelled → running` transition — throws. Attempt `running → completed` — succeeds.
- [ ] Typecheck + tests pass.

---

### Task 11: Adopt `@convex-dev/aggregate` for counters

**Why:** `extractionJobStats` has many writers (every paper completion) fighting for the same doc. OCC retries at high fan-in cost latency and throughput. `@convex-dev/aggregate` is Convex's purpose-built component for this.

**Reference:** https://www.npmjs.com/package/@convex-dev/aggregate (use WebFetch or Context7 to read the current docs before writing any code — training-data APIs are stale).

**Files:**

- `convex/convex.config.ts` — register the component.
- `convex/extraction/` — replace `extractionJobStats` counters with the aggregate component.
- `finalizeJobIfDone` (now `maybeFinalizeJob`), `subscribeToJobProgress`, `backfillJobStats` — read from the component.

**Migration strategy (pre-release project, no prod data):**

1. Install `@convex-dev/aggregate` (check package.json — may already be there).
2. Use it for new writes. Drop `extractionJobStats` table if it's the only user.
3. Alternative: keep `extractionJobStats` as a read-model, maintain both until convinced, then drop. Per CLAUDE.md no-legacy rule — prefer one-shot replacement.

**Acceptance:**

- [ ] `@convex-dev/aggregate` registered.
- [ ] Counter writes go through the component.
- [ ] Load test from P1 Definition of done still passes.
- [ ] Typecheck + tests pass.

---

### Task 12: Rename for clarity

**Why:** Architecture audit §6.

**Renames:**

- `actions.ts` → `actions/openAlexFetch.ts` (or whatever survives the Task 6 split).
- `finalizeJob` / `finalizeJobIfDone` → single `maybeFinalizeJob` (done in Task 3e, verify).
- `getPapersByOpenAlexIds` → `byOpenAlexIds` inside `queries/papers.ts`.
- `getPaperInternal` → `byId` inside `queries/papers.ts`.
- Shorten other over-qualified names inside their new sub-module (`getJob*` → `*` when within `queries/jobs.ts`).

**Acceptance:**

- [ ] Callers updated (grep for old names).
- [ ] Typecheck + tests pass.

---

## 5. Definition of done (whole plan)

- [ ] Every P2 task merged as an atomic commit.
- [ ] `convex/extraction/` file count reduced from 32 to roughly 20-25 (debug + test consolidation). Still logical and discoverable.
- [ ] No file in `convex/extraction/` exceeds 500 lines.
- [ ] `index.ts` lists only public-API functions. Internal contracts moved to `internal.ts` or consumed directly via `internal.extraction.*`.
- [ ] `grep -rn "api.extraction" app/ components/` and `grep -rn "internal.extraction" convex/` show clean separation.
- [ ] `npx convex typecheck` clean.
- [ ] `npm test` green. Same tests that passed at the start of P2 still pass.
- [ ] `npm run lint` clean.
- [ ] `grep -l "\"use node\"" convex/extraction` shows only files that truly need Node builtins.
- [ ] `@convex-dev/aggregate` powers the counter.
- [ ] Manual smoke test: every user workflow (start job, cancel, view results, export report, save template, review) still works.

---

## 6. Agent operating notes

- **P0 and P1 must be green first.** Run `npm test` before starting.
- **P2 is mechanical.** Resist the urge to "fix one more thing" mid-refactor. If you see a new bug, note it in `.agents/audit/plans/P3-followups.md` and keep moving.
- **One file at a time.** For Tasks 4/5/6, move ONE function/helper, run typecheck, commit. 20 small commits beats 1 big one with a broken mid-state.
- **Behavior preservation.** Every refactor task must have green tests before and after. If a test fails, you broke something.
- **Cross-reference architecture audit** — `05-architecture.md` §1a, §1b, §1c give the line-level function maps. Use them verbatim.
- **Sibling modules as templates** — `convex/library/`, `convex/screening/`, `convex/wallet/` are sanely organized. Mirror their shape.

---

## 7. Related reports (full context)

- `.agents/audit/00-CONSOLIDATED.md` — overview
- `.agents/audit/05-architecture.md` — **the master plan for P2** — function→file maps, duplication list, dead code list, rename list
- `.agents/audit/04-convex-best-practices.md` — returns validators, use-node abuse, modernization recommendations
- `.agents/audit/02-bugs.md` — state-machine illegal transitions
- `convex/_generated/ai/guidelines.md` — binding rules
