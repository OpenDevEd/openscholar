# Openscholar

The evidence workspace for research teams. Find the literature, screen it against your criteria, extract the data and publish what you learn. Openscholar searches OpenAlex's 250 million works and runs at [discover.openscholar.ai](https://discover.openscholar.ai).

This repository holds the app, its [Convex](https://convex.dev) backend, and the marketing site at [openscholar.ai](https://openscholar.ai) (`marketing/`). Evidence Communities, the public research libraries that teams set up from Openscholar, live in [Openscholar-ai/evidence-community](https://github.com/Openscholar-ai/evidence-community).

## What it does

- **Search.** Ask in plain language or write Boolean queries, filter by year, region, language, type and citations, and follow who cites what.
- **Screening.** Set your inclusion questions once and screen every paper of a search against them, with AI or by hand.
- **Extraction.** Pull the answers you need out of each paper's text or PDF into a table you can sort, check and export.
- **Research assistant.** Hand off the groundwork in a chat that can do anything you can do in the app.
- **Evidence Communities.** Turn a collection into a public library with its own address, search, maps and answers linked to their sources.
- **Reports.** Publish a report with a DOI through Crossref or Zenodo.
- **Teams.** Workspaces, roles, shared screenings and a record of who changed what.

## Tech stack

- Next.js 16 (App Router), React 19, Tailwind CSS 4
- Convex for data, functions and scheduling
- Clerk for sign-in
- Autumn (self-hosted) on Stripe for plans and credits
- OpenRouter, OpenAI, Anthropic and Google models for AI features

## Running your own copy

You need Node.js 22 or later, a Convex deployment (Convex Cloud or [self-hosted](https://github.com/get-convex/convex-backend)), and a Clerk application. Billing needs an [Autumn](https://useautumn.com) server and a Stripe account, and AI features need an OpenRouter key.

```bash
git clone https://github.com/Openscholar-ai/openscholar.git
cd openscholar
npm install
cp .env.example .env.local
```

`.env.example` lists every setting. The first part goes in `.env.local` for the Next.js app. The second part is set on the Convex deployment with `npx convex env set NAME value`.

```bash
npx convex dev            # push the backend to your deployment and watch for changes
npm run dev:web           # the app at http://localhost:3000
```

Useful commands:

```bash
npm test                  # unit tests (Vitest)
npm run build             # production build
npm run check:ui-rules    # the UI rules CI enforces
```

`npm run dev` and `npm run convex:push` are for the core team: they only run against Openscholar's shared development deployment.

## How it works

### Sign-in (Clerk)

- Next.js auth edge protection is configured in `proxy.ts`.
- Public route policy is centralized in `lib/auth/public-routes.ts` and shared by both `proxy.ts` and client route gating.
- Middleware matcher coverage follows Clerk guidance (including API/TRPC) and still enforces protected-by-default behavior.
- Clerk auth routes are canonicalized to `/sign-in` and `/sign-up`.
- Sign out is handled by the Clerk client API in UI components.
- Convex JWT verification is configured in `convex/auth.config.ts` with `CLERK_JWT_ISSUER_DOMAIN` and `applicationID: "convex"`.
- Protected App Router rendering is guarded by `components/auth/auth-route-gate.tsx`, which enforces a no-flicker auth bootstrap flow.
- Client auth readiness is exposed via `useAuthReadiness()` from `components/providers/convex-provider.tsx`.
- Use auth-aware query wrappers from `lib/auth/use-auth-query.ts` (`useProtectedQuery`, `useProtectedPaginatedQuery`, `useOptionalAuthQuery`) instead of direct `useQuery` calls in UI.
- Configure your Clerk webhook endpoint to `POST /webhooks/clerk` on your Convex HTTP deployment URL.
- `CLERK_WEBHOOK_SIGNING_SECRET` must be configured in every environment, including local development and deployed environments, or webhook verification will fail with `401`.
- `CLERK_WEBHOOK_SIGNING_SECRET` must be the endpoint Signing Secret value from Clerk (starts with `whsec_`); do not use API keys or frontend URL values.
- Auth paths are `/sign-in` and `/sign-up` only.
- Keep local `.env.local` aligned with current auth env variables to avoid operator confusion.

### Billing (Autumn and Stripe)

- Plans, credit balances, subscriptions, and invoices live in a self-hosted
  [Autumn](https://useautumn.com) server, which talks to
  Stripe. Plans, prices, credits, top-up bundles and which plans include
  which features are all edited in Autumn's dashboard. Convex copies the
  catalog into `billingCatalog` every five minutes, and the app reads it
  from there. Plan metadata sets what the dashboard has no field for:
  `popular` (true), `highlights` (one card line per line) and, on the
  top-up plan, `bundles` (credit amounts to offer).
- A feature flag with `planFeature` is on only for users whose plan
  includes that Autumn feature. `extraction.start` needs `extraction`.
- Convex keeps a cached copy of each user's plan and balance in
  `billingAccounts` for reactive UI, and a log of every charge in
  `billingUsage`. Design, trial results, and the data migration are in
  `plans/autumn-billing/README.md`.
- Autumn sends its webhooks through the Svix server beside it. Add an
  endpoint for `POST /webhooks/autumn` on the Convex HTTP URL in Autumn's
  dashboard under Developer, Webhooks, and set `AUTUMN_WEBHOOK_SECRET` to its
  signing secret. Each event refreshes that workspace's cached copy, so plan
  changes made in the dashboard reach the app in seconds. Autumn sends no
  event for a balance edit; the billing page refreshes the copy when it
  opens.
- Autumn's own Stripe webhook points at the Autumn server. Openscholar's
  Stripe webhook (`POST /webhooks/stripe` on the Convex HTTP URL) refreshes
  the cached card and removes credits for refunded top-ups. Subscribe it
  to: `customer.updated`, `payment_method.attached`,
  `payment_method.detached`, `charge.refunded`.
- `STRIPE_WEBHOOK_SECRET` is that endpoint's signing secret.
- The billing page pages through charges using a count kept in the
  `usageAgg` aggregate, under the workspace that paid. Each charge is
  counted as it's recorded.

### Admin

- Admins see an Admin group in settings: feature switches, which models
  users can pick, and the admin list. The server refuses admin changes from
  everyone else.
- Make the first admin of a deployment from the command line:
  `npx convex run admins/mutations:grant '{"email": "you@example.org"}'`.
  After that, admins add each other in settings. An invite by email becomes
  an admin when that person signs up; it's sent through the platform mail
  settings (`EL_SMTP_*`).
- Set `AUTUMN_DASHBOARD_URL` on the Convex deployment to show the Plans link
  to Autumn's dashboard.
- Settings, Admin, AI models sets the model and reasoning effort each preset
  (Cheap, Fast, Balanced, Intelligent) runs every task on. Users pick a preset,
  or Custom to choose each task themselves and use their own keys.
  `npx convex run aiModelConfig/internal:seed` adds the starting picks to a
  deployment that doesn't have them; it never replaces an existing pick.
- Screening and Screen All can run on Jev (`typesafe/jev-1.13`), TypeSafe's
  decision model, through OpenRouter's Decisions API: one call per paper. When
  a user's Screen All pick is Jev, their extraction jobs send yes/no questions
  to it too. The catalog sync adds Jev, which isn't in OpenRouter's model list.

## Auth E2E + CI

- Run auth E2E locally:

  ```bash
  npm run test:e2e:auth
  ```

- Required E2E environment variables:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_PUBLISHABLE_KEY` (or rely on auto-mapping from `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `e2e/global.setup.ts`)
  - `CLERK_SECRET_KEY`
  - `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`
  - `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
  - `NEXT_PUBLIC_CONVEX_URL`
  - `E2E_CLERK_USER_EMAIL`
  - `E2E_CLERK_USER_PASSWORD`
  - Optional: `E2E_BASE_URL` (defaults to `http://localhost:3000`)

Playwright starts a fresh server with Next's test proxy enabled and does not reuse
a running preview. For another port, set both `E2E_BASE_URL` and
`PLAYWRIGHT_WEB_SERVER_COMMAND`, for example `http://localhost:3478` and
`npm run build && npm run start -- --hostname localhost --port 3478`.
E2E specs import `test` and `expect` from `e2e/test.ts` so every test initializes
the proxy. Responses stay real unless a spec supplies a network fixture.

- CI workflow:
  - `.github/workflows/ci.yml` runs:
    - `unit-and-build` (`npm run test`, `npm run build`)
    - `e2e-auth` (`npm run test:e2e:auth`)
  - Branch protection should require the aggregate `CI` check. It covers the
    required jobs while allowing runtime E2E to skip documentation-only pull
    requests.

## Project Structure

- `/app` - Next.js App Router pages and layouts
- `/components` - React components (shadcn/ui, custom)
- `/convex` - Backend functions, schema, and cron jobs
- `/lib` - Utilities, stores (Zustand), and types

## Contributing

See [CONTRIBUTING.md](https://github.com/Openscholar-ai/.github/blob/main/CONTRIBUTING.md). To report a security problem, see [SECURITY.md](https://github.com/Openscholar-ai/.github/blob/main/SECURITY.md).

## Licence

Openscholar is free software under the [GNU Affero General Public License v3.0](LICENSE). If you run a changed version for other people, for example as a website, you must offer them its source code under the same licence.
