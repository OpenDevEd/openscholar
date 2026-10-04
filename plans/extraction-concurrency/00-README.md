# Extraction Concurrency — Plan Set

Four-plan rework of extraction execution so jobs can run with bounded paper-level and question-level parallelism, both derived from plan entitlements, without regressing pause/resume, billing idempotency, or Convex-friendly contention patterns.

This plan set is intentionally sliced so each step can ship, be verified, and be reverted independently.

---

## Motivation

Empirical state of extraction execution as of 2026-04-21, verified against source and runtime signals:

1. **Main extraction is fully serialized.** `convex/extraction/workflow.ts:177-189` explicitly documents that papers are processed serially and the question loop is also serial. The concrete loops live at `:190-332`.
2. **The product now wants both concurrency knobs, first-class.** The desired end state is plan-derived `paperConcurrency` and `questionConcurrencyPerPaper`, not hardcoded literals.
3. **Per-question execution already exists.** `convex/extraction/workpoolActions.ts:947-1226` has `extractOneQuestion`, which already owns the real idempotency boundary via `existingResult?.billed` and the current job-status guards.
4. **Pause/resume is the reason concurrency was removed.** `convex/extraction/workflow.ts:182-185` explicitly says the old per-paper parallelism was traded away for correctness with the current single `resume:<jobId>` event gate.
5. **The entitlement plumbing already exists.** `convex/extraction/bucket/limits.ts` already stores plan-derived extraction limits (`PAPER_LIMIT_BY_PLAN`, `PAPER_PULL_CAP_BY_PLAN`) and plan-derived concurrency for chat (`CHAT_CONCURRENCY_LIMIT_BY_PLAN`).
6. **The main wall-clock bottleneck is serialized LLM time.** Runtime analysis showed extraction question latency is dominated by the LLM path; the system is currently paying `papers × questions × question-latency`.
7. **Question-level fan-out is not free.** `convex/extraction/mutations/results.ts:233-355` does a lot of shared work on every answered question: result upsert, paper patch, credit deduction, credit aggregate, result aggregates, and a full paper-list projection recompute.
8. **The current control plane is not safe for parallel dispatch.** Today the workflow still assumes one blocked waiter, retry is not pause-aware, late workflow status writes can overwrite paused state, and workflow-level completion is not strongly guarded against stale workflow ownership.
9. **Workflow/workpool infrastructure is already showing OCC churn.** `npx convex insights --details` reported recent OCC retries concentrated in workflow/workpool internal tables (`runStatus`, `pendingStart`, `pendingCompletion`). That means “just increase fan-out” is likely to increase scheduler contention before it buys linear throughput.
10. **Some existing extraction control paths already exceed safe scan budgets.** `resumeExtraction` and `retryFailedQuestions` both read up to `PAPER_LIMIT_MAX * MAX_QUESTIONS_PER_JOB`, which is `1000 * 50 = 50,000`, above Convex’s documented `32,000` scanned-doc limit.

---

## Design decisions (locked)

| # | Decision | Why |
|---|---|---|
| **D1** | **Both extraction concurrency knobs are first-class plan-derived values from day one.** | Product requirement. No hardcoded `2`, no hidden fallback literal. |
| **D2** | **Reuse `convex/extraction/bucket/limits.ts` as the single numeric entitlement home.** | It already owns extraction paper caps and chat concurrency. Extending it is the DRY path. |
| **D3** | **Current plan values are `5` for every tier for both knobs.** | Product decision today, while preserving future differentiation by plan. |
| **D4** | **Plan entitlement and infra safety clamp are distinct concepts.** | The workflow/runtime may need a lower operational cap than the plan entitlement during rollout or incident response. |
| **D5** | **Pause/resume remains job-scoped. No pool-level pause.** | Pool pause is cross-tenant and was already explicitly rejected in `convex/extraction/mutations/pause.ts`. |
| **D6** | **Introduce a job-scoped run epoch / generation.** | Parallel dispatch requires a way to invalidate stale in-flight work across pause/resume boundaries. |
| **D7** | **Control-plane hardening lands before any execution fan-out.** | Today even paper-level concurrency is unsafe if pause/resume semantics must still hold. |
| **D8** | **Enable paper concurrency before question concurrency.** | Paper-level overlap buys real throughput while avoiding most same-paper write contention once the control plane is fixed. |
| **D9** | **Do not enable question concurrency until the per-question write path is stabilized.** | Today the same paper row and projection path are too hot for safe `5`-way same-paper fan-out. |
| **D10** | **Retry must use the same concurrency model and pause semantics as the main path.** | `runRetryWorkflow` currently bypasses the main path and uses raw nested `Promise.all`; leaving it untouched would make the execution model inconsistent. |
| **D11** | **Existing billing/idempotency gates remain the hard boundary.** | `indexingBilled` and `result.billed` already prevent duplicate charging; parallelism must be layered around them, not through them. |
| **D12** | **Broad scan-based control flows are fixed as part of this effort.** | The current 50k-row resume/retry reads are already out of bounds and would get worse under more parallelism. |
| **D13** | **Question-level internal overlap is allowed for read-only prep work.** | Fetching model, pricing, balance, and evidence inputs concurrently is low-risk and aligns with Convex best practices on keeping side effects behind idempotent boundaries. |

---

## Plan files

```text
plans/extraction-concurrency/
├── 00-README.md
├── 01-plan-limits-and-run-epoch.md
├── 02-bounded-paper-concurrency.md
├── 03-write-path-stabilization.md
├── 04-bounded-question-concurrency.md
└── PROMPTS.md
```

---

## Dependency graph

```text
01 limits + epoch + control-plane hardening ───► 02 bounded paper concurrency ───► 03 write-path stabilization ───► 04 bounded question concurrency
                    │                                              │                                 │
                    └──────────────────────────────────────────────┴─────────────────────────────────┘
```

Ship order recommendation: **01 → 02 → 03 → 04**.

`04` must not start until `03` lands. `02` and `03` are conceptually separate, but `03` should be informed by the runtime behavior observed after `02`.

---

## Reuse (DRY)

These plans should extend existing project primitives instead of inventing new control surfaces:

- **`convex/extraction/bucket/limits.ts`** — existing home for plan-derived numeric extraction limits. This plan set extends it with execution concurrency limits.
- **`convex/chat/concurrency.ts`** — current precedent for plan-derived numeric concurrency enforcement on the server.
- **`lib/billing/entitlements.ts`** + **`convex/subscriptions/lib/selectCanonicalSubscription.ts`** — canonical “what plan does this user actually have?” path. Do not hand-roll subscription resolution.
- **`convex/extraction/workflow.ts`** — current execution coordinator and pause gate. This remains the orchestration home.
- **`convex/extraction/workpoolActions.ts`** — current per-question idempotent worker surface. Reuse the existing status/billing guards.
- **`convex/extraction/mutations/results.ts`** — current per-question persistence and billing boundary.
- **`convex/extraction/aggregates.ts`** — existing job-scoped aggregate pattern that can inform safer write-side projections/counters.
- **`convex/_generated/ai/guidelines.md`** — local Convex rules override training assumptions.

---

## Testing doctrine

Follow project doctrine:

- assert on behavior, ARIA, and `data-*`
- never assert on Tailwind classes or inline style values
- push pure logic into small testable modules first
- treat workflow wiring, Convex mutations, and React surfaces as test-after unless there is a small pure helper to lock first

### TDD policy — pure logic only

Each plan must drive its pure helper first when there is one:

- **Plan 01** — extraction execution limit resolution helper and run-epoch transition helper
- **Plan 02** — batching/chunking helper for bounded paper dispatch
- **Plan 03** — per-paper write/summary helper(s) extracted from result persistence
- **Plan 04** — batching helper for bounded question dispatch

Convex workflow/mutation wiring is test-after.

---

## Migration stance

This project is pre-testing. Dev data is disposable.

- schema changes may be destructive
- do not add legacy compatibility shims
- do not write migrations to preserve old execution state “just in case”

If a schema change conflicts with existing rows, wipe the affected data in dev and continue.

One exception: execution correctness data that is still valuable in dev may be regenerated through bounded internal repair helpers if needed. Prefer repair over compatibility branches.

---

## Delegation policy — protect the main session’s context

Same project policy as the other large plan sets:

- any investigation requiring more than ~3 file reads or ~3 greps should be delegated
- use `Explore` agents for codebase mapping
- use general-purpose/doc agents for external docs and pattern verification
- keep the TDD loop, commits, and final verification in the main session

High-value delegation targets for this plan set:

- map every extraction path that writes the same paper row
- map every caller of the execution limit resolver
- read current Convex workflow/workpool docs for bounded parallelism, events, and retries
- verify all retry/resume readers that currently scan by-job result sets

---

## Convex patterns referenced across plans

- **Workflow `awaitEvent` / `sendEvent`** — current job-scoped pause/resume primitive
- **Bounded `Promise.all` batching** — official workflow pattern for parallel steps with `maxParallelism`
- **OCC-backed deterministic mutations** — current correctness model for billing and per-question persistence
- **Internal query wrappers for actions/workflows** — existing pattern for plan-derived limits and action-safe DB access

---

## Sources

- `convex/extraction/workflow.ts`
- `convex/extraction/workpoolActions.ts`
- `convex/extraction/mutations/results.ts`
- `convex/extraction/mutations/pause.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/mutations/retry.ts`
- `convex/extraction/queries/internal.ts`
- `convex/extraction/bucket/limits.ts`
- `lib/billing/entitlements.ts`
- `convex/subscriptions/lib/selectCanonicalSubscription.ts`
- `convex/_generated/ai/guidelines.md`
- local skill: https://github.com/get-convex/agent-skills/tree/7a6fcc6882f344577a34365fdadbd0f8f8c467d7/skills/convex-performance-audit/**
- Convex docs:
  - `https://docs.convex.dev/database/advanced/occ`
  - `https://docs.convex.dev/error`
  - `https://docs.convex.dev/functions/actions`
  - `https://docs.convex.dev/production/state/limits`
  - `https://github.com/get-convex/workflow`
  - `https://github.com/get-convex/workpool`
