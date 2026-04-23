# Copy-Paste Execution Prompts

One fenced prompt per numbered plan. Each prompt is self-contained and assumes a fresh session.

```md
Plan file: plans/chat-exact-stop-billing/01-authoritative-usage-source.md
Context README: plans/chat-exact-stop-billing/00-README.md

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, choose the option most consistent with exact provider-authoritative billing and document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `convex/chat/agent.ts`, `convex/chat/messages.ts`, `convex/chat/provider.ts`, `convex/ai/lib/creditBilling.ts`, `convex/chat/messages.test.ts`, and `node_modules/@convex-dev/agent/src/client/start.ts`.
2. No legacy: no approximate stop billing, no text-length heuristics, no dual-path “exact-ish” fallbacks.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` before touching Convex code.
4. Research before guessing: verify the current AI SDK, Convex, and OpenRouter contracts cited in the README before encoding assumptions.
5. Zero type errors is non-negotiable. If Convex/TypeScript compilation is red, the task is not complete.
6. Use PM2 logs when runtime behavior needs confirmation.
7. Delegate to subagents for bounded investigation beyond trivial file reads.
8. If exact cancelled-generation usage cannot be sourced reliably, write `plans/chat-exact-stop-billing/01-BLOCKER.md` and stop. Do not invent an approximation.

EXECUTION RHYTHM
Phase A: TDD the pure normalization / validation helper for provider-authoritative generation stats. Commit per green.
Phase B:
1. Prove the real capture point for OpenRouter generation ids in the current chat runtime.
2. Add a focused integration or dev-proof path for cancelled-generation reconciliation.
3. Update tests and document the locked capture contract.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-01]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria in the plan file are satisfied or an explicit blocker has been written and committed.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or a desire to ask the user about an already-specified exactness requirement.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-01] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-exact-stop-billing/00-README.md`.
2. Read this plan file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status`.
5. Begin the first red test for provider-authoritative generation-stats normalization.

Go.
```

```md
Plan file: plans/chat-exact-stop-billing/02-usage-ledger-and-reconciliation.md
Context README: plans/chat-exact-stop-billing/00-README.md
Depends on plan 01 being merged.

Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with idempotent exact billing and document the choice in the commit message.

STANDING RULES
1. DRY with named donors: `convex/schema.ts`, `convex/credits/internal.ts`, `convex/ai/lib/creditBilling.ts`, and the provider-authoritative helper(s) from plan 01.
2. No legacy: no metadata-only pseudo-ledger, no duplicate deduction paths, no approximate backstop.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` first.
4. Testing doctrine: behavior, state, and ledger invariants only. Never CSS classes.
5. Zero type errors is non-negotiable. If Convex rejects schema/runtime changes, the task is not complete.
6. Research before guessing: re-read the README’s grounding sources if the idempotency or provider contract is unclear.
7. Delegate to subagents for library/codebase mapping beyond trivial local reads.

EXECUTION RHYTHM
Phase A: TDD the pure billing-state / idempotency helper first. Commit per green.
Phase B:
1. Add the raw usage ledger schema and indexes.
2. Implement reconciliation and exact one-time deduction.
3. Add integration tests for duplicate reconciliation and cancelled-generation billing.
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
Stop only when the acceptance criteria are satisfied and all relevant tests plus compilation are green.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or an impulse to ask the user about schema details already covered by the plan.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-02] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-exact-stop-billing/00-README.md`.
2. Read this plan file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status`.
5. Begin the first red test for idempotent reconciliation.

Go.
```

```md
Plan file: plans/chat-exact-stop-billing/03-chat-runtime-cutover.md
Context README: plans/chat-exact-stop-billing/00-README.md
Depends on plan 02 being merged.

Long-running autonomous task. Expect 2-5 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, prefer the smallest runtime change that preserves exact billing and keeps the stopped-message UX decoupled from reconciliation timing.

STANDING RULES
1. DRY with named donors: `convex/chat/agent.ts`, `convex/chat/messages.ts`, plan-01 authoritative usage helpers, and plan-02 reconciliation / ledger code.
2. No legacy: do not leave old finish-only chat charging active alongside the new exact billing path.
3. Convex guidelines override training data: read `convex/_generated/ai/guidelines.md` first.
4. Testing doctrine: assert on observable balances, transactions, ids, and stop state — never classes.
5. Zero type errors is non-negotiable. If Convex or TypeScript compilation is red, the task is not complete.
6. Research before guessing: verify any AI SDK / OpenRouter behavior you rely on before encoding it in runtime logic.
7. Delegate to subagents for bounded investigation when local reads would otherwise sprawl.

EXECUTION RHYTHM
Phase A: TDD the pure runtime reconciliation-trigger helper first. Commit per green.
Phase B:
1. Wire generation-id capture into the real chat runtime.
2. Cut chat billing over to authoritative reconciliation.
3. Add/update integration tests for exact finished and exact stopped billing.
4. Run the affected chat + credits test slices and verify the dev server loads the new code.
Commit per logical unit.

COMMIT DISCIPLINE
- Use conventional commits with `[plan-03]`.
- One commit per TDD green in Phase A.
- One commit per logical unit in Phase B.
- Never commit with tests red.
- Never use hook bypass flags.
- Do not push unless the user explicitly asks.

WHEN TO STOP
Stop only when the acceptance criteria are satisfied, the relevant tests are green, and the running Convex dev server has loaded the updated code.
You may NOT stop for: ambiguity resolvable by re-reading the plan, token anxiety, or a desire to ask the user about the already-locked exactness requirement.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit any in-progress work cleanly.
2. Edit the plan file first.
3. Commit the plan edit as `docs: [plan-03] revise ...`.
4. Proceed against the revised plan.

START NOW
1. Read `plans/chat-exact-stop-billing/00-README.md`.
2. Read this plan file.
3. Read `convex/_generated/ai/guidelines.md`.
4. Check `git status`.
5. Begin the first red test for runtime reconciliation triggers.

Go.
```
