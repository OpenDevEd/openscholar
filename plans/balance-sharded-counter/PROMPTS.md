# PROMPTS — Balance ShardedCounter migration + HIGH-priority perf fixes

One per-plan execution prompt below. Each is a complete, self-contained boot prompt for a fresh `/clear`'d session. Each is a single fenced code block — copy-paste in one action.

Standing rules that apply to ALL prompts in this folder (repeated in each prompt for safety):

- The repo's `CLAUDE.md` is binding. `useEffect` is banned. Tests must assert on behavior / ARIA / `data-*`, never on CSS class strings.
- Convex API rules in `convex/_generated/ai/guidelines.md` OVERRIDE training knowledge — read it before convex work.
- `convex/` file names: camelCase only. NO hyphens. Hyphens are rejected by the push.
- Migration stance: dev data is disposable. No widen-then-narrow. No backfill scripts under `convex/migrations/`.
- DRY: before adding helpers, search for existing donors (`convex/extraction/jobCounters.ts` is the donor for ShardedCounter usage).
- Pm2 deployability gate after every convex-touching commit: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!` and NO `✖ Error`.
- One commit per TDD green. One commit per Phase B logical unit. Conventional prefix + `[plan-NN]` scope.
- NEVER use `--no-verify`, `--no-gpg-sign`, or any hook-bypass.
- NEVER push to remote unless the user explicitly asks.
- Parallelize: any "find every caller" or library-source read should be delegated to a subagent.

---

## Prompt for `01-replace-balanceagg-with-sharded-counter.md`

```md
Execute `plans/balance-sharded-counter/01-replace-balanceagg-with-sharded-counter.md`.

Read first: this plan file, `plans/balance-sharded-counter/00-README.md`, and `convex/_generated/ai/guidelines.md`.

Long-running autonomous task. Expect 4-7 hours. Do not stop mid-plan to ask for confirmation. When the plan is ambiguous, pick the option most consistent with the donor `convex/extraction/jobCounters.ts` and document the choice in the commit message.

STANDING RULES
1. DRY: the donor module is `convex/extraction/jobCounters.ts`. Mirror its structure (top-level instances, `read*` / `inc*` / `clear*` exports, no class). Do NOT invent a new abstraction.
2. No legacy. Delete `balanceAgg` completely from `convex.config.ts`, `convex/credits/aggregates.ts`, both `*aggregates.test-support.ts` files, and any test that probed it.
3. Convex guidelines OVERRIDE training. Read `convex/_generated/ai/guidelines.md` before writing any function.
4. Testing: TDD on `convex/credits/balanceCounter.ts` (R1-R5). Test-after on the rewires. All tests assert on behavioral state (`readBalance(...)` returns expected `{free, paid, total}`), never on aggregate internals.
5. Deployability gate after EVERY commit that touches `convex/`: run `npx pm2 logs convex --lines 5 --nostream` and confirm `✔ Convex functions ready!` is the latest state. NO `✖ Error`. NO `- Preparing Convex functions...` repeating. If the push is stuck, STOP — do not commit further changes on top of a broken push.
6. Research before guessing. If ShardedCounter behavior inside an `internalAction` for the drift cron is unclear, delegate to a general-purpose agent or read `node_modules/@convex-dev/sharded-counter/src/client/index.ts`.
7. Delegate "find every caller" lookups to Explore agents.

EXECUTION RHYTHM
Phase A — pure logic / new module (`convex/credits/balanceCounter.ts`). TDD red→green→commit per test. One commit per R1-R5 cycle. Module path: `convex/credits/balanceCounter.ts`.
Phase B — test-after rewire. Numbered units U1-U9 per the plan. One commit per unit. After every commit that touches `convex/`, run the pm2 deployability gate.

COMMIT DISCIPLINE
- Conventional prefix: `feat`/`fix`/`refactor`/`test`/`chore`/`docs`/`perf`.
- Scope every commit with `[plan-01]`. Example: `feat(credits): [plan-01] implement R3 mixed-sign balance`.
- One commit per TDD green in Phase A. One commit per logical unit in Phase B.
- Never commit red. If a pre-commit hook fails, fix the underlying issue. Never use `--no-verify`.
- Plan-file edits (deviations, resume notes) ship as their own `docs: [plan-01] revise <section> — <reason>` commit BEFORE any code change that depends on them.

WHEN TO STOP
Stop when:
- All U1-U9 units are committed, pm2 deployability gate is green, all listed tests are green, and the originally failing extraction job (or any retry against the fat-ledger user) completes without `Too many bytes read`.
- A genuine blocker (a required API does not exist) is hit. Then commit in-progress work, write `01-BLOCKER.md`, and stop.

You may NOT stop for:
- Ambiguity resolvable by re-reading the plan, the donor module, or the Convex guidelines.
- Worry about token usage. The plan is designed for sustained execution.
- Impulse to check with the user on a detail the plan already locks.

DEVIATIONS
If the plan is wrong or incomplete:
1. Commit in-progress work first.
2. Edit the numbered plan file with the new approach and rationale.
3. Commit the plan edit under `docs: [plan-01] revise <section> — <reason>`.
4. Proceed against the revised plan.

Never silently depart from the plan.

START NOW
1. Read `plans/balance-sharded-counter/01-replace-balanceagg-with-sharded-counter.md` in full.
2. Read `plans/balance-sharded-counter/00-README.md`.
3. Read `convex/_generated/ai/guidelines.md`.
4. Read `convex/extraction/jobCounters.ts` (donor pattern).
5. Run `git status` and confirm a clean tree (no in-progress work to land first).
6. Run `npx pm2 logs convex --lines 5 --nostream` and confirm `✔ Convex functions ready!`. If the push is stuck from prior work, fix that first.
7. Begin Phase A R1.

Go.
```

---

## Prompt for `02-fix-h1-grant-prorata-collect.md`

```md
Execute `plans/balance-sharded-counter/02-fix-h1-grant-prorata-collect.md`.

Read first: this plan file, `plans/balance-sharded-counter/00-README.md`, and `convex/_generated/ai/guidelines.md`.

Short autonomous task. Expect 30-90 minutes. Do not stop mid-plan.

STANDING RULES
1. DRY: `getLatestCreditsByUser` already exists in `convex/credits/internal.ts`. Reuse it.
2. No legacy. Delete the `.collect()` line entirely — no commented-out version, no fallback.
3. Convex guidelines OVERRIDE training. Specifically: async iteration must NOT be combined with `.collect()` or `.take()`.
4. Testing: TDD R1-R3 per the plan. Each test asserts on observable behavior (outcome string, granted credits, side effects), never on internal scan counts via mocks.
5. Deployability gate after the final commit: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`.
6. Research before guessing. If you're unsure whether `by_credits_createdAt` index exists, grep `convex/schema.ts` — do not assume.

EXECUTION RHYTHM
Phase A — TDD on the dedup behavior. R1 (noise tolerance), R2 (positive dedup), R3 (non-matching grant in period). One commit per cycle.
Phase B — none (this is a one-function fix; TDD covers it).

COMMIT DISCIPLINE
- Conventional prefix: `fix` / `test`.
- Scope with `[plan-02]`.
- One commit per TDD cycle. Never commit red. No `--no-verify`.

WHEN TO STOP
Stop when R1-R3 are green, pm2 push is green, and `pnpm tsc --noEmit` is clean.

You may NOT stop for ambiguity resolvable by re-reading the plan.

DEVIATIONS
Per project doctrine — commit work, edit plan in git, commit plan edit, proceed.

START NOW
1. Read the plan file in full.
2. Read `convex/credits/internal.ts` lines 840-960 to confirm the current shape of `grantUpgradeProRataCredits`.
3. Read `convex/_generated/ai/guidelines.md` (query / async iteration rules).
4. Confirm `by_credits_createdAt` index in `convex/schema.ts`.
5. Run `npx pm2 logs convex --lines 5 --nostream`; confirm `✔ Convex functions ready!`.
6. Begin R1.

Go.
```

---

## Prompt for `03-fix-h4-zombie-locks-scan.md`

```md
Execute `plans/balance-sharded-counter/03-fix-h4-zombie-locks-scan.md`.

Read first: this plan file, `plans/balance-sharded-counter/00-README.md`, and `convex/_generated/ai/guidelines.md`.

Short autonomous task. Expect 30-60 minutes. Do not stop mid-plan.

STANDING RULES
1. DRY: `by_mode` index already exists on `extractionJobs` in `convex/schema.ts`. Do not invent a new one.
2. No legacy. Delete the misleading comment block at the current lines 141-144 — do not "preserve" it.
3. Convex guidelines OVERRIDE training. Specifically: `for await (const row of query)` is the right pattern here; don't combine with `.collect()`.
4. Testing: TDD R1-R3 per the plan. Each test asserts on observable post-state (which rows got patched, which didn't), never on internal iteration count.
5. Deployability gate after the final commit: `npx pm2 logs convex --lines 5 --nostream` must show `✔ Convex functions ready!`. Watch one cron tick after deploy.
6. Research before guessing. If unsure about how `convex-test` simulates crons, read the donor test files (search for other tests of cron handlers in `convex/`).

EXECUTION RHYTHM
Phase A — TDD on the cleanup behavior. R1 (only chat rows touched), R2 (fresh chat row spared), R3 (non-generating chat row spared). One commit per cycle.
Phase B — none.

COMMIT DISCIPLINE
- Conventional prefix: `fix` / `test`.
- Scope with `[plan-03]`.
- One commit per TDD cycle. Never commit red. No `--no-verify`.

WHEN TO STOP
Stop when R1-R3 are green, pm2 push is green, and one cron tick (or simulated invocation) confirms no error.

You may NOT stop for ambiguity resolvable by re-reading the plan.

DEVIATIONS
Per project doctrine.

START NOW
1. Read the plan file in full.
2. Read `convex/chat/concurrency.ts` lines 120-165.
3. Read `convex/_generated/ai/guidelines.md` (query rules).
4. Confirm `by_mode` index in `convex/schema.ts`.
5. Run `npx pm2 logs convex --lines 5 --nostream`; confirm `✔ Convex functions ready!`.
6. Begin R1.

Go.
```
