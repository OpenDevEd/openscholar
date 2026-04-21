# Extraction Concurrency — Execution Prompts

One copy-paste prompt per plan, designed for a fresh session.

---

## Plan 01 — Plan-Derived Limits + Run Epoch + Control Plane Hardening

```text
Execute `plans/extraction-concurrency/01-plan-limits-and-run-epoch.md` top to bottom.

Order:
1. Extend `convex/extraction/bucket/limits.ts` with the two extraction execution limits and one combined resolver.
2. Add the action/workflow-friendly internal query wrapper.
3. Add `runEpoch` to `extractionJobs` schema.
4. Update pause/resume to bump the epoch.
5. Add status+epoch internal query support.
6. Make retry participate in the same pause/epoch model.
7. Make workflow-level completion and stale status writes safe against older runs.
8. Thread expectedEpoch into indexing/question workers and add stale-work guards.
9. Add focused tests for limit resolution, epoch bumps, stale-work skips, retry pause behavior, and stale workflow completion.

Non-negotiable:
- both concurrency knobs must be plan-derived
- all plans currently resolve to `5`
- no hardcoded concurrency literal remains in extraction execution code
- do not leave retry or workflow completion on the old freshness model
```

---

## Plan 02 — Bounded Paper Concurrency

```text
Execute `plans/extraction-concurrency/02-bounded-paper-concurrency.md`.

Order:
1. Add or extract a tiny chunking helper with tests.
2. Replace the outer serial paper loop in `convex/extraction/workflow.ts` with bounded paper batching.
3. Keep per-paper question processing serial.
4. Add the same bounded paper concurrency model to `runRetryWorkflow`.
5. Add tests proving multiple papers can be in flight and pause still gates between batches.

Do not enable question-level concurrency in this plan.
```

---

## Plan 03 — Stabilize The Write Path

```text
Execute `plans/extraction-concurrency/03-write-path-stabilization.md`.

Order:
1. Shrink `recordOneAnswer` so the per-question hot path no longer triggers a full paper projection recompute.
2. Move or replace projection maintenance with a narrower mechanism.
3. Tighten the oversized resume/retry control reads so they no longer rely on 50k-row scans.
4. Extend tests to prove billing idempotency and paper-list correctness still hold.

Non-negotiable:
- do not regress billing correctness
- do not leave `recomputePaperListProjection` on the per-question hot path
```

---

## Plan 04 — Bounded Question Concurrency

```text
Execute `plans/extraction-concurrency/04-bounded-question-concurrency.md`.

Order:
1. Add or reuse a question chunking helper.
2. Replace the per-paper serial question loop with bounded question batching.
3. Keep epoch/status rechecks at entry and immediately before persist/billing.
4. Add safe read-only internal overlap inside `extractOneQuestion`.
5. Verify finalizePaper remains correct under concurrent question completion.

Non-negotiable:
- question concurrency must use the plan-derived knob
- stale work must not bill or persist
- retry and main execution must stay aligned
```
