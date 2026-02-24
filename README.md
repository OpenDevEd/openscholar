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
- **Billing:** Stripe
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
   - **Convex:** `NEXT_PUBLIC_CONVEX_URL`
   - **Convex CLI target (for remote billing live tests):** `CONVEX_DEPLOYMENT` (or `CONVEX_DEPLOYMENT_NAME`)
   - **Convex HTTP (optional/custom domain):** `NEXT_PUBLIC_CONVEX_SITE_URL`
   - **Clerk (Next.js):** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`
   - **Clerk (Convex):** `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`
   - **App URL (for billing + redirects):** `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_URL`)
   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREDITS_PRODUCT_ID` (and optional publishable key for client UI)
   - **Credits top-up conversion:** optional `CREDITS_PER_USD` (defaults to `100`)
   - **Feature flags:** optional `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED` (set to `false` to disable top-ups)
   - **Billing live test user (optional; defaults provided):** `BILLING_TEST_USER_SUBJECT`, `BILLING_TEST_USER_EMAIL`

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

   Stripe notes for this repo:
   - Configure Stripe webhook endpoint to `POST /webhooks/stripe` on your Convex HTTP deployment URL.
   - Required webhook events:
     - `checkout.session.completed`
     - `customer.created`
     - `customer.updated`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.created`
     - `invoice.finalized`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `invoice.payment_succeeded`
     - `payment_intent.succeeded`
     - `charge.refunded`
   - Local listener command:
     - `npm run dev:stripe`
     - This command auto-syncs `STRIPE_WEBHOOK_SECRET` in Convex from the active Stripe CLI listener before forwarding events.
   - Signature verification troubleshooting:
     - `STRIPE_WEBHOOK_SECRET` must come from the same source that sends the request.
     - If using Stripe CLI forwarding, use the Stripe CLI signing secret (`stripe listen --print-secret`), not a dashboard endpoint secret.
     - If using direct Stripe dashboard webhooks to Convex, use that endpoint's signing secret and avoid forwarding the same events via Stripe CLI to the same path.
   - Plan change policy:
     - Upgrades apply immediately and release any attached `active`/`not_started` subscription schedule first.
     - Downgrades are scheduled for period end using current schedule phase boundaries.
     - Same-tier requests clear pending scheduled changes when present.
   - Entitlement policy:
     - Entitled statuses: `active`, `trialing`, `past_due`.
     - Non-entitled statuses: `incomplete`, `incomplete_expired`, `unpaid`, `paused`, `canceled`.
     - `incomplete` is treated as payment pending and should be resolved in Stripe Billing Portal.
   - Monthly credit grant policy:
     - Credits are granted only for invoices with `billing_reason` in `subscription_create` or `subscription_cycle`.
     - Non-eligible invoice reasons (for example `subscription_update`, `manual`) are ignored and do not grant credits.
     - Missing or unexpected `billing_reason` values on paid subscription invoices are treated as config drift and logged as actionable failures.
   - Reconciliation policy:
     - Webhook push is primary.
     - Hourly pull reconciliation (`internal.credits.actions.reconcileRecentPaidInvoicesFromStripe`) backfills missed eligible invoice grants.

4. **Run the development server**

   ```bash
   npm run dev
   ```

   This starts the Next.js app and the Convex dev server.

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
  - Optional: `E2E_BASE_URL` (defaults to `http://127.0.0.1:3000`)

- CI workflow:
  - `.github/workflows/ci.yml` runs:
    - `unit-and-build` (`npm run test`, `npm run build`)
    - `e2e-auth` (`npm run test:e2e:auth`)
    - `billing-live` (`npm run test:billing:live:ci`) against shared Convex dev + Stripe sandbox
  - `.github/workflows/billing-nightly.yml` runs `npm run test:billing:extended:ci` nightly
  - Branch protection should require all required CI checks on pull requests.

## Billing Live Regression Suite

- Preflight checks (env, Convex reachability, Stripe webhook endpoint/events):

  ```bash
  npm run test:billing:preflight
  ```

- Required live billing regression suite (PR-gated):

  ```bash
  npm run test:billing:live
  ```

- CI wrapper (pushes Convex code before running required suite):

  ```bash
  npm run test:billing:live:ci
  ```

- Extended non-blocking suite (main/nightly):

  ```bash
  npm run test:billing:extended
  ```

## Project Structure

- `/app` - Next.js App Router pages and layouts
- `/components` - React components (shadcn/ui, custom)
- `/convex` - Backend functions, schema, and cron jobs
- `/lib` - Utilities, stores (Zustand), and types
