# Architecture

**Analysis Date:** 2026-03-06

## Pattern Overview

**Overall:** Full-stack Next.js App Router + Convex BaaS with domain-driven module organization

**Key Characteristics:**
- Next.js 16 App Router for frontend with React 19 and React Compiler enabled
- Convex as backend-as-a-service: database, real-time queries, mutations, actions, cron jobs, HTTP endpoints
- URL-driven search state (nuqs) with SWR data fetching, Zustand for client-side persistence
- Durable workflow orchestration via `@convex-dev/workflow` and `@convex-dev/workpool` for extraction pipelines
- Clerk for authentication, Stripe for billing, OpenAlex API for academic paper search
- Internationalization via `next-intl` with 6 locales

## Layers

**Presentation Layer (Next.js App Router):**
- Purpose: Page routing, layouts, server components, and React client components
- Location: `app/`, `components/`
- Contains: Page components, UI components, layout wrappers, client providers
- Depends on: Convex client SDK, Zustand stores, SWR, nuqs
- Used by: End users via browser

**Search State Layer:**
- Purpose: Manages search parameters, data fetching, and results caching
- Location: `lib/search/`, `lib/store.ts`, `lib/search-params/`
- Contains: SearchProvider context, URL param parsers (nuqs), SWR fetcher, Zustand stores
- Depends on: OpenAlex API (via `app/api/openalex/search/route.ts`), nuqs, SWR
- Used by: All search-related components

**Client-Side AI Layer:**
- Purpose: AI-powered paper screening and analysis in the browser
- Location: `lib/ai/client/`, `lib/ai/core/`
- Contains: AI executor, mode routing (BYOK vs platform credits), batch processing, prompt templates
- Depends on: Vercel AI SDK, multiple LLM providers (OpenAI, Anthropic, Google, DeepSeek, OpenRouter)
- Used by: Search results screening, paper analysis features

**Backend Layer (Convex):**
- Purpose: All server-side logic, database, real-time subscriptions, durable workflows
- Location: `convex/`
- Contains: Schema, queries, mutations, actions, HTTP endpoints, cron jobs, webhooks
- Depends on: Convex platform, Stripe SDK, Clerk webhooks, OpenAlex HTTP API
- Used by: Frontend via Convex React client, external webhooks (Clerk, Stripe)

**Shared Utilities:**
- Purpose: Cross-cutting utilities, types, constants, formatting
- Location: `lib/`
- Contains: Type definitions, utility functions, constants, validation, formatting
- Depends on: Zod (validation), date-fns
- Used by: Both frontend components and server actions

## Data Flow

**Search Flow:**

1. User enters query on home page (`app/page.tsx`) -> creates search ID -> navigates to `app/results/[searchId]/page.tsx`
2. `SearchProvider` (`lib/search/provider.tsx`) reads URL params via nuqs as source of truth
3. SWR fetcher calls `getSearchResultsWithFilters()` (`lib/search-utils.ts`) which hits OpenAlex API
4. Results rendered in `results-list.tsx`, filters managed via URL params synced to Zustand store
5. Search history persisted in Zustand store with `persist` middleware (localStorage)

**Extraction Workflow (Convex Durable Workflow):**

1. User creates extraction job with questions -> `convex/extraction/mutations.ts` creates job record
2. `runExtractionWorkflow` (`convex/extraction/workflow.ts`) orchestrated by `@convex-dev/workflow`
3. Step 1: Fetch papers from OpenAlex/Zotero/manual sources
4. Step 2: Create paper records, deduplicate
5. Step 3: Enqueue each paper to `pdfProcessingPool` (`convex/workpool.ts`, max parallelism 3)
6. Per-paper: Download PDF -> Index in RAG (`@convex-dev/rag`) -> Extract answers via AI -> Store results
7. Job status updates in real-time via Convex reactive queries

**Authentication Flow:**

1. Clerk handles sign-in/sign-up (`app/sign-in/`, `app/sign-up/`)
2. `ConvexProviderWithClerk` (`components/providers/convex-provider.tsx`) bridges Clerk auth to Convex
3. `AuthReadinessProvider` calls `ensureUser` mutation on auth to sync Clerk user to Convex `users` table
4. Clerk webhook (`convex/webhooks/clerk.ts`) at `/webhooks/clerk` syncs user updates/deletions

**Billing Flow:**

1. Stripe webhooks registered at `/webhooks/stripe` via `@convex-dev/stripe` (`convex/http.ts`)
2. Subscription events -> `convex/subscriptions/` handles plan changes with idempotent handlers
3. Invoice/payment events -> `convex/credits/` grants/reverses credits with dedup gates
4. Credit usage tracked per extraction via `creditTransactions` table
5. Hourly cron reconciliation ensures Stripe and Convex stay in sync (`convex/crons.ts`)

**State Management:**

- **URL State (Source of Truth for Search):** nuqs manages search params in URL; `SearchProvider` reads them
- **Client Persistence:** Zustand stores with `persist` middleware for search history, bookmarks, ratings, AI settings (`lib/store.ts`)
- **Server State:** Convex database is the source of truth for users, subscriptions, credits, extraction jobs, library items
- **Real-time:** Convex reactive queries auto-update UI when server data changes

## Key Abstractions

**Search System:**
- Purpose: Academic paper search with complex filtering
- Examples: `lib/search/provider.tsx`, `lib/search/types.ts`, `lib/search-params/parsers.ts`
- Pattern: URL-as-state via nuqs, SWR for fetching, context provider for distribution

**Extraction Pipeline:**
- Purpose: AI-powered data extraction from academic papers
- Examples: `convex/extraction/workflow.ts`, `convex/extraction/actions.ts`, `convex/extraction/prompts.ts`
- Pattern: Durable workflow with workpool parallelism, RAG indexing, citation grounding

**Credit System:**
- Purpose: Usage-based billing with free and paid credit pools
- Examples: `convex/credits/internal.ts`, `convex/credits/actions.ts`, `convex/credits/lib/`
- Pattern: Dual balance (free/paid), idempotent grant/deduct via Stripe dedup keys

**Library:**
- Purpose: User's saved/rated paper collection with collections
- Examples: `convex/library/mutations.ts`, `convex/library/queries.ts`, `components/library/`
- Pattern: Convex tables with full-text search index, many-to-many via junction table

**AI Integration:**
- Purpose: Multi-provider AI for screening and extraction
- Examples: `lib/ai/client/router.ts`, `lib/ai/core/execute.ts`, `convex/ai/`
- Pattern: BYOK (bring your own key) + platform credits mode routing, Vercel AI SDK

## Entry Points

**Next.js App Router:**
- Location: `app/layout.tsx`
- Triggers: All page loads
- Responsibilities: Provider tree setup (NextIntl -> Theme -> Convex/Clerk -> Config -> Nuqs -> Tooltips), sidebar + mobile navbar layout

**API Route:**
- Location: `app/api/openalex/search/route.ts`
- Triggers: SWR fetcher from SearchProvider
- Responsibilities: Proxy search queries to OpenAlex API with consistent parameter building

**Server Actions:**
- Location: `app/actions/openalex.ts`, `app/actions/openrouter.ts`
- Triggers: Client-side AI operations
- Responsibilities: Server-side API calls for AI providers and OpenAlex

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: External webhooks (Clerk at `/webhooks/clerk`, Stripe at `/webhooks/stripe`, Zotero OAuth at `/api/zotero/callback`)
- Responsibilities: Webhook processing, idempotent event handling, audit logging

**Convex Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Scheduled intervals (hourly/daily)
- Responsibilities: Cleanup deleted users, check subscription status, reconcile Stripe invoices, monitor failed events, cleanup OAuth tokens, validate env vars

## Error Handling

**Strategy:** Multi-layered with structured errors on backend, toast notifications on frontend

**Patterns:**
- Convex backend uses `createError()` factory (`convex/lib/errors.ts`) for typed errors (NOT_FOUND, VALIDATION_ERROR, etc.)
- Stripe webhook handlers wrap in `runAuditedStripeHandler` for idempotent processing with retry tracking via `stripeEventLogs`
- Frontend uses toast system (`lib/toast/`) for user-facing errors
- Auth sync has exponential backoff retry (up to 6 attempts) in `AuthReadinessProvider`
- Rate limiting via `convex-helpers/server/rateLimit`

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` with `[Module]` prefixes (e.g., `[Workflow]`, `[StripeWebhook]`, `[Auth]`)
**Validation:** Convex validators for backend args, Zod for frontend schemas, `searchFiltersValidator` shared between client and server
**Authentication:** Clerk JWT verified by Convex via `auth.config.ts`; `AuthRouteGate` component gates protected pages; `convex/lib/auth.ts` provides server-side auth helpers
**Internationalization:** `next-intl` with 6 locales (en-US, en-GB, fr, hi, ja, zh) in `messages/` directory, locale detection in `i18n/`
**Analytics:** PostHog for product analytics with detailed search event tracking (`lib/posthog-search.ts`, `lib/posthog-ai.ts`)
**Feature Flags:** Feature flags managed in `convex/lib/featureFlags.ts`, `lib/credits/feature-flags.ts`, `lib/extraction/feature-flags.ts`

---

*Architecture analysis: 2026-03-06*
