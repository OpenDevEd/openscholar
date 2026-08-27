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
