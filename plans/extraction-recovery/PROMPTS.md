# Copy-Paste Execution Prompts

One prompt per plan. Paste into a **fresh Claude Code session** (`/clear` first). Each is self-contained — the session does not need prior conversation context.

The prompts all share the same standing rules — copy only the one you want to execute.

> **Migration stance for every prompt:** Dev data is disposable. When a plan's schema change conflicts with existing rows, **wipe the affected table** via the Convex dashboard (or an admin helper mutation gated to dev). Do NOT write backfill scripts. Do NOT add compat shims. Do NOT keep old fields "just in case". See `00-README.md` § Migration stance.
>
> **Delegation policy for every prompt:** Delegate broadly to subagents to protect this session's context. Any investigation needing >3 file reads or >3 greps → spawn an Agent (`Explore` for codebase mapping, `general-purpose` for research). Batch independent subagents in a single message for parallelism. The main session owns the TDD cycle, commits, and plan-file edits; everything else is delegable. See `00-README.md` § Delegation policy.

---

## Prompt — Plan 01 (Error Taxonomy)

```
You are executing plan 01 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/01-error-taxonomy.md
Context README: plans/extraction-recovery/00-README.md

This is a long-running, autonomous task. Expect 6–10 hours of continuous work. Do not stop mid-plan to ask me for confirmation. Do not ask whether to proceed. Use your judgment; when the plan is ambiguous, pick the option most consistent with existing code patterns and document your choice in the commit message.

STANDING RULES
1. DRY — search the codebase first. Primary donors: convex/screening/**, convex/extraction/aggregates.ts, the in-flight chat error keys in messages/en-US.json (uncommitted on dev).
2. NO LEGACY — this project is pre-testing. Do not add backward-compat shims, feature flags, or deprecation paths. Delete old code cleanly. Break schemas freely; write a migration.
3. CONVEX GUIDELINES OVERRIDE TRAINING — before writing any Convex code, read convex/_generated/ai/guidelines.md. Re-read when uncertain.
4. TESTING DOCTRINE (project CLAUDE.md) — assert on behavior, ARIA roles, data-* attributes. Never assert on CSS classes or Tailwind strings.
5. RESEARCH BEFORE GUESSING — when uncertain about any Convex API, use the Skill tool for convex skills or WebFetch https://docs.convex.dev. Use Skill(find-skills) if you suspect a skill exists. Never hallucinate APIs.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
Phase A (TDD, pure logic only — lib/errors/taxonomy.ts):
  Follow the plan's "TDD sequence" section verbatim. For every Red → Green cycle:
    1. Write the failing test (one behavior at a time).
    2. Run it. Confirm it fails for the right reason.
    3. Implement the minimum to pass.
    4. Run ALL tests.
    5. Refactor if needed.
    6. COMMIT. One commit per green. Message: "test: [plan-01] <behavior> + impl" or split test/impl into two commits if tidier.

Phase B (test-after, Convex + translations + schema migration + UI):
  For each logical unit in the plan's "Files touched" list:
    1. Implement.
    2. Write behavior tests (per plan's Test plan section).
    3. Run tests.
    4. COMMIT. Atomic, one concern per commit.

COMMIT DISCIPLINE
- Conventional-commit prefix: feat, fix, refactor, test, chore, docs.
- Scope every commit with [plan-01].
- Never commit if tests are red (unless labeled wip: and you're about to fix it in the next commit).
- NEVER use --no-verify. If a pre-commit hook fails, fix the underlying issue.
- Do not push to remote. I will push when ready.

WHEN TO STOP
You may stop ONLY when every acceptance criterion checkbox in the plan file is satisfied AND all tests are green AND the final commit is made. Then write a one-paragraph summary of what landed and stop.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, worry about length of session, an impulse to "check with the user".

If you hit a real blocker (a required API truly does not exist, a pre-existing bug prevents progress), commit all progress first, write plans/extraction-recovery/01-BLOCKER.md describing what is stuck and what you tried, then stop.

DEVIATIONS FROM PLAN
If the plan is wrong or incomplete and you find a better way:
1. Commit progress first.
2. Edit 01-error-taxonomy.md to reflect the new approach with a rationale.
3. Commit that edit: "docs: [plan-01] revise <section> — <reason>".
4. Proceed with the revised plan.

START NOW
1. Read plans/extraction-recovery/01-error-taxonomy.md (full file).
2. Read plans/extraction-recovery/00-README.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run git status. If dirty with unrelated changes, tell me and stop. If clean or only plan-01 work, proceed.
5. Begin R1 of the TDD sequence.

Go.
```

---

## Prompt — Plan 02 (Per-Question Decomposition)

```
You are executing plan 02 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/02-per-question-decomposition.md
Depends on plan 01 being merged (error taxonomy types are imported by this plan).

This is a long-running, autonomous task. Expect 8–14 hours of continuous work. Do not stop mid-plan to ask me for confirmation. Use your judgment; when the plan is ambiguous, pick the option most consistent with existing code patterns and document your choice in the commit message.

STANDING RULES
1. DRY — reuse convex/extraction/workpoolActions.ts patterns, the existing workflow shape in convex/extraction/workflow.ts, and the @convex-dev/workflow step.runAction semantics. Do not invent new orchestration; extend what is there.
2. NO LEGACY — delete extractionPapers.extractionBilled once migrated. Do not leave behind any "old code path" branches.
3. CONVEX GUIDELINES OVERRIDE TRAINING — convex/_generated/ai/guidelines.md is mandatory reading before writing any Convex code.
4. TESTING DOCTRINE — behavior, ARIA, data-*. Never CSS classes.
5. RESEARCH BEFORE GUESSING — Convex Workflow docs: https://github.com/get-convex/workflow. The README in node_modules/@convex-dev/workflow/README.md is also authoritative. Read both before restructuring the workflow.

Schema changes: dev data is disposable. Wipe in-flight extraction tables via the Convex dashboard when the validator rejects old rows. Do not write a backfill script. Do not keep extractionBilled as optional.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
Phase A (TDD, pure logic only — lib/extraction/paper-status.ts):
  Follow the plan's "TDD sequence" section (7 reds). Red → Green → Commit per cycle.

Phase B (test-after, workflow restructure + action split + mutation refactor + migration):
  Order of execution matters here:
  1. Schema change (extractionResults.billed, .attemptCount, .lastError). Wipe any existing in-flight rows via Convex dashboard; no backfill.
  2. Split waitAndExtractAction → extractOneQuestion. Port per-question idempotency gate. Test.
  3. Split saveExtractionResultsAndComplete → recordOneAnswer + finalizePaper. Test billing idempotency.
  4. Restructure workflow.ts enqueue loop to fan out per (paper, question). Test with a 3-paper × 5-Q seeded job.
  5. Delete old extractionBilled field + any dead code paths.
  Commit after each numbered step.

COMMIT DISCIPLINE
- [plan-02] scope on every commit.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Stop only when every acceptance criterion is green AND existing tests pass (including billing-idempotency.test.ts — which MUST continue to pass through the migration).

Blocker protocol: commit progress → write 02-BLOCKER.md → stop.

Deviation protocol: commit progress → edit the plan with rationale → commit the plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/02-per-question-decomposition.md fully.
2. Read plans/extraction-recovery/00-README.md and 01-error-taxonomy.md (the taxonomy you depend on).
3. Read convex/_generated/ai/guidelines.md.
4. Read node_modules/@convex-dev/workflow/README.md (at least lines around step.runAction, step.runMutation, workflow history size limits).
5. Read convex/extraction/workflow.ts, convex/extraction/workpoolActions.ts, convex/extraction/mutations/results.ts end-to-end before touching anything.
6. Run git status. Confirm plan-01 is merged (grep for lib/errors/taxonomy.ts).
7. Begin R1 of the TDD sequence.

Go.
```

---

## Prompt — Plan 03 (Pre-flight + creditsExhausted)

```
You are executing plan 03 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/03-preflight-and-creditsExhausted.md
Depends on plan 01 (error taxonomy). Plan 02 is NOT required — this plan uses paper-level billing if 02 has not landed.

This is a long-running, autonomous task. Expect 6–10 hours. Do not stop to ask for confirmation. Pick sensible defaults; document in commits.

STANDING RULES
1. DRY — the pre-flight check, creditsExhausted status, UI balance display, and Buy Credits CTA all exist in convex/screening/** and components/screening/**. REUSE those patterns; do not reinvent. Cite screening file paths in commit messages when porting.
2. NO LEGACY — remove any TODO or legacy "check later" comments in startJob. Ship the real check.
3. CONVEX GUIDELINES OVERRIDE TRAINING — read convex/_generated/ai/guidelines.md, especially the state-machine transition section.
4. TESTING DOCTRINE — behavior, ARIA, data-*. Preflight banner gets role="status" + data-preflight-ok.
5. RESEARCH BEFORE GUESSING — cost constants for the estimator must be calibrated, not invented. Read convex/credits/** to understand how current extraction billing actually charges, then derive constants from a sample of creditTransactions if possible. If calibration data is insufficient, pick conservative over-estimates and commit a note: "chore: [plan-03] TODO re-calibrate cost constants once we have 30 days of data".

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
Phase A (TDD, pure logic — lib/extraction/cost-estimate.ts):
  Follow the TDD sequence (9 reds). Commit per green.

Phase B (test-after):
  1. Schema: add creditsExhausted + paused to extractionJobs.status union; add estimatedCredits field. Add state-machine transitions. Test with existing state-machine tests.
  2. Pre-flight check in startJob. Test with convex-test (insufficient → throw, sufficient → proceed).
  3. Mid-run detection in extractOneQuestion (or waitAndExtractAction pre-plan-02). Test with mocked deductCredits throwing insufficient.
  4. Preflight banner component. Behavior test (sufficient vs insufficient, Buy Credits button routing).
  5. In-job creditsExhausted banner on job detail page.
  6. Translations (all 6 locales).
  Commit per step.

COMMIT DISCIPLINE
- [plan-03] scope.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Every acceptance criterion satisfied; tests green; final commit made.

Blocker protocol: commit → 03-BLOCKER.md → stop.
Deviation protocol: commit → edit plan → commit plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/03-preflight-and-creditsExhausted.md fully.
2. Read convex/screening/mutations.ts (the pre-flight check), convex/screening/workpoolActions.ts (the exhaustion detection), and components/screening/screening-dialog.tsx (the balance-check UI). These are the donors.
3. Read convex/_generated/ai/guidelines.md.
4. Read convex/extraction/stateMachine.ts and convex/extraction/mutations/jobs.ts fully.
5. git status clean or only plan-03 work.
6. Begin R1 of the TDD sequence.

Go.
```

---

## Prompt — Plan 04 (Credit Aggregation)

```
You are executing plan 04 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/04-credit-aggregation.md
Depends on plan 01 (taxonomy). Independent of plans 02, 03, 05, 06, 07.

This is a long-running, autonomous task. Expect 5–8 hours. Do not stop to ask for confirmation.

STANDING RULES
1. DRY — the codebase already uses @convex-dev/aggregate with three instances (resultStatusAgg, resultAnsweredAgg, resultConfidenceAgg) in convex/extraction/aggregates.ts. Study that file before adding the fourth. Mirror the exact pattern.
2. NO LEGACY — when you promote jobId/paperId off creditTransactions.metadata, delete those metadata keys entirely. Do not keep both.
3. CONVEX GUIDELINES OVERRIDE TRAINING — especially the "Do not store unbounded lists" and "Never use .collect().length to count rows" rules in convex/_generated/ai/guidelines.md.
4. TESTING DOCTRINE — behavior, ARIA, data-credits-total attribute on CostBadge.
5. RESEARCH BEFORE GUESSING — Convex Aggregate docs: https://github.com/get-convex/aggregate. Read the README especially the "Namespacing" and "Direct vs Table" sections before writing anything.

This plan has no pure-logic TDD. All work is test-after, but DO follow the sequence below.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
1. Register aggregate in convex.config.ts.
2. Instantiate creditsAgg in convex/extraction/aggregates.ts with helpers (recordCreditSpend, clearJobCredits).
3. Call recordCreditSpend from saveExtractionResultsAndComplete (pre-plan-02) or recordOneAnswer (post-plan-02) inside the same txn.
4. Promote jobId / paperId / billingType to first-class columns on creditTransactions; add by_job index.
5. Wipe creditTransactions via Convex dashboard (dev data is disposable — see PROMPTS.md top banner). No backfill script.
6. getJobCost query + sumByBillingType breakdown.
7. CostBadge component with data-credits-total attr.
8. Results table credits column (column-visibility toggled).
9. Completion toast on job detail page.
10. Billing-page ?jobId= filter support.
11. Clear creditsAgg on deleteExtraction cascade.
Commit per step.

For each unit: implement, write behavior test, run tests, commit.

COMMIT DISCIPLINE
- [plan-04] scope.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Every acceptance criterion satisfied; tests green; getJobCost O(log n) verified with a seeded 500-paper job.

Blocker protocol: commit → 04-BLOCKER.md → stop.
Deviation protocol: commit → edit plan → commit plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/04-credit-aggregation.md fully.
2. Read convex/extraction/aggregates.ts end-to-end — this is your template.
3. Read convex/convex.config.ts.
4. Read convex/credits/internal.ts focusing on deductCredits.
5. Read convex/schema.ts creditTransactions definition.
6. Read https://github.com/get-convex/aggregate/blob/main/README.md via WebFetch.
7. Begin step 1.

Go.
```

---

## Prompt — Plan 05 (Retry Failed Papers)

```
You are executing plan 05 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/05-retry-failed-papers.md
Depends on plan 01 (taxonomy + isRetryable) and plan 02 (per-question granularity). If 02 has not landed, retry operates at paper level with reduced precision — coordinate with me before starting if that's the case.

This is a long-running, autonomous task. Expect 6–9 hours. Do not stop to ask for confirmation.

STANDING RULES
1. DRY — retry UI mirrors screening's "Duplicate + mark incomplete" pattern shape (see components/screening/screening-job-history.tsx for the incomplete-warning pattern). Reuse the preflight banner from plan 03 for the retry confirmation dialog.
2. NO LEGACY — duplicateJob (convex/extraction/mutations/jobs.ts:182-277) stays as-is for now; it's a different use case. Do not conflate.
3. CONVEX GUIDELINES OVERRIDE TRAINING.
4. TESTING DOCTRINE — data-retryable-count, data-permanent-count on the RetrySummary component.
5. RESEARCH BEFORE GUESSING — if plan 06 has landed, retry piggybacks on the sendEvent mechanism (see plan 05's "Integration with plan 06" section). If plan 06 has not landed, implement runRetryWorkflow as a separate workflow. Detect which path you're on by grepping for sendEvent in convex/extraction/**.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
Phase A (TDD, pure logic — lib/extraction/retry-summary.ts):
  Follow TDD sequence (9 reds). Commit per green. This module MUST import isRetryable from plan 01's taxonomy — do not duplicate the table.

Phase B (test-after):
  1. getRetryableSummary query. Test with seeded mixed-failure job.
  2. retryFailedQuestions mutation with auth + status precondition checks + preflight credit check. Test.
  3. Workflow integration: sendEvent path OR runRetryWorkflow depending on plan 06 status. Test with a full resume cycle.
  4. RetrySummary UI component + data attrs. Test.
  5. RetryConfirmDialog with estimate (reuses preflight banner from plan 03). Test.
  6. Per-code permanent-failures callout with localized labels. Test.
  7. Translations.
  Commit per step.

COMMIT DISCIPLINE
- [plan-05] scope.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Every acceptance criterion satisfied; a full retry cycle (cancel → topup → retry → complete) proven end-to-end with no double-billing; tests green.

Blocker protocol: commit → 05-BLOCKER.md → stop.
Deviation protocol: commit → edit plan → commit plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/05-retry-failed-papers.md fully.
2. Read plans/extraction-recovery/01-error-taxonomy.md — specifically isRetryable.
3. Verify plan 02 status: grep -r "extractOneQuestion" convex/extraction/. If present, plan-02 landed.
4. Verify plan 06 status: grep -r "sendEvent" convex/extraction/. If present, plan-06 landed.
5. Based on 3 and 4, choose the Phase B integration path.
6. Begin R1 of the TDD sequence.

Go.
```

---

## Prompt — Plan 06 (Pause/Resume)

```
You are executing plan 06 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/06-pause-resume.md
Depends on plan 01, plan 02, plan 03. All three must be merged before starting.

This is a long-running, autonomous task. Expect 8–12 hours. Do not stop to ask for confirmation.

STANDING RULES
1. DRY — reuse screening's cancellation UI pattern for the Pause button (components/screening/screening-dialog.tsx and screening-job-history.tsx). Reuse plan 03's creditsExhausted banner shell for the paused banner (shared component: JobStatusBanner).
2. NO LEGACY — pool-level pause was explicitly rejected. Do not add components.pdfProcessingPool.config.update anywhere. The decision is documented in the plan; honor it.
3. CONVEX GUIDELINES OVERRIDE TRAINING — state-machine transitions must be funneled through typed helpers.
4. TESTING DOCTRINE — role="status" + aria-live="polite" on the paused banner, data-job-status on container.
5. RESEARCH BEFORE GUESSING — Convex Workflow awaitEvent/sendEvent docs: https://github.com/get-convex/workflow. Read the README section on "Events" carefully. Also read node_modules/@convex-dev/workflow/README.md for up-to-date semantics.

The subtle design bit: workflow-gate only, NOT pool-pause. Read plan 06's "Approach" section twice before writing any code.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
Phase A (TDD, pure logic — lib/extraction/transitions.ts):
  Follow TDD sequence (12 reds across validatePauseTransition + validateResumeTransition). Commit per green.

Phase B (test-after):
  1. Schema additions (pausedAt, pausedFromStatus). Migration trivial.
  2. stateMachine.ts transition additions + test.
  3. pauseExtraction mutation. Test idempotency.
  4. resumeExtraction mutation with credit pre-flight (for creditsExhausted path). Test both paths.
  5. Workflow gate: step.awaitEvent between enqueue batches. Test with a paused-mid-flight scenario.
  6. extractOneQuestion skip-guard. Test with a queued-before-pause question.
  7. JobStatusBanner component (paused + creditsExhausted share it). Test ARIA + data-job-status.
  8. Pause/Resume buttons in job detail page header. Test click → mutation.
  9. Translations.
  10. PostHog events.
  Commit per step.

COMMIT DISCIPLINE
- [plan-06] scope.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Every acceptance criterion satisfied. End-to-end proof: seed a 20-paper × 3-Q job, pause after 10 papers, verify no further billing, resume, verify remainder bills correctly. Tests green.

Blocker protocol: commit → 06-BLOCKER.md → stop.
Deviation protocol: commit → edit plan → commit plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/06-pause-resume.md fully.
2. Read plans/extraction-recovery/01, 02, 03 README (for dependencies).
3. Verify plans 01, 02, 03 are merged (grep for lib/errors/taxonomy.ts, extractOneQuestion, creditsExhausted status).
4. Read node_modules/@convex-dev/workflow/README.md focusing on step.awaitEvent + sendEvent.
5. Read convex/extraction/workflow.ts current shape.
6. Begin R1 of the TDD sequence.

Go.
```

---

## Prompt — Plan 07 (Observability Polish)

```
You are executing plan 07 of the extraction-recovery effort for the openalex-count project.
Plan file: plans/extraction-recovery/07-observability-polish.md
Depends on plan 01 (taxonomy + extractionPaperErrors table), plan 02 (per-question state), plan 06 (paused + creditsExhausted banners exist). All three must be merged.

This is a long-running, autonomous task. Expect 5–8 hours. Do not stop to ask for confirmation.

STANDING RULES
1. DRY — reuse existing pagination patterns from convex/extraction/queries/**. Reuse the CostBadge from plan 04 as the visual template for the now-processing banner.
2. NO LEGACY — when you add index by_job_status, remove any .filter()-based queries that were doing this job the slow way.
3. CONVEX GUIDELINES OVERRIDE TRAINING — especially the "Do NOT use filter; use withIndex" rule.
4. TESTING DOCTRINE — this plan is UI-heavy. data-*, role, aria-* assertions only. Never className assertions. Any component you touch must gain at minimum aria-label and a data-* attr expressing its semantic state.
5. RESEARCH BEFORE GUESSING — accessibility: https://www.w3.org/WAI/ARIA/apg/patterns/ for role and aria-live patterns. shadcn/Radix: https://ui.shadcn.com/docs/components for expandable panels.

6. DELEGATE TO SUBAGENTS — protect this session's context from rot. Any investigation needing >3 file reads or >3 greps, spawn an Agent (subagent_type "Explore" for codebase mapping, "general-purpose" for web research / multi-step synthesis). Batch independent subagents into a SINGLE message for parallelism. Main session owns: TDD cycle, commits, plan-file edits, final verification. Subagents own: exploration, research, multi-file synthesis, reading READMEs. See 00-README.md § Delegation policy for the full rule.

EXECUTION RHYTHM
No TDD phase for most of this plan — UI and queries. One pure-logic piece at the top:

Phase A (TDD — lib/extraction/failures-summary.ts):
  Follow TDD sequence (8 reds). Commit per green.

Phase B (test-after):
  1. Add extractionResults.by_job_status index (if not present). Run convex dev to confirm index.
  2. getNowProcessing query. Test with 0, 1, 3 in-flight.
  3. listPaperErrors paginated query. Test pagination ordering.
  4. getMixedSuccessSummary query. Test grouping.
  5. NowProcessing component with data-now-processing-paper + role="status" + aria-live="polite". Test.
  6. PaperQuestionProgress component (inline in results table row). Test data-paper-status + data-question-progress.
  7. ErrorHistory expandable panel. Test expansion + ordering.
  8. MixedSuccessSummary callout. Test.
  9. Update JobListItem status dot with aria-label.
  10. Update progress bar with role="progressbar" + aria-valuenow/min/max.
  11. Translations for all new strings.
  12. Playwright e2e: live progress banner updates during a seeded run.
  Commit per step.

COMMIT DISCIPLINE
- [plan-07] scope.
- Never commit red tests.
- Never use --no-verify.
- Do not push.

WHEN TO STOP
Every acceptance criterion satisfied. Accessibility smoke: a screen-reader (VoiceOver) walkthrough of the job detail page announces status transitions — if you cannot verify this yourself, add the aria attributes the plan specifies and trust the tests.

Blocker protocol: commit → 07-BLOCKER.md → stop.
Deviation protocol: commit → edit plan → commit plan edit → proceed.

START NOW
1. Read plans/extraction-recovery/07-observability-polish.md fully.
2. Read plans/extraction-recovery/01, 02, 06 (dependencies).
3. Verify prerequisite plans merged (grep extractionPaperErrors, extractOneQuestion, pauseExtraction).
4. Read convex/extraction/queries/** (pagination patterns).
5. Begin R1 of the TDD sequence.

Go.
```

---

## How to use

1. Finish the plan you're working on (merge to dev).
2. `/clear` in Claude Code.
3. Paste the next plan's prompt block.
4. Step back. Come back to review commits at a natural checkpoint.

If the session hits a `0X-BLOCKER.md`, that's my signal to come back and unblock.
