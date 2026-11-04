# Production launch

Brings `dev` to openscholar.ai. Standing rules are in the root `AGENTS.md` and
`docs/agents/project.md`.

## Decisions

Agreed with the user on 2026-11-04.

- Live data stays where it is: Convex Cloud `opulent-ram-908`, the production
  Clerk instance. Nobody moves or signs in again.
- The frontend is the same container as `dev.openscholar.ai`, on Coolify. Its
  OpenAlex limiter is per process, so Vercel isn't a like-for-like home.
- Credits: everyone is on Free with its 20,000 a month. Only credits people
  bought carry over: 10 people, 423,521 credits on 2026-11-04.
- Communities are left out. The `organizations.evidenceLibraries` switch stays
  off in prod, and AIED, TVET and ECCAR keep running against shared dev.
- Backups are for later, at the user's request. Check that Convex Cloud's backup
  is on before launch.

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

## Launch order

Every Convex command below names prod: `--prod` from a checkout with no `.env.local`,
with `CONVEX_DEPLOYMENT=dev:formal-rabbit-271`, which is how the CLI finds the project.

1. Prepare. Turn on organizations in the production Clerk (off today). Set the
   settings prod Convex lacks, leaving out `EL_*`: Autumn, `CLERK_SECRET_KEY`,
   `FREE_QUERIES_SECRET`, `GITHUB_TOKEN`, `PAPER_PDFS_*`. Stand up a live Autumn
   on live Stripe and sync the catalog. Make the Coolify app, not yet deployed.
2. Close the old site. Point openscholar.ai at a holding page and stop Stripe's
   webhook. Wait until no screening job is `processing`: the upgrade marks any
   paper still running as skipped. Sign-ups and purchases are now stopped.
3. Export live and keep it. Note who has bought credits, from `credits.paidBalance`.
4. Merge `dev` into `main`, then push to prod with validation off, by editing
   `convex/schema.ts` the way `push-dev.sh` does. Run the upgrade and
   `screeningOutcomes`, `screeningSearch`, `makerCounts`, `pagedAccountLists` and
   `placeRatings`. Push again with validation on.
5. Copy from shared dev: `aiModelConfig` and `featureFlags` with
   `npx convex import --prod --table <table> --format jsonLines --replace`, without
   `_id` or `_creationTime`. Don't use `featureFlags/internal:seed`: it leaves the
   assistant off. Add the admins.
6. Give the people who bought credits their balances as top-ups.
7. Deploy the Coolify frontend from the merged `main`, and check it on its temporary
   address.
8. Point openscholar.ai at it, fix `www`, point Clerk's and Stripe's webhooks at what
   they need, and stop the Vercel deploys.

## Not rehearsed yet

- Live Autumn and carrying over bought credits. The rehearsal used shared dev's
  Autumn sandbox.
- Real sign-in through the production Clerk. It only answers on openscholar.ai's
  domains, so this needs a temporary subdomain.
- A screening or extraction run start to finish, on Convex Cloud.
- Convex Cloud's limits and cost under real load.

## Done when

openscholar.ai serves `dev`, existing people sign in and see their papers, ratings
and screenings, and `upgradeLiveData.ts` and this folder are deleted.
