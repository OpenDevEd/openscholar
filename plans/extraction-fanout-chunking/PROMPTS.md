# Extraction Fanout Chunking — Prompts

## 01 — Chunked fanout

```md
Plan file: plans/extraction-fanout-chunking/01-chunked-fanout.md
Context README: plans/extraction-fanout-chunking/00-README.md

This is a single-slice plan. No upstream dependencies. Expect 2–4 hours
of focused work. Long-running autonomous task — do not stop mid-plan
to ask for confirmation. When the plan is ambiguous, pick the option
most consistent with existing code patterns and document the choice
in the commit message.

STANDING RULES
1. DRY. Before writing anything, confirm the `chunk()` helper from
   `convex/extraction/batching.ts` is the closest analog. Reuse, do
   not duplicate.
2. No legacy. Do not preserve a non-chunked code path "just in case".
   This project carries no production data — every change is a clean
   replacement.
3. Convex guidelines override your training data. Re-read
   `convex/_generated/ai/guidelines.md` before editing anything in
   `convex/`. Camelcase file names only — no hyphens.
4. Tests assert on DB-side observable state (paper rows, scheduled
   functions, ledger rows). Do NOT assert on call counts of
   `workflow.start`. Do NOT assert on CSS / class strings (per CLAUDE.md).
5. Deployability gate is MANDATORY after every commit that touches
   `convex/`. Run `npx pm2 logs convex --lines 5 --nostream` and
   confirm `✔ Convex functions ready!`. A failing push is a blocker;
   no further commits until it recovers.
6. Research before guessing. If a Convex API behavior is uncertain,
   re-read `node_modules/@convex-dev/workflow/README.md` and
   `node_modules/@convex-dev/workflow/src/test.ts` rather than
   guessing — the answer is in the package.
7. Delegate to subagents for anything that would take >3 file reads
   or >3 greps. Use `Explore` for "where is X" and `general-purpose`
   for cross-library synthesis.

EXECUTION RHYTHM

Phase A — TDD red→green→commit per behavior, in this order:
   - R1 chunk slice processed
   - R2 scheduler chain to completion
   - R3 launch idempotency on retry
   - R4 resume invalidates prior-epoch launches
   - R5 pre-flight credit-exhaustion on first chunk
   - R6 pre-flight skipped when offset > 0
   - R7 reservation idempotency preserved
   - R8 terminal papers skipped

The implementation module is
`convex/extraction/mutations/internal/fanout.ts`. The test file is
`convex/extraction/mutations/internal/fanout.test.ts`. Workflow
registration helper is `convex/extraction/workflow.test-support.ts`.
Commit per green.

Phase B — schema/types/wireup, in this order:
   1. Add `paperWorkflowId` and `paperWorkflowEpoch` to
      `extractionPaperFields` in `convex/extraction/validators.ts`.
      Run `pnpm vitest run convex/extraction/mutations/internal/fanout.test.ts`
      to confirm the typed paper-row shape compiles.
   2. Re-read the resume call site
      (`convex/extraction/mutations/resume.ts:241`) and the workflow
      call site (`convex/extraction/workflow.ts:566`). Confirm
      `offset: 0` is implicit. No edit needed unless one of them
      asserts on a non-existent return field.
   3. Run the full `pnpm vitest run` once and confirm green.

Commit per logical unit.

COMMIT DISCIPLINE
   - Atomic. One concern per commit. Conventional-commit prefix.
     Scope every commit with `[fanout-chunking]`.
   - One commit per Phase A red→green cycle.
   - One commit per Phase B unit.
   - Never commit with tests red. Never use `--no-verify` or any
     hook-bypass flag.
   - DO NOT push to remote.
   - DO NOT commit unrelated working-tree changes. Stage by exact
     file path. The repo currently carries 90+ unrelated modified
     files from prior in-flight work — keep this plan's commits
     surgical.

WHEN TO STOP
   - All R1–R8 tests green.
   - `pnpm vitest run` full suite green.
   - `npx pm2 logs convex --lines 5 --nostream` shows
     `✔ Convex functions ready!` and no `✖ Error` after the final
     commit.
   - The acceptance test against the stuck job
     (`kd72vgc421hqnk8n54cecsyq3586prz5`) has been documented as the
     final step but requires explicit user authorization to invoke.

You may NOT stop for:
   - Ambiguity that is resolvable by re-reading the plan or the
     existing source.
   - Worry about token usage.
   - Impulse to "check with the user" — the autonomy contract above
     applies.

DEVIATIONS
   - If a required Convex API does not exist or behaves differently
     than the plan assumes, COMMIT in-progress work, write
     `plans/extraction-fanout-chunking/01-BLOCKER.md` describing the
     gap and stop. Do not improvise a workaround.
   - If the plan itself is wrong, edit the plan file under
     `docs: [fanout-chunking] revise <section> — <reason>` and commit
     the plan edit BEFORE the code change that depends on it.

START NOW
   1. Read `plans/extraction-fanout-chunking/00-README.md`.
   2. Read `plans/extraction-fanout-chunking/01-chunked-fanout.md`
      end-to-end.
   3. Read `convex/_generated/ai/guidelines.md` (top of file is
      enough — the rest is reference).
   4. `git status` — confirm `convex/extraction/mutations/internal/fanout.ts`
      is untracked and the 90+ unrelated modifications still exist.
      DO NOT touch them.
   5. `npx pm2 logs convex --lines 5 --nostream` — confirm the dev
      push is healthy at boot.
   6. Begin R1.

Go.
```
