# PROMPTS — DRY credit billing rollout

Per-plan execution prompts for `plans/dry-credit-billing-drain-to-zero/`. Copy a fenced block into a fresh `/clear`'d session.

Standing rules apply to every prompt — they are repeated in each prompt's `STANDING RULES` block.

---

## Plan 01

```md
You are executing `plans/dry-credit-billing-drain-to-zero/01-extend-public-deduct-mutation.md`. Read the README at `plans/dry-credit-billing-drain-to-zero/00-README.md` first.

This is the foundational plan — plans 02 and 03 depend on its return-shape change.

Long-running autonomous task. Expect 1–2 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with existing code patterns and document the choice in the commit message.

STANDING RULES
1. DRY: `deductCreditsTransaction` already supports `allowPartial` and returns `{deducted, remaining}` — the public mutation is just exposing what already exists. Do not duplicate logic in the handler.
2. No legacy: do not keep the `v.number()` return shape "for compatibility". Update every caller in the same commit.
3. Read `convex/_generated/ai/guidelines.md` before any Convex change.
4. Convex test file naming: only alphanumeric, underscore, period. No hyphens in `convex/` files.
5. Deployability gate after the commit: `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` (if pm2 is running). If pm2 is idle, run `npx convex dev --once`. No `✖ Error` lines.
6. After deploy, also confirm the function spec carries `allowPartial` in args and `{deducted, remaining}` in returns.
7. Research before guessing: if anything about `deductCreditsTransaction` semantics is unclear, read its source at `convex/credits/internal.ts:1536-1681`.
8. Delegate to subagents only for repository-wide grep sweeps; this plan is concentrated in 5 files and is faster inline.

EXECUTION RHYTHM
Phase A (TDD, pure logic): none — pure logic already lives in `deductCreditsTransaction` and is tested.
Phase B (test-after, atomic units):
  1. Update `convex/credits/internal.ts:1683-1707` mutation: add `allowPartial` to args, change `returns` validator, simplify handler to passthrough.
  2. Update test files to destructure new return shape: `deduct-credits.test.ts`, `aggregates.test.ts`, `wallet.test.ts`, `gateway.test.ts`.
  3. Add new test in `deduct-credits.test.ts` exercising public mutation with `allowPartial: true`.

COMMIT DISCIPLINE
- One commit. Atomic. Conventional prefix `refactor(credits): [plan-01] expose allowPartial + return {deducted,remaining} on public deductCredits`.
- Do NOT use `--no-verify`.

WHEN TO STOP
Stop when: all four touched test files pass green, `npx tsc --noEmit` is clean, deployability gate is green, function-spec confirms new shape.
You may NOT stop for: ambiguity resolvable by re-reading the plan or `convex/credits/internal.ts`, worry about token usage, impulse to check with the user.

DEVIATIONS
If the plan turns out to be wrong (e.g. a caller you didn't expect breaks under the new shape), commit in-progress work, edit this plan with the correction, commit the plan edit as `docs: [plan-01] revise <section> — <reason>`, then proceed.

START NOW
1. Read `plans/dry-credit-billing-drain-to-zero/01-extend-public-deduct-mutation.md`.
2. Read `plans/dry-credit-billing-drain-to-zero/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status` — confirm clean working tree.
5. `npx pm2 logs convex --lines 5 --nostream` — confirm dev push is healthy at boot (or run `npx convex dev --once` if pm2 is idle).
6. Begin the mutation edit.

Go.
```

---

## Plan 02

```md
You are executing `plans/dry-credit-billing-drain-to-zero/02-migrate-ai-helpers-wrappers.md`. Read the README at `plans/dry-credit-billing-drain-to-zero/00-README.md` first. Depends on plan 01 being merged.

Long-running autonomous task. Expect 1–2 hours.

STANDING RULES
1. DRY: the three wrappers share the same shape — pre-flight, handler call, deduction. Migrate them with the same code shape, not three subtly different shapes.
2. No legacy: do not leave the old `await ctx.runMutation(...)` shape in any of the three migrated sites.
3. Do NOT migrate `applyBatchItemDeductions` callback — its salvage is the per-item drain equivalent.
4. Read `convex/_generated/ai/guidelines.md` before changes.
5. No hyphens in convex file names.
6. Deployability gate after each commit (one per migrated site or one overall): `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!`.
7. Research first: read `convex/ai/lib/applyBatchItemDeductions.ts` to understand why we keep that path on the throwing API.
8. Delegate sub-tasks only when investigation exceeds 3 file reads.

EXECUTION RHYTHM
Phase A (TDD): create `convex/ai/helpers.test.ts` (or extend if exists). Test `withUserCreditsBatch` first (simplest), red → green → commit. Same for the other two wrappers.
Phase B (test-after): N/A — all changes are covered by Phase A tests.

COMMIT DISCIPLINE
- One commit per wrapper migration: `refactor(ai/helpers): [plan-02] withUserCreditsBatch drains wallet to zero on shortfall` etc. Three commits total.
- One commit for the regression test on `applyBatchItemDeductions` salvage path.

WHEN TO STOP
Stop when: all wrapper tests pass, `npx tsc --noEmit` clean, deployability gate green.
You may NOT stop for ambiguity resolvable by re-reading the plan.

DEVIATIONS
If the `creditContext` ordering change breaks a downstream PostHog assertion, commit work-in-progress, edit the plan, commit the plan edit, then proceed.

START NOW
1. Read the plan.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. Read `convex/ai/lib/applyBatchItemDeductions.ts` to internalize why the callback stays unchanged.
5. `git status` — clean.
6. `npx pm2 logs convex --lines 5 --nostream`.
7. Begin with `withUserCreditsBatch` test.

Go.
```

---

## Plan 03

```md
You are executing `plans/dry-credit-billing-drain-to-zero/03-migrate-direct-callers.md`. Read the README first. Depends on plan 01 being merged.

Long-running autonomous task. Expect 2–3 hours due to three independent sites.

STANDING RULES
1. DRY: same migration shape across all three sites — capture `deducted`, use it for any downstream side effect.
2. CRITICAL: `recordCreditSpend.creditsUsed` MUST mirror `deducted`, not the input estimate. Inflating the aggregator by the shortfall corrupts every per-job spend dashboard.
3. CRITICAL: in the embedding site, `updates.indexingBilled = true` belongs OUTSIDE the `if (deducted > 0)` guard. The embedding succeeded; only billing was partial.
4. No legacy.
5. Read `convex/_generated/ai/guidelines.md` before changes.
6. Deployability gate after EACH commit (three commits expected, one per site).
7. Research: read the existing test files for each site before writing new test cases.
8. Delegate per-site test writing to a subagent if helpful, but commit yourself.

EXECUTION RHYTHM
Phase A (TDD): one commit per site, one test added per site, red → green → commit.
Phase B: aggregator-mirror test — assert that on a 50%-funded extraction, the creditsAgg B-tree entry equals the actual deducted amount, not the input.

COMMIT DISCIPLINE
- `fix(extraction): [plan-03] drain wallet on per-question extraction shortfall, mirror aggregator with actual deducted`
- `fix(extraction): [plan-03] drain wallet on embedding shortfall, flip indexingBilled even when partial`
- `fix(wallet/gateway): [plan-03] drain wallet on gateway-completion shortfall`

WHEN TO STOP
Stop when: each of the three sites has a green test asserting drain-to-zero, aggregator mirror, and downstream side effects (`indexingBilled`, `recordResult`, etc.).
You may NOT stop for ambiguity.

DEVIATIONS
If the `recordCreditSpend` aggregator schema rejects a zero-amount entry, document it and skip the call when `deducted === 0`.

START NOW
1. Read the plan.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status`.
5. `npx pm2 logs convex --lines 5 --nostream`.
6. Begin with site 1 (extraction per-question).

Go.
```

---

## Plan 04

```md
You are executing `plans/dry-credit-billing-drain-to-zero/04-tighten-wallet-gateway-preflight.md`. Read the README first. Independent of plans 02 and 03; can ship in parallel.

Short autonomous task. Expect 30–60 minutes.

STANDING RULES
1. DRY: reuse `ESTIMATED_CREDITS_PER_WEB_SEARCH` (already defined in `convex/lib/constants.ts:46`) for the web-search add-on. Do not introduce a second constant.
2. No legacy: replace the `<= 0` gate, do not leave it as a fallback.
3. Read `convex/_generated/ai/guidelines.md`.
4. Deployability gate after the commit.
5. The new gate runs AFTER request parsing (because it depends on `req.web_search_options`), not before.

EXECUTION RHYTHM
Phase A (TDD): two new test cases in `convex/wallet/gateway/gateway.test.ts` — non-web-search 402 at 50 credits, web-search 402 at 600 credits.
Phase B: implement constant + gate change.

COMMIT DISCIPLINE
- Two commits:
  - `feat(credits): [plan-04] add ESTIMATED_CREDITS_PER_WALLET_API_CALL constant`
  - `feat(wallet/gateway): [plan-04] estimate-based pre-flight, replaces <=0 check`

WHEN TO STOP
Stop when: both new test cases green, `tsc` clean, deployability gate green.

DEVIATIONS
None expected — plan is small.

START NOW
1. Read the plan.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. `git status`.
5. `npx pm2 logs convex --lines 5 --nostream`.
6. Begin with the test case.

Go.
```
