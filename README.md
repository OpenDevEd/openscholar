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
   - **WorkOS/AuthKit:** `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI` (or `NEXT_PUBLIC_WORKOS_REDIRECT_URI` for edge runtime redirect precedence), `WORKOS_WEBHOOK_SECRET`
   - **App URL (for billing/webhook redirects):** `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_URL`)
   - **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (and optional publishable key for client UI)

   WorkOS notes for this repo:
   - Next.js auth edge protection is configured in `proxy.ts`.
   - Public route policy is centralized in `lib/auth/public-routes.ts` and shared by both `proxy.ts` and client route gating.
   - Redirect URI precedence in edge auth is `NEXT_PUBLIC_WORKOS_REDIRECT_URI` then `WORKOS_REDIRECT_URI`.
   - Convex JWT verification is configured in `convex/auth.config.ts` and accepts both WorkOS issuer formats used by AuthKit.
   - Protected App Router rendering is guarded by `components/auth/auth-route-gate.tsx`, which enforces a no-flicker auth bootstrap flow.
   - Client auth readiness is exposed via `useAuthReadiness()` from `components/providers/convex-provider.tsx`.
   - Use auth-aware query wrappers from `lib/auth/use-auth-query.ts` (`useProtectedQuery`, `useProtectedPaginatedQuery`, `useOptionalAuthQuery`) instead of direct `useQuery` calls in UI.
   - Configure your WorkOS webhook endpoint to `POST /webhooks/workos` on your Convex HTTP deployment URL.
   - Public debug/test Convex endpoints are disabled by default; only enable with `ENABLE_PUBLIC_DEBUG_FUNCTIONS=true`.
   - Public read-query auth/authorization states follow the safe contract documented in `docs/auth-error-contract.md`.

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
