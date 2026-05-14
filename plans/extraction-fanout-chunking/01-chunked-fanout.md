# 01 — Chunked fanout

## Goal

`launchPaperWorkflowsForJob` completes within the Convex per-mutation
budget for any reasonable job size (target: ≥1000 papers), produces
exactly one `paperPipelineWorkflow` per paper per epoch, and recovers
cleanly from a chunk-level Convex retry without re-launching or
re-reserving.

## Scope

- Add `paperWorkflowId: v.optional(v.string())` and
  `paperWorkflowEpoch: v.optional(v.number())` to `extractionPaperFields`.
- Refactor `launchPaperWorkflowsForJob` to chunked-scheduler-chain
  semantics with launch idempotency.
- Add `convex/extraction/workflow.test-support.ts` that registers the
  `@convex-dev/workflow` component (and its nested workpool) into
  convex-test, and exclude `convex/**/*.test.ts` plus the helper
  itself from `convex/tsconfig.json` (the upstream
  `@convex-dev/workflow/test` ships a TS bug that breaks convex's
  `tsc` push — see Known pitfalls; tests transitively pulling in the
  helper would re-break the push, so the convex CLI typecheck pass
  excludes test files entirely — vitest still type-checks them via
  the root `tsconfig.json`).
- Add `convex/extraction/mutations/internal/fanout.test.ts` with the
  TDD cases listed below.
- No change to `convex/extraction/workflow.ts` call site — the single
  `step.runMutation(...)` invocation kicks off the chain.
- No change to `convex/extraction/mutations/resume.ts` call site — the
  single `scheduler.runAfter(...)` invocation kicks off the chain.
- No change to `launchRetryPaperWorkflowsForJob`.

## Design

### New args

`launchPaperWorkflowsForJob` gains one optional arg:

```ts
offset: v.optional(v.number()),  // default 0 — caller passes nothing on first call
```

`paperIds` is still the full remaining-papers list. Each invocation
slices `paperIds.slice(offset, offset + CHUNK_SIZE)` and processes
only that slice.

### Constant

`const CHUNK_SIZE = 25;` — co-located with the mutation. Sized so a
single chunk's read+write+workflow-start budget is well under the
~8000-op / ~60s mutation ceiling, while keeping the scheduler chain
length practical (1000 papers → 40 chunks → 40 sequential mutations).

### Handler shape

```
const offset = args.offset ?? 0;
read job, return early on missing / epoch-mismatch / terminal status

if (offset === 0):
  read questions, compute perPaperBudget
  collect papers that need a fresh reservation across the FULL paperIds list
  read balance once
  if balance < required: flip job → creditsExhausted, return { creditsExhausted: true }

chunk = paperIds.slice(offset, offset + CHUNK_SIZE)

build plans (skip terminal, billed, with stale paperWorkflowEpoch but new logic)
for each plan with kind=needs-reservation: reserve, patch reservationId
for each plan: if paper.paperWorkflowId set under expectedEpoch → skip;
               else workflow.start, patch { paperWorkflowId, paperWorkflowEpoch }

if (offset + CHUNK_SIZE < paperIds.length):
  ctx.scheduler.runAfter(0, internal.<self>, { …args, offset: offset + CHUNK_SIZE })

return { launched, reserved, creditsExhausted: false }
```

### Returns

`{ launched, reserved, creditsExhausted }` — same shape. Values now
reflect this chunk only; the workflow's log line will under-report on
the first call, but that is purely cosmetic. The `creditsExhausted`
signal is still authoritative because the pre-flight runs on the
first chunk; subsequent chunks always return `creditsExhausted: false`.

### Idempotency tables

| Scenario                                              | Gate                                                                                                  | Result |
| ----                                                  | ----                                                                                                  | ----   |
| Chunk-level Convex retry, paper has reservationId     | `paper.reservationId !== undefined` → plan as `already-reserved`                                      | reservation not duplicated |
| Chunk-level retry, paper has paperWorkflowId @ epoch  | `paper.paperWorkflowId !== undefined && paper.paperWorkflowEpoch === expectedEpoch` → skip start      | workflow not started twice |
| Resume bumps epoch, paper has paperWorkflowId @ old   | epoch mismatch → start new workflow, patch new id+epoch                                               | stale workflow self-terminates on its next step |
| Paper finalized between chunks (status=`completed`)   | `paper.status === "completed"` → skipped                                                              | finalized paper not relaunched |
| Pre-flight credit exhaustion on second chunk          | offset > 0 skips pre-flight                                                                           | first chunk's reservations stand; mid-stream creditsExhausted impossible |

### Schema diff

```diff
   questionsBilled: v.optional(v.boolean()),
   reservationId: v.optional(v.id("creditTransactions")),
+  // Plan extraction-fanout-chunking: launch-idempotency for the
+  // chunked fan-out. `paperWorkflowId` is the WorkflowId returned by
+  // `workflow.start` for the paper's pipeline; `paperWorkflowEpoch`
+  // pins it to a runEpoch so resume can correctly invalidate stale
+  // launches and start a fresh workflow under the bumped epoch.
+  paperWorkflowId: v.optional(v.string()),
+  paperWorkflowEpoch: v.optional(v.number()),
   pdfContentUsed: v.optional(v.boolean()),
```

## TDD sequence

Test file: `convex/extraction/mutations/internal/fanout.test.ts`.
Helper: `convex/extraction/workflow.test-support.ts` exports
`setupExtractionWorkflow(t)` that registers the workflow component.

- **R1 — chunk slice processed.** Seed 60 papers in `pending`. Call
  the mutation with `offset: 0`. Assert that exactly the first 25
  papers carry `paperWorkflowId` after; papers 26–60 still have
  `paperWorkflowId === undefined`; one scheduled function is queued
  for `offset: 25`.
- **R2 — scheduler chain to completion.** Seed 60 papers. Call once,
  then pump the launch chain by reading
  `_scheduled_functions` for entries whose `name` includes
  `launchPaperWorkflowsForJob`, invoking each via `t.mutation` with its
  stored args, tracking consumed `_id`s, and looping until no new
  launch-chain entry is queued. Assert all 60 papers have
  `paperWorkflowId` set; no further `launchPaperWorkflowsForJob`
  entries remain in `_scheduled_functions`.

  > **Plan deviation note (R2).** The original spec called for
  > `t.finishAllScheduledFunctions(vi.runAllTimersAsync)`. That helper
  > would also drive the workflow component (registered via
  > `setupExtractionWorkflow`) into running each `paperPipelineWorkflow`'s
  > first action call. Those actions (`extractOneQuestion`,
  > `downloadAndIndexPdfAction`, …) have no mock in convex-test — they
  > would either fail or hang. The behavioral invariant we actually care
  > about for R2 is "from a single initial call, the launch chain
  > unwinds and every paper receives a `paperWorkflowId`". Manually
  > pumping just the launch-chain entries tests exactly that without
  > entangling the workflow component's internals. R3–R8 follow the
  > same pumping pattern when they need >1 chunk.
- **R3 — launch idempotency on chunk retry.** Seed 25 papers,
  pre-patch 10 of them with `paperWorkflowId: "stub"` and
  `paperWorkflowEpoch: expectedEpoch`. Call the mutation. Assert: the
  10 pre-patched papers keep `paperWorkflowId === "stub"` (not
  overwritten); the other 15 have fresh `paperWorkflowId`s.
- **R4 — resume invalidates prior-epoch launches.** Seed 25 papers
  with `paperWorkflowId: "stale"` + `paperWorkflowEpoch: 0`. Call
  with `expectedEpoch: 1`. Assert all 25 get a NEW
  `paperWorkflowId !== "stale"` and `paperWorkflowEpoch === 1`.
- **R5 — pre-flight credit-exhaustion on first chunk.** Seed 60
  papers; seed credits row with balance < required. Call with
  `offset: 0`. Assert job.status === `"creditsExhausted"`, no
  reservations created, no `paperWorkflowId` set on any paper, no
  scheduled functions queued.
- **R6 — pre-flight skipped when offset > 0.** Seed 60 papers and a
  balance that is sufficient for exactly one chunk's reservations
  (`CHUNK_SIZE × perPaperBudget`) but insufficient for the full
  pre-flight requirement (`60 × perPaperBudget`). Call with
  `offset: CHUNK_SIZE`. Assert the mutation does NOT flip the job to
  `creditsExhausted`, the chunk's papers all reserve+launch, and the
  next chunk (`offset: 2 × CHUNK_SIZE`) is queued.

  > **Plan deviation note (R6).** The original spec used a zero balance
  > to "prove" pre-flight was skipped, asserting the reservation step
  > would silently patch nothing. That hypothesis was wrong:
  > `reserveCreditsTransaction` throws `INSUFFICIENT_CREDITS` (it does
  > not return `{ reservationId: null }`) when the balance falls below
  > the per-paper amount, which rolls the whole chunk mutation back.
  > The correct way to prove pre-flight is skipped is to seed a balance
  > that would have failed the FULL pre-flight (60 × budget) but is
  > sufficient for the CHUNK's reservations (25 × budget). If the
  > chunk runs cleanly at that balance, pre-flight clearly did not
  > scan the full list.
- **R7 — reservation idempotency preserved.** Seed 25 papers, 10 of
  them with `reservationId` already set. Call. Assert no NEW
  `creditTransactions` rows for the 10 pre-reserved papers; the other
  15 each get a fresh reservation.
- **R8 — terminal papers skipped.** Seed 5 papers in `"completed"`,
  20 in `"pending"`. Call. Assert the 5 completed papers do NOT
  receive `paperWorkflowId` or reservation; the 20 pending papers do.

## Files touched

- `convex/extraction/validators.ts` — add 2 optional fields
- `convex/extraction/mutations/internal/fanout.ts` — refactor
- `convex/extraction/workflow.test-support.ts` — NEW (workflow registration)
- `convex/extraction/mutations/internal/fanout.test.ts` — NEW
- `convex/tsconfig.json` — exclude `./**/*.test.ts` and
  `./extraction/workflow.test-support.ts` so the upstream
  `@convex-dev/workflow/test` TS bug doesn't break the convex dev
  push when a test transitively imports the helper.

No change to `convex/extraction/workflow.ts`, `resume.ts`, schema.ts
(schema picks up validators automatically).

## Migration stance

Additive only. Two new optional fields. No backfill.

## Test plan

`pnpm vitest run convex/extraction/mutations/internal/fanout.test.ts`
must be green for every red→green cycle's commit. After the final
commit, the full test suite must remain green:
`pnpm vitest run`.

## Deployability gate

After every commit that touches `convex/`:

```
npx pm2 logs convex --lines 5 --nostream
```

must show a recent `✔ Convex functions ready!` and no `✖ Error` line.

The fanout file is currently untracked — every commit in this plan
that touches it will be the first time it lands in git, which is
unusually impactful for the schema-spec rebuild. After the schema
patch lands, watch for any silent stale return-validator behavior on
the workflow's `step.runMutation` call (the validator already returns
`{ launched, reserved, creditsExhausted }` and is unchanged in this
plan, so no new wire-shape risk).

## Acceptance criteria

1. All R1–R8 tests pass.
2. `pnpm vitest run convex/extraction/mutations/internal/fanout.test.ts` green.
3. Full suite (`pnpm vitest run`) green — no regressions in adjacent
   tests (`preflight.test.ts`, `creditsExhausted.test.ts`,
   `billing-idempotency.test.ts`, `cancel.test.ts`,
   `workflow.test.ts`).
4. `npx pm2 logs convex --lines 5 --nostream` shows
   `✔ Convex functions ready!` and no `✖ Error` after the final commit.
5. Calling `internal.extraction.mutations.resume.resumeExtraction` on
   the stuck job `kd72vgc421hqnk8n54cecsyq3586prz5` moves at least one
   paper out of `pending` within 60 seconds.

## Known pitfalls

- **Convex args validator does not support defaults.** `offset` is
  `v.optional(v.number())`; default-to-0 is handled inside the
  handler body via `args.offset ?? 0`. Callers must NOT pass `offset`
  on first invocation.
- **Workflow component test registration recursively registers a
  nested workpool.** Confirmed via `@convex-dev/workflow/src/test.ts:
  workpool.register(t, "${name}/workpool")`. The `setupExtractionWorkflow`
  helper just calls `register(t)` from `@convex-dev/workflow/test`;
  do not duplicate the workpool registration.
- **`@convex-dev/workflow/test` ships a TypeScript bug** at
  `node_modules/@convex-dev/workflow/src/test.ts:17` — its `register<Schema>`
  generic doesn't unify with the loose `TestConvex<SchemaDefinition<GenericSchema, boolean>>`
  that `workpool.register(t, ...)` expects. The package ships `.ts`
  source (not `.d.ts`), so `skipLibCheck: true` does not suppress the
  error. Any file inside `convex/` that imports `@convex-dev/workflow/test`
  triggers `convex dev`'s `tsc` step to walk into the broken module and
  fail with `TS2345`, breaking the dev push. Mitigation:
  `convex/extraction/workflow.test-support.ts` AND
  `convex/**/*.test.ts` are added to `convex/tsconfig.json`'s `exclude`
  list. The helper exclude alone isn't enough — TypeScript follows
  imports regardless of `exclude`, so a `.test.ts` file that imports
  the helper drags the broken module back into the convex CLI's tsc
  pass. Excluding all `.test.ts` files under `convex/` is consistent
  with what convex actually deploys (tests aren't deployed) and keeps
  the convex push immune to test-only typecheck failures. Vitest still
  type-checks tests via the root `tsconfig.json`, so their types are
  still enforced — just not on the convex push path.
- **`vi.useFakeTimers()` is required** before
  `t.finishAllScheduledFunctions(vi.runAllTimersAsync)` so the
  recursive scheduler.runAfter(0,...) chain unwinds inside the test.
  Restore with `vi.useRealTimers()` in `afterEach` to avoid bleeding
  fake timers into adjacent tests.
- **The first chunk's pre-flight scans the ENTIRE paperIds list to
  compute `totalReservationNeeded`.** That is O(P) `ctx.db.get` reads
  on the first invocation. For 1000 papers that is still under the
  read budget (1000 ≪ 8000) but warrants future-proofing if jobs grow
  past 5000 papers (out of scope here). The risk lives in the
  pre-flight only — every subsequent chunk reads its own slice.
- **`paperWorkflowId` is a string, not an Id.** The workflow
  component's WorkflowId is its own internal id-shape, not an
  `Id<"workflows">`. Using `v.string()` is correct.
- **Convex retry semantics.** When the mutation times out
  mid-execution, Convex retries the ENTIRE mutation with the SAME
  args. Idempotency on `paper.paperWorkflowId` and
  `paper.reservationId` is what keeps retries safe. Verify R3
  (idempotency) before declaring the chunking complete.
