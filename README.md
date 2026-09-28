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
   - **Billing (Convex):** `AUTUMN_URL` and `AUTUMN_SECRET_KEY` for the self-hosted Autumn server; `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for OpenScholar's own Stripe webhook
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
     Stripe. The plan catalog is `autumn.config.ts`; publish changes with
     `AUTUMN_BASE_URL=... AUTUMN_SECRET_KEY=... npx atmn push`.
   - Convex keeps a cached copy of each user's plan and balance in
     `billingAccounts` for reactive UI, and a log of every charge in
     `billingUsage`. Design, trial results, and the data migration are in
     `plans/autumn-billing/README.md`.
   - Autumn's own Stripe webhook points at the Autumn server. OpenScholar's
     Stripe webhook (`POST /webhooks/stripe` on the Convex HTTP URL) refreshes
     the cached copy and removes credits for refunded top-ups. Subscribe it to:
     `checkout.session.completed`, `customer.updated`,
     `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.paid`,
     `invoice.payment_failed`, `payment_method.attached`,
     `payment_method.detached`, `charge.refunded`.
   - `STRIPE_WEBHOOK_SECRET` is that endpoint's signing secret.

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
