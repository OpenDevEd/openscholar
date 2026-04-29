# Execution Prompts — Chat Web Search & Grounding

One copy-paste prompt per numbered plan. Each prompt is a single fenced Markdown block so the entire prompt can be copied in one action. Every prompt is self-contained — a fresh `/clear`'d session consuming only the prompt plus the files it references must be able to execute the plan without prior conversation.

## Preamble — applies to every prompt

The standing rules below repeat in each per-plan prompt's `STANDING RULES` block. They are the project doctrine and are non-negotiable:

- **DRY / reuse-first.** Before introducing a new helper, type, mutation, table, or component, search the codebase for a donor. Plans 00-README §5 lists the named donors for this work; respect them.
- **No legacy.** This project is pre-testing. No backwards-compatibility shims, no widen-then-narrow migrations, no "old field too" code. Convex schema changes are destructive by default.
- **`useEffect` is banned for state sync.** URL/Convex/derived state never goes through an effect. See `CLAUDE.md` for the allowlist.
- **Convex guidelines override training.** Read `convex/_generated/ai/guidelines.md` before touching any Convex code.
- **TDD for pure logic.** Red → green → refactor → commit, one commit per green. Pure helpers (selectors, formatters, validators, mappers) are tested first.
- **Ground before you guess.** If you find yourself reaching for an API from memory, stop and verify against `node_modules/<pkg>/`, the package's own docs, or the upstream docs before writing code. The most relevant local sources are listed per plan.
- **Delegate to subagents** for any investigation that would touch ~3 or more files or grep more than ~3 patterns. The main session preserves the TDD loop and commits.
- **Test on behavior, not on Tailwind class strings.** Use `data-*` attributes, ARIA, `getByRole`, `getByText`. Never `expect(el.className).toMatch(...)`.

## Plan 01 — Schema field for the toggle + capability helper

```md
You are executing `plans/chat-web-search-grounding/01-schema-and-toggle-field.md` in the openalex-count repo (Next.js + Convex). Read the plan and `plans/chat-web-search-grounding/00-README.md` before starting. This plan is the foundation that plans 03 (mutation) and 07 (UI) depend on.

## Autonomy framing
Long-running autonomous task. Expect 30–60 minutes. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message.

## STANDING RULES
1. DRY: do not add `capabilities.webSearch?: boolean` to `models`; reuse the existing `supportedParameters` column populated by `convex/models/sync.ts:109`.
2. No legacy. The new field on `extractionJobs` is `v.optional(v.boolean())` — additive only.
3. `useEffect` is banned. (Not relevant in this plan, but inherit the rule.)
4. Convex schema changes ship as their own commit per the planning doctrine.
5. Pure helper TDD: write the test file first, watch it fail, implement, watch it pass, commit.
6. Ground before you guess: open `node_modules/@convex-dev/agent/src/validators.ts` and `convex/schema.ts` directly to confirm field shapes.
7. The helper input type is structural minimum (`{ supportedParameters?: string[] | null }`), NOT `Doc<"models">`. `lib/` stays framework-agnostic.

## EXECUTION RHYTHM
Phase A — TDD (commit per green):
1. Write `lib/chat/web-search-capability.test.ts` covering the 6 cases in the plan. Confirm tests fail. Commit `test(chat): [plan-01] add web-search capability helper tests`.
2. Implement `lib/chat/web-search-capability.ts:modelSupportsWebSearch`. Confirm tests pass. Commit `feat(chat): [plan-01] modelSupportsWebSearch helper`.

Phase B — schema (one logical unit, one commit):
3. Edit `convex/schema.ts` to add `webSearchEnabled: v.optional(v.boolean())` to the `extractionJobs` table. Run the project's typegen (likely `npx convex codegen` or whatever `package.json` configures). Confirm `tsc --noEmit` and `npm test` (or the project's test script) are clean. Commit `feat(chat): [plan-01] webSearchEnabled field on extractionJobs`.

## COMMIT DISCIPLINE
- Conventional-commit prefix: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `style`.
- Tag every commit `[plan-01]`.
- One commit per TDD green. Never batch multiple greens into one commit.
- Never commit with tests red. If a hook fails, fix the underlying issue. Do NOT use `--no-verify` or `--no-gpg-sign`.
- Do NOT push to remote.

## WHEN TO STOP
Stop only when:
- All tests in the plan are green AND the schema field is live AND `tsc --noEmit` clean.
- OR you hit a true blocker (a required API does not exist, or pre-existing test failures unrelated to your work block CI).

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, or impulse to check with the user before continuing through Phase B.

## DEVIATIONS
If the plan itself is wrong (e.g., the schema validator rejects the addition for a reason the plan didn't anticipate):
1. Commit any in-progress work first.
2. Edit `plans/chat-web-search-grounding/01-schema-and-toggle-field.md` with the new approach and rationale.
3. Commit the plan edit under `docs: [plan-01] revise <section> — <reason>`.
4. Proceed against the revised plan.

If a true blocker:
1. Commit in-progress work.
2. Write `plans/chat-web-search-grounding/01-BLOCKER.md` describing what is stuck and what would unblock.
3. Stop.

## START NOW
1. Read `plans/chat-web-search-grounding/00-README.md` and `plans/chat-web-search-grounding/01-schema-and-toggle-field.md` in full.
2. Read `convex/schema.ts` (focus on `extractionJobs` and `models`) and `convex/models/sync.ts` (line 109 area) for the existing `supportedParameters` shape.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status` — confirm a clean working tree.
5. Begin R1 (write the test).

Go.
```

## Plan 02 — Billing prefers `providerMetadata.openrouter.usage.cost`

```md
You are executing `plans/chat-web-search-grounding/02-billing-prefer-provider-cost.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Independent of plan 01; can run in parallel.

## Autonomy framing
Long-running autonomous task. Expect 1–2 hours. Touches the billing-critical path; verify against existing tests at every step. Do not stop mid-plan to ask. When the plan is ambiguous, pick the option most consistent with existing patterns.

## STANDING RULES
1. DRY: reuse `convertUsdCostToCredits` (`convex/ai/lib/creditBilling.ts`), `AI_COST_MARKUP` (`convex/lib/constants.ts`), `buildChatBillingMetadata` (`convex/chat/openrouterFetch.ts:129`), and the existing idempotency guard pattern (`row.billedAt` short-circuit).
2. No legacy. The cost-readback path is added alongside the token-based path; the token path is the explicit fallback when `totalCostUsd` is absent. No "both prices computed" shenanigans.
3. Convex guidelines override training: read `convex/_generated/ai/guidelines.md`.
4. TDD: pure helper `pickProviderCostUsd` first, then extend the integration tests in `convex/chat/billing.integration.test.ts` (or create `convex/chat/billing.test.ts` if integration is too heavy for the new cases).
5. Ground before guess: open `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` lines 3760-3777 and 4257-4264 and `dist/index.d.ts:393-398` to confirm where `usage.cost` lands and how `usage: { include: true }` flows through.
6. Delegate any cross-file mapping (e.g., "where else is `billGenerationFromSdkUsage` invoked?") to an `Explore` subagent.

## EXECUTION RHYTHM
Phase A — pure logic (commit per green):
1. R1 — write `lib/chat/pick-provider-cost.test.ts` with all 8 cases listed in the plan. Confirm fail. Commit `test(chat): [plan-02] pickProviderCostUsd cases`.
2. G1 — implement `lib/chat/pick-provider-cost.ts:pickProviderCostUsd`. Confirm pass. Commit `feat(chat): [plan-02] pickProviderCostUsd helper`.

Phase A continued — billing integration tests (commit per logical pair):
3. R2 — extend the billing test file with the four cases in the plan (cost-supplied, cost-absent, zero-cost, idempotency). Confirm fails. Commit per case (or per pair if scenarios share fixture setup).
4. G2 — implement the cost-source switch in `billGenerationFromSdkUsage` and `billThreadUsageFromSdk`. Confirm pass. Commit per logical green.

Phase B — call-site wiring (one commit per logical unit):
5. U1 — `convex/chat/agent.ts`: pass `usage: { include: true }` on the chat factory. Commit.
6. U2 — `convex/chat/provider.ts:resolveOpenRouterModel`: same. Commit.
7. U3 — `convex/chat/messages.ts:409-471`: extend `onFinish` destructure and forward `totalCostUsd?` to both billing branches. Commit.
8. U4 — verify ledger metadata discriminator addition in `buildChatBillingMetadata`. Commit if not already in step 4.

## COMMIT DISCIPLINE
Same as plan 01. Tag every commit `[plan-02]`. Conventional commits. One green per commit. No `--no-verify`.

## WHEN TO STOP
Stop when all tests in plan 02 pass AND:
- A live OpenRouter chat call (manual smoke) shows `chatGenerationUsages.totalCostUsd` populated and `metadata.billingSource = "sdk_usage_cost"` (or whichever discriminator label you chose; document the choice).
- All existing billing tests still pass (no regression).
- `tsc --noEmit` clean.

You may NOT stop for ambiguity resolvable by re-reading the plan, by manual smoke, or by reading the OpenRouter provider source.

## DEVIATIONS
If the cost field never arrives in `providerMetadata.openrouter.usage.cost` despite `usage: { include: true }`:
1. Verify `stream_options.include_usage: true` in the request body via OpenRouter's request inspector or via `console.log` of the request inside the provider's `doStream` (read `dist/index.mjs:3805` to confirm the right code path).
2. If the SDK truly does not surface the cost, fall back to the `/api/v1/generation` polling path used by `settleGenerationUsage` AS the happy-path source too. Document in a plan revision commit before code changes.

If a true blocker, write `plans/chat-web-search-grounding/02-BLOCKER.md` and stop.

## START NOW
1. Read `00-README.md` (focus on §1 facts about cost reception) and `02-billing-prefer-provider-cost.md`.
2. Read `convex/chat/billing.ts` (full), `convex/chat/openrouterFetch.ts` (full), `convex/chat/messages.ts:375-525`.
3. Read `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` lines 3500-3810 and 4220-4270 to confirm `usage.cost` plumbing.
4. Read `convex/chat/billing.integration.test.ts` to learn the existing test fixture style.
5. `git status` clean. Begin R1.

Go.
```

## Plan 03 — `setChatWebSearchEnabled` mutation

```md
You are executing `plans/chat-web-search-grounding/03-toggle-mutation.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Depends on plan 01 being merged (the schema field must exist).

## Autonomy framing
Short autonomous task. Expect 30–45 minutes. Do not stop mid-plan to ask.

## STANDING RULES
1. DRY: reuse `authorizeThreadAccess` (the helper used by `sendMessage` at `convex/chat/messages.ts:212`). Do NOT introduce a new auth helper.
2. The new mutation is `mutation`, NOT `internalMutation` — it is called from the UI.
3. Idempotency: when the requested value equals the current value, return `{ outcome: "noop" }` and skip the patch.
4. Tests via the existing convex-test harness in `convex/chat/messages.test.ts`. Match the fixture style of nearby tests verbatim.
5. Convex guidelines override training: read `convex/_generated/ai/guidelines.md`.
6. No background side effects (no toast, no analytics). Pure DB patch.

## EXECUTION RHYTHM
Phase A — none (no pure logic in this plan).

Phase B — test-after, one commit per logical assertion:
1. U1 — Add the mutation skeleton (validators + auth call only, no patch). Commit `feat(chat): [plan-03] add setChatWebSearchEnabled mutation skeleton`.
2. U2 — Implement lookup-and-patch with no-op short-circuit. Commit `feat(chat): [plan-03] implement webSearchEnabled patch logic`.
3. T1 — happy path test. Commit.
4. T2 — non-owner test (auth rejection). Commit.
5. T3 — idempotency / no-op test. Commit.
6. T4 — missing-thread test. Commit.

## COMMIT DISCIPLINE
Conventional commits, `[plan-03]` tag. One concern per commit.

## WHEN TO STOP
All four tests pass; `tsc --noEmit` clean; codegen runs clean and the new mutation is visible in `_generated/api.ts`.

## DEVIATIONS
If `authorizeThreadAccess` is not the right helper (search for the auth call inside `sendMessage`'s handler — `convex/chat/messages.ts:205-274`), use whatever auth function `sendMessage` actually invokes. Document in a plan revision commit if the helper name in the plan is wrong.

## START NOW
1. Read `00-README.md` and `03-toggle-mutation.md`.
2. Read `convex/chat/messages.ts:205-274` to learn the auth call shape.
3. Read `convex/chat/messages.test.ts` (top 200 lines) for fixture style.
4. `git status` clean. Begin U1.

Go.
```

## Plan 04 — OpenRouter web-search tool factory (Path A)

```md
You are executing `plans/chat-web-search-grounding/04-openrouter-tool-factory.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Independent of plans 01–03; can run in parallel.

## Autonomy framing
Short autonomous task. Expect 20–40 minutes. Pure factory + tests.

## STANDING RULES
1. DRY: import `openrouter` from `@openrouter/ai-sdk-provider` at module scope. Do NOT use the `createOpenRouter()` instance from `convex/chat/agent.ts`.
2. The factory accepts ONLY `maxResults`, `searchPrompt`, `engine` — verified at `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:705-716`. Do not invent extra args.
3. TDD on the factory's return shape (camelCase args, `type: "provider"`, `id: "openrouter.web_search"`).
4. Ground before guess: open `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` lines 5018-5027 and 4274-4289 to confirm factory id and snake_case mapping.
5. The `ACADEMIC_SEARCH_PROMPT` constant lives in the same file and is unit-tested as part of the factory contract.

## EXECUTION RHYTHM
Phase A — pure logic (commit per green):
1. R1 — write `convex/chat/tools/openrouter-web-search.test.ts` with the five assertions in the plan. Confirm fail. Commit.
2. G1 — implement `convex/chat/tools/openrouter-web-search.ts`. Confirm pass. Commit.

Phase B — none (no call-site changes in this plan).

## COMMIT DISCIPLINE
`[plan-04]` tag. One green per commit.

## WHEN TO STOP
All five assertions pass; `tsc --noEmit` clean.

## DEVIATIONS
If the typed factory at `dist/index.d.ts:705-716` differs from what the plan describes (e.g., a future version adds new args), update the plan first under `docs: [plan-04] revise factory args — <reason>`, then implement.

## START NOW
1. Read `00-README.md` and `04-openrouter-tool-factory.md`.
2. Read `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts` lines 700-760.
3. Read `node_modules/@openrouter/ai-sdk-provider/dist/index.mjs` lines 4270-4290 and 5015-5030.
4. `git status` clean. Begin R1.

Go.
```

## Plan 05 — Tavily custom-tool factory (Path B)

```md
You are executing `plans/chat-web-search-grounding/05-tavily-tool-factory.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Independent of plans 01–04; can run in parallel with plan 04.

## Autonomy framing
Long autonomous task. Expect 2–3 hours. Multiple new files; multiple TDD cycles. Do not stop mid-plan.

## STANDING RULES
1. DRY: place the Tavily HTTP client in `lib/tavily/` (framework-agnostic), the AI SDK tool wrapper in `convex/chat/tools/`. Reuse `zod` (already a project dep) for schemas.
2. Pass `apiKey` and `costSink` as factory args. Do NOT read `process.env.TAVILY_API_KEY` inside the factory.
3. TDD every pure helper: `toSnakeCaseBody`, `parseResponse`, `tavilySearch` (with mocked `fetch`), and the factory itself.
4. Ground before guess: open Tavily docs at https://docs.tavily.com/documentation/api-reference/endpoint/search and verify field names against the JSON shape; the plan summarizes them but verify the latest. Read https://docs.tavily.com/documentation/best-practices/best-practices-search before tuning the academic-domain list.
5. Avoid the documented footguns (plan §"Known pitfalls"): no `auto_parameters`, no `exact_match`, no `topic: "news"`, no `include_raw_content`, no `include_answer`.
6. Abort propagation: pass `abortSignal` from `ToolExecutionOptions` into `fetch`.
7. Document `TAVILY_API_KEY` in `.env.example` (or whatever the project uses).

## EXECUTION RHYTHM
Phase A — TDD on the client (commit per green):
1. R1 — `lib/tavily/client.test.ts` for `toSnakeCaseBody` and `parseResponse`.
2. G1 — implement those pure helpers.
3. R2 — extend the test file for `tavilySearch(...)` happy path with mocked `fetch`. Use `vi.mock("global.fetch", ...)` or pass `fetchImpl` directly.
4. G2 — implement `tavilySearch`.
5. R3 — extend with 401 / 429 / generic error cases, including `retry-after` preservation on the `TavilyError`.
6. G3 — implement `TavilyError` and the error mapping.

Phase A continued — TDD on the factory:
7. R4 — `convex/chat/tools/tavily-web-search.test.ts` for the factory contract (six assertions in the plan).
8. G4 — implement `buildTavilyWebSearchTool` using `tool({})` from `ai`. Test that `execute` invokes the client, returns the right shape, and calls `costSink` once.

Phase B — env doc (one commit):
9. U1 — add `TAVILY_API_KEY=` to `.env.example` (or analog). Commit `chore: [plan-05] document TAVILY_API_KEY in env example`.

## COMMIT DISCIPLINE
`[plan-05]` tag. One green per commit. Tests committed before implementation.

## WHEN TO STOP
All TDD cycles pass; `tsc --noEmit` clean.

## DEVIATIONS
If Tavily's docs differ from the plan's summarized fields (the plan was grounded as of 2026; field names rarely break but defaults may shift), update the plan first under `docs: [plan-05] revise field <name> — <reason>`, then implement against the revised plan.

If `TAVILY_API_KEY` is not yet provisioned for development, mock it via `process.env.TAVILY_API_KEY = "tvly-fake-..."` in tests but do NOT hardcode it anywhere outside test files. The factory's contract is to receive the key as an arg; tests only need to satisfy that contract.

## START NOW
1. Read `00-README.md` and `05-tavily-tool-factory.md`.
2. Read https://docs.tavily.com/documentation/api-reference/endpoint/search and https://docs.tavily.com/documentation/best-practices/best-practices-search.
3. Read `node_modules/@ai-sdk/provider-utils/src/types/tool.ts` (the `tool()` / `Tool<INPUT,OUTPUT>` types — the plan summarizes them).
4. `git status` clean. Begin R1.

Go.
```

## Plan 06 — Agent orchestration

```md
You are executing `plans/chat-web-search-grounding/06-agent-orchestration.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Depends on plans 01, 02, 03, 04, 05 being merged.

## Autonomy framing
Long autonomous task. Expect 2–3 hours. Wires every prior plan together at the `paperChat.streamText` call site. Do not stop mid-plan.

## STANDING RULES
1. DRY: reuse `pickWebSearchTool` (defined in this plan) — the only place that decides A vs B vs none. Do not re-implement the decision elsewhere.
2. `stepCountIs(5)` cap, NOT a forced 5 steps. Single-turn questions still terminate.
3. `costSink` callback closes over `ctx.runMutation(internal.chat.billing.recordTavilyCost, ...)`. The Tavily tool itself stays pure (per plan 05).
4. The system-prompt update is appended ONLY when `webSearchEnabled === true`. Default behavior unchanged when the toggle is off.
5. Read `process.env.TAVILY_API_KEY` ONCE at the messages.ts call site per request, not at module load.
6. Tests via convex-test, matching the existing patterns in `convex/chat/messages.test.ts` and `convex/chat/billing.integration.test.ts`.
7. Convex guidelines override training. Open `convex/_generated/ai/guidelines.md`.
8. Delegate "where is `buildChatContext` invoked?" / "where is `buildSystemPromptForJob` consumed?" to an `Explore` subagent if you find yourself reading more than 3 files.

## EXECUTION RHYTHM
Phase A — pure logic (commit per green):
1. R1 — `convex/chat/tools/select-web-search-tool.test.ts` with five truth-table cases.
2. G1 — implement `pickWebSearchTool`.
3. R2 — assertions on `WEB_SEARCH_SYSTEM_INSTRUCTION` content invariants (PRIMARY, [Pn], supplement).
4. G2 — define the constant in `convex/chat/context.ts`.
5. R3 — extend `convex/chat/context.test.ts` (or create) with the system-prompt builder cases.
6. G3 — extend `buildSystemPromptForJob` to accept `webSearchEnabled` and conditionally append the third message.

Phase B — call-site wiring (one commit per logical unit):
7. U1 — `convex/chat/agent.ts:60`: change `stepCountIs(1)` to `stepCountIs(5)`. Commit `feat(chat): [plan-06] bump stepCountIs to 5`.
8. U2 — Add `recordTavilyCost` internal mutation in `convex/chat/billing.ts`. Test: deducts via `deductCreditsTransaction(billingType: "search")`, idempotent. Commit per logical green.
9. U3 — `convex/chat/messages.ts:288-388`: read `webSearchEnabled` and `selectedModel`, compute the path via `pickWebSearchTool`, compose `tools` map, pass to `paperChat.streamText`. Commit.
10. U4 — Plumb `webSearchEnabled` through `buildChatContext` (in `convex/chat/agent.ts`) → `buildSystemPromptForJob`. Commit.

## COMMIT DISCIPLINE
`[plan-06]` tag. Conventional commits. One concern per commit.

## WHEN TO STOP
All TDD cycles pass; integration test for the toggle path passes (toggle on + Tavily key + tool call → tool parts on the assistant message + `recordTavilyCost` deducted). `tsc --noEmit` clean. Existing tests pass.

## DEVIATIONS
If `paperChat.streamText` does not accept `tools` directly via the option object (research agent 3 verified it does — see `node_modules/@convex-dev/agent/src/client/streamText.ts:44-54`), revise the plan and document. If the contextHandler at `convex/chat/agent.ts:26-47` does not have access to `webSearchEnabled` from the job row via the existing `getModelForThread` query, extend that query's return shape to include the field — choose the smaller diff.

## START NOW
1. Read `00-README.md` and `06-agent-orchestration.md`.
2. Read `convex/chat/agent.ts` (full), `convex/chat/context.ts` (full), `convex/chat/messages.ts:280-525`, `convex/chat/billing.ts:300-505`.
3. Read `node_modules/@convex-dev/agent/src/client/streamText.ts:34-200` and `start.ts:170-330`.
4. `git status` clean. Begin R1.

Go.
```

## Plan 07 — Composer toggle UI

```md
You are executing `plans/chat-web-search-grounding/07-composer-toggle-ui.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Depends on plans 01 (capability helper) and 03 (mutation) being merged.

## Autonomy framing
Medium autonomous task. Expect 1–2 hours.

## STANDING RULES
1. NO `useEffect`. State derives from props (Convex query result). Click handler invokes the mutation directly; no effect watches state for side-effects.
2. NO Tailwind class assertions in tests. Use `aria-pressed`, `data-web-search-enabled`, `data-web-search-supported`, `getByRole`, `getByText`.
3. Use shadcn `Tooltip` from `components/ui/tooltip.tsx`. Use shadcn `Button` with `variant="ghost"` matching the model picker chrome (h-7 gap-1.5 rounded-full px-2 text-xs font-medium).
4. Lucide icon: `Globe`. Not `GlobeLock`, not `Search`.
5. Do not put the toggle inside the model picker popover. It is a sibling at the toolbar level.
6. Do not introduce URL state. The toggle is per-thread server state, not a sharable filter.
7. Tests via @testing-library/react in `tests/components/`. Match existing component-test fixture style (mocks `convex/react`, `@/convex/_generated/api`).

## EXECUTION RHYTHM
Phase A — none (no new pure helper here; capability helper is in plan 01).

Phase B — test-after, one commit per logical unit:
1. U1 — Build `components/extraction/chat/web-search-toggle.tsx`. Commit `feat(chat): [plan-07] WebSearchToggle component`.
2. U2 — Mount in `components/extraction/chat/message-composer.tsx` between the model picker and the keyboard-hint span. Wire props from the existing job + selectedModel data path. Commit `feat(chat): [plan-07] mount WebSearchToggle in composer toolbar`.
3. T1 — `tests/components/web-search-toggle.test.tsx`: aria-pressed reflects state. Commit.
4. T2 — disabled when supportedParameters lacks "tools". Commit.
5. T3 — disabled while generating. Commit.
6. T4 — onClick calls setChatWebSearchEnabled with negated value. Commit.
7. T5 — tooltip text changes by state. Commit.

## COMMIT DISCIPLINE
`[plan-07]` tag. One concern per commit.

## WHEN TO STOP
All five tests pass; `tsc --noEmit` clean; manual smoke confirms the toggle in dev (click flips, capability gate visibly disables when model lacks tools).

## DEVIATIONS
If the composer does not yet have access to the resolved `selectedModel` (with `supportedParameters`), extend the existing model query result rather than adding a new query. Prefer the smaller diff. Document the choice.

## START NOW
1. Read `00-README.md` and `07-composer-toggle-ui.md`.
2. Read `components/extraction/chat/message-composer.tsx` (full), `components/extraction/chat/composer-model-picker.tsx` (full).
3. Read `tests/components/chat-citation-render.test.tsx` (or equivalent) for fixture style.
4. Read `lib/chat/web-search-capability.ts` from plan 01.
5. `git status` clean. Begin U1.

Go.
```

## Plan 08 — MessageRow parts rendering

```md
You are executing `plans/chat-web-search-grounding/08-message-row-parts-rendering.md` in the openalex-count repo. Read the plan and `00-README.md` before starting. Depends on plan 06 being merged (parts only flow once tools are wired).

## Autonomy framing
Long autonomous task. Expect 3–4 hours. Multiple new components and a refactor of an established UI surface. Do not stop mid-plan.

## STANDING RULES
1. DRY: reuse `Streamdown` + `parseIncompleteMarkdown` for `text` parts (existing `<MessageResponse>` component). Reuse `Shimmer` from `components/ai-elements/shimmer.tsx`. Reuse `Tooltip` from `components/ui/tooltip.tsx`. Reuse Lucide icons.
2. NO Tailwind class assertions. Use `data-tool-state`, `data-tool-name`, `data-source-type`, `data-step-boundary`, `data-web-sources-count`, `data-message-role`, `getByRole`, `getByText`.
3. NO `useEffect`. Render derives from `parts[]`.
4. Source-url parts render at the message FOOTER, not interleaved. Filter them out of the main loop and pass the full `parts[]` to `<WebSourceChips>`.
5. `step-start` heuristic: visible only when sandwiched between a tool-call `output-available` and a following `text` part. Otherwise null.
6. Aborted tool parts: when message status is failed/aborted AND tool state is `input-streaming`/`input-available`, render the aborted variant. Read `message.status`.
7. Reasoning parts: render as null in V1 (out of scope per `00-README.md` §11).
8. `[Pn]` rewrite stays inside the `text` part renderer.
9. Multiple `text` parts per assistant turn are valid (text → tool → text). Iterate; do NOT join.
10. Convex guidelines override training (the @convex-dev/agent UIMessage shape is documented at `node_modules/@convex-dev/agent/src/UIMessages.ts:36-49`). Read it.

## EXECUTION RHYTHM
Phase A — pure helpers (commit per green):
1. R1 — `lib/chat/format-search-cost.test.ts` with the four cases. Commit fail.
2. G1 — implement `formatSearchCostLabel`. Commit pass.
3. R2 — `lib/chat/favicon-url.test.ts` with three cases. Commit fail.
4. G2 — implement `faviconUrl`. Commit pass.

Phase B — components (test-after, one commit per logical unit):
5. U1 — `components/ai-elements/web-source-chip.tsx` + tests. Commit per pair.
6. U2 — `components/ai-elements/web-source-chips.tsx` + tests. Commit.
7. U3 — `components/ai-elements/tool-step.tsx` + state-by-state tests. Commit per state test.
8. U4 — `components/ai-elements/step-boundary.tsx` + tests. Commit pair.
9. U5 — Refactor `components/extraction/chat/message-list.tsx:383-516` `MessageRow` to iterate `parts[]`. Tests for: text-only, text+tool, text+tool+text+source-url. Commit per scenario.

## COMMIT DISCIPLINE
`[plan-08]` tag. Conventional commits. One concern per commit.

## WHEN TO STOP
All TDD cycles pass; `tsc --noEmit` clean; existing chat tests pass; manual smoke shows tool steps streaming with the live query, source chips at message footer, `[Pn]` paper citations still working inside text.

## DEVIATIONS
If `useUIMessages` returns a flattened message shape (no `parts` array), it conflicts with the research finding that @convex-dev/agent forwards parts. Before assuming, read `node_modules/@convex-dev/agent/src/UIMessages.ts:36-49` and `react/useUIMessages.ts:125-167` to verify. If the shape is different, revise the plan first under `docs: [plan-08] revise UIMessage shape — <reason>`.

If `Streamdown` cannot tolerate part-level streaming (e.g., it expects a single growing string, not multiple text parts), introduce a per-part instance of `<Streamdown>` and accept the rerender cost. Do not fall back to flattening.

## START NOW
1. Read `00-README.md` and `08-message-row-parts-rendering.md`.
2. Read `components/extraction/chat/message-list.tsx` (full), `components/extraction/chat/paper-citation.tsx` (full), `components/ai-elements/shimmer.tsx`, `components/ai-elements/message.tsx`.
3. Read `node_modules/@convex-dev/agent/src/UIMessages.ts` lines 36-49 and 175-200.
4. Read `node_modules/ai/src/ui/ui-messages.ts:75-191` (UIMessagePart union).
5. Read `tests/components/chat-citation-render.test.tsx` for fixture style.
6. `git status` clean. Begin R1.

Go.
```

## Cross-cutting notes

- Plans 01, 02 are independent and may execute in parallel.
- Plans 04, 05 are independent and may execute in parallel after 01–02 are merged (or alongside; they have no shared file).
- Plan 03 needs plan 01 (schema field).
- Plan 06 needs plans 01, 02, 03, 04, 05 all merged.
- Plan 07 needs plans 01 (capability helper) and 03 (mutation) merged. Independent of 06.
- Plan 08 needs plan 06 merged (parts only flow once tools are wired).

A serial worst-case path is: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08. A parallelized path: (01, 02, 04, 05) → 03 → 06 → (07, 08).
