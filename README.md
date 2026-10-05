# OpenScholar

OpenScholar is an academic search engine built on top of OpenAlex. It combines a 250M+ paper database with AI tools to help researchers find, screen, and organize literature.

It's designed for systematic reviews and complex queries, not just keyword matching.

## Features

### Search & Discovery

- **Smart Querying:** Write natural language questions or use strict Boolean syntax (AND/OR/NOT).
- **AI Enhancement:** Automatically converts research questions into optimized Boolean queries.
- **Multi-language:** Translate queries and results on the fly without losing precision.
- **Deep Filters:** Filter by year, region, language, document type, and citation count.
- **Citation Graph:** Traverse research by checking who cited a paper and what it cites.

### Systematic Review

- **Automated Screening:** Define screening questions (e.g., "Does this study use a randomized controlled trial?") and let AI screen papers for you.
- **Tracking:** Keep track of included/excluded papers per search.

### Organization

- **Bookmarks:** Create shorthand keywords (e.g., `ai-med`) that expand into complex query strings.
- **History:** Track how your search queries evolve over time.
- **Export:** Download results as JSON/CSV or sync directly to Zotero.

### AI Configuration

- **Provider Choice:** Support for OpenAI, Anthropic, Google, and OpenRouter (300+ models).
- **Flexible Usage:** Bring your own API keys (BYOK) or use the built-in credit system.

## Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Convex (Real-time)
- **Auth:** Clerk
- **Billing:** Autumn (self-hosted) on Stripe
- **Styling:** Tailwind CSS 4, Radix UI, Motion
- **State:** Zustand, SWR

## Getting Started

1. **Clone the repo**

   ```bash
   git clone https://github.com/yourusername/openalex-count.git
   cd openalex-count
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Environment Setup**
   Copy `.env.example` to `.env.local`:

   ```bash
   cp .env.example .env.local
   ```

   You'll need credentials for:
   - **Convex:** `NEXT_PUBLIC_CONVEX_URL=https://convex.opendev.space`
   - **Convex CLI:** `CONVEX_SELF_HOSTED_URL=https://convex.opendev.space`, plus the `openscholar-dev` admin key
   - **Convex HTTP:** `NEXT_PUBLIC_CONVEX_SITE_URL=https://convex-site.opendev.space`
   - **Clerk (Next.js):** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
   - **Clerk (Convex):** `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`
   - **App URL (for billing + redirects):** `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_URL`)
   - **Billing (Convex):** `AUTUMN_URL` and `AUTUMN_SECRET_KEY` for the self-hosted Autumn server, `AUTUMN_WEBHOOK_SECRET` for Autumn's webhook, and `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for OpenScholar's own Stripe webhook
   - **Extraction embedding billing:** optional `EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS` (defaults to `0.02`)
   - **Feature flags:** optional `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED` (set to `false` to disable top-ups), `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` (set to `false` for abstract-only extraction mode)

   Clerk notes for this repo:
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
   - Public debug/test Convex endpoints are disabled by default; only enable with `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true`.
   - Public read-query auth/authorization states follow the safe contract documented in `docs/auth-error-contract.md`.

   Billing notes for this repo:
   - Plans, credit balances, subscriptions, and invoices live in a self-hosted
     [Autumn](https://github.com/useautumn/autumn) server, which talks to
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
     signing secret. Each event refreshes that user's cached copy, so plan
     changes made in the dashboard reach the app in seconds. Autumn sends no
     event for a balance edit; the billing page refreshes the copy when it
     opens.
   - Autumn's own Stripe webhook points at the Autumn server. OpenScholar's
     Stripe webhook (`POST /webhooks/stripe` on the Convex HTTP URL) refreshes
     the cached card and removes credits for refunded top-ups. Subscribe it
     to: `customer.updated`, `payment_method.attached`,
     `payment_method.detached`, `charge.refunded`.
   - `STRIPE_WEBHOOK_SECRET` is that endpoint's signing secret.
   - The billing page pages through charges using a count kept in the
     `usageAgg` aggregate. After deploying it to a deployment that already has
     charges, count them once: `npx convex run migrations/countBillingUsage:run`.

   Admin notes for this repo:
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

4. **Run OpenScholar against the hosted development services**

   ```bash
   npm run dev
   ```

   This starts Next.js on this machine. It also watches `convex/`, uploads changes to the existing `openscholar-dev` Convex deployment on Coolify, and prints remote function logs. It refuses to start if `.env.local` points anywhere else. Clerk also stays hosted. Nothing starts a local Clerk or Convex server.

   Useful commands:

   ```bash
   npm run dev:web       # Next.js only
   npm run convex:push   # upload Convex code once, then exit
   npm run logs:convex   # stream remote Convex function logs
   ```

   The remote dashboard is `https://convex-dashboard.opendev.space`. For Convex container failures, open Coolify service `m6kbbm36nkb9anjt5vfc6e4e` and read the `backend` logs. Stop local development with `Ctrl-C`.

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
