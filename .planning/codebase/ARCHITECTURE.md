# Architecture

**Analysis Date:** 2026-03-03

## Pattern Overview

**Overall:** Full-Stack Next.js App with Convex Backend-as-a-Service

**Key Characteristics:**
- Next.js 15 App Router (RSC + Client Components) for the frontend
- Convex for all persistent data: real-time reactive queries, mutations, actions, cron jobs, durable workflows
- External APIs called from both Next.js Server Actions (OpenAlex search) and Convex Actions (AI, Stripe, Zotero)
- Clerk for authentication, bridged into Convex via `ConvexProviderWithClerk`
- URL (nuqs) as single source of truth for search filter state; Zustand for client-side session state; Convex for persistent user data

## Layers

**Next.js Frontend (RSC + Client Components):**
- Purpose: Renders pages and UI; handles routing, auth gates, i18n, search state
- Location: `app/`, `components/`, `lib/`
- Contains: Page components, layout wrappers, React context providers, Zustand stores, hooks, utility functions
- Depends on: Convex client SDK (for real-time data), SWR (for OpenAlex API calls), nuqs (URL state)
- Used by: End users via browser

**Convex Backend:**
- Purpose: Durable data store, business logic, webhook handling, background jobs
- Location: `convex/`
- Contains: Queries, mutations, actions, scheduled crons, durable workflows, HTTP routes, schema
- Depends on: Stripe SDK, OpenAlex HTTP API, AI SDK (OpenAI/Anthropic), Zotero OAuth API, PDF.js, GROBID
- Used by: Next.js frontend (via Convex React Client), Stripe webhooks (via HTTP router), Clerk webhooks

**Shared Library Layer:**
- Purpose: Types, utilities, and AI core logic shared between frontend and Convex backend
- Location: `lib/`
- Contains: Type definitions (`lib/types/`), AI configs/prompts (`lib/ai/`), filter logic, search utilities, PDF utilities
- Depends on: Nothing backend-specific; pure TypeScript
- Used by: Both `app/` + `components/` (frontend) and `convex/` (backend imports from `lib/ai/core/`, `lib/pdf/`)

**Convex Components (Third-Party):**
- Purpose: Pre-built Convex features installed as components
- Location: `convex/convex.config.ts` defines: `stripe`, `rag`, `workflow`, `workpool`
- Contains: Stripe webhook routing, RAG vector store, durable workflow engine, parallel work queue
- Used by: `convex/` modules via `components` import from `_generated/api`

## Data Flow

**Search Flow (OpenAlex):**

1. User types query on home page (`app/page.tsx` → `components/PageContent.tsx`)
2. User navigates to `/results/[searchId]` — URL params (nuqs) become source of truth
3. `lib/search/provider.tsx` (`SearchProvider`) reads URL params via `useQueryStates` and drives SWR fetch
4. SWR fetcher calls `lib/search-utils.ts` → `app/actions/openalex.ts` (Next.js Server Action)
5. Server Action calls OpenAlex HTTP API via `lib/openalex.ts` client
6. Results returned to client; search history stored in Zustand (`lib/store.ts`)

**Extraction Workflow (AI Paper Data Extraction):**

1. User creates job in `app/extraction/new/page.tsx` — draft state in Zustand (`lib/store/extraction.ts`)
2. Job creation triggers Convex mutation → `convex/extraction/mutations.ts` persists job record
3. Convex durable workflow starts: `convex/extraction/workflow.ts` (`runExtractionWorkflow`)
4. Workflow fetches papers from OpenAlex API or Zotero, creates `extractionPapers` records
5. Each paper enqueued to Workpool via `convex/extraction/mutations.ts` (`enqueuePaperProcessing`)
6. `convex/extraction/workpoolActions.ts` processes each paper: downloads PDF, indexes in RAG, runs AI extraction
7. Results written to `extractionResults`, `extractionEvidenceUnits` tables
8. Frontend polls/subscribes via `useProtectedPaginatedQuery` on `api.extraction.queries.getJobResultsPaginated`

**Auth + User Sync Flow:**

1. Clerk authenticates user in browser
2. `components/providers/convex-provider.tsx` (`AuthReadinessProvider`) calls `api.users.mutations.ensureUser` after Clerk auth
3. Clerk webhooks (`convex/webhooks/clerk.ts`) also push user data to Convex `users` table
4. Convex auth validates JWT from Clerk on all protected queries/mutations via `convex/lib/auth.ts`

**Billing Flow (Stripe):**

1. User upgrades via `components/billing/` UI → Convex action creates Stripe checkout session
2. Stripe fires webhooks to `convex/http.ts` → registered via `@convex-dev/stripe` component
3. Webhook handlers call `convex/subscriptions/` and `convex/credits/` internal mutations
4. Credit balance updated in `credits` table; `creditTransactions` records every change (idempotent by `stripeInvoiceId`)

**State Management:**

- **URL (nuqs):** Search filters and params for results pages — shareable, bookmarkable
- **Zustand (persisted):** Search history, keyword expansions, ratings, AI settings, extraction draft — lives in `lib/store.ts`
- **Convex Reactive Queries:** All server-side data (users, credits, extraction jobs/results, subscriptions) — real-time via WebSocket
- **SWR:** OpenAlex API responses — cached client-side with deduplication

## Key Abstractions

**Convex Module Pattern (`{domain}/queries.ts`, `mutations.ts`, `actions.ts`):**
- Purpose: Organizes Convex functions by domain (extraction, users, credits, subscriptions, zotero, etc.)
- Examples: `convex/extraction/queries.ts`, `convex/credits/actions.ts`, `convex/users/mutations.ts`
- Pattern: Public functions use `query/mutation/action`; internal (backend-only) use `internalQuery/internalMutation/internalAction`

**Protected Query Wrapper:**
- Purpose: Wraps Convex hooks with auth-readiness and loading state handling
- Examples: `lib/auth/use-auth-query.ts` exports `useProtectedQuery`, `useProtectedPaginatedQuery`
- Pattern: Returns `{ data, settlement }` where `settlement` is `"auth_loading" | "query_loading" | "ready"`

**Search Provider (Context):**
- Purpose: Single source of truth for search state — URL params via nuqs + SWR data
- Location: `lib/search/provider.tsx`
- Pattern: `SearchProvider` wraps results pages; child components use `useSearch()` hook

**AI Action Factory (`createAIAction`):**
- Purpose: Reduces boilerplate for Convex AI actions — handles auth, credits, model selection
- Location: `convex/ai/helpers.ts`
- Pattern: All AI Convex actions (enhance query, screening, extraction questions) use `createAIAction(inputValidator, outputValidator, label, configFn, mapFn)`

**Error System (`createError`):**
- Purpose: Typed error codes for all Convex errors
- Location: `convex/lib/errors.ts`
- Pattern: `createError("NOT_FOUND", "message")` → `ConvexError<ErrorData>` with typed `code` field

**Entitlements + Feature Flags:**
- Purpose: Gate UI features by subscription plan
- Location: `lib/billing/entitlements.ts`, `lib/extraction/feature-flags.ts`, `lib/credits/feature-flags.ts`
- Pattern: `resolveEffectivePlan(subscription)` returns `"free" | "go" | "pro" | "enterprise"`. Feature flags checked in components before rendering gated features.

## Entry Points

**Next.js App Entry:**
- Location: `app/layout.tsx`
- Triggers: All page loads
- Responsibilities: Mounts provider tree — i18n (`NextIntlClientProvider`), theme, Convex+Clerk (`ConvexClientProvider`), config, URL state (`NuqsAdapter`), layout shell

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: Inbound webhooks (Clerk, Stripe), Zotero OAuth callback
- Responsibilities: Routes `/webhooks/clerk`, `/webhooks/stripe`, `/api/zotero/callback` to their handlers

**Convex Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Time-based (hourly, daily)
- Responsibilities: Cleanup deleted users, check subscription status, monitor failed Stripe events, reconcile Stripe invoices, cleanup expired Zotero OAuth tokens

**Next.js API Route:**
- Location: `app/api/openalex/search/route.ts`
- Triggers: Direct HTTP GET requests
- Responsibilities: Proxy/wrapper for OpenAlex search (used by some fetch paths)

**Next.js Server Actions:**
- Location: `app/actions/openalex.ts`, `app/actions/openrouter.ts`
- Triggers: Called from client components via SWR fetcher
- Responsibilities: Execute OpenAlex API calls server-side with full search filter support

## Error Handling

**Strategy:** Typed error codes propagated from Convex backend; translated to user-facing toasts on frontend

**Patterns:**
- Convex backend throws `ConvexError<ErrorData>` with typed `code` via `createError()` in `convex/lib/errors.ts`
- Frontend catches errors in `lib/toast/error-resolver.ts` — maps error codes to toast messages
- `lib/toast/use-app-toast.ts` provides domain-specific toast methods (`toast.job.cancelFailed()`, `toast.search.failed()`)
- Next.js `app/error.tsx` and `app/global-error.tsx` catch RSC render errors
- `app/extraction/error.tsx` catches extraction section errors
- Auth errors handled by `components/auth/auth-state-panel.tsx` which renders contextual sign-in prompts

## Cross-Cutting Concerns

**Logging:** `console.log/error` in Convex backend functions (visible in Convex dashboard logs). PostHog analytics on frontend (`lib/posthog-search.ts`, `lib/posthog-ai.ts`).

**Validation:** Convex validators (`v.*`) on all function args. Zod schemas for AI output parsing in `lib/ai/core/schemas.ts`. Input validation in search params parsers (`lib/search-params/parsers.ts`).

**Authentication:** Clerk JWT on frontend. Convex Auth validates tokens on all protected functions. `convex/lib/auth.ts` provides `getAuthenticatedUser()` helper used across all protected mutations/queries.

**Rate Limiting:** `convex-helpers/server/rateLimit` applied in `convex/schema.ts` (rate limit tables). Used in sensitive actions to prevent abuse.

**Internationalisation:** `next-intl` throughout. Messages in `messages/{locale}.json` (en-US, en-GB, fr, zh, ja, hi). `useTranslations()` in components; `getTranslations()` in RSC.

---

*Architecture analysis: 2026-03-03*
