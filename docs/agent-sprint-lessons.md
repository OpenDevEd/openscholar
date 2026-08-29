# What two agent sprints taught us

Two sprints ran several coding agents at the same time, each in its own Git
worktree with its own Convex Cloud deployment. The first sprint leaked
containers and deployments. The second one (Evidence Library configuration
v2, August 2026) fixed most of that. These are the rules that came out of both.

## 1. Clean up only what the sprint created

- Cleanup targets are the things the sprint itself made: Convex Cloud lanes,
  worktrees, sprint branches, mock code, and `el-*` acceptance containers.
- Never stop, remove, or list as "cleanup" the user's own containers. In
  particular `what2` and `minio` are personal services. A previous agent
  killed the wrong container and that must not happen again.
- Before any `docker stop` or `docker rm`, list containers by the sprint's
  name prefix only. Anything without that prefix stays alone.

## 2. Each worktree installs its own `node_modules`

- Do not share or symlink `node_modules` between worktrees. Native modules,
  Next.js caches and Convex generated files then belong to the wrong tree and
  fail in confusing ways.
- Run `npm install` in every new worktree before the first test run.

## 3. Never re-point `dev-self`

- `dev-self` is the integration checkout. It is the only one that uploads to
  the shared self-hosted Convex deployment.
- Agents never change its `.env.local`, its branch, or its deployment. Each
  agent gets a named Convex Cloud lane in its own worktree and uploads there
  with `npx convex dev --once`.
- After a merge, the integration owner runs `npm run convex:push` from
  `dev-self` and checks the logs and the browser. Agents do not.

## 4. Delegate only when it shortens the work

- Do not create a lane because a task needs several reads or searches.
- Create lanes only for independent work that can run at the same time without
  sharing an invariant or write-set.
- Give every lane a bounded result and stop it when it no longer saves time.
- For a running implementation lane, check its worktree before relying on a
  status message. Git is the durable handoff.

## 5. Keep write-sets disjoint

- Each lane owns a fixed list of paths (the README of the plan folder lists
  them). Two lanes never edit the same file in the same sprint.
- If a change outside the lane's paths is unavoidable, the agent stops and
  writes a `NN-BLOCKER.md` file instead of editing another lane's files.
- Shared files that every lane touches (translations, the section list of a
  page) get one small, additive edit per lane, announced to the integration
  owner first.

## 6. Resume from the worktree

- If a lane stops, start from its named goal, plan when one exists, `git
  status`, and `git log`.
- Do not copy a large standing-rules prompt into every plan. `AGENTS.md` and
  `docs/agents/project.md` already own the workflow.
- Commit each working unit. Leave a short resume note only when the remaining
  work cannot be understood from the plan and Git.

## 7. Focus locally; run the full gate once

- During coding, run only the focused tests and checks that own the changed
  behavior.
- A lane checks its isolated boundary. It does not run the whole suite or touch
  the shared deployment.
- The primary agent integrates the phase, runs the final browser or deployment
  gate, and requests one read-only Fable review of the integrated diff.
- GitHub CI runs the full required suite once on the exact PR head. Only the
  integration owner merges.
