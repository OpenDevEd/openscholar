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

## 4. Poll agents; do not wait for them to report

- Agents that run for a long time may stop without a final message. Check
  their worktree (`git log`, `git status`, open PR) on a schedule instead of
  waiting.
- When an agent goes quiet, read the worktree state first. It is the truth;
  the agent's last message is not.

## 5. Keep write-sets disjoint

- Each lane owns a fixed list of paths (the README of the plan folder lists
  them). Two lanes never edit the same file in the same sprint.
- If a change outside the lane's paths is unavoidable, the agent stops and
  writes a `NN-BLOCKER.md` file instead of editing another lane's files.
- Shared files that every lane touches (translations, the section list of a
  page) get one small, additive edit per lane, announced to the integration
  owner first.

## 6. Agents die on session limits; resume from the worktree

- Sessions have a usage limit that resets at a fixed time. Every agent in
  the sprint died at once when it hit.
- Resume by starting a fresh session in the same worktree with the same
  prompt from `PROMPTS.md`. The agent reads `git status` and `git log` and
  continues from the last commit. Do not try to rebuild its memory.
- This only works because every unit of work is committed as soon as it is
  green. Uncommitted work is lost work.

## 7. Local checks are the gate; GitHub Actions can be down

- GitHub Actions was unavailable for part of the sprint. A green or missing
  check on GitHub proves nothing on its own.
- Before a PR is opened, and again before it is merged, run locally:
  `npx vitest run` for the touched areas, `npx tsc --noEmit`, the lane
  upload (`npx convex dev --once` ending in `Convex functions ready!`), and
  the browser check on the lane port.
- Two read-only reviewers look at each PR. The integration owner merges;
  agents never merge.
