---
name: ship-prod
description: Production runbook for OpenScholar. Use when the user says "ship to prod", "promote" a community's software, or "check prod", or asks how to deploy, watch or roll back discover.openscholar.ai, openscholar.ai or prod Convex.
---

# Ship to prod

Plain "ship" stops at shared dev. Only the words in the table below reach prod, and they count for that request alone.

| The user says | Do |
| --- | --- |
| "ship to prod" | Every step under "Ship": `dev`'s head goes live |
| "ship <fix> to prod" | "Ship one fix", when `dev` holds other unshipped work |
| "promote" | "Promote a community's software" |
| "check prod" | "Check prod", read-only |

## What runs where

| Thing | Where | Coolify uuid |
| --- | --- | --- |
| App, `discover.openscholar.ai` | branch `prod`, auto-deploy off | `n8nl3k8t8tjwmkehh4bb15rw` |
| Marketing, `openscholar.ai` | branch `prod`, auto-deploy off, `marketing/` | `ftka4ierv4txgsw8aozr9p9w` |
| Convex, `convex.openscholar.ai` | pushed by hand | service `b13uzj4g6mfy57yhv34rejdf` |

Paste these helpers into each shell call. Coolify's API answers only on the host.

```bash
R=~/.os-rehearsal   # prod-convex.env (lost: generate_admin_key.sh in the backend container), and `dev`, the checkout that pushes to prod
APP=n8nl3k8t8tjwmkehh4bb15rw; MARKETING=ftka4ierv4txgsw8aozr9p9w
coolify() { ssh hetzner "T=\$(sudo -n cat /root/cdtok | tr -d '[:space:]'); curl -sS -m 30 -H \"Authorization: Bearer \$T\" -H 'Content-Type: application/json' -X $1 ${3:+-d '$3'} http://localhost:8000/api/v1/$2"; }
prodcx() { ( unset CONVEX_DEPLOYMENT CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY; cd "$R/dev" && set -a && . "$R/prod-convex.env" && set +a && npx convex "$@" ); }
```

Other threads ship too. Before a write, read `git -C $R/dev status -sb` and the latest deployments, and wait for anything in progress.

## Ship

### 1. Read what's going out

```bash
git fetch origin
git log --format='%h %s' origin/prod..origin/dev
git log --format='%h %s' origin/dev..origin/prod
git diff --name-status origin/prod origin/dev
gh run list --commit "$(git rev-parse origin/dev)" --workflow CI --event push --json conclusion --jq '.[0].conclusion'
```

Done when CI's conclusion prints `success`, shared dev runs the same commit, and every commit that is only on `prod` is also on `dev` by content. Otherwise fix that on `dev` first, or the merge in step 4 undoes it.

### 2. Clear the gates

Each is a place `dev` can differ from prod without any code changing. Done when each one is answered.

- **Migrations.** Prod's data has only had the migrations run on prod, and shared dev's history says nothing about it. List prod's runs with `prodcx data --component migrations migrations --limit 200 --format jsonLines`. Then check `git diff --name-status origin/prod origin/dev -- convex/migrations convex/schema.ts`. Each added or changed file is a migration to run in step 6. A deleted file whose migration never ran on prod has to come back before shipping.
- **Narrowing.** A push fails when a row breaks the new schema. If the range both adds a migration and narrows the schema for it, ship in stages: the commit before the narrowing, run the migration, then the rest.
- **Environment.** Compare names with `prodcx env list | cut -d= -f1 | sort` against shared dev's. Only `EL_ALLOW_DEVELOPMENT_TEARDOWN` belongs on dev alone. Compare `coolify GET applications/$APP/envs` with `t3by2x80cqs5ghp4dtdb8ech`, where prod alone has `NEXT_PUBLIC_GA_ID` and `OPENALEX_EMAIL`. A new name needs prod's own value: Clerk, Stripe, Autumn and webhook secrets all differ between the two.
- **Settings in tables.** `featureFlags` and `aiModelConfig` are rows, so a merge doesn't carry them. A range that adds a flag or a model setting needs the row written on prod, as admin settings or as a single-row change.
- **Back up** when the range touches `convex/schema.ts` or a migration: `prodcx export --path "$R/before-<sha>.zip"`.

### 3. Tell the user what's going out

One short message with the commits in plain words, the migrations, and any new settings. Keep going unless a gate failed.

### 4. Move `prod`

`prod` only moves forward. Its tree must equal the `dev` commit CI passed.

```bash
cd "$R/dev" || exit 1
git checkout -q -- convex/_generated || exit 1
git fetch -q origin || exit 1
git checkout -q --detach origin/prod || exit 1
git merge --no-edit origin/dev || exit 1
git diff --quiet origin/dev || { echo "prod differs from dev"; exit 1; }
git push origin HEAD:prod || exit 1
```

### 5. Deploy, app first

Coolify builds for 4 to 5 minutes while the old container serves, so pushing Convex right after it finishes leaves the shortest mismatch. Pushing first leaves the old pages calling new functions for the whole build.

| The diff touches | Deploy |
| --- | --- |
| Only `docs/`, `plans/`, `.agents/`, `.claude/`, `.github/`, tests | Nothing. Stop here |
| Only `marketing/` | Marketing, no Convex |
| Only `convex/` | Convex, no app |
| Anything else | App, then Convex |

```bash
coolify POST deploy '{"uuid":"'$APP'"}'
coolify GET "deployments/applications/$APP?skip=0&take=1"   # repeat until status is finished
```

Done when the status is `finished` and the commit equals `origin/prod`. If it's `failed`, stop: the old container is still serving. If it stays `in_progress` with a log that has stopped, see [[coolify-deploy-watch]] in memory.

Then Convex, chained so that a wrong tree can't reach the push:

```bash
cd "$R/dev" || exit 1
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/prod)" ] && [ -z "$(git status --porcelain)" ] || { echo "not at prod"; exit 1; }
# when package-lock.json changed: npm ci --no-audit
( unset CONVEX_DEPLOYMENT; set -a; . "$R/prod-convex.env"; set +a; npx convex dev --once --typecheck disable --tail-logs disable ) || exit 1
git checkout -q -- convex/_generated
```

Done when the output says `Convex functions ready!`. Read all of it: a "Deleted table indexes" line you can't explain from the diff means the tree is wrong, so stop and look.

### 6. Run the migrations

`prodcx run migrations/<file>:run`, one at a time, each to `isDone` true with no error in the component table, followed by its `verify` function if it has one.

### 7. Prove it, then watch

Run "Check prod" right away and again about 15 minutes later. When the range changes a signed-in page, sign in and use it: `npm run verify` refuses any Convex but shared dev, so drive `discover` with `agent-browser`.

Report merged, deployed and verified separately, with the commit. Say what wasn't checked.

## Ship one fix

For when `dev` holds work that shouldn't go out yet. The fix goes to `dev` through its normal PR, and to `prod` through a PR of the same commit cherry-picked onto `prod`, which runs CI. Merge on green, then steps 5 to 7.

## Going back

A fix forward is usually safer, because Convex's data may already have moved. Ask the user before anything that loses writes.

- **App or marketing:** pin the last good commit, deploy, then remove the pin, or later deploys keep building that commit. `coolify PATCH applications/$APP '{"git_commit_sha":"<sha>"}'`, `coolify POST deploy '{"uuid":"'$APP'"}'`, and later `{"git_commit_sha":"HEAD"}`.
- **Convex functions:** push the last good commit the way step 5 does. A schema that has since been narrowed or migrated refuses it, which is the signal to fix forward.
- **Convex data:** `npx convex import --replace-all` from the step 2 export or a backup loses every write since. Restoring a backup: "Backups" in `plans/production-launch/README.md`.

These three haven't been run on prod yet. Tell the user that if you reach for one.

## Check prod

Read-only, and safe at any time. Done when every row has a result.

```bash
for u in https://discover.openscholar.ai https://discover.openscholar.ai/pricing https://openscholar.ai https://convex.openscholar.ai/version; do curl -sS -o /dev/null -m 15 -w "%{http_code} %{time_total}s $u\n" "$u"; done
coolify GET "deployments/applications/$APP?skip=0&take=1"
ssh hetzner 'uptime; df -h / | tail -1; sudo -n docker ps --format "{{.Names}} {{.Status}}" | grep -E "b13uzj4g|n8nl3k8t|ftka4ierv|1wqnx1zrn"'
```

| Look at | How | Normal |
| --- | --- | --- |
| App server errors | `ssh hetzner "sudo -n docker logs -t --since 1h <app container> 2>&1 \| grep -E 'Error\|digest'"` | Nothing new. A digest finds the whole error in this log |
| Convex function errors | `perl -e 'alarm 15; exec @ARGV' "$R/dev/node_modules/.bin/convex" logs --history 400`, from `$R/dev` with the env loaded. Call the binary directly: `npx` leaves a stuck child behind | No `[ERROR]` or `Uncaught`. Exit 142 is the alarm |
| Convex backend | `sudo -n docker logs --since 1h backend-b13uzj4g6mfy57yhv34rejdf` | Many "Optimistic concurrency" lines on `workers`, which are harmless. Anything else needs a look |
| Errors people hit | HogQL below | No new message since the deploy |
| Webhooks | Function logs for `/webhooks/stripe`, `/webhooks/clerk`, `/webhooks/autumn` at `convex-site.openscholar.ai` | 200s. Autumn's Svix holds under 100 Postgres connections (`pg_stat_activity` in `postgres-1wqnx1zrn24l1eosrk8nviau`) |
| Host | `uptime`, `df`, Beszel, `localhost:19999` | Load under 48 threads. Disk under 90% |
| Backups | `systemctl status backup-r2.service` on the host | Finished after 04:30 CET today |

PostHog, EU project 125154. The key is `POSTHOG_API_KEY` in `coolify GET applications/$APP/envs`:

```bash
curl -sS -H "Authorization: Bearer $PK" -H 'Content-Type: application/json' https://eu.posthog.com/api/projects/125154/query/ -d '{"query":{"kind":"HogQLQuery","query":"select toStartOfHour(timestamp) h, properties.route r, substring(toString(properties.$exception_values),1,90) m, count() n from events where event = '"'"'$exception'"'"' and properties.environment = '"'"'discover.openscholar.ai'"'"' and timestamp > now() - interval 6 hour group by h,r,m order by h desc, n desc limit 25"}}'
```

Coolify posts failed deploys, an unreachable server and disk warnings to Discord. Nothing alerts on the site being down, on a Convex function failing, or on a backup timer that never ran, so "check prod" is the only way to catch those.

## Promote a community's software

A community follows the Convex that published it. Its software moves one community at a time, by the same path as its Update button.

**The promotion gate isn't built.** The agreed page, `/settings/admin/community-releases`, exists only on `mock/community-releases`. new-el publishes every release as a normal GitHub release and both OpenScholars read the same list, so a release is on offer to prod's communities as soon as new-el merges. Today "promote" means updating a prod community to the newest release, and nothing else keeps a release back. When the page ships, replace this section with it.

1. Wait for the release: `gh release view runtime-<full 40-character sha> --repo OpenDevEd/new-el`.
2. For each community, smallest first, one at a time. Simultaneous updates killed deployments on 2026-10-10. Stop at the first failure.

   ```bash
   ID='{"subject":"<owner>","issuer":"https://clerk.openscholar.ai","tokenIdentifier":"https://clerk.openscholar.ai|<owner>"}'
   prodcx run --identity "$ID" evidenceLibraries/updates:check '{"libraryId":"<id>","refresh":true}'
   prodcx run --identity "$ID" evidenceLibraries/versions:startRuntimeUpdate '{"libraryId":"<id>"}'
   ```

   `<owner>` is a production Clerk ID that manages the community. Which communities are on prod: `prodcx data evidenceLibraries --format jsonLines`.
3. Poll `prodcx data evidenceLibraryConfigOperations --order desc --limit 5 --format jsonLines` for the returned `operationId`. These rows are large. Each update takes about 90 seconds.
4. Done when the operation says `succeeded`, the binding's `runtimeCommit` is the release, and `web-<coolify uuid>-*` on the host has that `SOURCE_COMMIT` and is healthy.

Traps, all from real failures. Details are in [[update-live-libraries-cli]] and [[coolify-4-6-environment]] in memory:

- `RUNTIME_NOT_READY` on a big community: its search index is busy. Wait for Meilisearch's `/tasks?statuses=processing,enqueued` to reach 0, then retry once.
- `CONFLICT`: another thread is updating it. Read the latest operation first.
- A failed update keeps serving the last good release, so leave the records alone and run the update again.
- Going back: `startRuntimeRollback` is internal and goes one release back. It refuses when the live settings need the current software, and it doesn't undo a database migration. The user decided against manual rollbacks, so ask first.

Moving a community from dev to prod is a different job: "Moving communities" in `plans/production-launch/README.md`.
