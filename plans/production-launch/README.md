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
- Credits: everyone is on Free with its 20,000 a month. Only credits people
  bought carry over: 10 people, 423,521 credits on 2026-11-04.
- Communities are left out. The `organizations.evidenceLibraries` switch stays
  off in prod, and they keep running against shared dev until moved after launch.
- Search-engine and marketing pages beyond the basics come after launch.

## The data upgrade

Almost every live table has `main`'s shape: no workspaces, papers by
`openalexId`, answers on the results, balances on `credits`. The migrations that
moved shared dev's data were deleted after they ran.
`convex/migrations/upgradeLiveData.ts` does it in one run and is deleted once it
has run on live.

`rehearse.sh` runs it on `formal-rabbit-271` from a fresh export. Rehearsed
four times on 2026-11-04 on about 33,760 documents:

| Step | Took |
| --- | --- |
| Export live | 9 to 40 s |
| Push `dev`, validation off | 40 to 95 s |
| `migrations/upgradeLiveData:run` | 4 to 7 min |
| Follow-up migrations | about 40 s |
| Push `dev`, validation on | about 20 s |

Result: about 45,000 rows, 0 fail the schema. Nothing lost: 3,234 papers with their
ratings and owners, 16 collections, 80 memberships, 3,270 screening answers.

Then, signed in as a test login mapped onto a copied account: library, filter
counts, screenings and their tallies, plan page, search, question to query, AI
overview and an assistant reply all worked. The query and the reply charged
credits as they should, 125 in all.

## What's there today (read 2026-11-04)

| Thing | State |
| --- | --- |
| Live site | Vercel, Convex Cloud `opulent-ram-908`, production Clerk |
| `api.openscholar.ai` | Cloud's custom domain. Stripe's webhook points here (`/webhooks/stripe`) and `/webhooks/clerk` answers here |
| `openscholar-prod` on Coolify | A June copy of live (1,442 users), old image, no router for `convex.openscholar.ai` (503). It holds live keys and is running. Nothing depends on it, so it can be replaced |
| `openscholar-app-prod` on Coolify | Old `coolify` branch with `pk_live`, at `openscholar.opendev.space` |
| Production Clerk | Organizations off, slugs off, 5-member cap. The `convex` JWT template lacks dev's `o` claim (`{id: org.id, rol: org.role}`). `home_url` is `openscholar.ai` |
| Autumn | Live environment empty: no live customers, products or API key, and only test Stripe keys |
| Live Stripe | 0 active subscriptions, products Go, Pro and Credits, last charge 2026-10-16 |
| Privacy policy | Names only PostHog and Vercel as processors. No terms page exists |
| PostHog | Dev and live share one project key |
| Cloudflare | Holds DNS. No API token found on this machine or the host |
| Coolify | Auto-update on (daily 00:02). Port 8000 answers from outside. Nightly backup skips Docker volumes |

## Order

### 1. Finish product work

Custom search (#1012, not started in code) and marketing are in other threads. Any
schema change needs the rehearsal run again. Agree a freeze before step 4.

### 2. Code, nothing deployed

- App address to `discover`: `metadata.siteUrl` is in 13 message files, so make it one
  setting. `isLiveSite` and the canonicals follow it.
- Bought credits: a script from `credits.paidBalance` in the export to Autumn top-ups.
- Privacy policy: name the processors and hosting as they'll be, for the user to
  approve, in every language.
- `credits.topups` off at launch unless a terms page exists by then.
- Point `rehearse.sh` at self-hosted Convex.

### 3. Infrastructure, nothing public changes

1. DNS: `discover.openscholar.ai` and `convex.openscholar.ai` to the host.
2. Prod Convex: replace `openscholar-prod` with a fresh database on dev's image, with
   64 concurrent queries and mutations, `cpu_shares` 16384 and `oom_score_adj` -500.
3. Settings: live's, plus what prod lacks, leaving out `EL_*`. Same `ENCRYPTION_KEY`,
   which already matches dev's. Webhook secrets stay as they are.
4. Frontend: `openscholar-app-prod` on `main`, at `discover`. A later API redeploy builds
   the pinned commit, so deploy by webhook.
5. Clerk: organizations on, slugs on, higher member cap, add the `o` claim.
6. Autumn: live Stripe key, copy the catalog, live API key, webhook to prod Convex.
7. Separate PostHog project for prod.
8. Before real accounts live here: nightly `convex export` into the restic backup,
   Coolify auto-update off, port 8000 closed.

### 4. Rehearse on the real stack

Copy live data to prod Convex and run the upgrade (`rehearse.sh`). On `discover` with
real sign-in, check library, ratings, collections, screening and extraction start to
finish, assistant, plans, `/connect` and Zotero. Note how long each step takes.

### 5. Launch

1. Holding page on the apex and stop Stripe's webhook. Wait until no screening job is
   `processing`: the upgrade marks any paper still running as skipped.
2. Export live and keep it. Note who bought credits.
3. Push old `main`'s code to prod with validation off and import with `--replace-all`, as
   `rehearse.sh` does: the rehearsal leaves `dev`'s schema there, which refuses live's rows.
   Merge `dev` into `main`, then push it with validation off, by editing `convex/schema.ts`
   the way `push-dev.sh` does. Run the upgrade and `screeningOutcomes`, `screeningSearch`,
   `makerCounts`, `pagedAccountLists` and `placeRatings`. Push again with validation on.
4. Copy `aiModelConfig` and `featureFlags` from shared dev with
   `npx convex import --table <table> --format jsonLines --replace`, without `_id` or
   `_creationTime`. Don't use `featureFlags/internal:seed`: it leaves the assistant off.
   Add the admins.
5. Give the people who bought credits their balances as top-ups.
6. Point `api.openscholar.ai` at prod Convex, so Stripe's and Clerk's webhooks keep their
   address. Start the frontend from the merged `main`.
7. Apex: redirect to `discover`, permanently for app paths (keeping the query string on
   `/connect`), temporarily for `/` until marketing is ready. Fix `www`. Stop Vercel deploys.
8. Check `/` on `discover` says `index, follow`: the proxy must pass that host. Check
   sign-in, a search and a charge.

**Going back:** before step 6 nothing public has moved. After it, point DNS back at
Cloud and Vercel, which are untouched. Writes made since are lost, so decide within
the hour.

### 6. After launch

- Marketing on the apex, with `WebSite` and `Organization` data, then job and comparison pages.
- Communities: copy each one's Convex rows to prod with owner and organization remapped,
  recreate its organization on production Clerk by email, publish from prod. About 6 are real.
  Readers (37) are keyed by dev Clerk ID and need matching by email. Try it on Demo first.
- Full backups: community databases and Convex files.
- Delete `upgradeLiveData.ts` and this folder.

## Not rehearsed yet

- The upgrade on self-hosted Convex. It has only run on Convex Cloud.
- Importing a Cloud export into self-hosted Convex, and Cloud's components there.
- Live Autumn, and whether it needs Stripe connected for free plans.
- Real sign-in through the production Clerk on `discover`.
- A screening or extraction run start to finish on the new stack.
- Load: dev's host has room today (17 GB free, 91 GB page cache) but runs at load 10.

## Done when

The app serves on `discover`, existing people sign in and see their papers, ratings and
screenings, and the apex serves marketing or redirects.
