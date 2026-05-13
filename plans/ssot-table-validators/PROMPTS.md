# PROMPTS — SSOT table-validator rollout

Per-plan execution prompts for `plans/ssot-table-validators/`. Copy a fenced block into a fresh `/clear`'d session.

Standing rules apply to every prompt — they are repeated inside each prompt's `STANDING RULES` block so a `/clear`'d session can boot from the prompt alone.

The rollout order is:
- Plan 01 ships an immediate one-line hotfix (independent of everything else).
- Plan 02 lands the pattern on `users` as the exemplar.
- Plans 03–06 propagate the pattern table by table.
- Plan 07 adds the runtime parity test as a backstop.

Plans 03–06 each depend on plan 02 (the `AssertExactDoc<>` helper must exist before any per-table migration can land). Plan 03 also folds plan 01 if 01 has not yet shipped. Plan 07 depends on plans 02–06 because the parity table iterates the field-objects those plans introduce.

---

## Plan 01

```md
You are executing `plans/ssot-table-validators/01-fix-credit-transaction-validator-drift.md`. Read the README at `plans/ssot-table-validators/00-README.md` first.

Tactical one-line hotfix. Independent of plans 02–07. Ships before the structural refactor so the wire shape is correct immediately.

Short autonomous task. Expect 20–40 minutes. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: do not duplicate any union. `creditTransactionTypeValidator` already exists at `convex/lib/validators.ts:37`. The new field is one optional string.
2. No legacy: do not leave the field undocumented. Mirror the schema-side comment at `convex/schema.ts:170` next to the new line.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens in `convex/` files.
5. Deployability gate after the commit: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. No `✖ Error`. No `Schema validator complaint`.
6. Research before guessing: read `convex/credits/queries.ts:73` to confirm `getTransactions` uses `creditTransactionValidator` in its `returns:`.
7. Delegate to subagents only if scope creeps beyond this plan; the change is two file edits.

EXECUTION RHYTHM
Phase A (TDD, pure logic): write the new test FIRST in `convex/credits/queries.test.ts` (create the file if missing, following `convex/credits/aggregates.test.ts` as a pattern). The test seeds a `credits` row, then a `creditTransactions` row with `searchableText: "manual extraction job · openrouter/anthropic"`, calls `getTransactions`, and asserts `result[0].searchableText` is preserved. Vitest fails red — validator strips the field.
Phase B (test-after): add `searchableText: v.optional(v.string())` to `creditTransactionValidator` at `convex/lib/validators.ts:105`. Re-run vitest — green. Commit.

COMMIT DISCIPLINE
- Two atomic commits:
  - `test(credits): [plan-01] add regression test for searchableText preservation in getTransactions` (the red test).
  - `fix(credits): [plan-01] add searchableText to creditTransactionValidator to stop wire-shape strip` (the one-line widening).
- Conventional prefixes. Do NOT use `--no-verify`. Do NOT use `git add -A` / `git add .`.

WHEN TO STOP
Stop when: the new test passes, `npx tsc --noEmit` is clean, deployability gate is green.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If the test setup is non-trivially different from `aggregates.test.ts` (e.g. requires `withIdentity`), commit in-progress work, edit this plan with the correction, commit the plan edit as `docs: [plan-01] revise TDD sequence — <reason>`, then proceed.

START NOW
1. Read `plans/ssot-table-validators/01-fix-credit-transaction-validator-drift.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status` — confirm clean working tree.
5. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy at boot.
6. Begin the red test in `convex/credits/queries.test.ts`.

Go.
```

---

## Plan 02

```md
You are executing `plans/ssot-table-validators/02-introduce-ssot-pattern-on-users-exemplar.md`. Read the README at `plans/ssot-table-validators/00-README.md` first.

Foundation plan. Plans 03, 04, 05, 06 depend on this. Establishes the `AssertExactDoc<>` helper and the `xFields` field-object convention on `users` as the exemplar.

Short autonomous task. Expect 1–2 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: the existing `userValidator` already declares the columns — the migration is a structural lift, not a re-declaration. Reuse every Convex import and every existing scalar validator (`userStateValidator`).
2. No legacy: do not keep the old inline `users: defineTable({...})` body. The schema becomes `defineTable(userFields)`.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens.
5. Deployability gate after the commit: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. No `✖ Error`. No `Schema validator complaint`.
6. Research first: read `convex/_generated/dataModel.d.ts` to confirm `Doc<TableName>` and `TableNames` exports exist as expected.
7. The `AssertExactDoc<>` helper is the test — the TS guard IS the test. There is no separate vitest assertion for `users`.
8. Delegate to subagents only for the existence-check sweep (any subscriber that destructures `userValidator.fields` — likely none, but worth a 1-shot Explore agent if uncertain).

EXECUTION RHYTHM
Phase A (TDD, pure logic):
  1. Add `AssertExactDoc<T, V>` to `convex/lib/validators.ts` (full helper per plan, with `[Doc<T>] extends [Infer<V>]` bidirectional check).
  2. Add `userFields` constant and rewrite `userValidator` to spread it.
  3. Add `const _check_userValidator: AssertExactDoc<"users", typeof userValidator> = true;` directly under the validator.
  4. R-step: temporarily omit `state` from `userFields`. `npx tsc --noEmit` errors with the `"table has fields the validator does not (validator is narrower)"` literal on the `_check_userValidator` line. Restore `state`.
  5. G-step: `tsc` clean. The TS guard proves the pattern works.

Phase B (test-after, one logical unit):
  - Update `convex/schema.ts` to import `userFields` from `./lib/validators` and call `defineTable(userFields)`. Preserve every `.index(...)`. Run `tsc`, run the existing user tests, run the deployability gate.

COMMIT DISCIPLINE
- Two atomic commits:
  - `refactor(validators): [plan-02] introduce AssertExactDoc helper + userFields field-object` (validators.ts only).
  - `refactor(schema): [plan-02] migrate users table to defineTable(userFields)` (schema.ts only).
- Conventional prefixes. Atomic. Do NOT use `--no-verify`.

WHEN TO STOP
Stop when: `npx tsc --noEmit` clean, `npx vitest run convex/users` green, deployability gate green, R-step has been demonstrated and reverted.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If `AssertExactDoc<>` fails to compile because the `V extends { _type: object }` constraint is wrong, swap to `V extends Validator<any, any, any>` from `convex/values` and document the change in the commit body. If `_generated/dataModel.d.ts` is stale (`Doc<"users">` resolves to `unknown`), run `npx convex codegen` or `npx convex dev --once` before continuing.

START NOW
1. Read `plans/ssot-table-validators/02-introduce-ssot-pattern-on-users-exemplar.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status` — confirm clean working tree.
5. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
6. Begin Phase A in `convex/lib/validators.ts`.

Go.
```

---

## Plan 03

```md
You are executing `plans/ssot-table-validators/03-migrate-lib-validators.md`. Read the README at `plans/ssot-table-validators/00-README.md` first. Depends on plan 02 being merged.

Three commits, one per table: `credits`, `subscriptions`, `creditTransactions`. The third commit folds plan 01 if 01 has not yet shipped (add `searchableText` to the field-object as part of the structural migration).

Long-running autonomous task. Expect 2–3 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: reuse existing named scalar validators (`planValidator`, `subscriptionStatusValidator`, `creditTransactionTypeValidator`). Lift the inline `billingType` union into a new named export `billingTypeValidator` rather than duplicating it.
2. No legacy: the schema's inline `v.union(...)` for `plan`/`status` on `subscriptions` and `billingType` on `creditTransactions` collapses into the named export. Do not leave both forms.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens.
5. Deployability gate after EACH of the three commits: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. No `✖ Error`. No `Schema validator complaint`. If push is stuck on commit N, STOP — do not commit further validator changes on top of a stuck push.
6. The TS guard `AssertExactDoc<>` is the structural test for each table. Per-commit R-step proves the guard fires before the green migration lands.
7. Research first: re-read the audited fact in plan 03 § "Known pitfalls" about `pendingFromPlan` / `pendingToPlan` matching `planValidator` shape.
8. Delegate to subagents only for cross-file callers that destructure `subscriptionValidator.fields` or similar (likely none after plan 02 generalized the pattern; one Explore agent confirms).

EXECUTION RHYTHM
For each of three commits, run the same drift-attempt → revert → confirm cycle:
  R: in `convex/lib/validators.ts`, omit one field from the new `xFields`. `npx tsc --noEmit` errors with the validator-narrower message. Restore the field.
  G: clean.
  Then add the `_check_xValidator` guard, rewrite the row validator to spread the field-object, and update `convex/schema.ts` to `defineTable(xFields)`. One commit per table.

COMMIT DISCIPLINE
- Three atomic commits:
  - `refactor(validators): [plan-03] migrate credits to defineTable(creditsFields)`
  - `refactor(validators): [plan-03] migrate subscriptions to defineTable(subscriptionFields), dedupe plan/status unions`
  - `refactor(validators): [plan-03] migrate creditTransactions to defineTable(creditTransactionFields), fold searchableText` (if plan 01 has not shipped — say so in the commit body)
- Conventional prefixes. One commit per table. Do NOT use `--no-verify`.

WHEN TO STOP
Stop when: all three migrations done, `npx tsc --noEmit` clean, `npx vitest run convex/credits convex/subscriptions convex/lib` green, deployability gate green after each commit.
You may NOT stop for: ambiguity resolvable by re-reading the plan or `convex/schema.ts:114-200`, worry about token usage, impulse to check with the user.

DEVIATIONS
If the schema's inline `subscriptions.plan` union differs from `planValidator` by even one literal (it should not — audited 2026-05-13, but verify), commit in-progress work, edit this plan with the correction, commit the edit as `docs: [plan-03] revise subscriptions union — <reason>`, then proceed.

START NOW
1. Read `plans/ssot-table-validators/03-migrate-lib-validators.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git log --oneline -5` — confirm plan 02 is merged. If not, run plan 02 first.
5. `git status` — confirm clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
7. Begin commit 1 (credits) with the R-step.

Go.
```

---

## Plan 04

```md
You are executing `plans/ssot-table-validators/04-migrate-high-blast-extraction-validators.md`. Read the README at `plans/ssot-table-validators/00-README.md` first. Depends on plan 02 being merged.

Four commits, one per table: `extractionPapers`, `extractionJobs`, `extractionResults`, `extractionQuestions`. These are the highest-blast-radius extraction validators — many `returns:` and `paginatedPaperWithResultsValidator` consume them.

Long-running autonomous task. Expect 3–5 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: `paginatedPaperWithResultsValidator` at `convex/extraction/validators.ts:448` already spreads `...extractionPaperValidator.fields`. After this plan it spreads `...extractionPaperFields` directly — update that line in the same commit as `extractionPapers`.
2. No legacy: dedupe the inline `citation` and `retrievalDiagnostics` objects in the schema for `extractionResults` by importing `citationValidator` / `retrievalDiagnosticsValidator` from the validators file. Do not leave both forms.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens.
5. Deployability gate after EACH of the four commits: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. No `✖ Error`. STOP on a stuck push.
6. The TS guard `AssertExactDoc<>` is the structural test for each table. Per-commit R-step proves the guard fires.
7. Research first: read `convex/extraction/validators.ts:282-354` to internalize the `extractionPaperValidator` shape including `projectionQuestionStates`, `questionsBilled`, and the search-projection fields.
8. Delegate to subagents for cross-file consumer discovery: spawn one `Explore` agent with `medium` thoroughness asking "list every file in `convex/extraction/` and `convex/chat/` that imports `extractionPaperValidator`, `extractionJobValidator`, `extractionResultValidator`, or `extractionQuestionValidator`" before commit 1 so you have the consumer list cached.

EXECUTION RHYTHM
For each of four commits, run the drift-attempt → revert → confirm cycle:
  R: omit one field from the new `xFields`. `npx tsc --noEmit` errors. Restore.
  G: clean. Add the `_check_xValidator` guard, rewrite the row validator, update `convex/schema.ts` to `defineTable(xFields)`, dedupe any inline objects on the schema side, fix the `paginatedPaperWithResultsValidator` spread for the `extractionPapers` commit.
  Commit. Deployability gate. Next commit.

Recommended commit order (low → high churn):
  1. `extractionQuestions` (smallest)
  2. `extractionResults` (medium, dedupes citation/retrievalDiagnostics)
  3. `extractionJobs` (medium, uses jobStatusValidator etc)
  4. `extractionPapers` (largest, fixes paginatedPaperWithResultsValidator)

COMMIT DISCIPLINE
- Four atomic commits, conventional prefixes. Do NOT use `--no-verify`. Do NOT batch.

WHEN TO STOP
Stop when: all four migrations done, `npx tsc --noEmit` clean, `npx vitest run convex/extraction convex/chat` green, deployability gate green after each commit, `paginatedPaperWithResultsValidator` spread updated.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If schema-side inline `citation` shape on `extractionResults` differs from `citationValidator` (it should not — audited 2026-05-13, but verify), commit in-progress work, edit this plan with the correction, commit the edit as `docs: [plan-04] revise extractionResults citation — <reason>`, then proceed.

START NOW
1. Read `plans/ssot-table-validators/04-migrate-high-blast-extraction-validators.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git log --oneline -5` — confirm plan 02 is merged.
5. `git status` — confirm clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
7. Spawn the consumer-list Explore agent (see rule 8).
8. Begin commit 1 (extractionQuestions) with R-step.

Go.
```

---

## Plan 05

```md
You are executing `plans/ssot-table-validators/05-migrate-remaining-extraction-validators.md`. Read the README at `plans/ssot-table-validators/00-README.md` first. Depends on plan 02 being merged. Independent of plans 03/04 but conventionally runs after them.

Six commits, one per table: `extractionPaperErrors`, `extractionEvidenceUnits`, `extractionSavedViews`, `extractionReportSnapshots`, `extractionRunDiffs`, `extractionWorkflowTemplates`. The last commit closes a latent drift on `workflowTemplate.bucketItems` (validator wider than schema).

Long-running autonomous task. Expect 3–4 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: the `workflowTemplate` migration introduces a new narrower `templateBucketItemValidator` and keeps `bucketItemInputValidator` as the wider mutation-arg validator. Do not unify them — they intentionally serve different boundaries.
2. No legacy: do not preserve `citedByCount`, `venueName`, `workType` on `templateBucketItemValidator`. The schema never persisted them; consumers reading `template.bucketItems[i].venueName` are fixing a bug in their call site.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens.
5. Deployability gate after EACH of the six commits: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. STOP on a stuck push.
6. The TS guard `AssertExactDoc<>` is the structural test for each table. The commit-6 R-step is special: keep the wider `bucketItemInputValidator` and watch the guard collapse to the `"validator has fields the table does not (validator is wider)"` literal, proving the drift was real.
7. Research first: spot-check the convex dashboard's Data view for any existing `extractionWorkflowTemplates` row that has a populated `citedByCount` on `bucketItems[i]`. If one exists, the audit was wrong — STOP and write a `NN-BLOCKER.md`.
8. Delegate to subagents for the consumer-list sweep of `workflowTemplate` readers (any `template.bucketItems[].venueName` or `.citedByCount` access). One `Explore` agent, `medium` thoroughness.

EXECUTION RHYTHM
For each of six commits, same drift-attempt → revert → confirm cycle.

Recommended commit order (low → high churn):
  1. `extractionPaperErrors` (small, append-only history)
  2. `extractionEvidenceUnits`
  3. `extractionSavedViews`
  4. `extractionReportSnapshots`
  5. `extractionRunDiffs` (medium, lifts `extractionRunDiffChangeValidator` and dedupes answer shape on the schema side)
  6. `extractionWorkflowTemplates` (closes drift, introduces `templateBucketItemValidator`)

COMMIT DISCIPLINE
- Six atomic commits, conventional prefixes. Do NOT use `--no-verify`. Do NOT batch.
- Commit-6 message must call out the drift correction in its body: "Narrows `workflowTemplate.bucketItems` from `bucketItemInputValidator` (wider) to `templateBucketItemValidator` (table-exact). The three OpenAlex-derived fields were never persisted; consumers reading them were reading `undefined`."

WHEN TO STOP
Stop when: all six migrations done, `npx tsc --noEmit` clean, `npx vitest run convex/extraction convex/chat` green, deployability gate green after each commit, drift demonstrated and reverted on commit 6's R-step.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If a consumer-site read of `template.bucketItems[i].citedByCount` exists and looks like it *expects* a value (i.e. is not a `?? undefined` guard), STOP — this is a latent feature bug, not a drift. Commit in-progress work, write a follow-up plan note, and surface to the user.

START NOW
1. Read `plans/ssot-table-validators/05-migrate-remaining-extraction-validators.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git log --oneline -5` — confirm plan 02 is merged.
5. `git status` — confirm clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
7. Spawn the consumer-list Explore agent (rule 8).
8. Begin commit 1 (extractionPaperErrors) with R-step.

Go.
```

---

## Plan 06

```md
You are executing `plans/ssot-table-validators/06-backfill-missing-mirror-validators.md`. Read the README at `plans/ssot-table-validators/00-README.md` first. Depends on plan 02 being merged. Independent of plans 03/04/05.

Two commits: `chatPapers`, `chatGenerationUsages`. Both tables currently lack mirror validators; this plan backfills them under the SSOT pattern.

Short autonomous task. Expect 1–2 hours. Do not stop mid-plan to ask for confirmation.

STANDING RULES
1. DRY: do NOT mirror `chatSourcesSnapshotValidator` — that is a JOIN-result validator and lives at `convex/chat/sourceReadModel.ts:62`. The new `chatPaperValidator` is a raw row mirror. Both coexist; they are different shapes.
2. No legacy: do not pre-emptively wire `returns: chatPaperValidator` into any function. The validators are scaffolding for future consumers; wiring is a separate commit (and arguably a separate plan).
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens.
5. Deployability gate after EACH of the two commits: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. STOP on a stuck push.
6. The TS guard `AssertExactDoc<>` is the structural test.
7. Research first: confirm `chatGenerationUsages.attemptCount` is NOT optional in the schema (line ~517) — match it `v.number()` in the field-object.
8. Out-of-scope tables (orphans with no mirror and no consumer reading the raw row) stay orphaned. Do NOT add mirrors for `models`, `featureFlags`, `billingCustomers`, etc.

EXECUTION RHYTHM
For each of two commits, same drift-attempt → revert → confirm cycle:
  R: omit one field from the new `xFields`. `npx tsc --noEmit` errors. Restore.
  G: clean. Add the `_check_xValidator` guard, the row validator, update `convex/schema.ts` to `defineTable(xFields)`, lift the two literal unions to named exports for `chatGenerationUsages`. Commit. Deployability gate.

COMMIT DISCIPLINE
- Two atomic commits, conventional prefixes:
  - `refactor(validators): [plan-06] add chatPapers field-object mirror`
  - `refactor(validators): [plan-06] add chatGenerationUsages field-object mirror + lift source/status unions`
- Do NOT use `--no-verify`.

WHEN TO STOP
Stop when: both mirrors landed, `npx tsc --noEmit` clean, `npx vitest run convex/chat` green, deployability gate green after each commit.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If a chat-billing test fails because the field-object accidentally changed an optional/required flag, fix the flag immediately (the schema is the source of truth) and re-run. If the schema declares `attemptCount` as `v.number()` and your field-object accidentally has `v.optional(v.number())`, `AssertExactDoc<>` fires — fix and continue, no plan edit needed.

START NOW
1. Read `plans/ssot-table-validators/06-backfill-missing-mirror-validators.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git log --oneline -5` — confirm plan 02 is merged.
5. `git status` — confirm clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
7. Begin commit 1 (chatPapers) with R-step.

Go.
```

---

## Plan 07

```md
You are executing `plans/ssot-table-validators/07-schema-validator-parity-test.md`. Read the README at `plans/ssot-table-validators/00-README.md` first. Depends on plans 02, 03, 04, 05, 06 being merged — the parity table iterates the field-objects those plans introduce.

Short autonomous task. Expect 30–60 minutes. One commit.

STANDING RULES
1. DRY: the parity test imports every existing field-object — do not declare a parallel array of table names. The map IS the canonical source.
2. No legacy: the test does not recurse into nested object validators. That is a deliberate scope boundary documented in plan 07 § "Known pitfalls". Do not deepen it.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change (no convex source changes here, but if you need to inspect the schema export, the guidelines apply).
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens. Plan-07's filename is `convex/lib/validators.test.ts` (or `convex/lib/schemaParity.test.ts` if `validators.test.ts` already exists).
5. Deployability gate after the commit: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`. A test-only commit should not trigger a push; this check confirms a prior plan's push has not gone stale.
6. The TDD R-step is part of the deliverable: demonstrate drift detection twice (once for missing-key, once for kind-mismatch) and revert both.
7. Research first: read the Convex `Validator` runtime type if needed (`node_modules/convex/values.d.ts`). The test uses `.kind` and the `isOptional` flag — confirm these names match the installed version of Convex.
8. Delegate to subagents only if the cast surface area grows (the `schema.tables` type may be `any` and need a one-shot reflection investigation). One `Explore` quick lookup suffices.

EXECUTION RHYTHM
Phase A (TDD):
  1. Create `convex/lib/validators.test.ts` with the 16-table `ssotTables` map (or whatever count plans 02–06 have landed).
  2. Add the parity loop with `describe("schema/validator parity") { for (...) test(`${tableName}: ...`, ...) }`.
  3. Run `npx vitest run convex/lib/validators.test.ts` — should be green from the start because field-objects ARE the schema fields after plan 02.
  4. R1 (drift detection demo, do NOT commit): change one field's kind in a field-object (e.g. `userFields.email` → `v.number()`). Re-run vitest — the `users` test fails with a clear `string` vs `number` diff. Revert.
  5. R3 (drift detection demo, do NOT commit): drop a field from a field-object that the schema declares. Vitest fails with a missing-key diff. Revert.
  6. G: all 16 tests green.

Phase B: none.

COMMIT DISCIPLINE
- One atomic commit: `test(validators): [plan-07] add schema/validator field-set parity test as runtime backstop`.
- Body: cite that the test pairs every field-object introduced in plans 02–06 with its `schema.tables[<name>].validator.fields` and asserts key/kind equality.
- Do NOT use `--no-verify`.

WHEN TO STOP
Stop when: 16 parity tests pass, `npx tsc --noEmit` clean, both drift R-steps demonstrated and reverted, deployability gate green.
You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user.

DEVIATIONS
If `schema.tables` is exported with a tighter type than expected and the cast is unnecessary, drop it. If a Convex version difference means `.kind` is named differently (e.g. `.type`), update the helper and document in the commit body. If a future Convex release makes nested-object introspection ergonomic, that's a follow-up plan, not this one.

START NOW
1. Read `plans/ssot-table-validators/07-schema-validator-parity-test.md`.
2. Read `plans/ssot-table-validators/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git log --oneline -10` — confirm plans 02, 03, 04, 05, 06 are merged.
5. `git status` — confirm clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy.
7. Begin Phase A in `convex/lib/validators.test.ts`.

Go.
```
