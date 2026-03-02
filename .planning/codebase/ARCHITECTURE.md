# Architecture

**Analysis Date:** 2026-03-02

## Pattern Overview

**Overall:** Full-stack Next.js App Router application with a Convex serverless backend, following a client-server split where UI logic lives in React client components and all persistent state, business logic, and background processing run in Convex.

**Key Characteristics:**
- Next.js 15 App Router for routing, SSR pages, and API routes
- Convex as the real-time database, function runtime, and job orchestration layer
- Clerk for authentication, synced into Convex via webhooks
- Zustand for local/session UI state (search filters, history, ratings) persisted to localStorage
- URL state managed via `nuqs` for shareable filter state

## Layers

**Presentation Layer (React Components):**
- Purpose: Renders UI, handles user interactions, subscribes to Convex real-time queries
- Location: `components/`
- Contains: Page-level shells, feature command centers, shared UI primitives
- Depends on: `lib/` for utilities/types, `convex/_generated/api` for typed Convex calls, `lib/store.ts` for Zustand state
- Used by: `app/` route pages

**Routing Layer (Next.js App Router):**
- Purpose: Defines URL routes, renders page shells, provides entry points for server actions and API routes
- Location: `app/`
- Contains: `page.tsx` route files, `layout.tsx`, `error.tsx`, server actions in `app/actions/`, REST API routes in `app/api/`
- Depends on: `components/` for page content, `lib/` for server utilities
- Used by: Browser navigation

**Business Logic / Utilities Layer:**
- Purpose: Domain logic, type definitions, OpenAlex SDK client, Zustand stores, billing entitlements, auth helpers
- Location: `lib/`
- Contains: `lib/store.ts` (Zustand), `lib/types/` (shared TypeScript types), `lib/openalex.ts` (SDK client), `lib/auth/`, `lib/billing/`, `lib/extraction/`, `lib/search/`
- Depends on: External packages only
- Used by: `components/`, `app/`, `convex/` (shared extraction logic)

**Backend Layer (Convex):**
- Purpose: Database schema, queries, mutations, actions, background workflow orchestration, webhook handlers
- Location: `convex/`
- Contains: `convex/schema.ts` (DB schema), domain modules (`users/`, `extraction/`, `credits/`, `subscriptions/`, `library/`, `zotero/`), HTTP router in `convex/http.ts`, cron jobs in `convex/crons.ts`
- Depends on: `lib/extraction/insights.ts` and other shared lib modules
- Used by: Next.js client components via `convex/react`, HTTP webhooks from Stripe/Clerk

**Durable Execution Layer:**
- Purpose: Long-running, multi-step extraction workflows with retry semantics
- Location: `convex/extraction/workflow.ts`, `convex/workflow.ts`, `convex/workpool.ts`
- Contains: `WorkflowManager` (multi-step orchestration), `Workpool` (parallel PDF processing with concurrency limits)
- Depends on: Convex `@convex-dev/workflow`, `@convex-dev/workpool`
- Used by: `convex/extraction/mutations.ts` to kick off extraction jobs

## Data Flow

**Search Flow:**
1. User types query in `components/search-command-center/index.tsx`
2. Component calls Next.js server action `app/actions/openalex.ts::getSearchResults`
3. Server action calls `lib/openalex.ts` (OpenAlex SDK client) with parameters built by `lib/utils.ts::createSearchParameters`
4. Results returned to component; stored in Zustand `useSearchHistoryStore` (`lib/store.ts`)
5. URL state updated via `nuqs` for shareability; results page rendered at `/results/[searchId]`

**Extraction Job Flow:**
1. User creates job via `components/extraction/job-creator.tsx`; calls `api.extraction.mutations.createExtractionJob`
2. Convex mutation creates `extractionJobs` + `extractionQuestions` records; triggers `workflow.runExtractionWorkflow`
3. Workflow (`convex/extraction/workflow.ts`) runs as durable multi-step: fetches papers from OpenAlex/Zotero/manual sources, downloads PDFs, indexes via RAG, extracts answers per question using AI
4. Individual paper processing runs in `pdfProcessingPool` (max 3 parallel) via `convex/workpool.ts`
5. Results written to `extractionResults`, `extractionEvidenceUnits` tables; real-time updates stream to `app/extraction/[jobId]/page.tsx` via `useProtectedPaginatedQuery`

**Auth Flow:**
1. Clerk handles sign-in/sign-up at `/sign-in` and `/sign-up`
2. Clerk webhook (`/webhooks/clerk` → `convex/webhooks/clerk.ts`) syncs user to Convex `users` table
3. `ConvexClientProvider` (`components/providers/convex-provider.tsx`) calls `api.users.mutations.ensureUser` on auth to sync user record
4. `AuthRouteGate` component checks `useAuthReadiness` phase; blocks protected routes until `authenticated`
5. Convex functions access identity via `ctx.auth.getUserIdentity()` → looked up in `users` table by `clerkId`

**Billing / Credits Flow:**
1. Stripe checkout session created via Convex action
2. Stripe webhooks arrive at `/webhooks/stripe` (registered via `@convex-dev/stripe`)
3. `convex/http.ts` handles `invoice.paid`, `payment_intent.succeeded`, `charge.refunded`, subscription events
4. Each handler calls internal mutations in `convex/credits/` or `convex/subscriptions/` to update `credits` and `subscriptions` tables
5. Idempotency enforced by dedup on `stripeInvoiceId` / `stripePaymentIntentId`

**State Management:**
- Server state: Convex real-time queries (reactive, WebSocket-based)
- Local/session state: Zustand store at `lib/store.ts` with `persist` middleware (localStorage)
- URL state: `nuqs` for search filters, view mode, pagination — enables shareable URLs
- Ephemeral client state: `useState` / `useReducer` within components

## Key Abstractions

**Convex Domain Modules:**
- Purpose: Group queries, mutations, actions, and internal helpers by feature domain
- Examples: `convex/extraction/queries.ts`, `convex/extraction/mutations.ts`, `convex/credits/`, `convex/subscriptions/`
- Pattern: Each module exports `query`, `mutation`, `action`, or `internalQuery`/`internalMutation`/`internalAction`; all internal functions use `internal.*` namespace to prevent direct client access

**`useProtectedQuery` / `useProtectedPaginatedQuery`:**
- Purpose: Wraps Convex queries with auth readiness gate; prevents queries from running before user is synced
- Examples: `lib/auth/use-auth-query.ts` — used throughout `app/extraction/[jobId]/page.tsx`
- Pattern: Returns `{ data, settlement, isDeferred }` with settlement states `"auth_loading" | "query_loading" | "ready"`

**Convex Error Pattern:**
- Purpose: Typed error codes returned as `ConvexError` for client handling
- Examples: `convex/lib/errors.ts` defines `ErrorCode` union type; `createError("UNAUTHENTICATED", "message")` used throughout
- Pattern: Client components catch `ConvexError` and check `error.data.code`

**Command Center Container:**
- Purpose: Consistent card/panel wrapper UI for all major feature areas
- Examples: `components/command-center/` — used in extraction, search, bookmarks, history pages
- Pattern: Pages wrap content in `<CommandCenterContainer>` inside `<PageWrapper>`

**Extraction Workflow Templates:**
- Purpose: Reusable extraction configurations (source + questions) stored as `extractionWorkflowTemplates` in DB
- Examples: `convex/schema.ts` `extractionWorkflowTemplates` table
- Pattern: Templates can be loaded into job creator, saved from completed jobs

## Entry Points

**Root Layout:**
- Location: `app/layout.tsx`
- Triggers: Every page request
- Responsibilities: Wraps app in `NextIntlClientProvider`, `ThemeProvider`, `ConvexClientProvider`, `NuqsAdapter`, `QuerySyncProvider`, `AuthRouteGate`; renders `AppSidebar` and `MobileNavbar`

**Home Page:**
- Location: `app/page.tsx`
- Triggers: User navigates to `/`
- Responsibilities: Renders `PageContent` (search interface), emits JSON-LD structured data for SEO

**Next.js API Route (OpenAlex proxy):**
- Location: `app/api/openalex/search/route.ts`
- Triggers: `GET /api/openalex/search?q=...`
- Responsibilities: Public search endpoint; builds `SearchFilters`, calls OpenAlex SDK, returns JSON results

**Server Actions:**
- Location: `app/actions/openalex.ts`, `app/actions/openrouter.ts`
- Triggers: Called directly from React client components as "use server" functions
- Responsibilities: OpenAlex search (main search flow), OpenRouter AI calls

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: Incoming HTTP requests to Convex backend
- Responsibilities: Routes `/webhooks/clerk`, `/api/zotero/callback`, Stripe webhook events via `@convex-dev/stripe`

**Convex Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Scheduled intervals (hourly/daily)
- Responsibilities: Cleanup deleted users, check subscription status, monitor failed Stripe events, reconcile paid Stripe invoices

## Error Handling

**Strategy:** Layered — typed errors in Convex backend surfaced as `ConvexError` to clients; React components handle auth states via `AuthStatePanel`; UI toasts for user-facing errors via `lib/toast/`

**Patterns:**
- Convex: `createError(ErrorCode, message)` from `convex/lib/errors.ts` throws `ConvexError<ErrorData>`; consumers check `error.data.code`
- Auth gates: Query responses include `status` discriminated union (`"ok" | "unauthenticated" | "no_access"`) instead of throwing; components branch on status
- UI feedback: `useAppToast()` from `lib/toast/` provides domain-scoped toast messages (e.g., `toast.job.cancelFailed()`)
- Stripe webhooks: `runAuditedStripeHandler` wrapper records success/failure to `stripeEventLogs`; failed handlers trigger retry via `ctx.scheduler.runAfter`

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` with bracketed prefixes (e.g., `[Workflow]`, `[Auth]`, `[StripeWebhook]`); no structured logging library
**Validation:** Convex schema validators (`v.string()`, `v.union()`, etc.) enforce runtime types on all DB writes; TypeScript strict mode for compile-time safety
**Authentication:** Clerk provides identity; Convex `ctx.auth.getUserIdentity()` resolves to Convex user record; `requireAuth(ctx)` helper in `convex/lib/auth.ts` enforces auth in mutations/actions; `AuthRouteGate` enforces auth at UI layer; public paths listed in `lib/auth/public-routes.ts`
**Internationalization:** `next-intl` throughout; translations in `messages/`; server-side via `getTranslations()`, client-side via `useTranslations()`
**Analytics:** PostHog for product analytics (`lib/posthog-ai.ts`, `lib/posthog-search.ts`); proxied via Next.js rewrites at `/data/:path*`

---

*Architecture analysis: 2026-03-02*
