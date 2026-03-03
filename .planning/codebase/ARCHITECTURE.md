# Architecture

**Analysis Date:** 2026-03-03

## Pattern Overview

**Overall:** Full-stack Next.js (App Router) + Convex backend-as-a-service with event-driven billing

**Key Characteristics:**
- Next.js 15 App Router on the frontend with React Server Components and `"use client"` boundary
- Convex as the primary backend: real-time database, serverless functions (queries/mutations/actions), HTTP routes, and cron jobs
- Clerk for authentication, synced into Convex via webhook; auth is bridged via `ConvexProviderWithClerk`
- Stripe for billing; webhooks handled in `convex/http.ts` via `@convex-dev/stripe`
- Durable extraction workflows using `@convex-dev/workflow` + `@convex-dev/workpool`
- RAG (Retrieval-Augmented Generation) via `@convex-dev/rag` for PDF extraction
- Zustand for client-side ephemeral state; Convex for persistent per-user data

## Layers

**Presentation Layer (Next.js App Router):**
- Purpose: Renders UI, handles routing, wraps providers
- Location: `app/`, `components/`
- Contains: Page components (RSC and client), layout wrappers, UI component library
- Depends on: Convex queries/mutations via `convex/react`, Zustand stores, `lib/` utilities
- Used by: End user browser

**Client State Layer:**
- Purpose: Manages ephemeral in-browser state (search results, UI toggles, AI config, history)
- Location: `lib/store.ts`, `lib/store/extraction.ts`
- Contains: Zustand stores with `persist` middleware (localStorage-backed)
- Depends on: `lib/types/`
- Used by: Components throughout `components/`

**Shared Library Layer:**
- Purpose: Framework-agnostic business logic shared between frontend and Convex backend
- Location: `lib/`
- Contains: AI prompt configs (`lib/ai/`), type definitions (`lib/types/`), billing entitlements (`lib/billing/`), extraction insights (`lib/extraction/`), search utilities (`lib/search/`), filter predicates (`lib/filters/`)
- Depends on: Nothing (pure TypeScript)
- Used by: Both `components/` and `convex/` modules

**Convex Backend Layer:**
- Purpose: Serverless database operations, business logic enforcement, external integrations
- Location: `convex/`
- Contains: Queries, mutations, actions, HTTP routes, cron jobs, schema
- Depends on: `lib/` shared utilities, Convex components (stripe, rag, workflow, workpool)
- Used by: Frontend via `convex/react`, Stripe webhooks, Clerk webhooks

**Next.js API Routes:**
- Purpose: Thin proxy layer for external API calls that require server-side execution
- Location: `app/api/`
- Contains: `app/api/openalex/search/route.ts` (OpenAlex proxy), `app/actions/` (server actions)
- Depends on: `lib/openalex.ts`, `lib/utils.ts`
- Used by: Components needing OpenAlex data

## Data Flow

**User Search Flow:**

1. User types query in `components/search-command-center/` → updates Zustand `useSearchHistoryStore`
2. Frontend calls `GET /api/openalex/search` (Next.js route) or directly calls `lib/openalex.ts`
3. OpenAlex REST API returns results; stored in Zustand `SearchResult` with a UUID
4. Results rendered in `app/results/[searchId]/page.tsx` → `components/results-page-content.tsx`
5. User interactions (ratings, bookmarks) mutate Convex via `useMutation(api.library.*)`

**Extraction Job Flow:**

1. User configures job in `app/extraction/new/` → draft state in `useExtractionStore` (Zustand)
2. Submit calls `useMutation(api.extraction.mutations.createExtractionJob)` in Convex
3. Convex mutation starts `workflow.define` → `convex/extraction/workflow.ts` (durable)
4. Workflow fetches papers via `internalAction` calling OpenAlex API
5. PDFs queued via `pdfProcessingPool` (Workpool, max 3 parallel) → download → RAG index
6. Per-paper AI extraction via `convex/ai/actions.ts` → deducts credits from `credits` table
7. Results written to `extractionResults` table; UI updates reactively via Convex subscriptions

**Authentication Flow:**

1. User signs in via Clerk (`app/sign-in/`)
2. Clerk issues JWT; `ConvexProviderWithClerk` (`components/providers/convex-provider.tsx`) bridges auth
3. On first auth, `ensureUser` mutation is called with retry logic (up to 6 retries, exponential backoff)
4. `AuthReadinessContext` provides `phase` state: `"initializing" | "authenticated" | "anonymous" | "sync_error"`
5. `AuthRouteGate` (`components/auth/auth-route-gate.tsx`) blocks protected routes until `phase === "authenticated"`
6. Separately, Clerk sends webhook to `POST /webhooks/clerk` → `convex/webhooks/clerk.ts` for user sync

**Billing / Subscription Flow:**

1. User initiates checkout via `convex/subscriptions/actions.ts` → creates Stripe Checkout Session
2. Stripe sends events to `POST /webhooks/stripe` (registered via `@convex-dev/stripe` in `convex/http.ts`)
3. Each event audited in `stripeEventLogs` table via `onEvent` handler
4. `invoice.paid` → `processInvoiceForGrantNonBlocking` → `credits.actions.grantMonthlyCredits`
5. Dedup gate: `stripeInvoiceId` checked in `creditTransactions` prevents double-grants
6. Hourly cron `reconcile stripe paid invoices` catches any missed invoice grants

**State Management:**

- Convex real-time subscriptions for server-persisted data (extraction jobs, credits, subscriptions)
- Zustand (persisted to localStorage) for: search history, ratings, AI config, UI preferences
- `nuqs` for URL-synchronized search parameters (`NuqsAdapter` in `app/layout.tsx`)

## Key Abstractions

**Convex Function Types:**
- `query` / `internalQuery`: Read-only, reactive, subscribed by frontend
- `mutation` / `internalMutation`: Transactional writes with database access
- `action` / `internalAction`: Node.js runtime, can call external APIs, cannot access DB directly
- `httpAction`: HTTP endpoint handlers (webhooks, OAuth callbacks)
- Examples: `convex/extraction/queries.ts`, `convex/extraction/mutations.ts`, `convex/extraction/actions.ts`

**Feature Gating:**
- Purpose: Enforce subscription plan requirements before operations
- Examples: `convex/extraction/guard.ts` (`requireExtractionEnabled`, `requireProPlan`)
- Pattern: Throw `ConvexError` with typed `ErrorCode` from `convex/lib/errors.ts`

**Credit System:**
- Purpose: Track AI usage credits per user with separate free/paid pools
- Tables: `credits` (balance), `creditTransactions` (audit log)
- Deduction: `convex/credits/internal.ts` mutations, called from extraction/AI actions
- Grant: `convex/credits/actions.ts` (`grantMonthlyCredits`, `processInvoiceForGrant`)

**AI Action Factory:**
- Purpose: Uniform wrapper for all AI operations (screening, extraction, translation, query enhancement)
- Location: `convex/ai/helpers.ts` (`createAIAction`, `withAuthAndCreditsBatch`)
- Routing: `lib/ai/client/mode-routing.ts` determines BYOK vs. platform credits

**Rate Limiting:**
- Purpose: Token-bucket rate limits on sensitive operations
- Location: `convex/lib/rateLimit.ts`
- Defined limits: `start-extraction` (5/hr), `api-key-save` (5/min), `checkout-session` (3/min)
- Pattern: Mutations call `rateLimit(ctx, ...)` directly; actions delegate to `internal.lib.rateLimit.consume`

## Entry Points

**Web Application:**
- Location: `app/layout.tsx`
- Triggers: Browser navigation
- Responsibilities: Mounts all global providers (Clerk+Convex auth, themes, i18n, nuqs, toast), renders `AppSidebar` + `AuthRouteGate`

**Convex HTTP Router:**
- Location: `convex/http.ts`
- Triggers: External webhook POST requests
- Responsibilities: Routes `/webhooks/clerk`, `/webhooks/stripe`, `/api/zotero/callback`

**Convex Cron Jobs:**
- Location: `convex/crons.ts`
- Triggers: Scheduled by Convex runtime
- Responsibilities: Cleanup deleted users, check subscription status, monitor failed Stripe events, reconcile Stripe invoices, cleanup expired Zotero OAuth tokens

**Extraction Workflow:**
- Location: `convex/extraction/workflow.ts` (`runExtractionWorkflow`)
- Triggers: `workflow.start()` called from `convex/extraction/mutations.ts`
- Responsibilities: Orchestrates the full paper-fetch → PDF-download → RAG-index → AI-extract pipeline

## Error Handling

**Strategy:** Typed `ConvexError` with structured error codes; client interprets codes to show appropriate UI

**Patterns:**
- All Convex errors created via `createError(code, message)` from `convex/lib/errors.ts`
- `ErrorCode` union type covers ~40 distinct error categories (auth, billing, AI, Zotero, etc.)
- Client-side: toast messages routed by error code via `lib/toast/` module
- Extraction workflow: per-paper failures tracked in `extractionPapers.status` and `errorMessage` fields; job continues processing remaining papers

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` with structured prefixes (e.g., `[Workflow]`, `[StripeWebhook]`, `[Auth]`). No structured logging framework.

**Validation:** Convex validator system (`v.string()`, `v.union()`, etc.) in schema + function args. Extraction input validated via `searchFiltersValidator` in `convex/extraction/validators.ts`.

**Authentication:** All Convex mutations/queries requiring auth call `requireAuth(ctx)` from `convex/lib/auth.ts`. Returns typed `Doc<"users">` or throws `ConvexError("UNAUTHENTICATED")`. Actions use `requireActionAuth(ctx)` which returns identity only (no DB access in actions).

**Feature Flags:** Environment variable checks in `convex/lib/featureFlags.ts` (`requireCreditsEnabled`, `requireSubscriptionsEnabled`, etc.). Checked at function entry, throw hard errors if feature disabled.

**Idempotency:** Stripe webhook handlers are explicitly designed idempotent. Each handler documents its dedup gate. `stripeEventLogs` table records all events; `onEvent` callback runs before handler logic.

---

*Architecture analysis: 2026-03-03*
