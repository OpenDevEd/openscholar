# Prompts

Each prompt is complete on its own. Copy the block for the plan the agent runs. The integration owner fills in nothing: worktree, branch, lane and dependencies are stated.

## Plan 01 — runtime read api and legal markdown

```text
Implement plans/evidence-library-configuration-v2/01-runtime-read-api-and-legal-markdown.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: none.

Lane B. Repository: OpenDevEd/new-el. Worktree: /Users/mcharrad/Documents/Github/new-el-runtime-api. Branch: codex/openscholar-read-api, created from current origin/main. Assigned Convex lane: none (runtime; use `npm run check:changed` and the runtime acceptance suite). Target branch for the PR: main.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. This is the Evidence Library runtime. Read AGENTS.md there first; it requires `npm run check:changed` (lint, TypeScript, schema check, unit tests, Fallow) before any push. Fallow blocks new dead code and complexity; keep new exports used and functions small.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Before finishing: `npm run check:changed`, then `npm run test:acceptance` because this changes runtime configuration and HTTP routes. Both must pass.
6. Deployability: the endpoints or pages are checked against a development library as the plan states. Remove any development library you created before opening the PR.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane B. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-01]`, for example `feat(evidence-libraries): [plan-01] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to main when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/01-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-01] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/main and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 02 — generic sections

```text
Implement plans/evidence-library-configuration-v2/02-generic-sections.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plan 01 merged and the contract re-pinned on dev.

Lane A. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/platform-sprint. Branch: codex/generic-sections, created from current origin/dev. Assigned Convex lane: dev/agents/platform (port 3011). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane A. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-02]`, for example `feat(evidence-libraries): [plan-02] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/02-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-02] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 03 — uploads

```text
Implement plans/evidence-library-configuration-v2/03-uploads.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plan 02 merged.

Lane A. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/platform-sprint. Branch: codex/uploads, created from current origin/dev. Assigned Convex lane: dev/agents/platform (port 3011). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane A. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-03]`, for example `feat(evidence-libraries): [plan-03] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/03-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-03] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 04 — update and restore

```text
Implement plans/evidence-library-configuration-v2/04-update-and-restore.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plan 02 merged.

Lane A. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/platform-sprint. Branch: codex/runtime-updates, created from current origin/dev. Assigned Convex lane: dev/agents/platform (port 3011). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane A. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-04]`, for example `feat(evidence-libraries): [plan-04] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/04-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-04] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 05 — page shell and brand

```text
Implement plans/evidence-library-configuration-v2/05-page-shell-and-brand.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plan 02 merged; the mock branch feat/library-interface-mock is the source to port.

Lane C. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/page-sprint. Branch: codex/config-page-brand, created from current origin/dev. Assigned Convex lane: dev/agents/page (port 3013). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane C. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-05]`, for example `feat(evidence-libraries): [plan-05] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/05-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-05] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 06 — page content discovery

```text
Implement plans/evidence-library-configuration-v2/06-page-content-discovery.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plan 05 merged.

Lane C. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/page-sprint. Branch: codex/config-page-sections, created from current origin/dev. Assigned Convex lane: dev/agents/page (port 3013). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane C. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-06]`, for example `feat(evidence-libraries): [plan-06] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/06-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-06] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 07 — sources and data pickers

```text
Implement plans/evidence-library-configuration-v2/07-sources-and-data-pickers.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plans 01 and 02 merged.

Lane B. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/data-sprint. Branch: codex/zotero-groups-and-pickers, created from current origin/dev. Assigned Convex lane: dev/agents/data (port 3012). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane B. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-07]`, for example `feat(evidence-libraries): [plan-07] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/07-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-07] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 08 — versions team and cleanup

```text
Implement plans/evidence-library-configuration-v2/08-versions-team-and-cleanup.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plans 04 and 07 merged.

Lane B. Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/data-sprint. Branch: codex/versions-and-cleanup, created from current origin/dev. Assigned Convex lane: dev/agents/data (port 3012). Target branch for the PR: dev.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, the README, current code, AGENTS.md, or official documentation. Do not stop for token worry.

STANDING RULES

1. Search before building. Reuse the code the README lists. Extend existing helpers, validators, fixtures and components instead of adding parallel ones.
2. Make clean breaking changes. Delete replaced code. No compatibility layers, fallbacks, feature flags for old paths, or migrations of development data.
3. Read convex/_generated/ai/guidelines.md before editing Convex code. Upload only with `npx convex dev --once` to the assigned lane. Never start a local Convex backend, never use PM2, never run `npm run convex:push`, never touch the shared self-hosted deployment, Coolify, or another lane. Do not copy CONVEX_SELF_HOSTED_* values into this worktree.
4. Use the test-decision skill and docs/test-quality.md before every test edit. Test behaviour, data and rendered text or roles. Never test CSS classes, copy alone, or mock call counts.
5. Run the smallest test during each unit. Before finishing: `npx vitest run` for the touched areas, `npx tsc --noEmit`, and the browser or Convex gate named in the plan. Failures that also fail on the base branch are listed in the PR, not fixed silently.
6. After committing Convex code: `npx convex dev --once` must end with `Convex functions ready!`, then `npx convex logs --history 200` must show no matching error. For page work: `npm run dev:web` on the lane port, open the changed page signed in, no compile or runtime error.
7. Owner-facing copy follows the mock plan rules (plans/evidence-library-full-configuration-mock/00-README.md on branch feat/library-interface-mock): plain words, sentence case, no counts unless they matter, no dots between facts, no vendor or hosting names, no jargon.
8. Write-set: only the paths the README assigns to lane B. If a change outside them is unavoidable, stop and write a blocker file instead of editing another lane's files.
9. Check current official docs or installed library source instead of guessing. For Next.js, read node_modules/next/dist/docs/ for any API you touch.

EXECUTION RHYTHM

1. For pure logic (validators, rules, mappers, helpers): write the failing test, make it pass, clean up, commit.
2. For integration work (Convex functions, routes, pages): build the smallest working unit, add its behaviour test, run the gate, commit.
3. Keep each commit a working unit. Commit the plan before code that depends on a plan change.

COMMIT DISCIPLINE

- Check `git status` before staging; preserve unrelated work; stage named files only.
- Conventional prefixes with `[plan-08]`, for example `feat(evidence-libraries): [plan-08] ...`.
- Never commit failing work. Never bypass hooks. Push the branch and open a PR to dev when the plan's completion rules pass. Do not merge.

WHEN TO STOP

- Stop only for a missing required API, an unsafe existing bug, or a conflict the plan and code cannot resolve. Then commit safe work, write plans/evidence-library-configuration-v2/08-BLOCKER.md with what was tried and what unblocks it, and stop.
- Do not report completion until the tests, TypeScript, the lane upload or runtime checks, and the plan's deployability gate pass.

DEVIATIONS

- If the plan is wrong and the better path is clear, commit safe work, update the numbered plan with the reason, commit it as `docs: [plan-08] revise <section> — <reason>`, and continue.
- Never change direction silently.

REPORT

PR URL; commits; files changed; exact check outputs (tails); the gate proof (log lines, URLs, screenshots for pages); anything left out and why.

START NOW

1. Read the README, this plan, AGENTS.md, and the rules files named above.
2. Run `git status`; confirm the branch starts from current origin/dev and the worktree's .env.local targets the assigned lane.
3. Confirm no other Convex uploader uses this worktree or lane.
4. Start with the first test-first unit in the plan.

Go.
```


## Plan 09 — library pages

```text
Implement plans/evidence-library-configuration-v2/09-library-pages.md.
Read plans/evidence-library-configuration-v2/00-README.md first.
Depends on: plans 05–08 merged (they are).

Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/pages-sprint. Branch: codex/library-pages (created from origin/dev). Assigned Convex lane: the one in the worktree .env.local (calm-labrador-815, port 3013). Target branch for the PR: dev.

Design source: branch feat/library-interface-mock (origin, commit e7ad8929): app/evidence-libraries/*, components/evidence-libraries/mock/{library-list,library-status-badge,library-not-found,delete-library-dialog,new-library-form,admin-launch,mock-org-switcher}.tsx and the mock page shells. Read them with `git show origin/feat/library-interface-mock:<path>`. Mock screenshots: /tmp/shots/page2-list.png, page2-new.png, page2-setup.png, page2-admin.png.

Keep working until the completion rules pass. Do not ask questions whose answers are in the plan, README, code, AGENTS.md or official docs.

STANDING RULES
1. Search before building; reuse configuration/fields.tsx controls, existing Convex queries and mutations, existing tests and fixtures.
2. Clean breaking changes: delete the old page components you replace. No mock store, no fake data, no compatibility paths.
3. Read convex/_generated/ai/guidelines.md before Convex edits. Upload only with `npx convex dev --once` to the lane. Never `npm run convex:push`, never touch the shared deployment, Coolify or another lane. Do not copy CONVEX_SELF_HOSTED_* values.
4. test-decision skill and docs/test-quality.md before every test edit. Behaviour, roles, labels, data-* only.
5. Before finishing: `npx vitest run` for touched areas, `npx tsc --noEmit` (two known errors in components/icons/openalex-icon.tsx), and the browser gate in the plan.
6. No useEffect for app state (AGENTS.md). Next.js APIs: read node_modules/next/dist/docs/ first.
7. Owner-facing copy follows the mock rules; six locales, English mirrored.

EXECUTION RHYTHM: one page per commit (list, new, setup, admin, shell), each with its test and a lane browser check.

COMMIT DISCIPLINE: conventional prefix with `[plan-09]`; stage named files; never commit failing work; never bypass hooks; push and open a PR to dev; do not merge.

WHEN TO STOP: only for a missing API or unsafe bug — commit safe work, write plans/evidence-library-configuration-v2/09-BLOCKER.md, stop.

DEVIATIONS: fix the plan first (`docs: [plan-09] revise <section> — <reason>`), then continue.

REPORT: PR URL, commits, check tails, gate screenshots side by side with the mock, anything left out.

START NOW: read the plan, README, AGENTS.md; `git status`; confirm the lane in .env.local; start with the list page.

Go.
```

## Plan 10 — defaults and team

```text
Implement plans/evidence-library-configuration-v2/10-defaults-and-team.md.
Read plans/evidence-library-configuration-v2/00-README.md and AGENTS.md first.
Depends on: plans 05–09 merged (they are).

Repository: OpenDevEd/openalex-count. Worktree: /Users/mcharrad/Documents/Github/openscholar/pages-sprint. Branch: codex/defaults-and-team from current origin/dev. Convex lane: the one in the worktree .env.local (calm-labrador-815, port 3013). PR target: dev.

Runtime facts: local checkout /Users/mcharrad/Documents/Github/new-el-runtime-api (main 7c269e10), src/config/library-config/schema.ts (assets 160-180, analytics 1337-1357, email 1388-1413 and 1775-1790).

STANDING RULES: reuse existing helpers/controls (configuration/fields.tsx, runtimeActionConfig.ts env helpers, uploads); clean breaking changes, delete replaced code; Convex guidelines before Convex edits; upload only with `npx convex dev --once` to the lane; never `npm run convex:push`, never touch the shared deployment or Coolify; test-decision skill before tests, behaviour only; no useEffect for app state; read node_modules/next/dist/docs/ for Next APIs; mock copy rules; six locales.

EXECUTION RHYTHM: one item per commit (assets, recipients, analytics, team), test-first for rules/assembly, then component + lane browser check.

COMMIT DISCIPLINE: `[plan-10]` prefix; named files; never failing work; no hook bypass; push and open a PR to dev; do not merge.

WHEN TO STOP: missing API or unsafe bug → commit safe work, write 10-BLOCKER.md, stop.
DEVIATIONS: fix the plan first (`docs: [plan-10] revise …`).
REPORT: PR URL, commits, check tails, screenshots of the four cards, the exact env names and the asset URLs the integration owner must set.

Go.
```

## Plan 11 — address reservation and recovery

```text
Implement your lane of plans/evidence-library-configuration-v2/11-address-reservation-and-recovery.md.
Read plans/evidence-library-configuration-v2/00-README.md and AGENTS.md first.
Depends on: plans 05–10 merged (they are).

Lane A: worktree /Users/mcharrad/Documents/Github/openscholar/reserve-sprint, branch codex/address-reservation, lane calm-labrador-815, port 3013. PRs A1 then A2 (A2 stacked on A1).
Lane B: worktree /Users/mcharrad/Documents/Github/openscholar/recovery-sprint, branch codex/address-recovery, lane lovable-clownfish-245, port 3014. PRs B1 then B2.

STANDING RULES: reuse (coolifyClient helpers, readinessClient, setupNaming, configuration/fields.tsx); clean breaking changes; Convex guidelines before Convex edits (actions in "use node" files only; validators on args and returns); upload only with `npx convex dev --once` to the lane; never `npm run convex:push`, never touch the shared deployment or Coolify; test-decision before tests, behaviour only; no useEffect for app state; Next docs in node_modules/next/dist/docs/; mock copy rules, six locales; write-set = your lane's files only — if you must touch the other lane's files, stop and write 11-BLOCKER.md.

EXECUTION RHYTHM: test-first for pure logic (candidate rules, probe signature parsing, host list parsing), then integration units with tests and a lane check; commit each unit with `[plan-11]`.

COMMIT DISCIPLINE: named files, never failing work, no hook bypass, push and open PRs to dev, do not merge.
WHEN TO STOP: missing API or unsafe bug → commit safe work, 11-BLOCKER.md, stop.
DEVIATIONS: fix the plan first (`docs: [plan-11] revise …`).
REPORT: PR URLs, commits, check tails, lane proof (screenshots for pages, logs for actions), anything left out.

Go.
```

## Plan 12 — organisation gate

```text
Implement plans/evidence-library-configuration-v2/12-organisation-gate.md.
Read plans/evidence-library-configuration-v2/00-README.md, AGENTS.md, and convex/_generated/ai/guidelines.md first.
Depends on: plans 01–11 merged (they are).

Worktree /Users/mcharrad/Documents/Github/openscholar/org-gate, branch codex/org-gate from origin/dev. Run `npm ci` first. Convex lane in .env.local (lovable-clownfish-245). Next port 3014. Allow about three hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: the Clerk webhook mappers and projections, `requireOrganizationAccess` in convex/evidenceLibraries/access.ts, `AuthStatePanel`, and the existing configuration primitives. Do not build a second gate.
2. No legacy code: no environment allowlist, no compatibility read, no second source of truth for the switch.
3. Convex rules: validators on args and returns; a returned field must be in the `returns` validator or Convex drops it; check how a schema push behaves against existing rows before choosing required or optional.
4. Tests: run the `test-decision` skill; behaviour only; never assert Tailwind classes.
5. Deployment checks: upload only with `npx convex dev --once` to the lane; never `npm run convex:push`; never touch the shared deployment or Coolify.
6. Research instead of guessing: read the code, the Convex guidelines, and the installed Next.js docs under node_modules/next/dist/docs/.
7. Use other agents for any investigation over about three file reads.

EXECUTION RHYTHM: test-first for the mapper and the access rules, then test-after for the query and the pages. Commit after every working unit with `[plan-12]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-12]` on every commit; commit the plan before the code that depends on it; never commit while relevant tests fail; never use --no-verify or another hook bypass; push and open a PR to dev; do not merge.

WHEN TO STOP: only for a real blocker. Do not stop for an answer the plan already gives, for token worry, or for the urge to ask. `npx tsc --noEmit`, the vitest sets named in the plan, `npx convex dev --once`, and the browser check on port 3014 must all pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan, commit `docs: [plan-12] revise <section> — <reason>`, then continue from the corrected plan. Never change direction silently.

START NOW: read the plan and the README, read convex/_generated/ai/guidelines.md, run `git status`, confirm no other Convex uploader is running, then start the first unit.

Go.
```

## Plan 13 — large-list pickers, lane R (runtime)

```text
Implement lane R of plans/evidence-library-configuration-v2/13-large-list-pickers.md (the plan lives in the OpenScholar repository at /Users/mcharrad/Documents/Github/openscholar/dev-self; read it there). Read that repository's plans/evidence-library-configuration-v2/00-README.md and this repository's AGENTS.md first.
Depends on: nothing. Lane P builds against your contract in parallel.

Worktree /Users/mcharrad/Documents/Github/new-el-pickers, branch codex/institutions-paging from origin/main. Run `npm ci` first. Allow about two hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: mirror the collections endpoint (`src/lib/admin/collection-catalog-service.ts`, its contract file and route) for query, cursor, pageSize and the error shape. Do not invent a second paging style.
2. No legacy code: the old "everything in one array" response goes; a request without parameters gets the first page.
3. Keyset paging on (count desc, name asc); the cursor carries both. Cap pageSize at 200, default 50.
4. Tests: red → green for the service (query, sort, cursor stability across ties, clamp, empty) and the route (bearer, bad cursor → 400, shape). Behaviour only.
5. `npm run check:changed` (Fallow) must pass before every push. Run `npm run test:acceptance` if Docker works on this machine; if it does not, say so in the PR and rely on the GitHub "Runtime acceptance" check. Never restart Docker Desktop and never touch containers you did not create (what2 and minio are off limits).
6. Research instead of guessing: read the code and the existing tests.
7. Use other agents only for read-only investigation over about three file reads.

EXECUTION RHYTHM: test-first for the service, then the route, then the doc. Commit after every working unit with `[plan-13]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-13]` on every commit; never commit while relevant tests fail; never use --no-verify or another hook bypass; push and open a PR to main; do not merge.

WHEN TO STOP: only for a real blocker (write plans/…/13-BLOCKER.md in the OpenScholar repository). Do not stop for an answer the plan already gives, for token worry, or for the urge to ask. Fallow and the tests must pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan in the OpenScholar repository, commit there with `docs: [plan-13] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, run `git status`, then start the service test.

Go.
```

## Plan 13 — large-list pickers, lane P (OpenScholar)

```text
Implement lane P of plans/evidence-library-configuration-v2/13-large-list-pickers.md.
Read plans/evidence-library-configuration-v2/00-README.md, AGENTS.md, and convex/_generated/ai/guidelines.md first.
Depends on: plans 01–12 merged (they are). Lane R builds the runtime institutions paging in parallel to the contract in the plan's Decision 2; until it merges the shared runtime answers with the full list and no nextCursor — treat that as a single page.

Worktree /Users/mcharrad/Documents/Github/openscholar/pickers-sprint, branch codex/large-list-pickers from origin/dev. Run `npm ci` first. Convex lane in .env.local (calm-labrador-815). Next port 3013. Allow about four hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: the approved collections picker (`CollectionPicker` in collections-field.tsx: Dialog, search, filter chips, sortable table, checkbox rows, select-all, footer count and confirm) becomes the shared `RemotePickerDialog`; the shared primitives in configuration/fields.tsx; `runtimeReads.ts` caching; the copy rules in the README (sentence case, no dots, no counts unless they change a decision). Match the approved look exactly — do not redesign.
2. No legacy code: delete `readCatalogue`, `MAX_PAGES`, the truncated banner, the Popover institution combobox and the plain Collection `Select`. Nothing preloads a catalogue.
3. Convex rules: validators on args and returns; every returned field in `returns`; read convex/_generated/ai/guidelines.md.
4. No useEffect for app state. The debounce is a timer in the search handler or a small custom hook with cleanup and a comment naming the outside system.
5. Tests: run the `test-decision` skill first; behaviour, roles, labels and data-* only; never Tailwind classes. Every test named in the plan.
6. Deployment checks: upload only with `npx convex dev --once` to the lane; never `npm run convex:push`; never touch the shared deployment. You may set up one disposable library on the development platform for the browser gate and must delete it before opening the PR.
7. Research instead of guessing: the code, the Convex guidelines, node_modules/next/dist/docs/.
8. Use other agents only for read-only investigation over about three file reads; never for UI work.

EXECUTION RHYTHM: test-first for the read client and the action, then the dialog, then each call site. Commit after every working unit with `[plan-13]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-13]` on every commit; never commit while relevant tests fail; never use --no-verify or another hook bypass; push and open a PR to dev; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/13-BLOCKER.md). Do not stop for an answer the plan already gives, for token worry, or for the urge to ask. `npx tsc --noEmit`, the vitest sets in the plan, `npx convex dev --once`, and the browser gate on port 3013 with screenshots in /tmp/pickers/ must all pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan, commit `docs: [plan-13] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, read convex/_generated/ai/guidelines.md, run `git status`, confirm no other Convex uploader is running on this lane, then start the read-client test.

Go.
```

## Plan 14 — admin handoff, lane R2 (runtime)

```text
Implement lane R2 of plans/evidence-library-configuration-v2/14-admin-handoff.md (the plan lives in the OpenScholar repository at /Users/mcharrad/Documents/Github/openscholar/dev-self; read it there). Read that repository's plans/evidence-library-configuration-v2/00-README.md and this repository's AGENTS.md first.
Depends on: new-el #141 (Runtime acceptance fix) — rebase onto main once it merges; until then the acceptance suite may stop at verifyOwnerLegalText, which is not yours. Lane O builds the OpenScholar side in parallel to the URL contract in Decisions 1–2.

Worktree /Users/mcharrad/Documents/Github/new-el-admin-handoff, branch codex/admin-handoff from origin/main. Run `npm ci` first. Allow about three hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: `loginPageUrl` from `getAdminAccessConfig`, `getExternalRequestOrigin`/`hasMatchingRequestOrigin` in src/lib/runtime-routing.ts, the existing session route. No new config fields.
2. No legacy code: delete AdminAccess.tsx and the access-error page; no card in any state; the 401s on API routes stay.
3. `return` is validated on the runtime: a path only, under /admin or /<locale>/admin, else /admin. Never redirect to anything built from input except that validated path; the external target is always loginPageUrl.
4. Tests: red → green for the routing helper and the session routes; update the e2e helper and specs the plan names; the acceptance step at tools/runRuntimeAcceptance.ts:432 must assert the redirect, not a 200. Behaviour only.
5. `npm run check:changed` (Fallow) before every push. Run `npm run test:acceptance` with your own image tags (the five EVIDENCE_LIBRARY_ACCEPTANCE_*_IMAGE variables) and `npm run test:acceptance:cleanup`. Never restart Docker Desktop; never touch containers you did not create (what2 and minio are off limits).
6. Research instead of guessing; use other agents only for read-only investigation.

EXECUTION RHYTHM: helper test → page redirect → exchange route → e2e helper and specs → acceptance step → doc. Commit after every working unit with `[plan-14]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-14]` on every commit; never commit while relevant tests fail; never use --no-verify; push and open a PR to main with `gh pr create`; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/14-BLOCKER.md in the OpenScholar repository). Fallow, unit tests and the acceptance run must pass first (or stop at the known verifyOwnerLegalText failure if #141 is not merged yet — say so).

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan in the OpenScholar repository with `docs: [plan-14] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, run `git status`, then start the routing helper test.

Go.
```

## Plan 14 — admin handoff, lane O (OpenScholar)

```text
Implement lane O of plans/evidence-library-configuration-v2/14-admin-handoff.md.
Read plans/evidence-library-configuration-v2/00-README.md, AGENTS.md, and convex/_generated/ai/guidelines.md first.
Depends on: plans 01–13 (13 is in flight on other files; do not touch its files). Lane R2 builds the runtime side in parallel to the URL contract in Decisions 1–2.

Worktree /Users/mcharrad/Documents/Github/openscholar/admin-handoff, branch codex/admin-handoff from origin/dev. Run `npm ci` first. Convex lane in .env.local (bright-stork-673). Next port 3012 (`npx next dev -p 3012`). Allow about four hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: `storeIssuedAdminLoginCode` and the audit rows, `readEvidenceLibraryAdminLaunchTarget`, `AuthStatePanel`, `LibraryPageShell`/`Panel` primitives for the panels, the sign-in page's redirect_url handling. Do not add a client card; the route is a server component that redirects or renders one panel.
2. No legacy code: delete admin-launch.tsx, open-admin-launch.ts and the client action path; remove `getAdminLaunchState` if nothing else reads it; remove dead copy keys.
3. Access is decided by membership in the library's organisation, not the token's active organisation (Decision 4). The plan-12 switch does not gate this path.
4. Convex rules: validators on args and returns; every returned field in `returns`; `"use node"` only where needed; read convex/_generated/ai/guidelines.md. Server-side calls use `fetchAction`/`fetchQuery` from `convex/nextjs` with `auth().getToken({ template: "convex" })`.
5. No useEffect for app state.
6. Tests: run the `test-decision` skill first; behaviour, roles, labels, data-* only; every test the plan names, including the new e2e spec.
7. Deployment checks: upload only with `npx convex dev --once` to the lane; never `npm run convex:push`; never touch the shared deployment or dev-self. You may set up one disposable library on the development platform for the browser gate and must delete it before opening the PR. Never touch Docker containers you did not create.
8. Research instead of guessing: the code, the Convex guidelines, node_modules/next/dist/docs/ (redirect() in server components, route handlers), the Clerk Next.js docs in node_modules/@clerk.
9. Use other agents only for read-only investigation; never for UI work.

EXECUTION RHYTHM: action test → action → decision helper test → helper → page → panels → e2e → cleanup of the old card. Commit after every working unit with `[plan-14]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-14]` on every commit; never commit while relevant tests fail; never use --no-verify; push and open a PR to dev with `gh pr create`; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/14-BLOCKER.md). `npx tsc --noEmit`, the vitest sets, the e2e spec, `npx convex dev --once`, and the browser gate with screenshots in /tmp/admin-handoff/ must all pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan, commit `docs: [plan-14] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, read convex/_generated/ai/guidelines.md, run `git status`, confirm no other Convex uploader is running on this lane, then start the action test.

Go.
```

## Plan 15 — runtime merge, lane M (new-el)

```text
Implement lane M of plans/evidence-library-configuration-v2/15-runtime-ai-analytics-merge.md (the plan lives in the OpenScholar repository at /Users/mcharrad/Documents/Github/openscholar/dev-self; read it there). Read that repository's plans/evidence-library-configuration-v2/00-README.md and this repository's AGENTS.md first.

Worktree /Users/mcharrad/Documents/Github/new-el-merge, branch codex/merge-ai-modernization from origin/main. Run `npm ci` first. Two PRs in order: (1) the merge of origin/ai-modernization into main; (2) branch codex/logo-fit from the merged result for the logo sizing. Allow about four hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Merge with a merge commit (`git merge origin/ai-modernization`); resolve every conflict by keeping both sides' intent (Decision 1): our admin gate order and reserved-routes helper in src/proxy.ts, our redirects query, our itemInstitution table and migration, our acceptance steps. Read both sides of each conflicting file before choosing. Never resolve with `-X theirs` or `-X ours`.
2. No legacy code: if the branch carries leftovers that Fallow flags on changed lines, fix them properly.
3. `npm run check:changed` (Fallow) must pass before every push. `npm run test:acceptance` with your own image tags (the five EVIDENCE_LIBRARY_ACCEPTANCE_*_IMAGE variables) must pass end to end; poll it yourself in one foreground loop; `npm run test:acceptance:cleanup` after. Never restart Docker Desktop; never touch containers you did not create (what2 and minio are off limits).
4. Logo PR (Decision 5): the bar owns the height, the image fits inside (`h-full w-auto max-w-[…] object-contain`); header, footer, cookie dialog, record-page institution and funder logos; unit test plus a browser measurement for square, 3:1 landscape and 1:2 portrait fixtures. Behaviour tests only — no class-string assertions in Vitest; measure geometry in Playwright.
5. Research instead of guessing; use other agents only for read-only investigation.

EXECUTION RHYTHM: merge → resolve → check:changed → acceptance → push PR 1; then logo fixtures and tests → fix → check:changed → acceptance (admin suite) → push PR 2. Commit with `[plan-15]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs/merge; `[plan-15]`; never commit while relevant tests fail; never use --no-verify; push and open each PR to main with `gh pr create`; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/15-BLOCKER.md in the OpenScholar repository). Fallow, unit tests and the acceptance run must pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan in the OpenScholar repository with `docs: [plan-15] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, run `git status`, then start the merge.

Go.
```

## Plan 15 — OpenScholar AI and analytics, lane A

```text
Implement lane A of plans/evidence-library-configuration-v2/15-runtime-ai-analytics-merge.md.
Read plans/evidence-library-configuration-v2/00-README.md, AGENTS.md, and convex/_generated/ai/guidelines.md first.
Depends on: lane M's merge for the OpenRouter catalog and the two analytics fields in the pinned schema. Start on the contract as it stands (the `ai.providers[]` shape is already on new-el main) and re-pin when the merged main commit exists (`node scripts/sync-evidence-library-config-contract.mjs --commit <sha>`; the script only accepts commits on new-el main). Until then build the model picker against the catalog file shape and mark the one test that needs the catalog with the exact commit it waits for.

Worktree /Users/mcharrad/Documents/Github/openscholar/ai-sprint, branch codex/ai-openrouter-analytics from origin/dev. Run `npm ci` first. Convex lane in .env.local (calm-labrador-815). Next port 3013. Allow about four hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: the section shell, FieldGroup/ToggleRow/ChoiceChips/Select primitives, the Zotero per-group credential store and its assembly injection for the provider key, the feature-dependency rules, the approved copy rules (sentence case, no dots, no counts unless they change a decision, no vendor names except the product the owner chose — OpenRouter is one).
2. OpenRouter only (Decision 2): one provider entry; no credits, no other providers, no embeddings note. Do not build UI the runtime cannot honour.
3. Convex rules: validators on args and returns; secrets never in getDraft, logs or the assembled config that leaves the deploy action; read convex/_generated/ai/guidelines.md.
4. No useEffect for app state.
5. Tests: run the test-decision skill first; every test the plan names; behaviour only.
6. Deployment checks: `npx convex dev --once` on the lane only; never the shared deployment; browser gate on 3013 with screenshots in /tmp/ai-section/.
7. Research instead of guessing; other agents only for read-only investigation; never for UI work.

EXECUTION RHYTHM: rules tests → rules → credential store and assembly tests → code → AI section → analytics fields → workspace rail → browser gate. Commit after every working unit with `[plan-15]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-15]`; never commit while relevant tests fail; never use --no-verify; push and open a PR to dev; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/15-BLOCKER.md). tsc, the vitest sets, `npm run schema:check:evidence-library-config`, `npx convex dev --once` and the browser gate must pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan, commit `docs: [plan-15] revise <section> — <reason>`, then continue.

START NOW: read the plan and the README, read convex/_generated/ai/guidelines.md, run `git status`, confirm no other Convex uploader is running on this lane, then start the rules test.

Go.
```

## Plan 16 — custom domains, lane D (OpenScholar)

```text
Implement lane D of plans/evidence-library-configuration-v2/16-custom-domains.md. Read 16-RESEARCH.md in the same folder first (it is long; sections 0, C and D are the ones you build from), then plans/evidence-library-configuration-v2/00-README.md, AGENTS.md, and convex/_generated/ai/guidelines.md.
Depends on: plans 01–15 (15 is in flight on other files — do not touch the AI or analytics sections, the contract files, or the setup page).

Worktree /Users/mcharrad/Documents/Github/openscholar/domains-sprint, branch codex/custom-domains from origin/dev. Run `npm ci` first. Convex lane in .env.local (bright-stork-673). Next port 3012. The lane has no Cloudflare credentials yet: build the Cloudflare client with an injected fetch and full tests, and make the section show "Custom domains are not set up on this platform yet" when `EL_CLOUDFLARE_API_TOKEN`/`EL_CLOUDFLARE_ZONE_ID` are missing; the integration owner sets them for the gate. Allow about six hours and keep working without asking questions the plan already answers.

STANDING RULES:
1. Reuse first: the address check pipeline in convex/evidenceLibraries/addressActions.ts (served-hosts cache, `AddressCheckError` semantics), `probeEvidenceLibraryAddress` + `requireActiveRevision` in readinessClient.ts, `startAddressMove` in versions.ts for the toggle, `parseComposeDomains`/`requirePublicDomain` in coolifyClient.ts, the section primitives (FieldGroup, Panel, ToggleRow, StatusChip, ReadOnlyValue), the copy rules. The agreed mock for the section is `git show origin/feat/library-interface-mock:components/evidence-libraries/mock/config/domain-section.tsx` plus its `evidenceLibraryMock.config.domain` copy — match it exactly except the CNAME value, which is `cname.opendev.space`.
2. No legacy code, no A-record path, no DNS-provider API for the customer side, no Traefik redirect labels; never send Coolify `redirect`, `domains` or `force_domain_override: true`.
3. Convex rules: validators on args and returns; DoH and Cloudflare calls via `fetch` from actions; secrets only in env; read convex/_generated/ai/guidelines.md.
4. No useEffect for app state.
5. Tests: run the test-decision skill first; every test the plan names, red → green for the pure parsers and the state machine; behaviour only.
6. Deployment checks: `npx convex dev --once` on the lane only; never the shared deployment; browser gate on 3012 with screenshots in /tmp/domains/ (records table, Check DNS → no-records for a fake host, toggle disabled until verified, apex wording). Note: lane rows may lack `evidenceLibrariesEnabled` — patch with a temporary internal mutation you delete afterwards, as earlier lanes did.
7. Research instead of guessing; other agents only for read-only investigation; never for UI work.

EXECUTION RHYTHM: dnsClient parsers → state machine (domainActions) → coolifyClient set comparison → cloudflareSaasClient → mutations/versions/teardown → section UI → rail → browser gate. Commit after every working unit with `[plan-16]`.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-16]`; never commit while relevant tests fail; never use --no-verify; push and open a PR to dev with `gh pr create`; do not merge.

WHEN TO STOP: only for a real blocker (plans/…/16-BLOCKER.md in your worktree). tsc, the vitest sets, `npx convex dev --once` and the browser gate must pass first.

DEVIATIONS: if the plan is wrong, commit safe work, fix the numbered plan in your worktree, commit `docs: [plan-16] revise <section> — <reason>`, then continue. In particular, the "Known risks" item about origin TLS under Cloudflare for SaaS must be answered in the plan with what you found.

START NOW: read the research sections 0, C, D, the plan, the README, the Convex guidelines, run `git status`, confirm no other Convex uploader is running on this lane, then start the DoH parser tests.

Go.
```

## Plan 18 — production configuration evolution

```text
Implement plans/evidence-library-configuration-v2/18-safe-stored-configuration-upgrades.md as the integration owner. Read plans/evidence-library-configuration-v2/00-README.md, Plan 15 Decision 7, AGENTS.md, convex/_generated/ai/guidelines.md, the `ponytail`, `unslop`, `test-decision` and `convex-migration-helper` skills, both migration-helper references, and docs/test-quality.md first. Depends on merged plans 01-16 and runtime contract commit 937bb65e.

Allow one working day. Create lane M (`codex/owner-config-migrations`) in its own worktree and Convex Cloud deployment. After it merges, push Deploy A from dev-self, tag every missing header and verify zero missing versions. Only then create lanes R (`codex/config-migration-wiring`) and E (`codex/config-migration-errors`) from the new origin/dev with separate worktrees and Convex Cloud deployments. Only dev-self may upload to the shared production deployment. Keep working without asking questions the plan or repository already answers.

STANDING RULES:
1. Production is now. Never wipe, hand-edit or silently coerce Evidence Library configuration. Use widen, migrate, verify, then narrow.
2. Read and follow `ponytail` and `unslop` in the owner and every agent. Use the official `@convex-dev/migrations` component for batching, dry runs, progress and resume. Do not build another migration runner around it.
3. Add one snapshot-level `ownerConfigurationVersion` on draft and revision headers. Do not put it on section rows and do not reuse the runtime contract `schemaVersion`.
4. Migrations are explicit consecutive full-snapshot TypeScript steps. They may express any declared field or section change, but never guess. Version 1 to 2 removes the two old Features switches and converts pre-122a7e55 Exports address rows to the existing schema-default booleans. Missing, newer, ambiguous, invalid or credential-bearing data blocks the release.
5. New request writes stay strict. Only trusted snapshots read from Convex enter the migration chain. Old frozen revisions never change; Restore creates a new current revision.
6. A live library stays on its old active revision until the migrated candidate deploys and passes readiness. Look up an operation by its full intent key before creating a candidate; Retry reuses that candidate. Address and domain changes put the new address in the candidate and never patch a frozen revision. Migration happens before any Coolify call.
7. Convex functions have complete args and returns validators. Read convex/_generated/ai/guidelines.md. Lanes upload only with `npx convex dev --once`; only dev-self uses `npm run convex:push`.
8. Before any test edit, use `test-decision` and docs/test-quality.md. Test versions, rows, ids, operation states, errors and health. Never test CSS or incidental copy. Use red, green, clean up for the pure registry.
9. Use GPT-5.6 Luna at max reasoning for every delegated Codex agent. Never substitute Terra or Sol. Every prompt requires `ponytail` and `unslop`. Lane M establishes Deploy A. After its tag audit passes, lanes R and E run in parallel with the exact non-overlapping ownership from Plan 18.
10. At the end of each complete phase, run one read-only review with `claudeekitabu --model claude-fable-5 --effort max`. Fable reads `ponytail` and `unslop`, reviews the whole phase once, and never implements or merges.

EXECUTION RHYTHM: Phase 1: lane M builds the optional version, pure registry, snapshot seam, official version-tag migrations, manual draft/revision return-validator metadata and focused tests. It counts header-only setup revisions separately and does not ship `migrateDraftsToV2` while the validator accepts only version 1. Run one Fable review, merge the green exact head, then in dev-self export → Deploy A widen/tag → audit and dry-run → backfill all missing headers → rerun every audit page → verify zero missing and zero migration-validation failures. Phase 2 in parallel: lane R adds and tests `migrateDraftsToV2`, then wires save, activation, setup, update, restore, address, domain, deployment and every payload-interpreting read through the snapshot seam; lane E owns server-projected `retryable`, retry enforcement and the workspace behavior. Saving a migrated draft persists every changed section without changing `editVersion`. Run one Fable review over both complete lanes, merge only green exact heads, push Deploy B, migrate drafts, and run the live gates including `new lib`. Phase 3: commit and push Deploy C narrowing, then repeat audit, browser, logs and health gates. Commit after every working unit.

COMMIT DISCIPLINE: prefixes feat/fix/refactor/test/chore/docs; `[plan-18]` on every plan commit; never commit while relevant tests fail; never use --no-verify or another hook bypass; push and open a PR to dev; do not merge. Commit a plan correction before code that depends on it as `docs: [plan-18] revise <section> — <reason>`.

WHEN TO STOP: only when Deploy C and every completion rule in Plan 18 pass, or a real blocker exists. For a blocker, commit safe work, write plans/evidence-library-configuration-v2/18-BLOCKER.md and stop. Do not stop for token worry or a question the plan answers. Never narrow while an audit page, dry run, migration, candidate deployment, health check or relevant test is not green.

DEVIATIONS: if the plan is wrong but the better path is clear, commit safe work, fix the numbered plan with the reason, commit the plan change, then continue. Never change direction silently.

START NOW: read every named file and skill, fetch origin, run git status, confirm no other Convex uploader is running, record the shared row counts without writing, create lane M with its worktree and Convex Cloud deployment, and give its GPT-5.6 Luna Max agent the exact Phase 1 write set and tests from Plan 18. Do not create lanes R or E until Deploy A has tagged and verified every header.

Go.
```
