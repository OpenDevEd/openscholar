# Copy-Paste Execution Prompts

One prompt per plan. Paste into a **fresh Claude Code session** (`/clear` first). Each is self-contained — the session does not need prior conversation context.

The prompts all share the same standing rules — copy only the one you want to execute.

> **Migration stance for every prompt:** Dev data is disposable. When a plan's schema change conflicts with existing rows, **wipe the affected table** via the Convex dashboard (or an admin helper mutation gated to dev). Do NOT write backfill scripts. Do NOT add compat shims. Do NOT keep old fields "just in case". See `00-README.md` § Migration stance.
>
> **Delegation policy for every prompt:** Delegate broadly to subagents to protect this session's context. Any investigation needing >3 file reads or >3 greps → spawn an Agent (`Explore` for codebase mapping, `general-purpose` for research). Batch independent subagents in a single message for parallelism. The main session owns the TDD cycle, commits, and plan-file edits; everything else is delegable. See `00-README.md` § Delegation policy.

---

## Prompt — Plan 01 (Bridge Table + Lifecycle)

```
You are executing plan 01 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/01-bridge-table-lifecycle.md
Context README: plans/chat-sources-toggle/00-README.md

This is a long-running autonomous task. Expect 4–8 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document your choice in the commit message.

STANDING RULES
1. DRY — the existing `deleteExtraction` cascade (convex/extraction/mutations/jobs.ts) and `duplicateJob` already have scheduler-chained batch patterns. Read them before writing yours. Extend; do not invent.
2. NO LEGACY — this project is pre-testing. Never keep old fields "just in case", never add compat shims.
3. CONVEX GUIDELINES OVERRIDE TRAINING — read convex/_generated/ai/guidelines.md before any Convex code. Re-read when uncertain.
4. TESTING DOCTRINE (CLAUDE.md) — assert on behavior, ARIA, data-*. Never CSS classes or Tailwind strings.
5. RESEARCH BEFORE GUESSING — use convex-* skills via Skill(find-skills) for any Convex patterns you're unsure of. Never hallucinate APIs.
6. DELEGATE — any investigation >3 file reads or >3 greps → spawn an Agent. Batch parallel research in one message.

Schema changes: dev data is disposable. If the validator rejects existing rows, wipe via Convex dashboard. No backfill scripts.

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  convex/chat/chatPapersSeed.ts  (R1–R5, commit per green)
  convex/chat/chatPapersDuplicate.ts  (R1–R6, commit per green)

Phase B (test-after — schema + seed + cascade + duplicate + backfill):
  1. Add chatPapers table + 4 indices to convex/schema.ts. Deploy.
  2. Wire seed hook in convex/chat/threads.ts::ensureThreadForJob (idempotent).
  3. Extend deleteExtraction cascade for chatPapers (match existing pattern).
  4. Extend duplicateJob to clone chatPapers for chat-mode jobs only.
  5. Add dev-only backfillChatPapersForExistingChats internal mutation; run it once from dashboard.
  6. Write Convex integration tests (§ Test plan). Commit per unit.

COMMIT DISCIPLINE
- Conventional-commit prefix: feat, fix, refactor, test, chore, docs.
- Scope every commit with [plan-01].
- Never commit if tests are red.
- Never use --no-verify.
- Do not push to remote.

WHEN TO STOP
Stop ONLY when every acceptance-criterion checkbox in the plan file is satisfied AND all tests are green AND the backfill has been run on the dev deployment. Write a one-paragraph summary of what landed.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, an impulse to "check with the user".

If you hit a real blocker, commit progress, write plans/chat-sources-toggle/01-BLOCKER.md, and stop.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit progress first.
2. Edit 01-bridge-table-lifecycle.md with the new approach and rationale.
3. Commit: "docs: [plan-01] revise <section> — <reason>".
4. Proceed.

START NOW
1. Read plans/chat-sources-toggle/01-bridge-table-lifecycle.md in full.
2. Read plans/chat-sources-toggle/00-README.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run git status. If dirty with unrelated changes, tell the user and stop. Otherwise proceed.
5. Begin R1 of the first TDD sequence.

Go.
```

---

## Prompt — Plan 02 (Prompt Filter + Send Guard)

```
You are executing plan 02 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/02-prompt-filter-and-send-guard.md
Context README: plans/chat-sources-toggle/00-README.md
Depends on plan 01 being merged (chatPapers table must exist).

Expect 3–6 hours. Long-running autonomous task.

STANDING RULES — identical to plan 01's prompt. Copy-paste from above; replace [plan-01] → [plan-02].

Additional reading before starting:
- convex/chat/context.ts (buildSystemPromptForJob)
- convex/chat/messages.ts (sendMessage)
- lib/chat/render-corpus.ts (current positional ID implementation — understand the "array-index ID generation" bug before refactoring).

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  lib/chat/render-corpus.ts::filterAndPreservePositions (R1–R11, commit per green).

Phase B (test-after):
  1. Refactor renderPaperCorpus to consume CorpusSourceForPrompt[] with stable promptId "P${position}" (NOT array index).
  2. Update buildSystemPromptForJob in convex/chat/context.ts — join chatPapers, filter included, sort by position.
  3. Add system-prompt rule in convex/chat/agent.ts warning the LLM about positional gaps.
  4. Add sendMessage guard in convex/chat/messages.ts rejecting zero-included with ConvexError({code:"no_sources_included"}).
  5. Locale keys for the prompt rule across all 6 messages/*.json.
  6. Convex tests per § Test plan.

COMMIT DISCIPLINE — identical to plan 01. Scope [plan-02].

WHEN TO STOP — identical to plan 01.

START NOW
1. Read plan 02 in full.
2. Read 00-README.md.
3. Read convex/_generated/ai/guidelines.md.
4. Run git status.
5. Begin TDD R1 for filterAndPreservePositions.

Go.
```

---

## Prompt — Plan 03 (Toggle Mutations + List-With-Inclusion Query)

```
You are executing plan 03 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/03-toggle-mutations-queries.md
Context README: plans/chat-sources-toggle/00-README.md
Depends on plan 01 (chatPapers table). Can parallelize with plan 02.

Expect 4–7 hours. Long-running autonomous task.

STANDING RULES — identical to plan 01's prompt. Scope [plan-03].

Additional standing rule:
7. AUTH REUSE — before writing assertCallerOwnsJob, grep for existing ownership-check patterns in convex/chat/*.ts. If one exists inline, extract it to convex/chat/auth.ts as a refactor commit BEFORE any feature work. One auth helper, many consumers.

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  lib/chat/chat-papers-selection.ts  (R1–R10, commit per green)
  lib/chat/source-type.ts  (R1–R7, commit per green)

Phase B (test-after):
  1. Extract/confirm assertCallerOwnsJob helper.
  2. Build listChatSourcesWithInclusion query in convex/chat/chatPapers.ts.
  3. Build toggleChatPaper mutation (idempotent, auth-checked).
  4. Build bulkSetChatPapers mutation (all-for-job and subset modes).
  5. Convex integration tests per § Test plan.

COMMIT DISCIPLINE — identical to plan 01. Scope [plan-03].

WHEN TO STOP — identical to plan 01.

START NOW
1. Read plan 03 in full.
2. Read 00-README.md.
3. Read convex/_generated/ai/guidelines.md.
4. Grep for existing auth-helper patterns in convex/chat/*.ts and summarize.
5. Begin TDD R1.

Go.
```

---

## Prompt — Plan 04 (Sources Panel UI + Composer Integration)

```
You are executing plan 04 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/04-sources-panel-ui.md
Context README: plans/chat-sources-toggle/00-README.md
Depends on plans 01, 02, 03 being merged. This is the largest plan in the set.

Expect 12–20 hours. Long-running autonomous task. Consider pausing mid-plan to commit progress, write a one-paragraph state note into the plan file, and resume in a fresh /clear'd session.

STANDING RULES — identical to plan 01's prompt. Scope [plan-04].

Additional rules for this plan:
8. REUSE THE SELECTABLE-LIST PRIMITIVE — components/extraction/bucket/selectable-list.tsx already has shift-click range, indeterminate checkbox, and "select across pages" banner. Adapt it in an adapter layer; DO NOT rewrite.
9. REUSE CMDK — it's installed (v1.1.1). Use its `filter` prop with the weighted scorer; do not install Fuse.js.
10. REUSE NUQS — components/extraction/source-selector.tsx already uses nuqs for URL state. Match that pattern.
11. REUSE OPTIMISTIC PATTERN — components/extraction/chat/sources-panel/sources-panel.tsx has the `.withOptimisticUpdate` template. Copy the shape.

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  lib/chat/search/source-scorer.ts  (R1–R14)
  lib/chat/search/match-snippet.ts  (R1–R10)
  lib/chat/sort/source-comparators.ts  (R1–R8)
  lib/chat/source-chips.ts  (R1–R5)
  Commit per green for each.

Phase B (test-after — components, URL state, keyboard, mobile, composer, i18n):
  Suggested order:
  1. Delete papers-in-context-sidebar.tsx (grep importers first; redirect at the same commit).
  2. Create sources-panel directory skeleton with all sub-components as stubs.
  3. Wire the state hook (use-sources-panel-state.ts) with nuqs.
  4. Implement source-row.tsx with data-* attributes. Behavior test.
  5. Implement sources-panel-list.tsx using SelectableList primitive + optimistic toggle.
  6. Implement toolbar (search + sort pills + bulk bar).
  7. Implement chips with counts.
  8. Implement the extension banner.
  9. Implement the keyboard hook and wire.
  10. Implement the mobile Sheet wrapper.
  11. Wire composer: live-hint, empty banner, disabled send.
  12. Locale keys — en-US first, then all 5 siblings.
  13. Axe run on the rendered panel.
  Commit per logical unit.

COMMIT DISCIPLINE — identical to plan 01. Scope [plan-04].

WHEN TO STOP — identical to plan 01. All 20+ acceptance-criteria boxes filled; all behavior tests green; axe reports 0 violations on the panel.

If the session grows stale mid-plan: commit progress, write a one-paragraph resume-note at the bottom of the plan file, stop. The next session starts fresh from this prompt.

START NOW
1. Read plan 04 in full.
2. Read 00-README.md.
3. Delegate to an Explore agent: "Map all importers of papers-in-context-sidebar.tsx; identify the chat-composer component path; identify the chat-page-header component path." Await result.
4. Run git status.
5. Begin TDD R1 for source-scorer.

Go.
```

---

## Prompt — Plan 05 (Citation Pill Tri-State)

```
You are executing plan 05 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/05-citation-tri-state.md
Context README: plans/chat-sources-toggle/00-README.md
Depends on plans 02 (prompt uses P${position}) and 03 (list query). Can ship after plan 04 or in parallel with its polish tail.

Expect 3–5 hours.

STANDING RULES — identical to plan 01's prompt. Scope [plan-05].

Additional rule:
8. REUSE applyInclusionPatch from plan 03's lib/chat/chat-papers-selection.ts for the re-include mutation's optimistic handler. Do not re-implement.

EXECUTION RHYTHM
Phase A (TDD — pure logic only):
  lib/chat/citation-state.ts  (R1–R4)
  lib/chat/resolve-paper.ts  (R1–R8, refactor from array-index to position-based)
  Commit per green.

Phase B (test-after):
  1. Extend ResolvablePaper type with `included: boolean`.
  2. Refactor paper-citation.tsx: data-citation-state attribute, tri-state styling, re-include hover action.
  3. Swap message-list.tsx from getJobSources → listChatSourcesWithInclusion.
  4. Add citation.reincludeForFutureTurns key across all locales.
  5. Behavior tests for pill state + re-include action.

COMMIT DISCIPLINE — identical to plan 01. Scope [plan-05].

WHEN TO STOP
All acceptance criteria met. Critical: `rg -n "papers\[\s*.+-\s*1\s*\]" lib/chat/` must return zero matches (no legacy array-index resolution surviving).

START NOW
1. Read plan 05 in full.
2. Read 00-README.md.
3. Read the current lib/chat/resolve-paper.ts and components/extraction/chat/paper-citation.tsx.
4. Begin TDD R1 for citation-state.

Go.
```

---

## Prompt — Plan 06 (Motion, A11y, E2E, Perf)

```
You are executing plan 06 of the chat-sources-toggle effort for the openalex-count project.
Plan file: plans/chat-sources-toggle/06-polish-and-tests.md
Context README: plans/chat-sources-toggle/00-README.md
Depends on plans 01–05 being merged. This is the final gate before shipping.

Expect 6–10 hours.

STANDING RULES — identical to plan 01's prompt. Scope [plan-06].

No schema or Convex-function changes in this plan. Test, measure, polish only.

EXECUTION RHYTHM
No Phase A TDD — this plan has no new pure-logic modules. Proceed directly to test-after on the following:

1. Motion wrappers with framer-motion's useReducedMotion gate; data-motion-disabled attribute.
2. Axe tests for Sources panel, citation pill, composer empty-state.
3. Keyboard-only Playwright test.
4. The 6 golden-path + 4 critical-edge E2E scenarios.
5. Perf seed helper (convex/chat/adminPerfSeed.ts, dev-gated).
6. Run perf measurements at 500 rows. Record in .perf/chat-sources-toggle.md.
7. Virtualization decision — install @tanstack/react-virtual ONLY if measured thresholds fail. Record the decision either way.
8. Color-contrast measurement for excluded row + pill.
9. Manual SR trace on VoiceOver + NVDA — record in .a11y/chat-sources-toggle-trace.md.
10. Fill the § Final acceptance matrix table.

Commit per logical unit.

COMMIT DISCIPLINE — identical to plan 01. Scope [plan-06].

WHEN TO STOP
Every row in the final acceptance matrix points to a real test that's passing in CI. All axe runs are clean. Perf numbers are recorded and within threshold (or P7 follow-up is scoped in writing).

Do not install virtualization unless measurement requires it. Do not pad the plan with extra features. This is the ship gate.

START NOW
1. Read plan 06 in full.
2. Read 00-README.md.
3. Confirm plans 01–05 are merged to dev (git log).
4. Begin with motion wrappers — gate with useReducedMotion, add data-motion-disabled, commit.

Go.
```

---

## Using these prompts

The plans are designed to be **resumable**. If a session runs long or context drifts:

1. Commit all progress. Ensure tests are green.
2. At the bottom of the plan file, append a short "Resume state" note: "Phase A green; Phase B started at step 3 (line-X in file-Y)."
3. Commit the plan-file edit.
4. `/clear` the session.
5. Paste the plan's prompt again. The new session reads the plan file, sees the Resume state note, picks up at step 3.

The planning-artifact lives in `git`, so every plan state is recoverable.
