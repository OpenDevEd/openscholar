# Prompts

## Plan 01: move and shorten OpenScholar CI

```text
Implement plans/openscholar-self-hosted-ci/01-runner-and-workflow.md.
Read plans/openscholar-self-hosted-ci/00-README.md first.
Depends on: the plan commit `docs: [plan-01] plan OpenScholar self-hosted CI`.

Repository: /Users/mcharrad/Documents/Github/openscholar/openscholar-self-hosted-ci
Branch: codex/openscholar-self-hosted-ci
Target PR branch: dev
Estimate: one working day, including full GitHub runs. Keep working without asking questions whose answers are in the plan, repository, live GitHub state, host, or official docs.

STANDING RULES

1. Read and follow AGENTS.md, /Users/mcharrad/.agents/skills/ponytail/SKILL.md, and /Users/mcharrad/.agents/skills/unslop/SKILL.md. Search before building. Use the smallest design in the plan.
2. Keep clean breaking changes. Do not add compatibility paths, an autoscaler, Kubernetes, a cache service, a runner framework, or a custom CI service.
3. Do not edit Convex code or application behavior. Do not run a local Convex backend, PM2, Coolify changes, production Convex, or a host Docker operation.
4. Read docs/test-quality.md. No test edit is planned. If one becomes necessary, stop and use the test-decision skill before editing it. Test behavior and real service results, never CSS or source strings.
5. Preserve every current check, artifact, timeout, validation, failure rule, and billing concurrency rule. Do not make a required check optional or skipped.
6. Keep fork pull requests off self-hosted runners. Runner groups allow only the immutable reusable workflow commit. A label is routing, not isolation.
7. Keep new-el-ci and runner group 6 unchanged. Never interrupt a busy runner. Use the fresh openscholar-ci guest in the plan.
8. Check current official GitHub, Next.js, and Playwright docs instead of guessing. Read the installed Next.js guide before any Next build setting change.
9. Do not share accounts, workdirs, npm caches, browser caches, Docker sockets, or writable tools across the light and secret trust levels.

EXECUTION RHYTHM

1. Restore repository test secrets from the checked dev-cloud environment. Create the plan's deployment-scoped `CONVEX_DEPLOY_KEY` for the live billing push. Push the already-committed plan, open the PR to dev, and record two full GitHub-hosted baseline runs where auth and billing execute.
2. Create the fresh bounded guest, groups, accounts, and runners. Read every setting back before changing workflow routing.
3. Add and commit the immutable reusable workflow. Restrict both runner groups to its exact commit. Then change and commit the two caller workflows.
4. Run checksum-verified actionlint and preliminary cold/warm runs. Keep a Next build setting only if it passes the plan's A/B rule.
5. Run one read-only Fable 5 review, fix findings, commit, then run the final exact head twice. Run the second beside the new-el reference run.

COMMIT DISCIPLINE

- Check git status before staging. Preserve unrelated files. Stage named files only.
- Use conventional prefixes and `[plan-01]` on every commit.
- The plan commit must remain older than every infrastructure or workflow change.
- Never commit a failing workflow. Never bypass hooks.
- Push this branch and keep the PR open against dev. Do not merge it.

WHEN TO STOP

- Stop only for the conflict named in the plan: the fixed guest cannot preserve the secret boundary, fork boundary, resource limits, full live checks, or concurrent new-el health.
- Commit safe work, write plans/openscholar-self-hosted-ci/01-BLOCKER.md with exact evidence and options, and stop.
- Do not stop for an answer already in the plan, token worry, a long running review, or a queued GitHub job.

DEVIATIONS

- If the plan is wrong and the safe path is clear, commit safe work, edit the numbered plan first, explain the measured reason, commit `docs: [plan-01] revise <section> - <reason>`, then continue.
- Never change direction silently.

REPORT

Give the PR URL, exact head SHA, all commits, before and after GitHub timing tables, runner groups and accounts, job-to-runner proof, fork proof, artifact proof, cache bytes, CPU and memory peaks, disk growth, new-el and host health links, remaining hosted jobs with exact reasons, and any manual integration-owner step.

START NOW

1. Read AGENTS.md, the README, this plan, ponytail, unslop, docs/test-quality.md, both current workflows, package scripts, Playwright, Vitest, Next config, and the installed Next docs.
2. Check git status and current origin/dev. Confirm the plan commit exists before any other change.
3. Confirm all five new-el runners are idle before any shared-host operation. Do not alter them.
4. Start with the full GitHub-hosted baseline.

Go.
```
