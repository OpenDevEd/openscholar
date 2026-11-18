# Agent working agreement

Keep this file byte-for-byte identical in `Openscholar-ai/openscholar` and
`Openscholar-ai/evidence-community`. Repository-specific rules belong in
`docs/agents/project.md`.

Read `docs/agents/project.md` in the repository the task is about before
acting on any non-trivial task, and before every push: it names the checks to
run first. Read a named plan or specification when the request points to one.
Do not load every plan or document by default.

For product, architecture, roadmap, or cross-repository work, check that the
Outline MCP server works, then read Outline in the order that
`docs/agents/project.md` lists before acting.

## Two repositories, one product

This product spans two repositories. The folder a session starts in does not
tell you which one a request is about: the user often starts in one and means
the other.

- `Openscholar-ai/openscholar` (formerly `OpenDevEd/openalex-count`) is
  OpenScholar: branch `dev`, integration checkout
  `~/Documents/Github/openscholar/dev-self`. It owns research features,
  accounts, billing, and Evidence Library setup. "The config", "the
  configuration page", and "library settings" mean OpenScholar's Evidence
  Library configuration.
- `Openscholar-ai/evidence-community` (formerly `OpenDevEd/new-el`, still called
  new-el) is the Evidence Library: branch `main`, checkout
  `~/Documents/Github/new-el`. It owns the public library and its admin. "The
  admin", "the admin page", and "the admin panel" mean new-el's `/admin`.
  "Evidence Library" on its own means new-el unless the request is about
  configuration or setup.
- People read "Evidence Community" and "community". "Library" on its own means
  the saved papers in OpenScholar. Code, tables, service APIs and older plans
  still say Evidence Library (`evidenceLibraries`, `/api/v1/evidence-libraries`,
  `new-el`), and "Evidence Community" in a request means that same thing. Never
  write "library" in text people read when the community is meant.
- People read the product's name as "Openscholar". Code names, HTTP headers such
  as `X-OpenScholar-Route`, comments and older plans still say OpenScholar.
- Before touching code, decide which repository the request is about from what
  it names, not from the current directory. Work in that repository's checkout
  or a worktree of it, even when the session started in the other one.
- Example: "tooltips in the Evidence Library admin", asked from `dev-self`,
  meant new-el's `/admin`. An agent changed OpenScholar's configuration pages
  instead, and the work had to be redone in new-el.

## Source of truth

When sources disagree, use this order:

1. The user's latest instruction.
2. Current code, tests, Git history, and verified runtime behavior.
3. `docs/agents/project.md` and the current shared Outline decisions.
4. The current product roadmap.
5. Old plans, prototypes, transcripts, and audits.

Plans describe task scope and product contracts. They do not replace this
working agreement unless the user's latest message explicitly changes the
workflow.

## Work within the request

- A request to inspect, diagnose, explain, or review is read-only.
- A request to implement authorizes scoped file changes, commits, and pushes.
  It authorizes a pull request and merging on green only once the work is
  ready to merge; while a mock or design is still under review, stop at the
  push.
- Preserve unrelated dirty and untracked files.
- Use an isolated worktree when the main checkout is dirty or another agent is
  editing nearby files.
- Never use a hook bypass or a destructive Git command to get around a problem.

## Research

- Check facts instead of guessing. Use current code first, installed package
  documentation second, and the web only for facts those sources do not
  resolve. Do not run several research tools as a checklist.
- Prefer clean breaking changes in code. Saved library data is never
  disposable: follow the migration rules in `docs/agents/project.md` for any
  change to its shape.

## React

- Do not use React effects for app state, URL state, copied props, derived
  values, data loading, navigation, mutations, filters, tabs, pages, or forms.
- Effects are only for a real outside browser system such as an event
  listener, observer, timer, focus operation, or third-party widget. Keep the
  effect small, name the outside system, and include full cleanup and
  dependencies.
- Use server components, `nuqs`, render-time calculations, lifted state,
  context, and event handlers for application state. `docs/agents/project.md`
  names the repository's data layer.

## Skills

- Use `ponytail` for substantial planning and implementation. Choose the
  smallest complete solution.
- `.agents/skills/` is the canonical repository skill directory.
  `.claude/skills/` contains links to those skills, not separate copies.
- `CLAUDE.md` contains only `@AGENTS.md`.

## Keep execution efficient

- Optimize elapsed wall-clock time. Run independent repository reads,
  dependency installs, focused checks, builds, and deployment preparation at
  the same time instead of serially.
- Batch related searches, file reads, status checks, and API queries. Prefer
  one bounded command or parallel tool call over a long sequence of tiny
  calls. Reaching 50 completed tool calls in one phase is a trigger to
  consolidate the remaining work, not to pause or stop.
- After an unexpected integration or deployment failure, collect the relevant
  logs, runtime state, configuration, and connected code paths in one pass.
  Test independent hypotheses at the same time when safe, then make one
  combined root-cause fix. Do not release one patch per newly discovered clue.
- Code that introduces an external service boundary must record useful
  internal diagnostics in its first version. Do not require a separate release
  merely to reveal the real error.

## Plan only when it helps

- Before creating, editing, or executing anything under `plans/`, read
  `plans/AGENTS.md`.
- Keep small and medium plans in the conversation.
- Commit a repository plan only for multi-day work, a breaking data migration,
  a cross-repository contract, a product decision, or work that must survive a
  fresh session.
- A committed plan records decisions, dependencies, owned paths, checks,
  deployment gates, and completion rules. Link to this file instead of copying
  its standing rules.
- Do not commit research scratch, agent transcripts, duplicated prompts, or a
  plan for a change that is already obvious from the code.
- Update a plan before code only when the implementation changes an approved
  contract or direction.

## Test the smallest real boundary

- During implementation, run the smallest local test, type check, lint target,
  or service check that can catch the current defect.
- Use red, green, clean up for new plain logic. Use test-after for integration
  work where the real boundary must exist first.
- Test behavior, roles, labels, data, API responses, database state, and real
  service state. Never test CSS class strings.
- When a change needs runtime proof, test the unmerged commit in an isolated or
  preview deployment before merge. Merge must not be the first way to exercise
  the real boundary.
- `convex-e2e` (`convex-e2e.opendev.space`) belongs to OpenScholar CI's
  `e2e-auth` job. Never deploy an unmerged branch to it, or point a preview,
  `npm run verify`, or a script at it: a row saved in a new shape fails every
  other CI run with `Schema validation failed`. Test an unmerged Convex change
  on a throwaway Convex project of its own.
- Run one final browser, deployment, or live-service gate when the changed
  boundary needs one.
- When a change touches a loading state, a dialog, sheet, popover or menu, or
  motion, run `npm run verify -- shift` on the routes it touched, in a
  repository that has the command (the `verify` skill says how).
- A new or changed flow a person walks through is done when the first two
  passes of the `first-use-qa` skill are complete: a state table for each
  changed screen, then a first-use walk on a new account and on an account with
  history. Scripted QA waves follow those passes. A tester who is told the
  steps can't show whether a new person gets through them.
- Documentation-only work needs link checks and `git diff --check`, not the
  application test suite.

## Issues and the project board

Every issue in both repositories belongs to the organisation project
**Openscholar** (Openscholar-ai project 1) and to a milestone (`OS-NN` in
openscholar, `EL-NN` in evidence-community).

- Before creating an issue, search open and closed issues in both
  repositories. Update an existing issue instead of creating a duplicate.
- Write only what the user asked for. Title: the user-visible outcome,
  prefixed with the milestone code, such as `[EL-05] Preview draft records`.
  Body: the problem, the checks that prove it's done, and what is out of
  scope. No padded requirements.
- Create it with everything in one step, then read it back: milestone,
  project (`gh issue create --milestone "<title>" --project Openscholar`),
  board Status (`Backlog`, or `Ready` when the user wants it soon), and any
  label that applies (`needs-decision`, `external-blocker`, `documentation`).
- Work that needs several issues becomes a milestone with issues, not a plan
  document.
- Set `In progress` when you start, and `Blocker` with a comment naming the
  blocker. The board-upkeep workflow in openscholar does the rest, every
  four hours and on openscholar's issue and pull request events: `In review`
  while an open PR closes the issue and `In progress` again once none does,
  `Done` when the issue closes, the current Sprint on an issue in progress,
  missing issues added to the board, and a milestone closed when its last
  issue closes. Its run summary lists issues in progress with no activity for
  a week.
- Sprints are weekly, Monday to Sunday. When an issue is picked for this week,
  set its Sprint to the current week. If no upcoming sprints are left, add
  more weekly ones to the Sprint field; the board-upkeep run reports it.
- When a decision changes an issue's scope, edit its body in the same turn so
  it never contradicts what was agreed. Use comments for progress.
- A PR for planned work names its issue: `Closes Openscholar-ai/<repo>#N` when it
  finishes the issue, `Part of Openscholar-ai/<repo>#N` otherwise. A small fix with
  nothing planned behind it (a bug the user just reported, a copy change, a
  dependency bump) goes straight to a PR whose title is the record; don't open
  an issue only to close it.
- `Closes` only works in PRs into the default branch: `dev` in openscholar,
  `main` in evidence-community. After merging, check the issue actually closed.
- Close an issue as soon as its work is merged and verified. If only part is
  done, comment what remains.

## Git and pull requests

- Use conventional commit prefixes: `feat`, `fix`, `refactor`, `test`, `chore`,
  `docs`, `perf`, or `style`.
- Keep one concern per pull request. Keep commits small enough to review but do
  not split a working unit into ceremony.
- Stage named files. Check the staged diff before committing.
- Never use `--no-verify`, `--no-gpg-sign`, force-push, or history rewriting
  unless the user explicitly requests the exact action.

## Completion

An implementation task is complete when the requested behavior is present at
the real boundary, targeted checks pass, and no known dead path or hidden
fallback remains. Report the checks actually run, commit, deployment state, and
remaining risk. Never call a unit test alone proof of a browser or deployed
service.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
