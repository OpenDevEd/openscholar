# Extraction Recovery — Plan Set

Eight-plan rework of the Data Extraction feature's recovery, observability, and user-control surfaces. Sliced so each plan can ship (and be reviewed, reverted, re-planned) independently, with explicit dependency arrows.

---

## Gap audit that motivated this work

From the five-agent audit on 2026-04-19:

| # | Severity | Gap | Evidence |
|---|---|---|---|
| 1 | **CRITICAL** | No pre-flight credit check on `startJob`. User can submit a 200-paper job with 10 credits and the system cheerfully accepts. | `convex/extraction/mutations/jobs.ts:61-179` vs screening's check at `convex/screening/mutations.ts:93-108`. |
| 2 | **CRITICAL** | Credit exhaustion mid-job fails papers silently one-by-one without halting. No distinct `creditsExhausted` status (screening has it). | `convex/extraction/mutations/results.ts:276-287` throws generic failure; `convex/schema.ts:798-805` shows screening's superset status union. |
| 3 | **CRITICAL** | Only retry path is `duplicateJob` which re-processes every paper from scratch, re-billing credits for already-completed papers. | `convex/extraction/mutations/jobs.ts:182-277`. |
| 4 | **HIGH** | `extractionPapers.creditsUsed` stored but never surfaced. No job-level total. No pre-flight estimate. No cost summary on completion. | `convex/schema.ts:516` (field exists); no queries/UI reference it. |
| 5 | **HIGH** | Error codes thrown via `createError("CODE", msg)` but only the message string is persisted. `errorMessage: string` can't be classified at query time. | `convex/extraction/mutations/internal/onComplete.ts:244-265`. |
| 6 | **HIGH** | No pause/resume. `paused` status doesn't exist; no mutation; no worker check; no UI button. | `convex/extraction/stateMachine.ts:17-25`. |
| 7 | **MEDIUM** | No timeout mitigation for the 10-min Convex action ceiling. `waitAndExtractAction` with a heavy paper (10 Qs × 1000+ chunks) can time out and the 3× retry just repeats it. | `convex/extraction/workpoolActions.ts:744-1170`. |
| 8 | **MEDIUM** | No per-item progress (which paper, which question). No `aria-live` regions. No ARIA roles on status dots. | `components/extraction/job-list-item.tsx`, `app/extraction/[jobId]/page.tsx`. |
| 9 | **MEDIUM** | No "Buy Credits" CTA on credit-exhaustion failure. User must find billing page manually. | `lib/toast/error-resolver.ts:71` — plain message, no action. |
| 10 | **LOW** | No append-only error history per paper — only `lastError`. Hard to diagnose flaky retries. | `convex/extraction/paperLifecycle.ts:73`. |

## Plan files

```
plans/extraction-recovery/
├── 00-README.md                         (this file)
├── 01-error-taxonomy.md                 (foundation — everything depends on it)
├── 02-per-question-decomposition.md     (foundation — timeout fix + unit-of-retry)
├── 03-preflight-and-creditsExhausted.md (pre-flight check + new non-terminal status)
├── 04-credit-aggregation.md             (creditsAgg + UI cost surfacing)
├── 05-retry-failed-papers.md            (retryable classification + mutation)
├── 06-pause-resume.md                   (pause/resume mechanism)
└── 07-observability-polish.md           (per-item progress, ARIA, error history UI)
```

## Dependency graph

```
01 error-taxonomy ─────┬────► 03 preflight/creditsExhausted ────► 06 pause-resume
                       │              │
                       ├─────────────► 05 retry-failed
                       │
                       └────► 02 per-question-decomp ────► 06 pause-resume
                                                           07 observability

04 credit-aggregation  (independent — can ship any time after 01)
```

Ship order recommendation: **01 → 02 → 03 → 04 → 05 → 06 → 07**. You can parallelize 03 and 04 after 01 lands; you can parallelize 04 and 05 after 03 lands.

## Reuse (DRY)

These plans lean hard on patterns the codebase already has. Primary donors:

- **Screening** (`convex/screening/**`) — pre-flight check, `creditsExhausted` status, `isInsufficientCredits` detection, pre-submission balance-check UI with "Buy Credits" CTA (`components/screening/screening-dialog.tsx:411-440`), `exportIncompleteWarning` pattern, analytics events.
- **Chat error work in flight** (`messages/en-US.json` lines 530-556 in the working tree) — `chatErrorTitle`/`chatErrorBody` taxonomy. Plan 01 unifies this into `lib/errors/taxonomy.ts` so chat and extraction share one codebook.
- **Existing aggregates** (`convex/extraction/aggregates.ts`) — three `DirectAggregate` instances. Plan 04 adds a fourth with the same shape.
- **Workpool + Workflow components** — native `maxParallelism=0` pause + `step.awaitEvent` gate (plan 06).

## Coordination with parallel chat error work

The in-flight chat changes (uncommitted on `dev`) add `chatErrorTitle`/`chatErrorBody` translation blocks and error classification on the chat side. Plan 01 **lifts that taxonomy out of the chat namespace** into a shared one before committing any extraction work, so both features share a single source of truth. If the chat work lands first, plan 01 consumes its keys. If extraction lands first, chat later replaces its local keys with the shared namespace. Both branches converge on the same set of codes.

## Testing doctrine

All plans follow the project's testing philosophy (project `CLAUDE.md`):
- **Assert on behavior, ARIA roles, `data-*` attributes, and semantic state — not CSS classes.**
- Expose internal contracts via `data-error-code`, `data-job-status`, `aria-live`, `role="status"`.
- Pure logic (classification, estimation, taxonomy mapping) is tested in `lib/**.test.ts`.

### TDD policy — **pure logic only**

Each plan carries an explicit **TDD sequence** section listing Red → Green → Refactor steps for its pure-logic module(s). These modules must be fully green before any Convex wiring or UI work begins. Commit after each green.

- **Plan 01** — `lib/errors/taxonomy.ts` (18 codes, `isRetryable`, `classifyUnknownError`)
- **Plan 02** — `lib/extraction/paper-status.ts` (question-results → paper status rollup)
- **Plan 03** — `lib/extraction/cost-estimate.ts` (pre-flight estimator)
- **Plan 04** — no pure logic; test-after for all wiring
- **Plan 05** — `lib/extraction/retry-summary.ts` (retryable/permanent classifier)
- **Plan 06** — `lib/extraction/transitions.ts` (pause/resume transition validators)
- **Plan 07** — `lib/extraction/failures-summary.ts` (failures-by-code grouping)

Convex mutations, workflow orchestration, migrations, and UI components are **test-after**. The Test plan section in each plan enumerates the specific behavior assertions (one per contract), written after green-lit implementation. This reflects the real-world trade-off: TDD on pure TS has instant feedback; TDD on Convex ctx with mocks has diminishing returns.

## Migration stance — **dev data is disposable**

The project is pre-testing. The Convex deployment is a dev database with no production data to preserve. Every plan in this set makes breaking schema changes; **none of them ship a backfill migration**.

When a plan introduces a schema change:
1. Edit `convex/schema.ts`.
2. Deploy. If the validator rejects existing rows, **wipe the affected tables** via Convex dashboard or `npx convex run internal.admin.wipeTable { table: "..." }` (add this helper if needed, gate by `NODE_ENV === "development"`).
3. Start fresh.

Do **not** write `@convex-dev/migrations` scripts, do **not** preserve old rows by widening + backfilling + narrowing, do **not** add optional-field compat shims. The user has explicitly authorized destructive schema evolution on this deployment.

If a production deployment ever exists, re-open every plan's schema change section and write a proper migration then. Until that day, go fast.

## Delegation policy — protect the main session's context

Context rot is the silent enemy of long-running plans. Every file read, grep, and tool output pollutes the main session's context; after enough accumulation, quality degrades. Subagents absorb that pollution in their own context and return only synthesized summaries.

**The executing session MUST delegate broadly** via the Agent tool. Rule of thumb: **any investigation needing more than ~3 file reads or ~3 greps → spawn a subagent**.

### Agent types to prefer

- **`Explore`** — fast codebase exploration. Use for "where is X defined?", "map all callers of Y", "find every file that imports Z". Always specify thoroughness: `"quick"` | `"medium"` | `"very thorough"`.
- **`general-purpose`** — multi-step research, web doc reading, synthesis tasks.
- **`Plan`** — subsidiary planning for a non-trivial sub-problem.

### What to delegate (high value)

- "Map every caller of `waitAndExtractAction` and summarize what each expects."
- "Read `@convex-dev/aggregate` README and extract the `DirectAggregate` + namespaced-sum recipe; give me a code sketch."
- "Find every test file touching `extractionBilled`; list which need updating and why."
- "Read these 5 files and explain the billing data flow end-to-end."
- "Research how screening's `creditsExhausted` propagates from worker → mutation → UI; give me a sequence diagram."
- Writing a fully-spec'd isolated module after its contract is locked.

### What to keep in the main session

- The TDD red → green → refactor cycle. Needs tight test-runner feedback.
- Commits. Main session owns discipline.
- Plan-file edits (deviations, updates).
- Final acceptance-criteria verification.
- Trivial one-shot lookups (faster to grep directly than spawn an agent).

### Parallelism

When spawning multiple subagents for **independent** questions, put them in a **single message with multiple Agent tool calls**. The harness runs them concurrently. Example: three independent research questions → one message, three parallel `Agent` tool calls.

### Prompting subagents

A subagent starts with **zero context**. Give it enough to succeed unattended:
- Repo root path (`/Users/mcharrad/Documents/Github/openalex-count`).
- What you've already tried / ruled out.
- Exact shape of the answer you want ("bulleted list, under 500 words, `file_path:line` citations").
- Clearly state whether it should write code or just research.

### When the session grows stale

If the main session accumulates many tool calls and you feel quality drifting, **pause, commit progress, write a one-paragraph state summary into the plan file or a commit message, then restart in a fresh `/clear`'d session** by pasting the plan's prompt from `PROMPTS.md`. The plan files are designed to be resumable from any acceptance-criteria checkpoint.

## Convex patterns referenced across plans

- `@convex-dev/workflow` v0.3.11 — `step.awaitEvent` + `sendEvent` for cooperative pause.
- `@convex-dev/workpool` v0.4.6 — `config.update({ maxParallelism: 0 })` as native pause.
- `@convex-dev/aggregate` — `DirectAggregate` with `Namespace = Id<"extractionJobs">` for per-job O(log n) sums.
- `ctx.scheduler.runAfter(0, internal.foo.continue, { cursor })` for self-rescheduling continuations (guidelines.md:245).

## Sources

- [Convex Workflow README](https://github.com/get-convex/workflow) — step.awaitEvent, restart-from-step semantics
- [Convex Workpool README](https://github.com/get-convex/workpool) — `maxParallelism: 0` as documented pause
- [Convex Aggregate README](https://github.com/get-convex/aggregate) — namespaced DirectAggregate, sumValue
- [Convex Action limits](https://docs.convex.dev/functions/actions) — 10-minute ceiling
- [Stack: Migrating Data with Mutations](https://stack.convex.dev/migrating-data-with-mutations) — self-reschedule recipe
- [Stack: Durable Workflows](https://stack.convex.dev/durable-workflows-and-strong-guarantees)
