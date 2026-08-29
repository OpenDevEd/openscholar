# Agent working agreement

Keep this file byte-for-byte identical in `OpenDevEd/openalex-count` and
`OpenDevEd/new-el`. Repository-specific rules belong in
`docs/agents/project.md`.

For any non-trivial task, read `docs/agents/project.md` before acting. Read a
named plan or specification when the request points to one. Do not load every
plan or document by default.

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
- Check facts instead of guessing. If a claim feels uncertain, inspect the
  code, use `find-skills`, read current package docs, and research the web.
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

- Do not delegate routine work or delegate merely because an investigation has
  several reads or searches.
- Parallelize only when there are at least two independent workstreams and doing
  so shortens the critical path.
- Keep one writer for each shared schema, API contract, migration, deployment,
  or other invariant.
- Give every lane a bounded goal, exact paths, expected evidence, and a clear
  stop condition.
- Codex and ChatGPT primaries delegate to GPT-5.6 Sol at high reasoning.
- Claude primaries delegate to Opus-5 at high reasoning.
- Every delegated prompt requires `ponytail` and `unslop`.
- Implementation lanes use isolated worktrees and isolated development
  services. They do not start or change shared deployments.
- Stop or redirect a lane that is no longer saving time.
- The primary agent integrates lane results. Subagents do not merge their own
  work.

## Plan only when it helps

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
- Run the repository's full required suite once in CI on the final PR head.
  Do not make every lane or commit repeat it.
- The primary agent runs one final browser, deployment, or live-service gate
  when the changed boundary needs one.
- Subagents do not repeat full suites, browser runs, or shared deployment checks
  unless their lane specifically owns that isolated boundary.

## Review once per complete phase

- Use one read-only review from the other agent family on the final integrated
  diff for each complete phase. Do not review every commit.
- A Codex or ChatGPT primary uses Fable-5 at high effort:

  ```sh
  claudeekitabu -p --model claude-fable-5 --effort high \
    --permission-mode plan --tools Read,Glob,Grep --no-session-persistence
  ```

- A Claude primary uses GPT-5.6 Sol at high reasoning:

  ```sh
  codex exec -m gpt-5.6-sol -c model_reasoning_effort=high -s read-only -
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
  result as the merge gate. A second review is needed only when the fix changes
  the phase's design or security boundary.

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

Work is complete when the requested behavior is present at the real boundary,
focused checks pass, the final required CI passes when a PR is in scope, and no
known dead path or hidden fallback remains. Report the exact checks, commit,
deployment state, and remaining risk. Never call a unit test alone proof of a
browser or deployed service.
