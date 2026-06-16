# Plan 06 - Workflow Cleanup

## Goal

Delete workflow-era extraction code, fields, tests, components, comments, and dependencies that are no longer part of the architecture.

## Scope

In:
- `convex/extraction/workflow.ts`
- `convex/workflow.ts`
- `convex/convex.config.ts`
- Workflow-specific test support
- Workflow fields on validators/schema
- Workflow imports and comments in extraction files
- Tests that only proved workflow component routing

Out:
- Non-extraction workflow usage, if any exists after source audit. If some other feature truly needs `@convex-dev/workflow`, keep a renamed non-extraction module and document it.

## Design

After Plans 01-05 are green:

1. Delete `convex/extraction/workflow.ts`.
2. Delete extraction workflow test-support and tests.
3. Remove `@convex-dev/workflow` component registration if no other feature uses it.
4. Remove `workflowId`, `paperWorkflowId`, and `paperWorkflowEpoch` from validators/schema and all seed fixtures.
5. Delete `mutations/internal/fanout.ts` once queue dispatch fully replaces it, or rename surviving credit-reservation helpers into queue modules.
6. Remove stale comments mentioning workflow as current execution.
7. Regenerate Convex API types.

## TDD Sequence

R1. Import-boundary test proves extraction public/internal APIs do not expose workflow modules.

R2. `rg "workflow\\.start|WorkflowManager|step\\.run|paperWorkflow|runExtractionWorkflow|runRetryWorkflow"` returns no extraction runtime references.

R3. Full extraction test suite passes without registering the workflow component.

R4. Convex deployability gate is green.

## Files Touched

- `convex/extraction/workflow.ts`
- `convex/workflow.ts`
- `convex/convex.config.ts`
- `convex/extraction/workflow.test.ts`
- `convex/extraction/workflow.test-support.ts`
- `convex/extraction/mutations/internal/fanout.ts`
- `convex/extraction/mutations/internal/fanout.test.ts`
- `convex/extraction/validators.ts`
- `convex/schema.ts`
- `convex/extraction/tests/fixtures.ts`
- `convex/_generated/api.d.ts`

## Migration Stance

Destructive. Obsolete fields and component state are deleted. Dev data can be wiped.

## Test Plan

- `npx vitest run convex/extraction`
- `npx vitest run convex/extraction/import-boundary.test.ts convex/extraction/internal-routing.test.ts`
- `npx tsc --noEmit`
- `rg "workflow\\.start|WorkflowManager|step\\.run|paperWorkflow|runExtractionWorkflow|runRetryWorkflow" convex/extraction convex/workflow.ts convex/convex.config.ts`

## Deployability Gate

```
npx pm2 logs convex --lines 5 --nostream
```

Must show `✔ Convex functions ready!`.

## Acceptance Criteria

- Extraction runtime contains no Convex Workflow dependency.
- `@convex-dev/workflow` is removed from `convex.config.ts` if no non-extraction usage remains.
- Obsolete workflow fields are absent from schema and validators.
- Full extraction tests and typecheck are green.

## Known Pitfalls

- Generated API types change after module deletion.
- Other tests may have accepted workflow registration errors as "success"; replace those assertions with queue state assertions before deleting workflow.
