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
- **Auth:** WorkOS
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
   - **Convex HTTP (optional/custom domain):** `NEXT_PUBLIC_CONVEX_SITE_URL`
   - **WorkOS/AuthKit:** `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_WEBHOOK_SECRET`
   - **App URL (for billing, webhooks, redirects, auth callback):** `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_URL`)
   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (and optional publishable key for client UI)

   WorkOS notes for this repo:
   - Next.js auth edge protection is configured in `proxy.ts`.
   - Public route policy is centralized in `lib/auth/public-routes.ts` and shared by both `proxy.ts` and client route gating.
   - Auth callback redirect URI is derived from `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_URL`) + `/auth/callback`.
   - Sign-out route (`/auth/signout`) uses AuthKit `signOut({ returnTo })` with `NEXT_PUBLIC_APP_URL` then `NEXT_PUBLIC_URL`; one of these env vars is required and must be an absolute `http(s)` URL.
   - Convex token bridging uses `GET /auth/access-token` backed by AuthKit middleware + `withAuth({ ensureSignedIn: false })` and returns `401` when no active session is present.
   - Configure WorkOS Redirects in each environment: `App Homepage URL`, callback URL(s) for `/auth/callback`, and sign-out redirect locations that include your app base URL.
   - Convex JWT verification is configured in `convex/auth.config.ts` and accepts both WorkOS issuer formats used by AuthKit.
   - Protected App Router rendering is guarded by `components/auth/auth-route-gate.tsx`, which enforces a no-flicker auth bootstrap flow.
   - Client auth readiness is exposed via `useAuthReadiness()` from `components/providers/convex-provider.tsx`.
   - Use auth-aware query wrappers from `lib/auth/use-auth-query.ts` (`useProtectedQuery`, `useProtectedPaginatedQuery`, `useOptionalAuthQuery`) instead of direct `useQuery` calls in UI.
   - Configure your WorkOS webhook endpoint to `POST /webhooks/workos` on your Convex HTTP deployment URL.
   - `WORKOS_WEBHOOK_SECRET` must be configured in every environment, including local development and deployed environments, or webhook verification will fail with `401`.
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
   - Local listener command:
     - `npm run dev:stripe`
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

## Project Structure

- `/app` - Next.js App Router pages and layouts
- `/components` - React components (shadcn/ui, custom)
- `/convex` - Backend functions, schema, and cron jobs
- `/lib` - Utilities, stores (Zustand), and types
