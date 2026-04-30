# Execution Prompts — Unified Pricing

One copy-paste prompt per numbered plan. Each prompt is a single fenced Markdown block so the entire prompt can be copied in one action. Every prompt is self-contained — a fresh `/clear`'d session consuming only the prompt plus the files it references must be able to execute the plan without any prior conversation.

## Preamble — applies to every prompt

The standing rules below repeat in each per-plan prompt's `STANDING RULES` block. They are the project doctrine and are non-negotiable:

- **DRY / reuse-first.** Before introducing a new helper, type, mutation, or component, search the codebase for a donor. The 00-README §5 lists the named donors for this work; respect them.
- **No legacy.** This project is pre-testing. No backwards-compatibility shims, no widen-then-narrow migrations, no "old field too" code. The single allowed compat re-export (`AI_COST_MARKUP` from `convex/lib/constants.ts`) is called out explicitly in plan 02; everything else gets deleted in the same commit that wires its replacement.
- **`useEffect` is banned for state sync.** URL/Convex/derived state never goes through an effect. Loading-state branches go in render. See `CLAUDE.md` for the allowlist.
- **Convex guidelines override training.** Read `convex/_generated/ai/guidelines.md` before touching any Convex code. Stale `returns` validators silently strip fields on the wire — every new field on a returned object MUST be in `returns`.
- **TDD for pure logic.** Red → green → refactor → commit, one commit per green. Pure helpers (selectors, formatters, validators, mappers) are tested first.
- **Deployability gate after every commit that touches `convex/`, `app/`, or `components/`.** Run `npx pm2 logs convex --lines 5 --nostream` and/or `npx pm2 logs next --lines 5 --nostream` and confirm the success line. A commit on top of a broken push is a regression.
- **Ground before you guess.** If you find yourself reaching for an API from memory, stop and verify against the package source under `node_modules/` or the upstream docs before writing code.
- **Delegate to subagents** for any investigation that would touch ~3 or more files or grep more than ~3 patterns. The main session preserves the TDD loop and commits.
- **Test on behavior, not on Tailwind class strings or dollar literals.** Use `data-*` attributes, ARIA, `getByRole`, `getByText`. Never `expect(el.className).toMatch(...)`. Never `expect(text).toContain("$0.02")` — the dollar literal is exactly what this work removes.

---

## Plan 01 — Pricing module (`lib/pricing/`)

```md
You are executing `plans/unified-pricing/01-pricing-module.md` in the openalex-count repo (Next.js + Convex). Read the plan and `plans/unified-pricing/00-README.md` before starting. This plan is the foundation — plans 02 and 03 both depend on it.

## Autonomy framing
Long-running autonomous task. Expect 45–90 minutes. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message.

## STANDING RULES
1. DRY: do NOT introduce a second `convertUsdCostToCredits` or duplicate the markup constant. The new module is the source of truth; existing helpers become adapters in plan 02 (not this plan).
2. No legacy. The `lib/pricing/` module is new; no compat shim required this plan.
3. `useEffect` ban inherited (not relevant here, but applies if you wander into UI files).
4. Convex guidelines override training — but `lib/pricing/` is framework-agnostic, so it must NOT import from `convex/`. Verify this with a grep before committing.
5. TDD for both helpers. Red → green → refactor → commit, one commit per green test.
6. Ground before guess: pricing facts are already established in `00-README.md` § 9. If a new pricing question arises, delegate research to a `general-purpose` subagent before guessing.
7. The `WebSearchPath` type currently lives at `convex/chat/tools/selectWebSearchTool.ts:12`. It moves to `lib/pricing/web-search.ts`; the function body stays where it is.

## EXECUTION RHYTHM
Phase A — TDD (commit per green):
1. R1 — write `lib/pricing/convert.test.ts` with all 12 cases listed in the plan's TDD sequence. Confirm all RED. Commit `test(pricing): [plan-01] convertUsdToCredits cases`.
2. G1 — implement `lib/pricing/constants.ts` and `lib/pricing/convert.ts`. Confirm GREEN. Commit `feat(pricing): [plan-01] convertUsdToCredits + constants`.
3. R2 — write `lib/pricing/web-search.test.ts` with all 11 cases. Confirm RED. Commit `test(pricing): [plan-01] pickWebSearchPricing cases`.
4. G2 — implement `lib/pricing/web-search.ts`. Confirm GREEN. Commit `feat(pricing): [plan-01] pickWebSearchPricing selector`.
5. G3 — `lib/pricing/index.ts` barrel export. Run full suite to confirm no regressions. Commit `feat(pricing): [plan-01] barrel export`.

Phase B — type-import migration (one logical unit):
6. U1 — Move `WebSearchPath` type definition from `convex/chat/tools/selectWebSearchTool.ts:12` into `lib/pricing/web-search.ts`. Update the import in `selectWebSearchTool.ts` to `import type { WebSearchPath } from "@/lib/pricing"`. Run `tsc --noEmit` and existing `selectWebSearchTool.test.ts`. Commit `refactor(pricing): [plan-01] hoist WebSearchPath into lib/pricing`. Run `npx pm2 logs convex --lines 5 --nostream` and confirm `✔ Convex functions ready!`.

## COMMIT DISCIPLINE
- Conventional-commit prefix: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`, `style`.
- Tag every commit `[plan-01]`.
- One commit per TDD green. Never batch multiple greens into one commit.
- Never commit with tests red. If a hook fails, fix the underlying issue. NEVER use `--no-verify` or `--no-gpg-sign`.
- Do NOT push to remote.

## WHEN TO STOP
Stop only when:
- All 23 unit tests pass AND `tsc --noEmit` is clean AND `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
- OR you hit a true blocker (a TS path alias resolution issue that requires tsconfig change you're unsure of, etc).

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, or impulse to check with the user before continuing.

## DEVIATIONS
If the plan itself is wrong (e.g., a test case is mathematically inconsistent with the formula on closer inspection):
1. Commit any in-progress work first.
2. Edit `plans/unified-pricing/01-pricing-module.md` with the new approach and rationale.
3. Commit the plan edit under `docs: [plan-01] revise <section> — <reason>`.
4. Proceed against the revised plan.

If a true blocker (e.g., `@/lib/pricing` won't resolve from Convex code despite the alias being configured):
1. Commit in-progress work.
2. Write `plans/unified-pricing/01-BLOCKER.md` describing what is stuck and what would unblock.
3. Stop.

## START NOW
1. Read `plans/unified-pricing/00-README.md` and `plans/unified-pricing/01-pricing-module.md` in full.
2. Read `convex/_generated/ai/guidelines.md` (Convex guideline override).
3. Read `convex/chat/tools/selectWebSearchTool.ts` (the current home of `WebSearchPath`).
4. Read `convex/ai/lib/creditBilling.ts` and `convex/lib/creditTopups.ts` (for the conversion-formula context — DO NOT modify them in this plan; plan 02 owns those).
5. `git status` — confirm a clean working tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm the dev push is healthy at boot.
7. Begin R1 (write `lib/pricing/convert.test.ts`).

Go.
```

---

## Plan 02 — Rewire billing + fix null-price under-charge

```md
You are executing `plans/unified-pricing/02-rewire-billing-and-fix-null-fallback.md` in the openalex-count repo. Read the plan and `plans/unified-pricing/00-README.md` before starting. **Depends on plan 01 being merged.**

## Autonomy framing
Long-running autonomous task. Expect 1–2 hours. Touches the billing-critical path AND fixes an active billing leak (gateway under-charges $0.02/call when `model.webSearchPrice` is null). Verify against existing tests at every step. Do not stop mid-plan to ask. When the plan is ambiguous, pick the option most consistent with existing patterns and document in the commit message.

## STANDING RULES
1. DRY: reuse `convertUsdToCredits` and `pickWebSearchPricing` from `@/lib/pricing` (introduced in plan 01); reuse `getCreditsPerUsd` from `convex/lib/creditTopups.ts` (env reader, not duplicated); reuse `creditsFromCost` and the gateway's existing per-model `costMarkup` flow at `convex/wallet/gateway/handler.ts:267`.
2. No legacy. `TAVILY_USD_PER_CREDIT` (`convex/chat/billing.ts:515`) is DELETED in the same commit that swaps the import. The two `AI_COST_MARKUP = 1.3` and `DEFAULT_CREDITS_PER_USD = 10_000` original constants are replaced by re-exports from `@/lib/pricing`. No `@deprecated` annotations.
3. `useEffect` ban inherited. (Not relevant here, all server-side code.)
4. Convex guidelines override training: read `convex/_generated/ai/guidelines.md`. Pay attention to the "stale return validators" guidance — none of the changes in this plan modify a `returns` validator, but verify this is still true at the end.
5. TDD: the new gateway test case (null-price fallback) is RED-first. Write the failing test, commit it, then write the fix.
6. Ground before guess: open `convex/wallet/gateway/cost.ts:38-87` and `handler.ts:438-486` and `handler.ts:267` to understand how USD flows into credits before changing anything. Do NOT modify the per-model `costMarkup` flow.
7. Delegate to a subagent any cross-file mapping (e.g., "find every consumer of `convertUsdCostToCredits`" — there are 4+).
8. Deployability gate: after EVERY commit that touches `convex/`, run `npx pm2 logs convex --lines 5 --nostream` and confirm `✔ Convex functions ready!`.

## EXECUTION RHYTHM
Phase B — test-after, one commit per logical unit:

1. U1 — `convex/chat/billing.ts`: replace file-private `TAVILY_USD_PER_CREDIT` with `WEB_SEARCH_PRICING.tavily.usdPerCredit` import. Run `npx vitest run convex/chat/billing.recordTavilyCost.test.ts` (must pass; constant value is unchanged). Commit `refactor(billing): [plan-02] recordTavilyCost reads from lib/pricing`. **Run pm2 gate.**

2. U2 — `convex/ai/lib/creditBilling.ts`: rewrite `convertUsdCostToCredits` body as a 1-line delegation to `convertUsdToCredits` from `@/lib/pricing`. Signature unchanged. Run live-billing tests at `tests/live-billing/` and `tests/credit-calculation-integration.test.ts`. Commit `refactor(billing): [plan-02] convertUsdCostToCredits adapter -> lib/pricing`. **Run pm2 gate.**

3. U3 — `convex/lib/creditTopups.ts`: rewrite `convertDollarsToCredits` body as a 1-line delegation with `markup: 1`. Signature unchanged. Run `tests/credit-topup-config.test.ts`. Commit `refactor(billing): [plan-02] convertDollarsToCredits adapter -> lib/pricing`. **Run pm2 gate.**

4. U4 — `convex/lib/constants.ts`: delete the `export const AI_COST_MARKUP = 1.3;` line; replace with `export { AI_COST_MARKUP } from "@/lib/pricing"`. Run `tests/credit-calculation-integration.test.ts:16-21` (asserts the value is 1.3 — must still pass). Commit `refactor(billing): [plan-02] AI_COST_MARKUP re-export from lib/pricing`. **Run pm2 gate.**

5. R5a — Extend `convex/wallet/gateway/gateway.test.ts` with a new test case: model with `webSearchPrice: undefined`, `webSearchRequests: 1`, `costMarkup: 2.0`. Expected credits from web-search = `ceil(0.02 × 2.0 × 10_000) = 400`. Confirm RED. Commit `test(gateway): [plan-02] null webSearchPrice falls back to server-tool rate`.

6. G5a — Edit `convex/wallet/gateway/cost.ts:69-72` to call `pickWebSearchPricing(...)` instead of `webSearchRequests * (model.webSearchPrice ?? 0)`. Confirm new test GREEN AND existing tests at `gateway.test.ts:2162` and `:2204` (which use `webSearchPrice: 0.025`) still pass — the native-price branch must be unaffected. Commit `fix(gateway): [plan-02] charge OpenRouter server-tool rate when webSearchPrice is null`. **Run pm2 gate.**

7. U5b — DEFER per the plan's design notes. Do NOT modify `handler.ts:474-475` in this plan unless the implementation makes the answer obvious. If you do, follow the deviation protocol (commit a `docs: [plan-02] revise § Design — U5b clarified` plan-edit BEFORE the code commit).

8. U6 — Final acceptance grep audit. From the repo root, run:
```
grep -rn "0\.008" --include="*.ts" convex/ lib/ components/ app/ messages/ | grep -v "lib/pricing/"
grep -rn "TAVILY_USD_PER_CREDIT" --include="*.ts" .
grep -rn "AI_COST_MARKUP\s*=\s*1\.3" --include="*.ts" .
grep -rn "DEFAULT_CREDITS_PER_USD\s*=\s*10_000" --include="*.ts" .
```
All four must return ZERO hits. Document the audit result in the next commit body or in a final `chore: [plan-02] post-rewire grep audit clean` commit (no code change).

## COMMIT DISCIPLINE
Same as plan 01. Tag every commit `[plan-02]`. Conventional commits. One logical unit per commit. NEVER `--no-verify`. Never push to remote.

## WHEN TO STOP
Stop only when:
- All four post-rewire greps return zero hits.
- All existing billing tests pass AND the new null-price test passes.
- `tsc --noEmit` clean.
- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit.
- Manual smoke (per the plan's Test plan): a chat turn against a null-price model with web search enabled produces a `creditTransactions` row that bills the expected `ceil(0.02 × costMarkup × 10_000)` credits per `webSearchRequests`.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user before continuing.

## DEVIATIONS
Standard deviation protocol per `CLAUDE.md`: commit any in-progress work first; edit the plan file with the new approach + rationale; commit the plan edit under `docs: [plan-02] revise <section> — <reason>`; then proceed.

For a true blocker (e.g., the new gateway test reveals an unrelated existing test is broken on main): commit in-progress work, write `plans/unified-pricing/02-BLOCKER.md`, stop.

## START NOW
1. Read `plans/unified-pricing/00-README.md`, `01-pricing-module.md` (the API surface plan 01 ships), and `02-rewire-billing-and-fix-null-fallback.md` in full.
2. Read `convex/_generated/ai/guidelines.md`.
3. Read `convex/chat/billing.ts:497-560`, `convex/wallet/gateway/cost.ts`, `convex/wallet/gateway/handler.ts:438-486`, `convex/wallet/gateway/gateway.test.ts:2150-2230` (existing web-search test cases).
4. Read `convex/ai/lib/creditBilling.ts`, `convex/lib/creditTopups.ts`, `convex/lib/constants.ts`.
5. `git status` — confirm clean tree.
6. `npx pm2 logs convex --lines 5 --nostream` — confirm `✔ Convex functions ready!` BEFORE starting (a stuck push from prior work blocks every later commit).
7. Begin U1.

Go.
```

---

## Plan 03 — Rewire UI + i18n

```md
You are executing `plans/unified-pricing/03-rewire-ui-and-i18n.md` in the openalex-count repo. Read the plan and `plans/unified-pricing/00-README.md` before starting. **Depends on plan 01 being merged.** Independent of plan 02 (can run in parallel with it once 01 is in).

## Autonomy framing
Long-running autonomous task. Expect 2–3 hours. Touches a Convex query, a React component, an AI-elements component, a pure formatter, and 6 i18n locale files. Do not stop mid-plan to ask. When the plan is ambiguous, pick the option most consistent with existing patterns and document in the commit message.

## STANDING RULES
1. DRY: reuse `pickWebSearchPricing`, `WEB_SEARCH_PRICING` from `@/lib/pricing` (introduced in plan 01); reuse `pickWebSearchTool` from `convex/chat/tools/selectWebSearchTool.ts` (server-side only); reuse `useTranslations("composer")` already wired in the toggle.
2. No legacy. `formatSearchCostLabel`'s old `{ creditsPerSearchEstimate, costUsdEstimate }` shape is DELETED in the same plan; both callers (`tool-step.tsx`, the test) are rewired in lockstep. The 6 locale files have their old `tooltipOff` string DELETED, replaced with the parameterized version. No `tooltipOffLegacy` key.
3. **`useEffect` is banned.** Loading-state branches go in render. The `pricing === undefined` case renders `tooltipOffLoading`; do NOT use an effect to "prefill" the tooltip text.
4. Convex guidelines override training: read `convex/_generated/ai/guidelines.md`. The new `getChatWebSearchPricing` query MUST have a complete `returns` validator listing every field — adding `source` to the body but not to `returns` silently strips it on the wire.
5. TDD for `formatSearchCostLabel` first (pure logic). The Convex query and the UI rewires are test-after.
6. Ground before guess: read `next-intl` interpolation syntax (existing examples in `messages/en-US.json:51,158,179,208,292,294,411,417`). Read the existing `WebSearchToggle` and `ToolStep` components in full before editing.
7. Delegate to a subagent: "find every consumer of `formatSearchCostLabel`" (expected: 2 — the tool-step component and the test file).
8. Test on behavior, not on Tailwind classes or dollar literals. Assertions use `data-web-search-source`, `data-web-search-credits-estimate`, `getByRole`, `getByText(/\d+ credits/)` — never `toContain("$0.02")`.
9. Deployability gate: after EVERY commit that touches `convex/`, run `npx pm2 logs convex --lines 5 --nostream`; after every commit that touches `app/` or `components/`, run `npx pm2 logs next --lines 5 --nostream`. Confirm the success line each time.

## EXECUTION RHYTHM
Phase A — pure logic (commit per green):
1. R1 — rewrite `lib/chat/format-search-cost.test.ts` for the new signature (7 cases per the plan's TDD sequence). Confirm RED. Commit `test(chat): [plan-03] formatSearchCostLabel new signature`.
2. G1 — rewrite `lib/chat/format-search-cost.ts` body. Confirm GREEN. Commit `refactor(chat): [plan-03] formatSearchCostLabel reads from lib/pricing`.

Phase B — Convex query (one logical unit, one commit):
3. U1 — add `getChatWebSearchPricing` query to `convex/chat/messages.ts` with full `returns` validator. Add 5 unit-test cases (per plan's § Phase B U1 list). Confirm GREEN. Commit `feat(chat): [plan-03] getChatWebSearchPricing query`. **Run convex pm2 gate.**

Phase B — UI rewires (one commit per logical unit):
4. U2 — `components/ai-elements/tool-step.tsx`: delete `SEARCH_COST_DEFAULTS`, add new props (`webSearchSource`, `modelWebSearchPriceUsd`), swap label rendering. Update `tests/components/tool-step.test.tsx` — drop the `"~$0.02 / ~3 credits"` assertion, replace with credit-only assertions per scenario. Confirm GREEN. Commit `refactor(chat): [plan-03] tool-step reads pricing from lib/pricing`. **Run next pm2 gate.**

5. U3 — `components/extraction/chat/web-search-toggle.tsx`: subscribe to `useQuery(api.chat.messages.getChatWebSearchPricing, { threadId })`, parameterize the tooltip via `t("webSearch.tooltipOff", { credits: pricing?.creditsPerCall ?? 0 })`, add `data-web-search-source` and `data-web-search-credits-estimate` attributes. Handle `pricing === undefined` by showing `tooltipOffLoading` (NO `useEffect`). Update `tests/components/web-search-toggle.test.tsx` per plan's § Phase B U3 list. Confirm GREEN. Commit `refactor(chat): [plan-03] WebSearchToggle tooltip shows real credits`. **Run next pm2 gate.**

6. U4 — i18n: rewrite `webSearch.tooltipOff` in all 6 locale files (`en-US`, `en-GB`, `ja`, `zh`, `fr`, `hi`) to use `{credits}` placeholder; add new `webSearch.tooltipOffLoading` key with the per-locale string from the plan's § i18n key changes table. Run toggle tests — interpolation parser will fail loudly if a placeholder is wrong. Commit `i18n(chat): [plan-03] tooltipOff parameterized; tooltipOffLoading added (6 locales)`. **Run next pm2 gate.**

7. U5 — `MessageRow` in `components/extraction/chat/message-list.tsx`: forward `webSearchSource` and `modelWebSearchPriceUsd` into each `<ToolStep>` for `web_search` parts. Reuse the `getChatWebSearchPricing` query result already present from the toggle (Convex deduplicates) OR extend the existing thread-scoped query the parent already runs. Commit `feat(chat): [plan-03] MessageRow forwards webSearchSource into ToolStep`. **Run next pm2 gate.**

8. U6 — Final acceptance grep:
```
grep -rn "0\.02" --include="*.tsx" --include="*.json" components/ messages/ | grep -v "from-primary/\[0\.02\]" | grep -v "oklch"
grep -rn "costUsdEstimate\|creditsPerSearchEstimate" --include="*.ts" --include="*.tsx" .
grep -rn "SEARCH_COST_DEFAULTS" --include="*.ts" --include="*.tsx" .
grep -rn "\\$0\\.02\|\\$0,02" messages/
```
All four must return ZERO non-cosmetic hits. Document the audit. Optional `chore: [plan-03] post-rewire grep audit clean` commit.

## COMMIT DISCIPLINE
Same as prior plans. Tag every commit `[plan-03]`. Conventional commits. One logical unit per commit. NEVER `--no-verify`. Never push to remote.

## WHEN TO STOP
Stop only when:
- All four greps return zero non-cosmetic hits.
- All new and existing tests pass.
- `tsc --noEmit` clean.
- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
- `npx pm2 logs next --lines 5 --nostream` shows recent `✓ Compiled` with no `Module not found` / `Type error` / `Failed to compile`.
- Manual smoke (per the plan's Test plan): tooltip shows the real credit count for the active path; switching models updates the tooltip; in-flight chip shows estimate, output-available chip shows actual.

You may NOT stop for: ambiguity resolvable by re-reading the plan, worry about token usage, impulse to check with the user before continuing.

## DEVIATIONS
Standard protocol per `CLAUDE.md`. If the i18n strings need a native-speaker pass and you're unsure of a translation, ship the first-cut translations from the plan's table and add a follow-up note in the plan file under `Deviations` — do NOT block the plan on translation review, but DO call it out so future passes can revise.

For a true blocker (e.g., `next-intl` interpolation behaves differently than expected for one locale): commit in-progress work, write `plans/unified-pricing/03-BLOCKER.md`, stop.

## START NOW
1. Read `plans/unified-pricing/00-README.md`, `01-pricing-module.md` (API surface), `02-rewire-billing-and-fix-null-fallback.md` (server-side context — useful even if not depended-on), and `03-rewire-ui-and-i18n.md` in full.
2. Read `convex/_generated/ai/guidelines.md`.
3. Read `components/extraction/chat/web-search-toggle.tsx`, `components/ai-elements/tool-step.tsx`, `lib/chat/format-search-cost.ts`, `lib/chat/format-search-cost.test.ts`, `convex/chat/messages.ts` (focus on `setChatWebSearchEnabled` for query-shape inspiration).
4. Read `messages/en-US.json` lines 1029-1031 and check the same key range in the other 5 locales.
5. `git status` — confirm clean tree.
6. `npx pm2 logs convex --lines 5 --nostream` AND `npx pm2 logs next --lines 5 --nostream` — confirm both healthy.
7. Begin R1 (rewrite `format-search-cost.test.ts`).

Go.
```
