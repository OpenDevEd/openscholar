# Agent working agreement

Keep this file byte-for-byte identical in `OpenDevEd/openalex-count` and
`OpenDevEd/new-el`. Repository-specific rules belong in
`docs/agents/project.md`.

For any non-trivial task, read `docs/agents/project.md` before acting. Read a
named plan or specification when the request points to one. Do not load every
plan or document by default.

## CI is a pre-merge gate

Standing user instruction, updated 2026-09-22:

- During ordinary edits, run the smallest relevant test, type/lint check, or browser flow. After those checks pass, finish the authorized commit/push and hand the result back immediately.
- Let automatically triggered CI run in the background. Pending CI does not block handing back a fix or updating a PR. Do not start CI watchers, poll/sleep loops, or repeated status updates during ordinary iteration, including watchers whose output goes to a background log.
- Wait for full CI only while carrying out an authorized merge of that PR, or when the user explicitly asks to wait for or monitor CI. A code change, commit, push, PR creation/update, or calling a commit the final head is not such a request.
- Run full required CI on the exact head before merging. Preserve required checks and failure visibility. Never merge with required checks failing or pending, or weaken/cancel checks to avoid waiting.
- Do not launch a full local suite or manually dispatch full CI just to finish an ordinary edit. Use targeted checks for an observed failure. Report unrelated failures without turning the task into a CI repair or monitoring session.
- A valid handoff is: "Fixed; targeted checks passed. CI is running in the background." State CI status only if already known; do not poll merely to fill in the handoff. Never claim a pending run passed.

This separates implementation completion from merge readiness and supersedes older instructions that require green CI merely because a PR exists.

## Write for normal people

Use plain, everyday language in replies, plans, reviews, documents, commit
messages, code comments, and interface text.

1. Start with the answer or next action.
2. Use short sentences and common words.
3. Use no more than five numbered steps when a list helps.
4. Say what changed, how it was checked, and what remains.
5. Remove repeated summaries, vague claims, and filler before sending.

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
- A request to implement authorizes scoped file changes and local commits.
- A push, deployment, merge, production change, or external message needs
  clear permission unless the project guide makes it part of the requested
  workflow.
- Preserve unrelated dirty and untracked files.
- Use an isolated worktree when the main checkout is dirty or another agent is
  editing nearby files.
- Never use a hook bypass or a destructive Git command to get around a problem.

## Reuse and research

- Search before building. Extend the deepest existing component, helper,
  contract, fixture, workflow, or document that already owns the behavior.
- Check facts instead of guessing. Use current code first, installed package
  documentation second, and the web only for facts those sources do not
  resolve. Do not run several research tools as a checklist.
- Read installed framework docs before changing a framework contract.
- Do not add compatibility layers, fallback paths, dead code, or speculative
  abstractions unless the user asks for them.
- Prefer a clean breaking change on development branches and disposable
  development data. Follow the repository's migration rules when saved data is
  production data.
- Do not stop work to lecture about secrets or rotate them unless asked.

## Skills and agent entry points

- Use `ponytail` for substantial planning and implementation. Choose the
  smallest complete solution.
- Use `unslop` for every agent-written plan, review, document, and user-facing
  message.
- Use `test-decision` before creating, changing, deleting, or reviewing a test
  or assertion. Read `docs/test-quality.md` with it.
- `.agents/skills/` is the canonical repository skill directory.
  `.claude/skills/` contains links to those skills, not separate copies.
- `CLAUDE.md` contains only `@AGENTS.md`.

## Keep execution efficient

One primary agent owns the task, integrated diff, final verification, and
handoff.

- Optimize elapsed wall-clock time. Run independent repository reads,
  dependency installs, focused checks, builds, and deployment preparation at
  the same time instead of serially.
- Batch related searches, file reads, status checks, and API queries. Prefer
  one bounded command or parallel tool call over a long sequence of tiny
  calls. Reaching 50 completed tool calls in one phase is a trigger to
  consolidate the remaining work, not to pause or stop.
- During an authorized merge or explicit CI-monitoring task, use one watcher
  and continue independent work. During ordinary edits, follow the CI handoff
  rule above and return after targeted verification.
- Do not delegate routine work or delegate merely because an investigation has
  several reads or searches.
- Parallelize only when there are at least two independent workstreams and doing
  so shortens the critical path.
- Keep one writer for each shared schema, API contract, migration, deployment,
  or other invariant.
- Give every lane a bounded goal, exact paths, expected evidence, and a clear
  stop condition.
- Codex and ChatGPT primaries delegate to GPT-6 Astra at xhigh reasoning.
- Claude primaries delegate to Opus 5.5 at high reasoning.
- Every delegated prompt requires `ponytail` and `unslop`.
- Implementation lanes use isolated worktrees and isolated development
  services. They do not start or change shared deployments.
- Stop or redirect a lane that is no longer saving time.
- The primary agent integrates lane results. Subagents do not merge their own
  work.
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
- Do not add tests for copy-only, style-only, comment-only, documentation-only,
  or behavior-preserving refactors.
- Use focused checks for edits, commits and PR updates. The CI section above
  defines when to run or wait for the full pre-merge suite; an implementation
  handoff does not require that suite to finish.
- When a change needs runtime proof, test the unmerged commit in an isolated or
  preview deployment before merge. Merge must not be the first way to exercise
  the real boundary.
- The primary agent runs one final browser, deployment, or live-service gate
  when the changed boundary needs one.
- Subagents do not repeat full suites, browser runs, or shared deployment checks
  unless their lane specifically owns that isolated boundary.

## Review once per complete phase

- Use one read-only review from the other agent family on the final integrated
  diff for each complete phase. Do not review every commit.
- A Codex or ChatGPT primary uses Opus 5.5 at high effort:

  ```sh
  claudeekitabu -p --model claude-opus-5-5 --effort high \
    --permission-mode plan --tools Read,Glob,Grep --no-session-persistence
  ```

- A Claude primary uses GPT-6 Astra at xhigh reasoning:

  ```sh
  codex exec -m gpt-6-astra -c model_reasoning_effort=xhigh -s read-only -
  ```

- Send the review prompt on standard input. Include the exact integrated diff,
  acceptance criteria, and check results.
- Require the reviewer to use `ponytail` and `unslop`, inspect the exact diff,
  and report only actionable findings with file and line references.
- The reviewer does not implement, commit, merge, or deploy.
- A long review, silent output, or a client polling timeout is not a failed
  review. Keep waiting while the reviewer process is alive.
- Treat the review as failed only after a non-zero exit, an explicit error or
  refusal, or confirmation that the process ended without a result. Never
  restart a live review or call a second reviewer because the first is slow.
- Fix valid findings, rerun the affected focused checks, and use the final CI
  result as the merge gate. The primary agent verifies every review fix itself.
  Never call a second reviewer for the same phase, even when a fix changes the
  phase's design, security boundary, code, tests, or interface.

## Git and pull requests

- Use conventional commit prefixes: `feat`, `fix`, `refactor`, `test`, `chore`,
  `docs`, `perf`, or `style`.
- Keep one concern per pull request. Keep commits small enough to review but do
  not split a working unit into ceremony.
- Stage named files. Check the staged diff before committing.
- Never use `--no-verify`, `--no-gpg-sign`, force-push, or history rewriting
  unless the user explicitly requests the exact action.
- Only the integration owner merges and changes shared or production services.
- CI must be green on the exact head that will merge.

## Completion

An implementation task is complete when the requested behavior is present at
the real boundary, targeted checks pass, and no known dead path or hidden
fallback remains. Hand it back with any authorized commit/push complete; CI
may still be running or may not have been checked. Report the checks actually
run, commit, deployment state, and remaining risk. Never call a unit test alone
proof of a browser or deployed service.

Merge readiness is separate: before an authorized merge, require green CI on
the exact head. Do not turn this merge gate into a condition for finishing an
ordinary implementation turn.

## Bad and good examples

| Bad | Good |
|---|---|
| Spawn a subagent because the fourth file needs reading. | Read the connected flow in the primary session. Spawn lanes only for independent work that can run at the same time. |
| Let two agents edit the same schema or API contract. | Give the shared contract one owner. Parallelize callers only after that contract is fixed. |
| Copy all standing rules and model choices into every `PROMPTS.md`. | Put task decisions and checks in the plan. Link to `AGENTS.md` for workflow. |
| Wait for full CI after a fix or PR update. | Run targeted checks, hand back the result, and leave CI in the background. Wait for the exact-head CI gate only for an authorized merge or explicit CI-monitoring request. |
| Run related reads, checks, and repository work one after another. | Batch related tool calls and run independent work at the same time. |
| Release one patch for every error exposed by the previous patch. | After the first failure, inspect the connected boundary once and ship one combined root-cause fix. |
| A reviewer is silent for eight minutes, so start another review. | Check that the process is alive and keep waiting for the same review. |
| Keep an old field optional so saved rows still validate. | Follow the data rule: audit, migrate, verify, then narrow. |
| Say "tests pass, so deployment works." | Run the browser or live-service gate that proves the changed boundary. |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
