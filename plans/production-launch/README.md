# Production launch

Brings `dev` to production. Standing rules are in the root `AGENTS.md` and
`docs/agents/project.md`.

## Decisions

Agreed with the user on 2026-11-04.

- `openscholar.ai` is the marketing site. The app moves to
  `discover.openscholar.ai`. If marketing isn't ready, the apex redirects to
  `discover` temporarily.
- Pricing and the legal pages stay on `discover`, one copy each. The apex
  redirects those paths there.
- Convex is self-hosted, set up as shared dev is, on Coolify with Postgres.
  This replaces the earlier decision to stay on Convex Cloud: the user wants it on
  our own host. The move has one gain: Cloud and Vercel stay untouched, so going back
  is a DNS change.
- The frontend is the same container as `dev.openscholar.ai`, on Coolify. Its
  OpenAlex limiter is per process, so Vercel isn't a like-for-like home.
- Autumn stays one server, using its live environment.
- Credits: everyone is on Free with its 50,000 a month. Only credits people
  bought carry over: 10 people, 423,521 credits on 2026-11-04.
- Communities are on at launch: an organization opens one under the organization plans, by request (`/pricing?audience=org`, switched on at Settings > Admin). The existing ones move after launch (AIED, TVET, ECCAR, USAID, Wealth Inequality and `aievidencehub.org`), once Demo's move is accepted. The other 120 are tests and stay on dev. Until each moves, its Open in Openscholar button opens `dev.openscholar.ai`, on dev Clerk's separate accounts, capped at 100 people (56 on 2026-11-05).
- Search-engine and marketing pages beyond the basics come after launch.

## The data upgrade

Almost every live table has `main`'s shape: no workspaces, papers by
`openalexId`, answers on the results, balances on `credits`. The migrations that
moved shared dev's data were deleted after they ran.
`convex/migrations/upgradeLiveData.ts` does it in one run and is deleted once it
has run on live.

`rehearse.sh` runs it on prod Convex from a fresh export of live. On the self-hosted stack on 2026-11-05, on 33,775 documents:

| Step | Took |
| --- | --- |
| Export live | 18 s |
| Import into prod Convex | 29 s |
| Push `dev`, validation off | 33 s |
| `migrations/upgradeLiveData:run` | 3 min 7 s |
| Follow-up migrations | 36 s |
| Push `dev`, validation on | 21 s |

About 6 minutes in all. Result: 45,077 rows in 139 tables, 0 fail the schema. Nothing lost: 3,234 papers with their ratings and owners, 16 collections, 80 memberships, 3,372 screening answers.

Then, with a production Clerk login mapped onto a copied account, on `discover`: library (294 papers), screenings, plan page (20,000 Free plus 96,634 bought), search, pricing and `/connect` all worked. Earlier rehearsals on Cloud also checked question to query, AI overview and an assistant reply.

## What's there today (read 2026-11-05)

| Thing | State |
| --- | --- |
| Live site | Vercel, Convex Cloud `opulent-ram-908`, production Clerk |
| `api.openscholar.ai` | Cloud's custom domain. Stripe's webhook points here (`/webhooks/stripe`) and `/webhooks/clerk` answers here. Prod Convex already has a router for this host, with no certificate resolver because Cloudflare proxies it |
| `openscholar-prod` on Coolify | Prod Convex: dev's image, 64 concurrent queries and mutations, fresh volumes `convex-data` and `convex-pgdata` (the June copy's `data` and `pgdata` are kept). At `convex.openscholar.ai`, `convex-site.openscholar.ai`, `convex-dashboard.openscholar.ai`. It holds the last rehearsal's copy of live. Admin key: `~/.os-rehearsal/prod-convex.env` on the Mac, or `generate_admin_key.sh` in the container |
| `openscholar-app-prod` on Coolify | At `discover.openscholar.ai`, built from `dev`, auto-deploy off. Deploy with `POST /api/v1/deploy?uuid=...` from the host |
| Production Clerk | Organizations and slugs on, `force_organization_selection` off, `convex` template has `o` and `email`. Member caps are set per organization in code, so the instance's 5 doesn't matter. `home_url` is still `openscholar.ai` |
| Autumn live | Live Stripe key, catalog copied, key `am_sk_live` on prod Convex, Svix webhook to `convex-site.openscholar.ai/webhooks/autumn`. Holds the rehearsal's customers |
| Live Stripe | 0 active subscriptions. Autumn added a webhook of its own and its products; the old site's webhook and products are untouched |
| `openscholar-marketing` on Coolify | The marketing site from `marketing/`, built by its Dockerfile, at `marketing.openscholar.ai` |
| Cloudflare | Holds DNS. Reach it with the `cf` CLI (`CLOUDFLARE_ACCOUNT_ID=47478c682fae9ae095d6c89858ea0d67`). Prepared and switched off: holding page, `www` to the apex, and every apex path that isn't the marketing site's to `discover`. A response rule sends `X-Robots-Tag: noindex` on `discover` and the marketing preview until launch |
| Coolify | Auto-update off. Port 8000 closed to the outside by `close-coolify-port.service`; the dashboard is `coolify.opendeved.net` |
| PostHog | One project, as the free plan allows. Server events carry `environment`, browser events `$host` |

## Order

### 1. Finish product work

Custom search (#1012, not started in code) and marketing are in other threads. Any
schema change needs the rehearsal run again. Agree a freeze before step 4.

### 2. Code: done

`SITE_URL`, `carry-credits.mjs` and the rehearsal scripts merged in #1048.

### 3. Infrastructure: done except a real payment

See the table above. Traps for anyone repeating it:

- Turning on Clerk organizations through the API also sets `force_organization_selection`, which reached the live site for about 15 minutes on 2026-11-05. Send it as `false` in the same request.
- `npx convex env set --from-file` keeps backslashes in a quoted value. Set values holding quotes one at a time.
- Prod Convex holds `EL_*`, without `EL_ALLOW_DEVELOPMENT_TEARDOWN`, so a community can be published from it.

Still to do: one top-up with a real card. `discover` reaches Stripe's live checkout for $1.00 with the right email, and nothing has been paid.

### 4. Rehearse on the real stack

`rehearse.sh`, then `carry-credits.mjs`, have run: see The data upgrade. On 2026-11-05 a real $1 top-up went through Autumn's live environment and added its credits.

Demo moved to prod the way the others will (see Moving communities), and on prod: a reader signs in through production Clerk, Open in Openscholar brings its 4 papers to `discover`, and `/admin` and the configuration page open for an organization admin. Signed Stripe and Clerk deliveries, with the real secrets, are accepted on prod Convex and bad signatures are refused; `api.openscholar.ai` routes to the same handlers at the origin. Autumn's webhook delivers there too.

Left: screening and extraction start to finish, assistant and Zotero. Rerun `rehearse.sh` after the product freeze.

**Before launch, clear the rehearsal:** delete Autumn live's customers, or `carry-credits.mjs` skips people whose balances have since changed; delete the Clerk user `mohammed+launch-check@opendeved.net` and the Clerk organization `launch-check`.

### 5. Launch

1. Turn on the holding page (Cloudflare rule, switched off until then) and stop Stripe's webhook. Wait until no screening job is
   `processing`: the upgrade marks any paper still running as skipped.
2. Export live and keep it. Note who bought credits.
3. Push old `main`'s code to prod with validation off and import with `--replace-all`, as
   `rehearse.sh` does, from `merge-communities.py`'s export with Demo in it, whatever else moves later: this is the one chance to give prod's community tables dev's numbers: the rehearsal leaves `dev`'s schema there, which refuses live's rows.
   Merge `dev` into `main`, then push it with validation off, by editing `convex/schema.ts`
   the way `push-dev.sh` does. Run the upgrade and `screeningOutcomes`, `screeningSearch`,
   `makerCounts`, `pagedAccountLists` and `placeRatings`. Push again with validation on.
4. Copy `aiModelConfig` and `featureFlags` from shared dev with
   `npx convex import --table <table> --format jsonLines --replace`, without `_id` or
   `_creationTime`. Don't use `featureFlags/internal:seed`: it leaves the assistant off.
   Add the admins.
5. Give the people who bought credits their balances as top-ups: `AUTUMN_URL=... AUTUMN_SECRET_KEY=... node carry-credits.mjs <export.zip> --apply`. On 2026-11-05 that was 10 people and 423,521 credits. It stops with an error if any balance comes out wrong.
6. Point `api.openscholar.ai` at prod Convex with `cf`: A `178.63.162.33` and AAAA `2a01:4f8:2210:1224::2`, proxied, so Stripe's and Clerk's webhooks keep their address. Point the frontend at `main` (it builds from `dev` now) and deploy it.
7. Clerk: set `home_url` to `discover`, and add `organization.*`, `organizationMembership.*` and `organizationInvitation.*` to the production webhook `ep_3BzL7D0RtQXqKG4Pec1h6RLTq7c`, which only sends `user.*`. Without them, changes made in Clerk don't reach prod's organizations. Doing either earlier would touch the live site.
8. Marketing: merge `marketing/` to `main`, give `openscholar-marketing` the domains `openscholar.ai` and `www.openscholar.ai` and deploy it. Point both names at the host with `cf` (A `178.63.162.33`, AAAA `2a01:4f8:2210:1224::2`, proxied; `www` is a CNAME to Vercel now, so replace it). Swap the holding page for the two prepared redirects. Remove the `noindex` rule. Stop Vercel deploys.
9. Check `/` on `discover` says `index, follow` with no `X-Robots-Tag`. Check sign-in, a search and a charge. A new account must show 20,000 credits straight away.

**Going back:** before step 6 nothing public has moved. After it, point DNS back at
Cloud and Vercel, which are untouched. Writes made since are lost, so decide within
the hour.

### 6. After launch

- Marketing on the apex, with `WebSite` and `Organization` data, then job and comparison pages.
- Community releases, before the first community moves. new-el publishes each release as a
  GitHub prerelease; dev's OpenScholar can see prereleases, and promoting one offers it to
  prod. A page at `/settings/admin/community-releases`, agreed as a mock on
  `mock/community-releases`, lists releases and communities, with Promote, Pull back, Update all
  and Roll back all. Updates run one at a time, smallest first, stopping at the first failure,
  and we may update anyone's community. Rollback uses `startRuntimeRollback` and only appears
  when no database change is in the way. There are no manual rollbacks.
- Move the existing communities: see Moving communities.
- Delete `upgradeLiveData.ts` and this folder.

## Moving communities

A community's app, Postgres, search, files and domains stay put. Only its Convex rows move, and they keep their IDs: `merge-communities.py` explains why. Credentials stay readable because `ENCRYPTION_KEY` is the same on both.

1. Once, per organization: create it on production Clerk and name it in `$R/clerk-organizations.json`. OpenDevEd is `org_3Lggka7qmtNGSSsrLp6a0hHK3Ax`.
2. `npx convex export` from prod, then `merge-communities.py --rows-only <export> <rows.zip> "<name>"`, then `npx convex import --append <rows.zip>`.
3. Publish it from prod, which writes the new Openscholar address and a production Clerk sign-in into the community. Publish refuses when nothing changed, so run `versions:startRuntimeUpdate` if an update is waiting, or save a change first.
4. Readers: in the community's database, change `reader_account."accountId"` and `reader_user.email` from the dev Clerk ID to the production one, matched by email, before they sign in on prod. Otherwise they get a new empty reader. There are about 16 real ones. Everyone signs in once more.

5. Rebuild what copying rows doesn't, which runs no triggers. All three are safe to run again:
   - `npx convex run migrations/communityMoveCounts:countLibraries`, the workspace's count of communities.
   - `npx convex run migrations/pagedLibraryVersions:run '{"cursor": null}'`, each community's count of versions.
   - `npx convex run migrations/communityMoveCounts:rebuildTopics`, what topic pages read. Run it after the last move of a batch: it reads every community's locations.

Only organizations in the launch import can move this way, since they alone have dev's IDs on prod: all of today's are OpenDevEd. A community following a dev collection stops the script until `copy-collection.py <export> <collection ID>` has put it on prod, through `migrations/copyCollection`: AIED follows one, 1,611 papers.

**Going back:** the community's rows stay on dev for a week. On dev, save a change to its configuration, since publishing refuses when nothing changed, and publish. Once that has put dev's sign-in back, reverse step 4 with the mapping kept from it. Then delete the dev rows. Never tear it down from dev: that deletes its app.

## Backups

`backup-r2.sh` runs nightly at 04:30 on the host (`backup-r2.timer`). It dumps every database in `POSTGRES_CONTAINERS` and each backend in `CONVEX_BACKENDS`, both in `/etc/default/backup-r2`, and encrypts them with `age` to bucket `openscholar-backups` on R2. A new community database is picked up by itself; a new Postgres container has to be added. Meilisearch rebuilds from Postgres, and PDFs stay in Supabase and R2, so neither is copied. Restic still covers the host's configuration.

- **Kept:** `daily/` 14 days, `weekly/` 36 days, so a deleted account is gone from backups within the time the privacy policy gives. Sunday's copy goes to `weekly/` and includes Convex's stored files (4 small images in November 2026). A 7-day bucket lock stops anyone deleting a recent copy, the server's own token included. To delete one sooner, change the lock with `cf r2 buckets locks`.
- **Failure:** the job exits non-zero and pings the restic health check's `/fail`, including when a copy is under half the size of the last. There's no alert if the timer never runs at all.
- **Keys:** the private key is at `~/.config/openscholar-backup/age-key.txt` on the Mac and in the password manager, never on the host. Keep Convex's environment variables and `ENCRYPTION_KEY` with it: dumps don't include them.

**Restoring**, from the Mac (`age -d` needs the private key):

```sh
BACKUP='set -a; . /etc/default/backup-r2; set +a; rclone'
# Find a copy
ssh hetzner "sudo -n bash -c '$BACKUP lsf -R r2:openscholar-backups/daily/'"
# A Postgres database, into a server with the extensions: restore globals.sql.zst.age the same way with psql first
ssh hetzner "sudo -n bash -c '$BACKUP cat r2:openscholar-backups/daily/<stamp>/postgres/<container>/<db>.dump.zst.age'" \
  | age -d -i ~/.config/openscholar-backup/age-key.txt | zstd -d | pg_restore --no-owner -d <target>
# Convex: decrypt the zip the same way, then import it as under "The data upgrade"
npx convex import --replace-all <zip>
```

Tested 2026-11-05: `kenya` restored into a throwaway pgvector container and its five largest tables matched the source row for row. The Convex zip opened with all 156 tables, but hasn't been imported yet. Prod Convex's backend is in `CONVEX_BACKENDS`.

## Not rehearsed yet

- A screening or extraction run start to finish on the new stack.
- Load: on 2026-11-05 the host ran at load 45 to 140 during CI.
- Importing one of the backups' Convex zips.

## Done when

The app serves on `discover`, existing people sign in and see their papers, ratings and
screenings, and the apex serves marketing or redirects.
