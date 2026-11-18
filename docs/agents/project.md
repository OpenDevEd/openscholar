# OpenScholar project guide

Read this after the shared `AGENTS.md`. This file owns OpenScholar-specific
facts, commands, and deployment boundaries.

## Product and repository boundary

- Repository: `Openscholar-ai/openscholar` (formerly `OpenDevEd/openalex-count`).
- Active development branch: `dev`. See "Branches and live systems".
- OpenScholar owns research discovery, reviews, screening, extraction,
  synthesis, evidence organization, accounts, billing, and Evidence Library
  setup and management.
- `Openscholar-ai/evidence-community` (new-el) on `main` owns the public Evidence Library runtime,
  record admin, files, search, source sync, writeback, and runtime workers.
- Cross-repository calls use an authenticated, versioned, retry-safe API. Do
  not copy runtime features into OpenScholar.

## Shared product facts

For product, architecture, roadmap, or cross-repository work, check Outline in
this order:

1. Start: `cc243a51-87ec-4137-869e-0e791f6161f4`.
2. OpenScholar current state: `6dcc7403-a39f-4922-8a6c-a5c7b2a900dd`.
3. Integration contract when both repositories are involved:
   `ff15f65c-bf85-48b3-baf5-e849f85cde41`.
4. Current decisions: `636ce019-6fe6-4a4e-918b-95e0912cc92d`.
5. Only the other page needed for the task.

The collection is `16480726-288c-42f7-9912-5047444585c9`. Check changing
claims against `dev`, tests, remote Convex logs, and the running app. If
Outline is unavailable, say so and use the repository only when it contains
enough evidence.

After a verified pushed change, update the smallest existing Outline page only
when product ownership, a decision, built behavior, deployment setup, or a
supported process changed. Read the page back before claiming success.

## Framework rules

- Convex is the backend. Before changing `convex/`, read
  `convex/_generated/ai/guidelines.md`.
- Application state uses Convex queries alongside the shared React rules in
  `AGENTS.md`.
- `npm run check:ui-rules` runs in CI and enforces the UI rules agents kept
  breaking. Each error names the fix. A line that needs an exception says why
  on the line before it: `// ui-rules-allow: <rule> -- <reason>`.

  | Rule | Enforced by |
  |---|---|
  | No animation that also transitions opacity or transform | `check:ui-rules` (`animation-clash`) |
  | No uppercase labels | `check:ui-rules` (`uppercase`) |
  | No native `title` tooltips | `check:ui-rules` (`native-title`) |
  | No dot separators, in code or in `messages/` | `check:ui-rules` (`dot-separator`) |
  | An avatar without a photo shows an icon, never initials | `check:ui-rules` (`initials`) |
  | No "Loading" text; the shared Spinner or the final size | `check:ui-rules` (`loading-text`) |
  | A dialog, popover or picker comes from `components/ui`, never a raw primitive | `check:ui-rules` (`raw-primitive`) |
  | No "Coolify" in text people read | `check:ui-rules` (`coolify`) |
  | A name people can act on uses its hover card, link or filter | `check:ui-rules` (`entity-name`) |
  | A country shows its flag | `check:ui-rules` (`country-flag`) |
  | An icon or picture beside a title with a line under it sits at the title's top | `check:ui-rules` (`icon-top`) |
  | A scrolling grid sets its columns, so a long line never scrolls it sideways | `check:ui-rules` (`grid-scroll`) |
  | Nothing moves or flashes as data arrives | `npm run verify -- shift` |
  | A dialog, sheet, popover or menu opens with its data in it | `npm run verify -- shift` with a `--do` step that opens it |

## Research assistant

The assistant can do everything a user can, through the same actions
(`plans/research-assistant/README.md`, milestone OS-17).

- Every new or changed user action ships with its registry entry
  (`convex/lib/userActions.ts`). Define it once with `defineUserQuery` or
  `defineUserMutation` (a core that takes the acting user), export the public
  function built from it and its `…ForAssistant` twin, and add the entry to
  `USER_ACTIONS` in `convex/lib/userActionRegistry.ts`. The assistant's tool is
  built from that list.
- `npm run check:user-actions` runs in CI and fails on any public Convex
  function or Next.js server action that is neither registered nor listed in
  `scripts/user-actions-exempt.json`. That file lists plumbing, with the reason
  it isn't a user action; covered functions, with the registered action the
  assistant does the same job with; manual ones, with the reason they stay on
  their page (money, secrets, putting a library live, site administration);
  and pending user actions, with the issue that will register them. Plumbing
  is never a place for a missing user action.
- Tools address records by ID. The assistant changes what a user sees by
  changing the Convex record the page renders.
- Reading at scale runs through OpenScholar's own features (screening,
  extraction, findings), not general-purpose sub-agents. A sub-agent task that
  recurs becomes a feature.

## Development services

`/Users/mcharrad/Documents/Github/openscholar/dev-self` is the integration
checkout. It is the only checkout allowed to upload to the shared self-hosted
development Convex service.

- `npm run dev:web` runs the Next.js app only. Use it for `app/` and
  `components/` work, or `npm run verify -- up`, which also gives the
  worktree its environment and its own port.
- `npm run dev` also watches `convex/` and keeps pushing functions to the
  shared development backend. Run it only from `dev-self` when that upload is
  intended.
- `npm run convex:push` uploads once. `npm run logs:convex` reads the remote
  logs.
- Convex URL: `https://convex.opendev.space`.
- HTTP actions: `https://convex-site.opendev.space`.
- Dashboard: `https://convex-dashboard.opendev.space`.
- Do not run a local Convex backend or use PM2.
- Other worktrees never copy `CONVEX_SELF_HOSTED_URL` or
  `CONVEX_SELF_HOSTED_ADMIN_KEY`, and never select the shared deployment or a
  production deployment.
- Use Coolify service `m6kbbm36nkb9anjt5vfc6e4e`, sub-service `backend`,
  only for container, network, disk, or startup failures. Use Convex logs for
  function failures.
- The `what2` and `minio` Docker containers are the user's personal services.
  Never stop, remove, or clean them up.

## Branches and live systems

- `prod` is live: the app at `discover.openscholar.ai` on self-hosted Convex (`convex.openscholar.ai`). Its Coolify app builds from it with auto-deploy off. Never push to or deploy `prod` unless the user asks. `main` and `prod-old` are history.
- `marketing` is live too: the marketing site at `openscholar.ai`, built from `marketing/` and the few `lib/` files it imports. Its Coolify app (`openscholar-marketing`) builds from it with auto-deploy off.
  - A marketing change merges into `dev` like any other. To ship it, move `marketing` forward to that `dev` commit with a plain push (`git push origin <dev commit>:marketing`), then deploy the app.
  - Never open a pull request into `marketing`, and never commit to it directly. CI pushes a pull request's Convex functions to the test backend, which refuses a branch whose schema is behind `dev`'s.
  - Cloudflare redirects every path of `openscholar.ai` it doesn't list to discover, so a new page's paths (`/x`, `/x/` and its `og-x.jpg`) go into that redirect rule after the deploy.
  - A page that sends something new to the app or Convex ships after production has the side that receives it.
- After a deploy that adds or changes a public page on `openscholar.ai` or `discover.openscholar.ai`, tell Bing and the other IndexNow search engines: `node scripts/indexnow.mjs https://openscholar.ai/sitemap.xml`, or the app's sitemaps, or the page's own address. The key is the 32-character `.txt` file in `public/` and `marketing/public/`, which both hosts serve at their root.
- `dev` deploys to `dev.openscholar.ai` and is where all current work lands.
- Before deploying to prod or moving or updating a community, read
  `docs/deploy-lessons.md`: what went wrong in the launch week and what to do
  instead.
- Community releases: new-el publishes each runtime release as a GitHub
  prerelease. Shared dev's Convex sets `EL_OFFER_PRERELEASES=true` and offers it
  at once; prod offers a release only once it's promoted at
  `/settings/admin/community-releases`, which also runs updates. Updates only
  go forward; rollbacks are done by hand on the server.
- Communities tell IndexNow search engines when a record is published, changed
  or taken down only where Convex sets `EL_INDEXNOW=true`: prod. Never set it on
  shared dev or e2e, whose communities must not announce themselves. A community
  takes the setting at its next activation.
- new-el's `coolify` branch and the tenants it runs are off limits. Never
  touch, push to, or use them as a reference; see new-el's
  `docs/agents/project.md`.
- Do not use the user's `new-el-optimize` checkout.

## Bot floods

On 18 November 2026 thousands of browsers on home internet connections crawled
`discover`'s results and paper pages. They cost about 100 searches a second,
and our search API turned real searches away. Since then a page runs no
searches for a visitor we don't know:

- A page never runs a search for a visitor it doesn't know.
  `isKnownVisitor()` (`lib/known-visitor.ts`) is someone signed in, or a
  crawler Cloudflare has verified. A Cloudflare transform rule sets
  `x-openscholar-verified-bot` on every request to `discover` and `dev`, so a
  visitor can't send it. Anyone else's searches run from their browser as
  server actions. A new page that reads our index or OpenAlex while it renders
  does the same.
- Cloudflare answers a signed-out browser's server actions on `discover` and
  `dev` only once the browser holds its pass, the `cf_clearance` cookie. The
  zone's custom rule answers the rest with a managed challenge.
  `lib/visitor-pass.ts` earns the pass through Turnstile, out of sight, and
  sends the request again.
- The rule covers every `POST` outside `/api/`, `/data/` and `/cdn-cgi/`, not
  only those with a `Next-Action` header: Next also runs an action posted as
  a form without it. A new route that takes a `POST` from signed-out browsers
  or other sites goes under `/api/`.
- Both Turnstile widgets issue the pass (`clearance_level: managed`). It is
  good on every host of `openscholar.ai` for the zone's Challenge Passage,
  7 days. The marketing site's search boxes earn it before a search leaves for
  the app.
- A second rule checks a signed-out browser that opens a `/papers/` or
  `/results` page with no referrer and no pass. Drawing those pages for the
  flood pinned the app's one server process on 18 November: at about 19 pages
  a second, pages took up to 18 seconds, with no searches running. It stops
  people too, once per pass: community links to Openscholar carry
  `rel="noreferrer"`, and emails, chat apps and bookmarks send none. A visit
  from a search engine or the marketing site has a referrer and isn't checked.
  Remove the rule only once the app can draw that many pages, or the flood has
  gone, and watch `next-server`'s CPU when you do.
- The rule skips a request that carries a `__session` cookie, so signed-in
  people never meet Turnstile. A bot that sends a made-up `__session` skips it
  too. If one does, drop that clause from the rule: signed-in browsers then
  earn the pass like everyone else.
- A route that isn't a server action and costs a search or an AI call checks
  its own Turnstile token, as `/api/overviews` does.
- Cloudflare's rules don't run on `localhost`. To test a change here before
  merging, serve the build through a Cloudflare tunnel on a hostname of the
  zone, and add that hostname to the rule and to the dev widget.

## Evidence Library configuration data

Saved configuration must never be lost. Development libraries are used for
MVPs and showcases, and future libraries will rely on updates keeping their
settings, so every change to its shape ships a migration.

- Give each stored snapshot an OpenScholar format version separate from the
  runtime schema version.
- For a breaking storage or ownership change, widen, migrate, then narrow.
- Use `@convex-dev/migrations` for unbounded data. Audit and dry-run first,
  verify every batch and live deployment, then narrow.
- Starting with the deployment that needs a version, all new writes use that
  version.
- Keep frozen revisions unchanged. Restore by applying the explicit migration
  chain into a new revision.
- Unknown versions, missing steps, ambiguous values, invalid output, and
  credential material block release.
- Never wipe or hand-edit saved configuration to satisfy a new validator.

## Checks

- Run the smallest relevant Vitest target while coding.
- Run `npx tsc --noEmit` when TypeScript contracts change.
- Run `npm run build` when the production Next.js build is part of the
  changed boundary.
- For Convex work, upload from the correct checkout, require
  `Convex functions ready!`, run the changed function or browser flow, and
  confirm the matching remote logs are clean.
- GitHub CI runs the pre-merge suite. Tests tagged `size` run nightly.
- Convex and plain test files share modules within a Vitest worker, so a test
  can't count on a fresh module. A file that calls `vi.mock`, itself or through
  a local helper, runs isolated on its own; `vitest.config.ts` sorts them.

## Convex limits

Every page, export and count works at the largest sizes the product allows
(milestone OS-18).

- Convex tests run under Convex's transaction limits: `vitest.config.ts`
  aliases `convex-test` to `tests/convex-test-with-limits.ts`. A flow that
  holds a whole job, library or history in one read fails its test the way it
  would fail in production.
- `convex/lib/maxSize.test-support.ts` generates the largest sizes the product
  allows, at the row sizes measured on shared dev. A flow that reads more than
  one page proves it with a case in `convex/limits/maxSize.test.ts`.
  Those cases, and any other test that seeds hundreds of rows to cross a page
  or batch, carry the Vitest tag `size`: `npm test` leaves them out and
  `npm run test:size` runs them. CI runs them every night on `dev`
  (`.github/workflows/nightly-size.yml`), not on pull requests, and a failure
  opens an OS-18 issue. Run the size cases a change touches before pushing.
- `convex-test` runs one transaction at a time, so it never shows a write
  conflict. Counters and anything else written in parallel are proven on a real
  backend as well.
- Every list pages by cursor, infinite scroll included (#428). A function
  reads a page (`.paginate()`) or a named cap (`.take(CAP)`) that its writes
  enforce, and returns a list only as the `page` of a pagination result. A list
  stored on a record has a cap enforced on write (#426). Clients and actions
  load the next page when the person asks for it, and exports stream page by
  page; nothing loads every page into one array.
- `npm run check:convex-rules` runs in CI. It fails on a `.collect()` or
  `for await` over a query, on a public function whose `returns` holds a list
  or record outside a pagination page, on `loadMore` from an effect or a loop,
  and on a cursor loop that gathers pages, unless the case is listed as pending
  in `scripts/convex-rules.json` with its issue. Pending lists only shrink: CI
  fails on a function that isn't pending on `dev`, or has more pending entries
  than on `dev`. It also fails on a public function without a `returns`
  validator and on a public query that reads the clock.

## References

- Test rules: `docs/test-quality.md`.
- Cross-repository follow-ups: `docs/evidence-library-follow-ups.md`.
- Deploy lessons: `docs/deploy-lessons.md`, also in Outline as
  `dae6c74d-9d76-495f-a5fa-84c1ade7e688`.
