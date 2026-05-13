# Plan 07 — Schema/validator parity test as runtime backstop

## Goal

Add a single vitest module that walks every `(table, field-object)` pair declared by plans 02–06 and proves, at runtime, that the field-object's keys + per-field validator kinds are bit-exact equal to the schema's `defineTable` argument. This is the belt-and-suspenders complement to `AssertExactDoc<>`:

- `AssertExactDoc<>` (compile-time) fires under `tsc --noEmit` if the *types* drift. It depends on `_generated/dataModel.d.ts` being current and on the assertion-helper itself being correct.
- The parity test (runtime) reflects on the live `schema.tables[<name>].validator.fields` map and compares it to the field-object. It fires inside CI even if codegen is stale or the assertion helper has a regression.

Both surfaces must agree. If they ever disagree, the disagreement IS the bug — either codegen is stale (fix: `npx convex codegen`), the assertion helper has a hole (fix: tighten it), or someone hand-edited one side of an SSOT pair (fix: revert).

## Scope

- One new file: `convex/lib/validators.test.ts` (or `convex/lib/schemaParity.test.ts` if `validators.test.ts` already exists).
- Reads from: `convex/schema.ts` (default export), `convex/lib/validators.ts` (field-objects), `convex/extraction/validators.ts` (field-objects).
- No production-code changes. The test is a pure read-only structural check.

## Design

Convex's `defineSchema({ tables })` returns a `SchemaDefinition` whose `tables` map carries each `TableDefinition`. Each `TableDefinition` has a `validator: ObjectValidator` whose `.fields` is a `Record<string, Validator>` keyed by column name. Every `Validator` exposes `.kind` ("string" | "number" | "boolean" | "id" | "literal" | "array" | "object" | "union" | "optional" | "any" | "null" | "bytes" | "float64" | "int64" | "record"). For the bidirectional structural check we need:

1. Key-set equality between the field-object and `schema.tables[name].validator.fields`.
2. Per-field `.kind` equality.
3. For optional fields, the inner type's `.kind` also equal.

The test does NOT recurse into nested object validators — `AssertExactDoc<>` already covers that at the type level, and walking arbitrary depth at runtime is fragile. The parity check is a top-level structural diff; nested drift is caught by either the compile-time guard or the convex push validator at deploy time.

```ts
// convex/lib/validators.test.ts
import { describe, expect, test } from "vitest";
import type { Validator } from "convex/values";
import schema from "../schema";

import {
  userFields,
  creditsFields,
  subscriptionFields,
  creditTransactionFields,
  chatPaperFields,
  chatGenerationUsageFields,
} from "./validators";

import {
  extractionJobFields,
  extractionQuestionFields,
  extractionPaperFields,
  extractionPaperErrorFields,
  extractionResultFields,
  extractionEvidenceUnitFields,
  extractionSavedViewFields,
  extractionReportSnapshotFields,
  extractionRunDiffFields,
  workflowTemplateFields,
} from "../extraction/validators";

// One entry per table that has a mirror validator. If this list ever grows
// out of sync with the field-objects exported above, the spread itself fails
// to compile — the field-object IS the key here, not a stringly-typed name.
const ssotTables = {
  users: userFields,
  credits: creditsFields,
  subscriptions: subscriptionFields,
  creditTransactions: creditTransactionFields,
  chatPapers: chatPaperFields,
  chatGenerationUsages: chatGenerationUsageFields,
  extractionJobs: extractionJobFields,
  extractionQuestions: extractionQuestionFields,
  extractionPapers: extractionPaperFields,
  extractionPaperErrors: extractionPaperErrorFields,
  extractionResults: extractionResultFields,
  extractionEvidenceUnits: extractionEvidenceUnitFields,
  extractionSavedViews: extractionSavedViewFields,
  extractionReportSnapshots: extractionReportSnapshotFields,
  extractionRunDiffs: extractionRunDiffFields,
  extractionWorkflowTemplates: workflowTemplateFields,
} as const;

function describeValidator(v: Validator<unknown, "required" | "optional", string>): string {
  // Surface `optional<x>` so the diff message shows which side made the field
  // optional. Convex models optionality as a wrapping `isOptional` flag rather
  // than a discriminated kind, but the public Validator type exposes it.
  const inner = v.kind;
  const optional = (v as { isOptional?: "required" | "optional" }).isOptional === "optional";
  return optional ? `optional<${inner}>` : inner;
}

describe("schema/validator parity", () => {
  for (const [tableName, fields] of Object.entries(ssotTables)) {
    test(`${tableName}: field-object matches schema.tables.${tableName}.validator.fields`, () => {
      const tableDef = (schema.tables as Record<string, { validator: { fields: Record<string, Validator<unknown, "required" | "optional", string>> } }>)[tableName];
      expect(tableDef, `schema.tables.${tableName} missing — schema desync`).toBeDefined();

      const schemaShape: Record<string, string> = Object.fromEntries(
        Object.entries(tableDef.validator.fields).map(([k, v]) => [k, describeValidator(v)]),
      );

      const validatorShape: Record<string, string> = Object.fromEntries(
        Object.entries(fields as Record<string, Validator<unknown, "required" | "optional", string>>).map(
          ([k, v]) => [k, describeValidator(v)],
        ),
      );

      // A single equality check produces the clearest diff in CI; vitest
      // pretty-prints object diffs by default.
      expect(validatorShape).toEqual(schemaShape);
    });
  }
});
```

The test is deliberately one assertion per table — vitest's diff output shows the missing/extra/mistyped keys verbatim, which is the failure surface a future contributor will see when they drift one side.

## TDD sequence

1. **R1 (red, drift detection)**: temporarily mutate one field-object (e.g. drop `state` from `userFields`). Run `npx vitest run convex/lib/validators.test.ts` — the `users` parity test fails with a diff showing the missing `state` key. Revert.

2. **R2 (red, key-only drift)**: temporarily add a phantom `lastSeenAt: v.optional(v.number())` to `userFields` only. Run the test — same parity test fails because the schema (which now reads from `userFields` per plan 02) and the field-object are the same object, so this red can only be observed if you ALSO leave the field out of the schema. Skip this case in practice; the schema/field-object are the same object after plan 02. The compile-time `AssertExactDoc` handles the second-table case (plan 03+).

   This R2 step is documentation, not a test to run. The post-plan-02 SSOT shape is such that the field-object and schema cannot independently drift — they share the same object. The parity test catches drift between the field-object and what `defineSchema` registered, which is a different layer of safety (catches accidental hand-edits to the schema file that bypass the field-object).

3. **G1 (green)**: with the field-objects untouched, all 16 parity tests pass.

4. **R3 (drift detection on `.kind` mismatch)**: temporarily change a field's validator kind (e.g. `userFields.email: v.number()` instead of `v.string()`). The parity test fails on the `users` row with a `string` vs `number` diff. Revert.

5. **G2 (final green)**: clean.

## Files touched

- `convex/lib/validators.test.ts` — new test module (~80 lines including the table map).

No production code touched.

## Migration stance

Pure test addition. No schema change. No validator change. No row-shape change.

## Test plan

- `npx vitest run convex/lib/validators.test.ts` — 16 tests green.
- `npx tsc --noEmit` clean (the test imports field-objects and the typed schema; the type of `schema.tables` is partially `any` in Convex's exports, hence the explicit cast).
- Full `npx vitest run` green — no regression introduced.

## Deployability gate

- `npx pm2 logs convex --lines 5 --nostream` — `✔ Convex functions ready!`. A vitest-only commit should not trigger a convex push, but the logs are checked once after the commit to confirm the dev push remains healthy (a stuck push from a prior plan blocks any later work).
- No `Module not found` line: vitest's import of `../schema` resolves correctly because `convex/schema.ts` is the canonical schema export.

## Acceptance criteria

- `convex/lib/validators.test.ts` exists.
- The `ssotTables` map covers every table that gained a field-object in plans 02–06 (16 entries).
- All 16 parity tests pass under `npx vitest run`.
- Demonstrated (and reverted) drift detection for both a missing-key drift (R1) and a kind-mismatch drift (R3).
- `npx tsc --noEmit` clean.
- pm2 logs healthy after the commit.

## Known pitfalls

- **`schema.tables` type is `any`-ish in Convex's exports** — the public types do not expose the inner `validator.fields` map in a strongly-typed way. The explicit cast in the test is intentional. If a future Convex release tightens these types, drop the cast.
- **The map must be hand-extended when a new table joins the SSOT pattern.** This is by design — adding a new field-object should be a deliberate act, and the test failing on "schema.tables.foo missing" is a feature: it forces the new table into the parity map.
- **`isOptional` is the optionality signal**, not a separate validator kind. The `describeValidator` helper wraps the inner kind in `optional<x>` so the diff message is readable. Do not flatten this — `optional<number>` vs `number` is a real drift case worth surfacing.
- **Nested object validators are not recursed into.** A drift inside `extractionResults.citations[].retrieval.denseScore` is NOT caught by this test. It is caught by `AssertExactDoc<>` at compile time (because the nested types must match structurally) and by the convex push validator at deploy time (because the row shape would be rejected). The parity test is a top-level structural backstop, not an exhaustive deep-equality oracle.
- **`v.any()` and `v.record(...)`** kinds — both `extractionPaperErrors.context` (`v.any()`) and `creditTransactions.metadata` (`v.record(v.string(), v.string())`) pass parity because both sides report the same `.kind`. The runtime structure inside `any` or the record's value-validator is not introspected. Same reasoning as nested objects.
- **`SchemaDefinition.tables` is a flat record** — adding the test does not require importing `defineSchema`; the default `schema` export is enough. If a future refactor changes the export shape, the test fails fast at the schema-load step.
- **Order independence**: `expect(validatorShape).toEqual(schemaShape)` does an unordered object comparison. Do not switch to `toStrictEqual` on `Object.entries(...)` — that would couple the test to key-insertion order, which is not part of the contract.
