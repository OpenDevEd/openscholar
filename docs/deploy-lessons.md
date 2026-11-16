# Deploy lessons, 4 to 7 November 2026

Outline copy: `dae6c74d-9d76-495f-a5fa-84c1ade7e688`. Change both together.

These come from the launch thread, the planet and logo thread, the blank-page thread and the community update threads. Each lesson says what happened and what to do next time.

## How a prod ship went when it went well

On 6 November four releases went out this way with nothing broken (#1073, #1074, #1075, #1077):

1. Merge the PR into `dev` once CI passes on its last commit, then wait for post-merge CI.
2. Confirm `dev.openscholar.ai` serves the merge and a real search works.
3. Read what differs between `prod` and `dev`: migrations, `convex/schema.ts`, `package-lock.json`, new environment variables, new settings rows.
4. Move `prod` to a commit with the same files as `dev`.
5. Deploy the app, then the marketing site. Since 12 November the marketing site builds from its own `marketing` branch, so it ships by moving that branch to the `dev` commit and deploying it (`docs/agents/project.md`, Branches and live systems).
6. Push prod's Convex only if `convex/` changed, after the app is live, from a clean `prod` checkout, with a prod export taken first (`~/.os-rehearsal/before-<sha>.zip` on 5 November).
7. Run a real search on `openscholar.ai` and `discover.openscholar.ai`, read the app's errors, and say what wasn't checked.

## Before shipping

**A skipped check still has to stop the command.** On 5 November the user said to merge without waiting for CI. #1055 went in with a missing import because the command kept going after the type check failed, and the `dev` build broke until #1056. Chain checks with `&&` or `|| exit 1` so a failure stops the merge, even when CI is skipped.

**Re-read the plan's order before each step.** The launch plan said to build the community releases page before the first community moved. Demo moved, and the other six were offered for moving, before the page existed. The user had to ask (5 November, 16:48).

**Rehearse at the size of the real day.** `merge-communities.py` re-read prod's whole table for every row. In the rehearsal prod had no topic rows, so it was fast. Once AIME and USAID had moved, Wealth Inequality's 80,346 topic rows stalled the move for 70 minutes. Reading each table once brought it down to 2 minutes.

**Tell the user in advance what will look broken.** During the launch the user saw an error on `discover` and reported it as broken. It was the expected state while the upgrade ran, about 4 minutes. Say beforehand what will show an error and for how long.

## Shipping to prod

**A fix pushed straight to `prod` leaves `dev` behind.** The refund fix and the collection copy went to the `prod` branch and prod Convex before their PRs (#1059, #1060) were merged into `dev`. CI doesn't run on pushes to `prod`. When that happens, open the `dev` PR in the same turn. Before the next move of `prod`, check that every commit only on `prod` is on `dev` with the same content, or the move undoes it.

**The side that receives a new field ships first, everywhere.** Openscholar rejects a community status report with a field it doesn't know. The record count fix had to be live on both shared dev and prod (#1068) before new-el #765 published a release that sent the field. Otherwise every community on the new release would stop reporting.

**The app goes live before Convex.** This was already the rule on dev (#917), and the 5 November prod push kept to it: Coolify built 48e6acc5 first, then Convex was pushed.

**An import doesn't fill what crons fill.** After the launch import, the presets showed no intelligence bars: 0 of 693 models had a score, because the daily OpenRouter sync hadn't run yet. Running the sync by hand fixed it. After an import, run the syncs the pages depend on.

**Add to prod's version tables, never replace them.** On 13 November prod's checks and agreement were brought up to dev's. Prod had two live reports signed under prod's own agreement version 1 and checked under its checks versions 1 and 2, whose text differed from dev's rows of the same numbers. Replacing `reportAgreementVersions` and `reportCheckVersions` with dev's would have changed what those reports signed. Dev's versions above prod's newest went in with `npx convex import --append`, and the settings row then named dev's current versions. Before copying a table to prod, look for prod rows that point at it.

**Copy settings before a migration that edits them.** `migrations/publicationBalance` makes a new agreement version when the saved one still names CC BY 4.0. Run after dev's agreement was in place, it found nothing to change. Run before, it would have made a version 2 that collides with dev's.

**Copying rows doesn't update counters.** Imports run no triggers, so topic counts and community list counts stayed wrong for moved communities until `communityMoveCounts` and `pagedLibraryVersions` ran. Plan these rebuilds before moving data.

**Say where a change is live.** The signed-out overview went to dev only, and the user tested it on `discover` and found nothing (5 November, 23:30). Every report says "live on shared dev", "live on prod", or both.

## Communities

**Promote, then update.** new-el publishes each release as a prerelease. Shared dev offers it at once. Prod offers it only after Promote on `/settings/admin/community-releases`. Update all then moves prod's communities one at a time, smallest first, and stops at the first failure. Updates only go forward. Rollbacks are done by hand on the server.

**One thread owns a rollout.** On 5 November two threads started updating the same communities to `runtime-d6368d33` within a minute of each other. Before an update, check that the community isn't already on the target or in the middle of an update.

**A moved community's collection source needs its new ID.** The copied collection got a new ID on prod, but AIED's database still named dev's collection. Its source-sync container restarted in a loop from about 20:30 on 5 November until 00:02 on 6 November, and nothing reported it. After a move or a rollout, check that every community's source-sync container is `running`, not only that the rollout finished.

**Test sign-in after a failed publish.** A failed update on Demo changed its Clerk secret while Demo kept running with the old one. The site loaded, but sign-in failed with `invalid_client`. A rerun of the update fixed it.

**Don't import rows a webhook already writes.** The merge script imported an organization membership that Clerk's webhook had already mirrored. Jennie ended up listed twice in OpenDevEd, which would have made Clerk's next event about her fail.

**Compare a page's number with the community's own site.** The releases page added up each source's record count. Wealth Inequality's 9 sources overlap, so it showed 119,469 records. The site shows 51,365.

**Moved communities read "Deleting" on dev.** The move sets dev's row to `disabled` so dev's Update all can't publish dev's sign-in into a live community. The page labels every `disabled` row "Deleting". Nothing is being deleted. It stays that way until dev's rows are cleaned up, about 13 November.

**A big community's publish can time out on its search indexer.** The indexer's health check waits behind Meilisearch's current batch, and the publish gives up after about 150 seconds. Wait for Meilisearch's queue to reach 0, then retry once.

**A hung database session fails an update that carries a migration.** On 13 November seven of prod's eight communities moved to `runtime-9394eb5c` in about a minute each. AIED stayed in "publishing" for 12 minutes and failed. Its new search indexer runs the database migrations first, and one that adds triggers to `item` waited on a lock held by an insert of AIED's own source sync, stuck inside Postgres since the day before (`wait_event` `PerSessionDSA`, 0% CPU). `pg_cancel_backend` and `pg_terminate_backend` don't reach a session in that state. Only a restart of the Postgres server every community shares does, and the user decides that. Visitors were served on the old release by the standby the whole time. Before a rollout whose releases carry a database change, list sessions older than ten minutes in `pg_stat_activity` on that server, and `pg_blocking_pids(<pid>)` says what a waiting migration waits on.

## Outside services

**Clerk: enabling organizations also forces organization selection.** On 5 November this reached the live site for about 15 minutes, and one real person was sent through the choose-organization page. Send `force_organization_selection: false` in the same request. Prove a change to a shared production service by signing in, not by an HTTP 200.

**Clerk: read a setting back after writing it.** `PATCH /instance` accepted the new `home_url` and changed nothing.

**Convex Cloud's custom domain wins over our DNS.** `api.openscholar.ai` kept reaching Convex Cloud after the DNS change, even proxied. Stripe's and Clerk's webhooks now point at `convex-site.openscholar.ai`.

**Autumn's dashboard showed sandbox data under the Production label.** The dashboard sends the environment in an `app_env` header, and its proxy dropped it because of the underscore. The agent first told the user they were on the wrong environment. The user was right, and the agent only found out by looking in the user's browser. Check what the user sees before explaining it.

**Autumn's Svix can hold most of Postgres's connections.** A burst of webhooks took about 80 of 100 and refused new ones until Svix restarted. The limit is now 300, but the pool isn't capped.

**Compare Autumn's plans and features on both sides before a ship.** On 13 November prod's Autumn had no `reports_per_day`, the daily limit on new reports that dev's Free, Free organization and Southern plans carry. Prod's code read it, found nothing, and set no limit. List `plans.list` and `features.list` on the sandbox and on live, and compare each plan's items. To add an item to a live plan in place, send `plans.update` with `items` holding every existing item plus the new one, and `disable_version: true`: the version and the other items' entitlement IDs stay. Our Autumn ignores `add_items` without an error. A plan nobody is on gets all its entitlements made again by the same call.

**Test the money path with a real event.** The first real refund on prod returned the money but not the credits. The code looked for an invoice line tag that Autumn no longer adds, and the test used the old format, so it passed. Only a real $1 refund showed it.

**Read the dashboard before giving steps.** The agent told the user Autumn had a Refund button. For Stripe invoices it's under Issue credit note, then Refund to payment method.

**`npx convex env set --from-file` keeps backslashes in a quoted value.** Set values that hold quotes one at a time.

**Cloudflare stores chunk 404s in the browser for 4 hours.** In the 5 seconds while Coolify's old and new containers overlap, a browser can get the new HTML and a 404 for a new chunk. Cloudflare rewrote that 404 to `max-age=14400`, which gave a blank page on dev on 5 November. A cache rule now covers `/_next/static/` on `dev` and `discover`. The apex still uses the 4 hours. Read the user's HAR first, since a clean browser never shows it.

**Coolify updated itself and broke every publish.** On 4 November Coolify moved to 4.6.0, which changed an API response, and every community publish failed at `assembling` until #998. Auto-update is off now. When a Coolify call starts failing, compare a real response with the parser first.

## Checking it worked

**A script's pass isn't proof.** The user, 5 November: "dont just depend on scripts pleaase, use your actual intelligence and look through things". A minute earlier, in the planet thread: "THE FIX ISNT LIVE YOUR TEST WHERE YOU OPEN A BROWSER AND KEEP REFRSHING IT DIDNT CATCH SHIT". After that, each community move was checked by hand: screenshots viewed, record counts compared with the site, domains and redirects opened in a real browser.

**Clean up what a test leaves on prod.** A background driver hit its 30-minute limit and left a throwaway login in prod Clerk. Delete test users and organizations, such as `launch-check`, before handing back.

**Close only your own browser windows.** Closing "the front window" closed the user's main Helium window, with 19 tabs. Close windows by ID.

## Working with the user

**A question gets an answer, not work.** On 5 November the user asked whether the prod setup made sense. The agent wrote a runbook, opened two PRs and started watching them. The user said "im trying to talk to you i never asked you to merge prs". Answer, then stop.

**Use the installed CLI.** The agent reached for `wrangler` when `cf` was installed and logged in. The user: "Bro why are you goign to wrangler there's a cli already set up??"
