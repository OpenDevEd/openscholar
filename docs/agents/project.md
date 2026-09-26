# OpenScholar project guide

Read this after the shared `AGENTS.md`. This file owns OpenScholar-specific
facts, commands, and deployment boundaries.

## Product and repository boundary

- Repository: `OpenDevEd/openalex-count`.
- Active development branch: `dev`.
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
- Before changing a Next.js API, route, cache rule, request rule, or file
  layout, read the matching installed guide under
  `node_modules/next/dist/docs/`.
- Do not use React effects for app state, URL state, copied props, derived
  values, data loading, navigation, or mutations.
- Effects are only for an outside browser system such as an event listener,
  observer, timer, focus operation, or third-party widget. Keep the effect
  small, explain the outside system, and include full cleanup and dependencies.
- Use server components, Convex queries, `nuqs`, render-time calculations,
  lifted state, context, and event handlers for application state.
- An animated element (a CSS animation class or Framer props) never also
  transitions opacity or transform: no `transition`, `transition-all`,
  `transition-opacity`, or `transition-transform` on it. Put the animation on a
  wrapper, or transition only colors, borders, and shadows. Shared
  `components/ui` parts name the properties they transition.
  `tests/animation-transition-clash.test.ts` enforces both.

## Development services

`/Users/mcharrad/Documents/Github/openscholar/dev-self` is the integration
checkout. It is the only checkout allowed to upload to the shared self-hosted
development Convex service.

```sh
npm run dev
npm run dev:web
npm run convex:push
npm run logs:convex
```

- Convex URL: `https://convex.opendev.space`.
- HTTP actions: `https://convex-site.opendev.space`.
- Dashboard: `https://convex-dashboard.opendev.space`.
- Do not run a local Convex backend or use PM2.
- An implementation lane uses its own worktree and named Convex Cloud
  development deployment. It uploads once with `npx convex dev --once`.
- A lane never copies `CONVEX_SELF_HOSTED_URL` or
  `CONVEX_SELF_HOSTED_ADMIN_KEY`. It never selects the shared deployment,
  another lane's deployment, or a production deployment.
- Only the integration owner uploads merged `dev` to the shared service and
  performs the final remote check.
- Use Coolify service `m6kbbm36nkb9anjt5vfc6e4e`, sub-service `backend`,
  only for container, network, disk, or startup failures. Use Convex logs for
  function failures.

Production is outside normal development scope. Never push the Evidence
Library `coolify` or `openscholar` branches. Do not use the user's
`new-el-optimize` checkout. Never change a shared or production service
without the user's clear instruction and a read-only target check.

## Evidence Library configuration data

Saved configuration is production data.

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

Read `docs/test-quality.md` and use `test-decision` before touching tests.

- Run the smallest relevant Vitest target while coding.
- Run `npx tsc --noEmit` when TypeScript contracts change.
- Run `npm run build` when the production Next.js build is part of the
  changed boundary.
- For Convex work, upload from the correct checkout, require
  `Convex functions ready!`, run the changed function or browser flow, and
  confirm the matching remote logs are clean.
- For `app/` or `components/` work, run `npm run dev:web`, open the
  changed page, and check the browser plus terminal.
- Check an animation or transition change in Firefox as well as Chromium.
  Zen is Firefox-based, and Firefox shows animation clashes that Chromium hides.
- Documentation-only work needs link checks and `git diff --check`, not the
  application test suite.

GitHub CI owns the full pre-merge suite. Follow the CI section in `AGENTS.md`:
ordinary edits and PR updates finish after targeted checks, while automatic CI
runs in the background. The primary agent checks the changed browser or
shared-service behavior when that boundary needs verification.

## Plans and current references

Use a committed plan only for the cases named in `AGENTS.md`. Keep task
contracts in the numbered plan and link to shared rules instead of copying
agent prompts.

- Test rules: `docs/test-quality.md`.
- Cross-repository follow-ups: `docs/evidence-library-follow-ups.md`.
- Multi-agent deployment lessons: `docs/agent-sprint-lessons.md`.
- Current Evidence Library configuration work:
  `plans/evidence-library-configuration-v2/00-README.md`.
