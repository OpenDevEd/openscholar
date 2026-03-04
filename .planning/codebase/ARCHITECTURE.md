# Architecture

**Analysis Date:** 2026-03-04

## Pattern Overview

**Overall:** Full-stack SaaS with Next.js (App Router) frontend and Convex as the reactive backend-as-a-service. External data comes from the OpenAlex academic API and AI providers (OpenAI, Anthropic, Google, OpenRouter). Billing is Stripe-managed.

**Key Characteristics:**
- Next.js App Router handles routing, SSR/metadata, and Next.js API routes (OpenAlex proxy, OpenRouter proxy)
- Convex provides real-time database, serverless functions (queries/mutations/actions), durable workflows, HTTP webhook handlers, and scheduled cron jobs
- Clerk provides authentication; user identity syncs into Convex `users` table via Clerk webhooks
- Client state uses Zustand (persisted to localStorage) plus URL state via `nuqs`
- Internationalization via `next-intl` with message files in `messages/`

## Layers

**Next.js App Router (Routing & UI):**
- Purpose: Pages, layouts, metadata, access gates, page-level data composition
- Location: `app/`
- Contains: `page.tsx`, `layout.tsx`, route-specific components, access gate wrappers
- Depends on: `components/`, `lib/`, Convex generated API
- Used by: Browser

**React Components:**
- Purpose: UI building blocks from primitive shadcn/ui atoms to complex feature panels
- Location: `components/`
- Contains: Feature-specific components (extraction, library, search, billing), global layout components, shadcn-ui primitives under `components/ui/`
- Depends on: `lib/`, Convex hooks (`convex/react`), `next-intl`
- Used by: `app/` pages

**Client Library (`lib/`):**
- Purpose: Business logic, shared utilities, type definitions, client-side state, and hooks
- Location: `lib/`
- Contains: Zustand stores (`lib/store.ts`), type definitions (`lib/types/`), search utilities, billing entitlements, auth helpers, extraction logic, toast routing, analytics
- Depends on: Convex generated API, external SDKs
- Used by: `components/`, `app/`

**Convex Backend:**
- Purpose: Database, reactive queries, mutations, server actions, webhooks, cron jobs, durable workflows
- Location: `convex/`
- Contains: Domain modules (`extraction/`, `credits/`, `subscriptions/`, `users/`, `zotero/`, `ai/`, `apiKeys/`, `library/`, `maintenance/`, `webhooks/`), schema (`convex/schema.ts`), HTTP router (`convex/http.ts`), crons (`convex/crons.ts`)
- Depends on: Stripe, Clerk, AI SDKs, GROBID, Convex components (workflow, workpool, RAG, stripe)
- Used by: Frontend (via generated `convex/_generated/api`)

**Next.js API Routes:**
- Purpose: Server-side proxies for external APIs (prevents exposing OpenAlex and OpenRouter keys to client)
- Location: `app/api/`
- Contains: `app/api/openalex/search/route.ts` (OpenAlex search proxy), `app/api/openalex.ts`, `app/api/openrouter.ts`
- Depends on: `lib/openalex.ts`, `lib/utils.ts`
- Used by: Client-side search hook via SWR

**Next.js Server Actions:**
- Purpose: Server-side mutations for OpenAlex fetching during extraction
- Location: `app/actions/`
- Contains: `openalex.ts` (fetch papers from OpenAlex for extraction jobs)
- Depends on: OpenAlex SDK
- Used by: Convex `extraction/actions.ts`

## Data Flow

**Search Flow:**

1. User enters query in `components/search-sidebar.tsx` or `components/search-command-center/`
2. Query updates URL params via `nuqs` (`useQueryStates`)
3. `lib/search/provider.tsx` (`SearchProvider`) reads URL params, calls `/api/openalex/search` via SWR
4. `app/api/openalex/search/route.ts` proxies to OpenAlex API using `@sickrin/openalex-sdk`
5. Results returned to `SearchProvider` context, consumed by `components/results-list.tsx`
6. Search history saved to Zustand store (persisted localStorage) via `useSearchHistoryStore`

**Extraction (AI Data Extraction) Flow:**

1. User creates job in `app/extraction/new/page.tsx` → calls `api.extraction.mutations.startExtraction`
2. Convex mutation creates `extractionJobs` record, triggers `runExtractionWorkflow` via `@convex-dev/workflow`
3. Workflow orchestrates steps via `convex/extraction/workflow.ts`:
   - Calls `app/actions/openalex.ts` (Next.js server action) to fetch papers from OpenAlex
   - Dispatches per-paper workpool actions (`downloadAndIndexPdfAction`, `waitAndExtractAction`) via `@convex-dev/workpool`
4. Per-paper action: downloads PDF → indexes text via `@convex-dev/rag` → calls AI provider to extract structured data → stores `extractionResults`
5. Frontend polls/subscribes via `useProtectedPaginatedQuery(api.extraction.queries.getJobResultsPaginated)` in `app/extraction/[jobId]/page.tsx`

**Auth/User Sync Flow:**

1. Clerk handles sign-in/sign-up at `app/sign-in/` and `app/sign-up/`
2. Clerk sends webhook to `convex/http.ts` → `/webhooks/clerk` handler
3. `convex/webhooks/clerk.ts` upserts user into Convex `users` table
4. `components/providers/convex-provider.tsx` (`ConvexClientProvider`) bridges Clerk auth to Convex via `ConvexProviderWithClerk`
5. Auth readiness state exposed via `useAuthReadiness()` hook
6. `lib/auth/use-auth-query.ts` exports `useProtectedQuery` / `useProtectedPaginatedQuery` which defer until auth is ready

**Billing/Credits Flow:**

1. Stripe webhooks arrive at `convex/http.ts` → routed by `@convex-dev/stripe`
2. `convex/lib/stripeWebhookHandlers.ts` processes events: subscription changes → `convex/subscriptions/`, invoice payment → `convex/credits/actions.ts` (grants credits)
3. Credits deducted during AI extraction in `convex/extraction/workpoolActions.ts` via `withUserCreditsBatch`
4. Credit balance readable by client via `api.credits.queries.*`
5. Plan entitlements derived client-side by `lib/billing/entitlements.ts:resolveEffectivePlan()`

**State Management:**

- URL (via `nuqs`): search query params, extraction view mode, active filters
- Zustand (persisted localStorage): search history, ratings, bookmarks, UI state, keyword expansion, extraction citation panel
- Convex reactive queries: server-owned data (extraction jobs, credits, subscription, library items, API keys)
- SWR: OpenAlex search results cache

## Key Abstractions

**`useProtectedQuery` / `useProtectedPaginatedQuery`:**
- Purpose: Auth-aware Convex query hooks that defer until Clerk+Convex auth is settled
- Examples: `lib/auth/use-auth-query.ts`
- Pattern: Returns `{ data, settlement, isDeferred }` where `settlement` is `"auth_loading" | "anonymous" | "query_loading" | "ready"`

**`resolveEffectivePlan`:**
- Purpose: Resolves the effective subscription plan accounting for non-entitled statuses (canceled, paused, etc.)
- Examples: `lib/billing/entitlements.ts`
- Pattern: Returns `"free"` if subscription is null or status is non-entitled, otherwise returns subscription plan

**Convex Domain Modules:**
- Purpose: Each module owns its queries, mutations, and actions by domain (not by function type)
- Examples: `convex/extraction/`, `convex/credits/`, `convex/subscriptions/`, `convex/zotero/`, `convex/users/`, `convex/library/`, `convex/apiKeys/`
- Pattern: Each domain has `queries.ts`, `mutations.ts`, optionally `actions.ts`, `internal.ts`, and a domain-specific `lib/` subfolder

**Extraction Workflow:**
- Purpose: Durable, resumable multi-step AI extraction over large paper sets
- Examples: `convex/extraction/workflow.ts`, `convex/extraction/workpoolActions.ts`
- Pattern: `@convex-dev/workflow` orchestrates steps; `@convex-dev/workpool` parallelizes per-paper actions with retry; `@convex-dev/rag` indexes PDF content for RAG retrieval

**`FilterState` + `preprocessPapers` / `filterPapers`:**
- Purpose: Client-side filtering of extraction results with O(n) preprocessing to avoid repeated expensive computation
- Examples: `lib/extraction/filtering.ts`
- Pattern: Preprocess once when papers change, then filter on every filter state change

## Entry Points

**Web Application:**
- Location: `app/layout.tsx`
- Triggers: Every page request
- Responsibilities: Provider tree setup (theme, Convex+Clerk, i18n, nuqs, sidebar layout, toast, cookie consent)

**Home / Search Page:**
- Location: `app/page.tsx` → `components/PageContent.tsx`
- Triggers: Route `/`
- Responsibilities: Renders search interface and initial landing content

**Search Results:**
- Location: `app/results/[searchId]/page.tsx` → `components/results-page-content.tsx`
- Triggers: Route `/results/:searchId`
- Responsibilities: Displays paginated search results using `SearchProvider` context

**Extraction Job Detail:**
- Location: `app/extraction/[jobId]/page.tsx`
- Triggers: Route `/extraction/:jobId`
- Responsibilities: Full extraction results UI with tabs (results, insights, review, report), pagination, filtering, citation panel, export

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: Incoming HTTP requests to Convex deployment URL
- Responsibilities: Routes `/webhooks/clerk` (user sync), `/api/zotero/callback` (OAuth), Stripe webhook endpoints

**Convex Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Scheduled intervals (hourly/daily)
- Responsibilities: Delete soft-deleted users, check subscription status, monitor failed Stripe events, reconcile Stripe invoices, cleanup Zotero OAuth tokens, validate env vars

## Error Handling

**Strategy:** Layered — Convex functions throw typed errors (`convex/lib/errors.ts:createError()`), frontend catches via try/catch in event handlers and routes to `useAppToast()` toast notifications. Auth state errors are surfaced via `AuthStatePanel` component variants.

**Patterns:**
- Convex mutations/actions throw `ConvexError` with typed codes; frontend catches and maps via `lib/toast/` resolvers
- `getAuthSensitiveListRenderState()` in `lib/auth/list-render-state.ts` maps auth settlement + data state to render state enums ("loading", "empty", "filtered_empty", "ready")
- Extraction errors stored per-paper in `extractionPapers.status` field; job-level errors in `extractionJobs.status`
- Stripe webhook failures logged to `stripeEventLogs` table with retry state machine

## Cross-Cutting Concerns

**Logging:** `console.log` in Convex functions; PostHog event tracking (`lib/posthog-search.ts`, `lib/posthog-ai.ts`) for analytics
**Validation:** `convex/lib/validators.ts` and `convex/extraction/validators.ts` for Convex value validators; `lib/keyword-validation.ts` for client-side query keyword validation
**Authentication:** Clerk for identity; `ConvexProviderWithClerk` bridges JWT to Convex; `AuthRouteGate` in `app/layout.tsx` for route-level protection; `ExtractionAccessGate` for feature-level protection
**Rate Limiting:** `convex-helpers/server/rateLimit` tables in schema; `convex/lib/rateLimit.ts` for enforcement
**Internationalization:** `next-intl` with locale files at `messages/en-US.json`, `messages/en-GB.json`, `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json`
**Feature Flags:** `lib/extraction/feature-flags.ts` and `convex/lib/featureFlags.ts` for controlling experimental features

---

*Architecture analysis: 2026-03-04*
