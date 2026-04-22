# Convex Remediation Hardening — Execution Prompts

Copy-paste prompts for fresh execution sessions.

Standing context for every prompt:

- Convex guidance in [`convex/_generated/ai/guidelines.md`](../../convex/_generated/ai/guidelines.md) overrides training memory.
- Project doctrine in root `AGENTS.md` is non-negotiable.
- Use subagents aggressively for audits beyond ~3 file reads / ~3 greps.
- No class-name assertions.
- No legacy or compatibility shims.

---

## Plan 01 — `plans/convex-remediation-hardening/01-correctness-and-type-restoration.md`

```md
**Header**  
Execute [plans/convex-remediation-hardening/01-correctness-and-type-restoration.md](./01-correctness-and-type-restoration.md) using [plans/convex-remediation-hardening/00-README.md](./00-README.md) as the control document. This is the first plan in the set.

**Autonomy framing**  
Long-running autonomous task. Expect 1.5-3 hours. Do not stop mid-plan to ask for confirmation. When a choice is ambiguous, pick the option that restores user-visible correctness fastest without reintroducing the broad-path performance bug.

**STANDING RULES**
1. DRY first. Reuse existing query tests, existing page harnesses, and existing Playwright setup before creating anything new.
2. No legacy behavior. Repair bad dev data directly; do not preserve silent-bad states.
3. Convex guidance overrides training memory for every file under `convex/`.
4. Research before guessing. If anything is “probably”, inspect source or docs.
5. Testing doctrine is behavioral: roles, text, ARIA, `data-*`; never CSS classes.
6. Delegate audits and cross-file mapping to subagents.
7. Do not conclude until the named Vitest runs and `pnpm tsc --noEmit` have been attempted.

**EXECUTION RHYTHM**
Phase A — TDD / red-green:
1. Add failing library query tests for missing counter correctness.
2. Add failing page-client tests for rendered filtered total/range.
3. Add failing AI settings failure-path test.
4. Add failing sidebar near-complete test.
Commit per green.

Phase B — Test-after implementation:
1. Fix the library correctness path.
2. Fix touched-file type failures required by this slice.
3. Implement AI settings error state.
4. Switch sidebar to query-supplied percent.
5. Run the targeted test set and `pnpm tsc --noEmit`.
Commit per logical unit.

**COMMIT DISCIPLINE**
1. Conventional commits only.
2. Scope every commit with `[plan-01]`.
3. One commit per TDD green, then one commit per logical implementation unit.
4. Never commit with tests red.
5. Do not push.

**WHEN TO STOP**
1. Stop only for a real blocker: missing required API, irreducible repo-wide type failure outside this slice, or data/fixture setup that cannot be discovered locally.
2. You may NOT stop for ambiguity that can be resolved by reading the current tests, the plan, or adjacent code.
3. You may NOT stop because the repo has unrelated noise; isolate and document it instead.

**DEVIATIONS**
1. If the plan is wrong, commit in-progress work first.
2. Edit the plan file.
3. Commit the plan edit under `docs: [plan-01] revise <section> — <reason>`.
4. Continue against the revised plan.

**START NOW**
1. Read the plan file.
2. Read the README.
3. Read `convex/_generated/ai/guidelines.md`.
4. Run `git status`.
5. Start with the first failing library query test.

Go.
```

---

## Plan 02 — `plans/convex-remediation-hardening/02-library-coverage-hardening.md`

```md
**Header**  
Execute [plans/convex-remediation-hardening/02-library-coverage-hardening.md](./02-library-coverage-hardening.md) using [plans/convex-remediation-hardening/00-README.md](./00-README.md) as context. Depends on plan 01 being merged locally.

**Autonomy framing**  
Long-running autonomous task. Expect 1.5-3 hours. Do not stop mid-plan to ask for confirmation. The purpose of this plan is to eliminate synthetic library confidence and replace it with behavior and invariant coverage.

**STANDING RULES**
1. Reuse the existing library query tests and page-client harness; do not fork a second library test stack.
2. No class assertions, no Tailwind assertions, no implementation-only hook-call-order confidence.
3. Use Playwright only for the highest-signal library smoke; keep browser scope tight.
4. Convex query invariants belong in Convex tests, not only in UI mocks.
5. Delegate any audit of current Playwright library/auth setup to subagents.

**EXECUTION RHYTHM**
Phase A — TDD / red-green:
1. Add failing collection-filter pagination tests.
2. Add failing page tests for rendered totals/range and search-to-browse reset.
3. Add failing library counter invariant tests.
4. Add failing browser smoke if fixture path is ready.
Commit per green.

Phase B — Test-after implementation:
1. Adjust fixtures/mocks to be query-ref-aware.
2. Add any tiny `data-*` contracts needed for stable assertions.
3. Implement only the code changes required by failing tests.
4. Run targeted Vitest and Playwright smoke.
Commit per logical unit.

**COMMIT DISCIPLINE**
1. Conventional commits only.
2. Scope every commit with `[plan-02]`.
3. Commit per green, then per logical unit.
4. Do not push.

**WHEN TO STOP**
1. Stop only if library browser smoke cannot be seeded with current local auth/data infrastructure.
2. You may NOT stop because the existing mocks are awkward; replace them.

**DEVIATIONS**
1. Commit in-progress work first.
2. Revise the plan file.
3. Commit the plan edit under `docs: [plan-02] revise <section> — <reason>`.
4. Continue.

**START NOW**
1. Read the plan file and README.
2. Confirm plan 01 is landed locally.
3. Inspect current library tests and any existing library/browser fixtures.
4. Begin with the failing collection pagination query test.

Go.
```

---

## Plan 03 — `plans/convex-remediation-hardening/03-chat-and-extraction-edge-hardening.md`

```md
**Header**  
Execute [plans/convex-remediation-hardening/03-chat-and-extraction-edge-hardening.md](./03-chat-and-extraction-edge-hardening.md) using [plans/convex-remediation-hardening/00-README.md](./00-README.md) as context. Depends on plan 01 being merged locally.

**Autonomy framing**  
Long-running autonomous task. Expect 2-4 hours. Do not stop mid-plan to ask for confirmation. Preserve the bandwidth wins, but do not keep any silent truncation or bootstrap undercount path.

**STANDING RULES**
1. Reuse the current chat/extraction test harnesses; harden them instead of building parallel suites.
2. Convex guidelines override memory for query return-shape changes.
3. No duplicate broad reads unless the plan is formally revised first.
4. Tests must force the edge case, not infer it from a happy-path fixture.
5. Delegate codebase mapping for chat/extraction consumers to subagents.

**EXECUTION RHYTHM**
Phase A — TDD / red-green:
1. Add failing cap-exhaustion regression test for `listThreadMessages`.
2. Add failing real-provider `SuggestionChips` bootstrap test.
3. Add failing non-chat extraction route test.
Commit per green.

Phase B — Test-after implementation:
1. Fix `listThreadMessages` integrity under read caps.
2. Make source count authoritative through bootstrap.
3. Tighten extraction route mode coverage.
4. Run targeted Vitest.
Commit per logical unit.

**COMMIT DISCIPLINE**
1. Conventional commits only.
2. Scope every commit with `[plan-03]`.
3. Never batch unrelated chat and extraction fixes into one commit.
4. Do not push.

**WHEN TO STOP**
1. Stop only for a true blocker such as an external library limitation that prevents preserving visible-page integrity.
2. You may NOT stop because the current provider wiring is inconvenient; the race is exactly why this plan exists.

**DEVIATIONS**
1. Commit partial work cleanly.
2. Revise the plan file first.
3. Commit the plan edit under `docs: [plan-03] revise <section> — <reason>`.
4. Continue.

**START NOW**
1. Read the plan file and README.
2. Read `convex/_generated/ai/guidelines.md`.
3. Confirm plan 01 is landed locally.
4. Begin with the cap-exhaustion regression test.

Go.
```

---

## Plan 04 — `plans/convex-remediation-hardening/04-settings-and-screening-hardening.md`

```md
**Header**  
Execute [plans/convex-remediation-hardening/04-settings-and-screening-hardening.md](./04-settings-and-screening-hardening.md) using [plans/convex-remediation-hardening/00-README.md](./00-README.md) as context. Depends on plan 01 being merged locally.

**Autonomy framing**  
Medium autonomous task. Expect 1-2.5 hours. Do not stop mid-plan to ask for confirmation. Keep the scope narrow: explicit failure semantics and durable coverage.

**STANDING RULES**
1. Reuse the existing settings/screening test harnesses.
2. Empty-state and error-state must remain distinct.
3. Sidebar progress must trust the shared query output.
4. Add behavior assertions in addition to mounted-query assertions.
5. Delegate any broad scan of adjacent settings/billing tests to subagents.

**EXECUTION RHYTHM**
Phase A — TDD / red-green:
1. Add failing AI settings failure-path test.
2. Add failing sidebar near-complete test.
3. Add one failing settings/screening behavior assertion if mounted-query-only coverage remains.
Commit per green.

Phase B — Test-after implementation:
1. Implement explicit AI settings fetch states.
2. Switch sidebar rendering to `percentComplete`.
3. Update adjacent tests.
4. Run targeted Vitest.
Commit per logical unit.

**COMMIT DISCIPLINE**
1. Conventional commits only.
2. Scope every commit with `[plan-04]`.
3. Commit per green, then per logical unit.
4. Do not push.

**WHEN TO STOP**
1. Stop only if an adjacent settings/billing surface turns out to depend on undocumented shared state that cannot be discovered locally.
2. You may NOT stop because a mounted-query assertion already exists; behavior coverage is required.

**DEVIATIONS**
1. Commit in-progress work first.
2. Revise the plan file.
3. Commit the plan edit under `docs: [plan-04] revise <section> — <reason>`.
4. Continue.

**START NOW**
1. Read the plan file and README.
2. Confirm plan 01 is landed locally.
3. Inspect current AI settings and sidebar tests.
4. Start with the failing AI settings failure-path test.

Go.
```

---

## Plan 05 — `plans/convex-remediation-hardening/05-verification-gate-and-browser-smoke.md`

```md
**Header**  
Execute [plans/convex-remediation-hardening/05-verification-gate-and-browser-smoke.md](./05-verification-gate-and-browser-smoke.md) using [plans/convex-remediation-hardening/00-README.md](./00-README.md) as context. Depends on plans 02, 03, and 04 being merged locally.

**Autonomy framing**  
Long-running autonomous task. Expect 1.5-3 hours. Do not stop mid-plan to ask for confirmation. The purpose of this plan is to ensure the corrective work can be verified repeatably and cannot regress silently.

**STANDING RULES**
1. Use the repo’s existing Playwright infrastructure; do not add another browser framework.
2. Keep the smoke scope narrow and high-signal.
3. The verification gate must include typecheck.
4. If full typecheck is blocked by unrelated noise, document the blocker explicitly instead of silently narrowing the gate.
5. Delegate browser-fixture and auth-setup audits to subagents.

**EXECUTION RHYTHM**
Phase A — TDD / red-green:
1. Add failing Playwright smoke(s) for the highest-signal user-visible contracts.
2. Add any failing verification wrapper or script assertions.
Commit per green.

Phase B — Test-after implementation:
1. Add the verification command or helper.
2. Run targeted Vitest, Playwright smoke, and `pnpm tsc --noEmit`.
3. Spot-check `pm2 logs convex --lines 120 --nostream`.
4. Document any blocker explicitly.
Commit per logical unit.

**COMMIT DISCIPLINE**
1. Conventional commits only.
2. Scope every commit with `[plan-05]`.
3. Commit per green, then per logical unit.
4. Do not push.

**WHEN TO STOP**
1. Stop only for a real blocker such as impossible local browser seeding or irreducible unrelated type noise that prevents a meaningful gate.
2. You may NOT stop because the unit tests are already green; this plan exists because that was insufficient.

**DEVIATIONS**
1. Commit in-progress work first.
2. Revise the plan file.
3. Commit the plan edit under `docs: [plan-05] revise <section> — <reason>`.
4. Continue.

**START NOW**
1. Read the plan file and README.
2. Confirm plans 02-04 are landed locally.
3. Inspect existing Playwright auth and chat/library patterns.
4. Start with the first failing browser smoke.

Go.
```
