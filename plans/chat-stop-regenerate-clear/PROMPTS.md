# Copy-Paste Execution Prompts

One fenced prompt per numbered plan. Each prompt is self-contained and assumes a fresh session.

```md
Plan file: plans/chat-stop-regenerate-clear/01-stop-runtime-contract.md
Context README: plans/chat-stop-regenerate-clear/00-README.md

Long-running autonomous task. Expect 1-3 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `convex/chat/messages.ts`, `lib/chat/abort-poller.ts`, `lib/chat/abort-signal.ts`, `convex/chat/messages.test.ts`, and the prior donor plan set under `plans/chat-stop-streaming/`.
2. No legacy: this repo is pre-testing. Do not add compatibility paths or preserve broken stop semantics.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` before touching Convex code.
4. Testing doctrine: assert on behavior, ARIA, and `data-*`. Never on CSS classes.
5. Zero type errors is non-negotiable. If Convex/TypeScript/Next compilation is red, the task is not complete and the app is still effectively on old behavior.
6. Research before guessing: if unsure about `@convex-dev/agent` abort semantics, read the actual node_modules source and the docs cited in the README.
7. Delegate to subagents for any bounded investigation needing more than ~3 file reads or greps.

EXECUTION RHYTHM
Phase A: TDD the pure stop-poller behavior first. Strengthen once-only / cleanup invariants before touching the action. Commit per green.
Phase B:
1. Update the action-side stop runtime contract in `convex/chat/messages.ts`.
2. Add / update Convex integration tests for singular aborted-turn behavior and cleanup.
3. Run the affected chat test slice.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-01]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria in the plan file are satisfied, the relevant tests are green, and Convex compilation is green for touched backend files.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or a desire to check in with the user.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-01] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-stop-regenerate-clear/00-README.md`.
2. Read this plan file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status`.
5. Begin the first red test for the stop-poller / stop-runtime contract.

Go.
```

```md
Plan file: plans/chat-stop-regenerate-clear/02-regenerate-and-clear-artifacts.md
Context README: plans/chat-stop-regenerate-clear/00-README.md
Depends on plan 01 being merged.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with existing chat turn ordering and document it in the commit message.

STANDING RULES
1. DRY with named donors: `convex/chat/messages.ts`, `node_modules/@convex-dev/agent/src/component/streams.ts`, `node_modules/@convex-dev/agent/src/client/index.ts`, and the current stopped-turn UI path.
2. No legacy: no ghost-turn compatibility, no duplicate regenerate paths, no “old clear” fallback.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` first.
4. Testing doctrine: behavior, ARIA, `data-*`, and state only. Never CSS classes.
5. Zero type errors is non-negotiable. If Convex rejects the file, the new clear/regenerate behavior is not live and the task is not complete.
6. Research before guessing: verify the exact non-thread-deleting stream deletion helpers before writing code.
7. Delegate to subagents for codebase/library mapping beyond trivial reads.

EXECUTION RHYTHM
Phase A: write a pure helper for resolving the latest assistant turn / prompt relationship. Test it first. Commit per green.
Phase B:
1. Update regenerate to purge same-turn artifacts before rerun.
2. Update clear-history to purge stream artifacts as well as message docs while preserving the thread.
3. Add Convex integration tests for regenerate-after-stop and clear-after-stop.
4. Run the affected test slice.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-02]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the plan acceptance criteria are satisfied, the relevant tests are green, and the Convex dev server has loaded the updated backend code without type errors.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or an impulse to ask the user about an implementation detail already covered by the plan.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-02] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-stop-regenerate-clear/00-README.md`.
2. Read this plan file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status`.
5. Begin the first red test for latest-turn resolution.

Go.
```

```md
Plan file: plans/chat-stop-regenerate-clear/03-ui-contract-and-verification.md
Context README: plans/chat-stop-regenerate-clear/00-README.md
Depends on plan 02 being merged.

Autonomous task. Expect 1-2 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, preserve the existing visual language and only tighten behavior that the tests require.

STANDING RULES
1. DRY with named donors: `components/extraction/chat/message-list.tsx`, `message-actions.tsx`, `clear-conversation.tsx`, existing stopped-pill rendering, and existing component tests.
2. No legacy: no duplicate stopped/error branches and no stale clear-history expectations.
3. Testing doctrine: behavior, roles, visible text, `data-*`; never classes.
4. Zero type errors is non-negotiable. If either dev server is red for touched codepaths, the task is not complete.
5. Research before guessing: verify any `@convex-dev/agent` hook behavior you depend on before encoding it in tests.
6. Delegate to subagents for bounded test/discovery work if it exceeds trivial local reads.

EXECUTION RHYTHM
Phase A: write red component tests for the final UX contract.
Phase B:
1. Tighten UI branching only where tests prove a gap remains.
2. Add / update smoke verification coverage.
3. Run the relevant test slice.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-03]`.
- One commit per logical unit.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the plan acceptance criteria are satisfied, the relevant tests are green, and the touched local dev servers compile cleanly.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or a desire to ask the user for confirmation on an already-specified UX contract.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-03] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-stop-regenerate-clear/00-README.md`.
2. Read this plan file.
3. Check `git status`.
4. Begin the first red component test for stopped-turn rendering / clear-empty-state behavior.

Go.
```
