# Evidence Library service authentication prompts

Use one prompt at a time in order. Never push unless the user asks.

## Plan 01

```md
Plan: `plans/evidence-library-service-auth/01-library-service-credential.md`
Context: `plans/evidence-library-service-auth/00-README.md`
Dependencies: none.

Long-running autonomous task. Expect 1–2 hours. Continue through the full plan without asking questions that the plan or repository answers.

## STANDING RULES
1. Reuse `access.ts`, `credentials.ts`, `credentialActions.ts`, `convex/lib/crypto.ts`, and the wallet token donor.
2. No legacy or second credential store.
3. Read `convex/_generated/ai/guidelines.md`; it overrides training.
4. Use one behavioral failing test, one minimal green, then clean up.
5. After each Convex commit, require `npx pm2 logs convex --lines 5 --nostream` to show `✔ Convex functions ready!`.
6. Check current primary docs before guessing.
7. Delegate broad maps only; keep TDD and commits in this session.

## EXECUTION RHYTHM
Phase A: TDD token generation, upsert, rotation, and authentication in the exact files named by the plan. Commit each green.
Phase B: connect the public rotation action, check generated validators, and commit the integration unit.

## COMMIT DISCIPLINE
Use conventional commits with `[plan-01]`. Never commit red tests, bypass hooks, or push.

## WHEN TO STOP
Stop only when every completion rule and the pm2 gate pass. Do not stop for an answer already in the plan or concern about token use.

## DEVIATIONS
Commit safe work, update and commit the plan before changing direction. For a real blocker, write `01-BLOCKER.md` and stop.

## START NOW
1. Read the plan, README, Convex rules, and named donors.
2. Check `git status` and `npx pm2 logs convex --lines 5 --nostream`.
3. Write the first failing rotation test.

Go.
```

## Plan 02

```md
Plan: `plans/evidence-library-service-auth/02-admin-login-code.md`
Context: `plans/evidence-library-service-auth/00-README.md`
Dependency: Plan 01 is green and committed.

Long-running autonomous task. Expect 1–2 hours. Continue through the full plan without unnecessary questions.

## STANDING RULES
1. Reuse `requireEvidenceLibraryAccess`; never trust client identity or role.
2. No legacy token format, compatibility path, or second membership model.
3. Read the Convex rules first.
4. Use red → green for every issue and denial behavior.
5. Run the Convex pm2 gate after every backend commit.
6. Use current primary docs before guessing.
7. Keep TDD and commits in the main session.

## EXECUTION RHYTHM
Phase A: TDD secure token policy and persisted binding. Commit each green.
Phase B: add the public issue action and deployed validator check.

## COMMIT DISCIPLINE
Use conventional commits with `[plan-02]`. Never commit red, bypass hooks, or push.

## WHEN TO STOP
Stop only when all completion rules and the pm2 gate pass.

## DEVIATIONS
Update and commit the plan before changing direction. Write `02-BLOCKER.md` only for a real blocker.

## START NOW
1. Read the plan, README, Convex rules, access helper, and Clerk prerequisite record.
2. Check Git and pm2.
3. Write the first failing Owner issue test.

Go.
```

## Plan 03

```md
Plan: `plans/evidence-library-service-auth/03-redemption-http.md`
Context: `plans/evidence-library-service-auth/00-README.md`
Dependencies: Plans 01 and 02 are green and committed.

Long-running autonomous task. Expect 1–2 hours. Finish the atomic redemption and deployed endpoint proof.

## STANDING RULES
1. Reuse the existing HTTP router and prior plan helpers.
2. No second session system or general API gateway.
3. Read Convex rules before coding.
4. Test the public request and one-time result, not internal calls.
5. Run the Convex pm2 gate after each commit.
6. Follow current Convex HTTP and transaction docs.
7. Keep TDD, commits, and final smoke here.

## EXECUTION RHYTHM
Phase A: TDD one atomic redemption mutation. Commit each green.
Phase B: add the HTTP handler, response mapping, deployed route smoke, and one integration commit.

## COMMIT DISCIPLINE
Use conventional commits with `[plan-03]`. Never commit red, bypass hooks, or push.

## WHEN TO STOP
Stop only after focused tests, replay proof, function spec, endpoint smoke, and pm2 pass.

## DEVIATIONS
Commit safe work and revise the plan first. Write `03-BLOCKER.md` for a real blocker.

## START NOW
1. Read the plan, README, Convex rules, and current HTTP router.
2. Check Git and pm2.
3. Write the first failing successful-redemption test.

Go.
```
