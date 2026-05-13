# SSOT table-validator rollout — eliminate schema/validator drift

## Motivation — the bug this prevents

On 2026-05-13 a `ReturnsValidationError` blew up `extraction/queries:getJobDetails` because `convex/schema.ts:683` had `extractionPapers.questionsBilled: v.optional(v.boolean())` but the hand-rolled `extractionPaperValidator` at `convex/extraction/validators.ts:306` had not been kept in sync. A previous plan (`plan-04 per-paper billing`) added the field to the table but only to the table; the mirror validator was forgotten.

The fix landed in commit `8b42ef11` — one line. The root cause did not. Every table in this codebase carries two declarations of the same wire shape:

1. The runtime row shape, declared via `defineTable({...})` in `convex/schema.ts`.
2. The hand-rolled `v.object({_id, _creationTime, ...})` validator that paginated/list/by-id queries return.

They drift silently because there is no single source of truth. Adding a field requires touching both places, and the schema rejects an extra field at *write* time while the validator rejects an extra field at *read* time — so a schema-only addition stays green in tests that only insert rows, then explodes on a paginated read in production.

A full audit (3 parallel `Explore` agents on 2026-05-13) found:

- **2 active drifts today**:
  1. `extractionPaperValidator.questionsBilled` — fixed in `8b42ef11`.
  2. `creditTransactionValidator.searchableText` — `convex/schema.ts:170` defines `searchableText: v.optional(v.string())`, `convex/lib/validators.ts:105` does not. `convex/credits/queries.ts:73` returns `v.array(creditTransactionValidator)`, so every transaction with `searchableText` populated is silently stripped on the wire. Latent — does not throw, but corrupts the client view.
- **2 tables with NO mirror validator** despite having queries that return raw docs: `chatPapers`, `chatGenerationUsages`.
- **10 tables where the mirror is currently aligned** but is one forgotten field away from the same bug class: `users`, `credits`, `subscriptions`, `extractionJobs`, `extractionPapers` (now), `extractionQuestions`, `extractionResults`, `extractionEvidenceUnits`, `extractionPaperErrors`, `extractionSavedViews`, plus `extractionWorkflowTemplates` (input-shape composed of `bucketItemInputValidator` + `questionInputValidator`).

This plan removes the duplicate declaration. One field-object per table, spread into both `defineTable(...)` and the `v.object(...)` mirror, with a `tsc --noEmit`-enforced type invariant that proves they stay in lockstep.

## Locked design decisions (2026-05-13)

- **Single field-object module per validator file.** No new `fields.ts` files — co-locate each `xFields` constant directly above the corresponding `xValidator` in the existing `convex/lib/validators.ts` and `convex/extraction/validators.ts`. Adding a field becomes a one-spot edit in the same file.
- **Pattern B — validator owns the field-object, schema imports it.** `convex/schema.ts` already imports validators (e.g. `structuredErrorValidator`), so the dependency direction is established. Schema becomes thinner; validators become canonical.
- **Type invariant via `AssertExactDoc<T, V>`.** A shared helper in `convex/lib/validators.ts` produces a compile-time `true` / `"validator drift"` literal that surfaces drift in `tsc --noEmit`. Every migrated validator emits a one-line `const _check_x: AssertExactDoc<"x", typeof xValidator> = true;` directly under it. Drift breaks the type-check.
- **Plan 01 is a tactical hotfix.** Patch the `creditTransactionValidator.searchableText` drift directly (one line). Do NOT wait for the structural migration. The drift is latent today but corrupts every credit-transaction wire payload — fix it first, refactor it later.
- **No widen-then-narrow.** Every schema/validator pair migrates in a single commit. The new `xFields` constant is introduced, the table reads from it, the validator reads from it, the TS guard is added — all in one commit per table. No leaving the old hand-rolled shape "for compatibility".
- **`paginatedPaperWithResultsValidator` is the prior art** (`convex/extraction/validators.ts:449` already uses `...extractionPaperValidator.fields`). The new pattern uses `...xFields` instead of `...xValidator.fields` — slightly cleaner, single allocation, and the field-object can be spread into `defineTable(...)` directly (you cannot spread `xValidator.fields` into `defineTable(...)` because `defineTable` wants a `Record<string, GenericValidator>`, which is exactly what the field-object is).
- **Input-shape validators stay as-is.** `bucketItemInputValidator`, `questionInputValidator`, `screeningPaperInputValidator`, `screeningQuestionValidator`, `screeningScoringConfigValidator`, `chatSourceRowValidator`, etc. mirror *args*, not table rows. They are explicitly NOT migrated. The SSOT pattern is for `(defineTable, v.object({_id, _creationTime, ...}))` pairs only.
- **Tables with NO mirror validator AND no query returning their raw doc are NOT migrated.** Per the audit: `models`, `featureFlags`, `screeningJobs`, `screeningResults`, `libraryItems`, `collections`, `libraryItemCollections`, `walletKeys`, `apiKeys`, `userResourceLocks`, `billingCustomers`, `stripeEventLogs`, `auditLogs`, `walletAllowedOrigins`, `zoteroConnections`, `zoteroOAuthTokens` — these stay schema-only until something queries them with a typed return. Plan 06 migrates only the two tables that actually need mirrors today: `chatPapers`, `chatGenerationUsages`.
- **Plan 07 lands a parity test.** A vitest test in `convex/lib/validators.test.ts` enumerates every registered `(tableName, validator)` pair and proves the table's `defineTable` validator and the mirror validator produce the same `Infer<>` shape at runtime via JSON-schema export, catching the case where someone bypasses the field-object spread.

## Plan-file inventory

- `01-fix-credit-transaction-validator-drift.md` — tactical hotfix: add `searchableText: v.optional(v.string())` to `creditTransactionValidator`. One file, one line, one commit. Side-fix; everything else depends on this not regressing.
- `02-introduce-ssot-pattern-on-users-exemplar.md` — introduce `AssertExactDoc<TableName, ValidatorType>` helper and migrate `users` → `userFields` as the canonical exemplar. Subsequent plans copy the exact shape.
- `03-migrate-lib-validators.md` — migrate the remaining three `convex/lib/validators.ts` mirrors: `credits` (one commit), `subscriptions` (one commit), `creditTransactions` (one commit; folds plan 01's hotfix into the structural change so the `searchableText` field lives in the field-object).
- `04-migrate-high-blast-extraction-validators.md` — migrate `extractionPapers`, `extractionJobs`, `extractionResults`, `extractionQuestions`. These four are the highest-blast-radius mirrors (5+ consumer surfaces each per the audit). One commit per table.
- `05-migrate-remaining-extraction-validators.md` — migrate `extractionPaperErrors`, `extractionEvidenceUnits`, `extractionSavedViews`, `extractionJobSources`. One commit per table. (Note: `extractionWorkflowTemplates` is composed of input shapes; its `_id/_creationTime` wrapper is kept but the inner `bucketItems`/`questions` arrays continue to reference their input validators.)
- `06-backfill-missing-mirror-validators.md` — introduce `chatPaperFields` + `chatPaperValidator` and `chatGenerationUsageFields` + `chatGenerationUsageValidator` for the two tables that have queries returning their raw docs but no validator. Promote any query that returns these tables' rows from untyped/`v.any()` returns to the new validator.
- `07-schema-validator-parity-test.md` — a vitest test that calls `schema.tables[name].validator.json` and the mirror validator's `.json`, and asserts the two produce equal `Infer<>` shapes after stripping `_id`/`_creationTime`. Lands last so every migrated table is asserted in one sweep.

## Dependency graph

```
01 (creditTransaction hotfix — independent, ships first)
 │
 ├── 02 (users exemplar + AssertExactDoc helper)
 │    │
 │    ├── 03 (lib mirrors — depends on AssertExactDoc + folds 01's hotfix)
 │    │
 │    ├── 04 (high-blast extraction mirrors — depends on AssertExactDoc)
 │    │    │
 │    │    └── 05 (remaining extraction mirrors — depends on AssertExactDoc)
 │    │
 │    └── 06 (chat/screening backfill — depends on AssertExactDoc)
 │
 └── 07 (parity test — depends on every migrated table existing)
```

Plans 03, 04, 06 are independent of each other and can land in parallel after 02. Plan 05 is gated on 04 only because both edit `convex/extraction/validators.ts` and back-to-back PRs avoid merge friction.

## Reuse / DRY notes

- **`paginatedPaperWithResultsValidator`** (`convex/extraction/validators.ts:449`) already spreads `extractionPaperValidator.fields`. After plan 04 it spreads `...extractionPaperFields` directly — one fewer indirection.
- **`Infer<typeof xValidator>`** is `convex/values`. **`Doc<"tableName">`** is `convex/_generated/dataModel`. The TS guard uses both.
- **`as const`** is NOT needed on the field-object — `defineTable` and `v.object` both accept a `Record<string, GenericValidator>`, and the keys are not used as discriminated literals.
- **No new helper modules.** The `AssertExactDoc` type and a small `assertExactDoc<T>()` runtime no-op (purely for type assertion) live at the top of `convex/lib/validators.ts` next to the existing validators.
- **`extractionPaperValidator.fields` callers** (currently only `paginatedPaperWithResultsValidator`) are updated in plan 04's commit to use the new field-object name. Do NOT keep `.fields` as a fallback.

## Testing doctrine

- **Plan 01**: TDD red — add a test in `convex/credits/queries.test.ts` (or `creditTransactions.test.ts`, whichever exists) that seeds a `creditTransactions` row with `searchableText` populated and asserts the value survives the `getTransactions` round-trip. Currently fails (silently stripped). Green after the validator fix.
- **Plan 02**: TDD red — add a test that imports `userFields` (does not exist) and asserts the type guard compiles. Compilation failure is the red. Green after introducing the field-object.
- **Plans 03–06**: type-level — every migrated table emits a `const _check_x: AssertExactDoc<"x", typeof xValidator> = true;`. Running `npx tsc --noEmit` is the unit gate. If `tsc` reports `Type 'string' is not assignable to type 'true'` for any `_check_x`, drift exists. No vitest scaffolding needed per-table because the TS guard runs every time anyone touches the file.
- **Plan 07**: a single vitest test (`convex/lib/validators.test.ts`) iterates the table → validator registry and compares both validators' JSON exports. This is the runtime backstop in case someone bypasses the type system (e.g. by hand-rolling a new validator that happens to compile against the type guard but uses a structurally-identical-but-semantically-different inner shape).
- Behavioral assertions only. No assertion on validator internals beyond `v.object` shape equality (the JSON output is structural).
- Run `npx vitest run convex/credits convex/lib convex/extraction` after each plan.

## Migration stance

Pre-testing project; dev DB is disposable; schema validators are breaking by default.

**This plan ships zero schema changes.** Every `xFields` extraction is a pure refactor — the keys, types, and optionality of every column are byte-identical to the current `defineTable({...})`. The same `xFields` object is what powers `defineTable` and the mirror validator after the migration. Therefore:

- No dev DB wipe is required.
- No `@convex-dev/migrations` script — explicitly banned per project doctrine.
- The push log should show `✔ Convex functions ready!` on the first attempt after each commit. If the push complains about a schema field shape changing, **stop** — the refactor was not byte-identical and the plan has been violated.

The only ROW-shape touching commit is plan 01's `searchableText` addition to `creditTransactionValidator` — but `searchableText` already exists on the table; only the validator is being widened. No row-shape break.

## Delegation policy

Inline by the main session. The migration is repetitive and concentrated in 3 files (`convex/schema.ts`, `convex/lib/validators.ts`, `convex/extraction/validators.ts`); the per-table commit cadence is tight and benefits from the TDD-red→green→commit rhythm staying in one context. Subagents would slow the work.

Exception: if the registry/parity test (plan 07) needs to introspect Convex internals beyond `schema.tables[name].validator.json`, spawn an `Explore` subagent to map the Convex `convex/server` types — keep that investigation out of the main session.

## Grounding sources

- `convex/_generated/ai/guidelines.md` — Convex function-registration, validators, schema guidelines.
- `convex/schema.ts:1-1178` — table definitions, source of truth for runtime row shape.
- `convex/lib/validators.ts:1-137` — current `userValidator`, `creditsValidator`, `subscriptionValidator`, `creditTransactionValidator`.
- `convex/extraction/validators.ts:1-535` — current extraction mirrors and prior art `paginatedPaperWithResultsValidator` at line 449.
- `convex/credits/queries.ts:73` — `getTransactions` returns `v.array(creditTransactionValidator)`; the drift surface.
- Commit `8b42ef11` — `fix(extraction/validators): include questionsBilled in extractionPaperValidator` — the bug this plan structurally prevents.
- Audit transcripts from 2026-05-13 (three `Explore` agents) — confirm: 2 active drifts, 2 tables with no mirror, 10 currently-aligned mirrors at risk.

## Audit summary (confirmed)

**Drifted today (2):**

1. `creditTransactions` ↔ `creditTransactionValidator` — `searchableText` missing from validator.
2. ~~`extractionPapers` ↔ `extractionPaperValidator`~~ — `questionsBilled` missing from validator. **Fixed in `8b42ef11` (2026-05-13).**

**Aligned but unguarded (high-blast, 4):**

| Table | Validator | Consumer surfaces |
|---|---|---|
| `extractionPapers` | `extractionPaperValidator` | 4 query/mutation returns + 1 paginated wrapper |
| `extractionJobs` | `extractionJobValidator` | 4 returns |
| `extractionResults` | `extractionResultValidator` | 5 returns |
| `extractionQuestions` | `extractionQuestionValidator` | 7 surfaces (queries + arg shapes) |

**Aligned but unguarded (med-blast, 6):**

| Table | Validator | Consumer surfaces |
|---|---|---|
| `users` | `userValidator` | 4 returns |
| `credits` | `creditsValidator` | 2 returns |
| `subscriptions` | `subscriptionValidator` | 3 returns |
| `creditTransactions` | `creditTransactionValidator` | 1 paginated return |
| `extractionPaperErrors` | `extractionPaperErrorValidator` | 2 returns |
| `extractionEvidenceUnits` | `extractionEvidenceUnitValidator` | 2 returns |
| `extractionSavedViews` | `extractionSavedViewValidator` | 3 returns |

**No mirror, needs one (2):**

| Table | Validator | Why it needs one |
|---|---|---|
| `chatPapers` | (none) | Read by `convex/chat/sourceReadModel.ts` and threaded through `getChatSources` returns |
| `chatGenerationUsages` | (none) | Polled by retry workers, returned by admin queries |

**No mirror, no need yet (16):**

`models`, `featureFlags`, `screeningJobs`, `screeningResults`, `libraryItems`, `collections`, `libraryItemCollections`, `walletKeys`, `apiKeys`, `userResourceLocks`, `billingCustomers`, `stripeEventLogs`, `auditLogs`, `walletAllowedOrigins`, `zoteroConnections`, `zoteroOAuthTokens`. Out of scope.
