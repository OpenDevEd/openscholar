# Architecture

**Analysis Date:** 2026-02-27

## Pattern Overview

**Overall:** Full-stack Next.js (App Router) + Convex BaaS with durable workflows

**Key Characteristics:**
- Next.js 15 App Router for frontend routing and server components; Convex for all persistent state, real-time subscriptions, and background processing
- No traditional REST backend — all mutations/queries go through Convex's typed API (`convex/_generated/api`), callable from both client (React hooks) and server actions
- Durable extraction pipeline built with `@convex-dev/workflow` and `@convex-dev/workpool` — survives server restarts, retries automatically
- Dual AI execution model: user-supplied BYOK API keys (executed client-side or via Next.js server action) or platform credits (executed via Convex actions on the server)
- Authentication via Clerk, synced into Convex `users` table via webhook on every sign-in

## Layers

**Presentation Layer:**
- Purpose: React UI, routing, page structure
- Location: `app/`, `components/`
- Contains: Next.js page components (`app/**/page.tsx`), feature components (`components/`), layout components (`components/layout/`)
- Depends on: Convex React hooks, Zustand store, `lib/` utilities
- Used by: End users via browser

**Client State Layer:**
- Purpose: Local ephemeral state and URL state
- Location: `lib/store.ts`, `lib/hooks/`, `hooks/`
- Contains: Zustand store with persistence (`lib/store.ts`), URL state hooks (`lib/hooks/use-url-state.ts`), custom hooks for UI operations
- Depends on: Nothing (pure client)
- Used by: Page components and feature components

**Server Actions Layer:**
- Purpose: Next.js `"use server"` functions that call external APIs not available from Convex (OpenAlex SDK)
- Location: `app/actions/openalex.ts`, `app/actions/openrouter.ts`
- Contains: `getSearchResults` — calls the OpenAlex SDK and returns paper results
- Depends on: `lib/openalex.ts` (SDK client), `lib/utils.ts`
- Used by: Search UI components

**AI Client Layer:**
- Purpose: Routes AI operations to either local execution (BYOK) or Convex credit-based execution
- Location: `lib/ai/client/`
- Contains: `router.ts` (exports React hooks for each AI operation), `mode-routing.ts` (routing decision logic), `executor.ts` (client-side AI execution), `hook-factory.ts` (creates typed AI hooks)
- Depends on: Convex actions (`api.ai.actions.*`), OpenAI/provider SDK (for local execution)
- Used by: Feature components (screening, search enhancement, translation)

**AI Core Layer:**
- Purpose: Shared AI logic and prompt configurations used by both client executor and Convex actions
- Location: `lib/ai/core/`
- Contains: `configs.ts` (LLM prompt configs), `execute.ts` (core execution), `batch.ts` (batch processing), `schemas.ts` (structured output schemas), `prompts.ts`
- Depends on: AI SDK (Vercel AI SDK or similar)
- Used by: `lib/ai/client/executor.ts` and `convex/ai/actions.ts`

**Convex Backend Layer:**
- Purpose: Durable backend — database, queries, mutations, actions, scheduled jobs, webhooks
- Location: `convex/`
- Contains: Domain modules (`users/`, `credits/`, `subscriptions/`, `ai/`, `extraction/`, `zotero/`, `apiKeys/`), HTTP router (`http.ts`), schema (`schema.ts`), workflow/workpool config (`workflow.ts`, `workpool.ts`), cron jobs (`crons.ts`)
- Depends on: External: Stripe SDK, Clerk webhook, OpenAlex (via Next.js proxy), AI providers
- Used by: Frontend (via generated `convex/_generated/api`), external webhooks (Stripe, Clerk, Zotero OAuth)

## Data Flow

**Search Flow:**

1. User types query in `components/search-command-center/`; state held in Zustand store (`lib/store.ts`)
2. Search submission calls Next.js server action `app/actions/openalex.ts:getSearchResults`
3. Server action calls OpenAlex SDK (`lib/openalex.ts`) with `createSearchParameters` utility
4. Results returned to client; saved to Zustand `searchHistory` with UUID-keyed entries
5. Navigation to `/results/[searchId]` renders `components/results-page-content.tsx` reading from store

**AI Operation Flow (dual-path):**

1. Component calls a hook from `lib/ai/client/router.ts` (e.g., `useEnhanceSearchQuery`)
2. `hook-factory.ts` consults `mode-routing.ts` to decide: `local` (BYOK) or `credits` (Convex)
3. **Credits path:** Hook calls `api.ai.actions.*` Convex action; Convex action uses `lib/ai/core/` to call the AI provider, deducts credits from `credits` table
4. **Local path:** Hook calls `lib/ai/client/executor.ts` directly from browser using user's stored API key; no Convex involved
5. Result returned to component; credits deducted if credits path was used

**Extraction Workflow Flow:**

1. User creates extraction job via `api.extraction.mutations.startExtraction` (Convex mutation)
2. Mutation creates `extractionJobs` + `extractionQuestions` records, then starts a `@convex-dev/workflow` durable workflow
3. Workflow (`convex/extraction/workflow.ts:runExtractionWorkflow`) orchestrates: fetch papers → deduplicate → create `extractionPapers` records → enqueue each paper into `pdfProcessingPool` (workpool)
4. Workpool processes each paper: download PDF → index into RAG component → extract answers using AI → store results in `extractionResults` + `extractionEvidenceUnits`
5. UI subscribes to `api.extraction.queries.subscribeToJobProgress` (real-time Convex query) for live progress updates

**Billing / Credits Flow:**

1. Stripe webhook arrives at Convex HTTP router (`convex/http.ts`) via `registerRoutes` from `@convex-dev/stripe`
2. `onEvent` handler records event in `stripeEventLogs` for idempotency
3. On `invoice.paid`: triggers `credits.actions.processInvoiceForGrant` → grants monthly credits to `credits` table
4. On `customer.subscription.created/updated/deleted`: `subscriptions.internal.syncSubscription` mutation updates `subscriptions` table
5. Credit deduction happens inline in `convex/ai/helpers.ts:withAuthAndCreditsBatch` during each AI action execution

**Auth Flow:**

1. User signs in via Clerk (hosted components at `/sign-in`, `/sign-up`)
2. Clerk fires webhook to `convex/http.ts:/webhooks/clerk` → `convex/webhooks/clerk.ts`
3. Webhook calls `users.mutations.ensureUser` — upserts user record in Convex `users` table
4. `ConvexClientProvider` (`components/providers/convex-provider.tsx`) mounts `AuthReadinessProvider` which calls `ensureUser` on auth state change with exponential-backoff retry
5. `AuthRouteGate` (`components/auth/auth-route-gate.tsx`) blocks protected routes until `phase === "authenticated"`

**State Management:**

- **Server state:** Convex real-time queries (mutations auto-invalidate subscribing queries)
- **Client ephemeral state:** Zustand store (`lib/store.ts`) with localStorage persistence (search history, bookmarks, screening responses, AI settings)
- **URL state:** `lib/hooks/use-url-state.ts` and `nuqs` for serializable page state (view mode, filters, sort)

## Key Abstractions

**Convex Domain Modules:**
- Purpose: Each feature domain has its own directory under `convex/` with `queries.ts`, `mutations.ts`, `actions.ts`, and `internal.ts`
- Examples: `convex/extraction/`, `convex/credits/`, `convex/subscriptions/`, `convex/ai/`
- Pattern: Public exports (callable from client) + `internal` exports (only callable from other Convex functions)

**AI Hook Factory (`lib/ai/client/hook-factory.ts`):**
- Purpose: Creates typed React hooks that transparently route to credits or local execution
- Pattern: `createAIHook(convexAction, clientExecutor, resultTransformer?, options?)` → returns a React hook

**Protected Queries (`lib/auth/use-auth-query.ts`):**
- Purpose: Wraps Convex `useQuery`/`usePaginatedQuery` with auth-awareness — returns a settlement state to distinguish "loading auth" from "query loading" from "ready"
- Pattern: `useProtectedQuery(api.x.y, args)` → `{ data, settlement, isDeferred }`

**Command Center Pattern:**
- Purpose: Reusable shell for list-oriented feature pages (search history, bookmarks, extraction jobs)
- Examples: `components/command-center/`, `components/search-command-center/`, `components/bookmarks-command-center/`, `components/history-command-center/`
- Pattern: `CommandCenterContainer` > `CommandCenterHeader` + `CommandCenterToolbar` + `CommandCenterList`

**Workpool + Workflow (Convex):**
- Purpose: Durable, retryable background processing for the extraction pipeline
- `workflow.ts`: `WorkflowManager` with 10-way parallelism, 3 retries
- `workpool.ts`: `pdfProcessingPool` — rate-limited (3 parallel) workpool for PDF download/indexing
- Pattern: Workflow orchestrates high-level steps; workpool handles per-paper processing

## Entry Points

**Web App Root:**
- Location: `app/layout.tsx`
- Triggers: Every page request
- Responsibilities: Provides `ThemeProvider`, `ConvexClientProvider` (Clerk + Convex), `NuqsAdapter`, `AuthRouteGate`, `AppSidebar`, `MobileNavbar`, `Toaster`, i18n (`NextIntlClientProvider`)

**Home Page:**
- Location: `app/page.tsx`
- Triggers: Navigation to `/`
- Responsibilities: Renders `PageContent` (search interface); publicly accessible

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: External webhooks (Stripe, Clerk, Zotero OAuth callback)
- Responsibilities: Routes incoming HTTP requests to Convex actions/mutations

**Convex Schema:**
- Location: `convex/schema.ts`
- Triggers: Convex deployment
- Responsibilities: Defines all database tables and indexes

**Extraction Job Start:**
- Location: `convex/extraction/mutations.ts:startExtraction`
- Triggers: User submits extraction job form
- Responsibilities: Validates, creates job/question records, launches durable workflow

**Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Scheduled by Convex runtime (hourly, daily)
- Responsibilities: Deleted user cleanup, subscription status checks, Stripe invoice reconciliation

## Error Handling

**Strategy:** Typed error codes propagated from Convex backend; UI components handle specific codes to display contextual messages

**Patterns:**
- Convex backend creates structured errors via `convex/lib/errors.ts:createError(code, message)` (e.g., `NOT_FOUND`, `VALIDATION_ERROR`, `UNAUTHENTICATED`)
- AI operations: `mode-routing.ts:resolveErrorCode()` extracts error codes from caught errors; smart mode falls back to local execution on `AI_INSUFFICIENT_CREDITS` / `AI_UNAUTHENTICATED`
- Protected queries return a `settlement` field (`"auth_loading" | "query_loading" | "ready"`) rather than throwing; components use `getAuthSensitiveListRenderState()` to determine render state
- Toast notifications via `lib/toast/` (`useAppToast()` hook with domain-specific methods like `toast.job.cancelFailed()`)
- Global error boundary: `app/error.tsx` and `app/global-error.tsx`

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` with structured prefixes (e.g., `[Workflow]`, `[StripeWebhook]`, `[Auth]`, `[OpenAlex API]`); PostHog analytics via `lib/posthog-*.ts` files

**Validation:** Convex validator (`v`) for all Convex args/returns; zod-like schemas in `lib/ai/core/schemas.ts` for AI structured outputs

**Authentication:** Clerk for identity; Convex for data auth (every query/mutation calls `ctx.auth.getUserIdentity()` and resolves to internal user ID); `AuthRouteGate` for route-level protection; `isPublicPath()` for exceptions

**Internationalization:** `next-intl` throughout; translations in `messages/*.json` (en-US, en-GB, fr, hi, ja, zh); server-side via `getTranslations()`, client-side via `useTranslations()`

---

*Architecture analysis: 2026-02-27*
