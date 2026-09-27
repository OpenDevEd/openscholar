# OpenScholar project guide

Read this after the shared `AGENTS.md`. This file owns OpenScholar-specific
facts, commands, and deployment boundaries.

## Product and repository boundary

- Repository: `OpenDevEd/openalex-count`.
- Active development branch: `dev`. See "Branches and live systems".
- OpenScholar owns research discovery, reviews, screening, extraction,
  synthesis, evidence organization, accounts, billing, and Evidence Library
  setup and management.
- `OpenDevEd/new-el` on `main` owns the public Evidence Library runtime,
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
- An animated element (a CSS animation class or Framer props) never also
  transitions opacity or transform: no `transition`, `transition-all`,
  `transition-opacity`, or `transition-transform` on it. Put the animation on a
  wrapper, or transition only colors, borders, and shadows. Shared
  `components/ui` parts name the properties they transition.
  `npm run check:animation-clash` enforces both, in CI.
- The shared tooltip is `TooltipHint` or `Tooltip` from
  `components/ui/tooltip`. The only native `title` left is on the hidden
  `Z3988` spans, which carry citation data for Zotero.

## Development services

`/Users/mcharrad/Documents/Github/openscholar/dev-self` is the integration
checkout. It is the only checkout allowed to upload to the shared self-hosted
development Convex service.

- `npm run dev:web` runs the Next.js app only. Use it for `app/` and
  `components/` work.
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

- `main` is the live OpenScholar at `openscholar.ai`. It has none of the
  Evidence Library, extraction, or other work on `dev`, which is the future
  production release. Never merge into, push to, or deploy `main` unless the
  user asks.
- `dev` deploys to `dev.openscholar.ai` and is where all current work lands.
- new-el's `coolify` branch and the tenants it runs are off limits. Never
  touch, push to, or use them as a reference; see new-el's
  `docs/agents/project.md`.
- Do not use the user's `new-el-optimize` checkout.

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
- For `app/` or `components/` work, run `npm run dev:web`, open the
  changed page, and check the browser plus terminal.
- GitHub CI runs the full pre-merge suite.

## References

- Test rules: `docs/test-quality.md`.
- Cross-repository follow-ups: `docs/evidence-library-follow-ups.md`.
