# Architecture

**Analysis Date:** 2026-04-14

## Pattern Overview

**Overall:** Next.js 16 App Router frontend + Convex backend-as-a-service (reactive serverless functions), with a thin Next.js API/Server Actions layer for direct OpenAlex calls. Identity is delegated to Clerk, payments to Stripe (via `@convex-dev/stripe`). Long-running AI pipelines run as durable Convex workflows + workpools.

**Key Characteristics:**
- **Dual-runtime** — Next.js handles routing, SSR shells, and public OpenAlex proxying; Convex owns all authenticated data, AI orchestration, billing, and webhooks.
- **Reactive data layer** — Clients consume Convex queries via `useQuery`/`useProtectedQuery`; mutations and actions flow through `api`/`internal` refs generated into `convex/_generated/api.ts`.
- **URL as source of truth for search** — `nuqs` parsers in `lib/search-params/parsers.ts` drive SWR fetches; Zustand only mirrors for history persistence.
- **Durable workflows** — Extraction and screening run as `@convex-dev/workflow` pipelines backed by `@convex-dev/workpool` (`convex/workpool.ts`) with retry + parallelism caps.
- **Fully internationalized** — `next-intl` with 6 locales, locale cookie set by the root proxy (`proxy.ts`).
- **OpenAI-compatible wallet gateway** — `convex/wallet/gateway/handler.ts` exposes `/api/wallet/v1/chat/completions` for third parties using an API key backed by user credits.

## Layers

**Next.js App (UI + Public API):**
- Purpose: Render UI, read URL state, proxy public OpenAlex searches, expose server actions and edge middleware.
- Location: `app/`, `components/`, `hooks/`, `i18n/`, `proxy.ts`, `next.config.ts`
- Contains: RSC page files, client components, server actions, one Next.js route handler, i18n request config.
- Depends on: `lib/`, `convex/_generated/api`, Clerk, next-intl, nuqs, SWR, Convex React client.
- Used by: Browser.

**Shared Client Lib:**
- Purpose: Reusable client/server utilities — types, Zustand stores, AI client router, SWR hooks, filter builders, toast system, download/export helpers, PostHog wrappers.
- Location: `lib/`
- Contains: `lib/store.ts` (Zustand), `lib/search/` (SWR provider), `lib/ai/client/`, `lib/ai/core/`, `lib/ai/server/providers.ts`, `lib/types/`, `lib/filters/`, `lib/search-params/`, `lib/toast/`, `lib/auth/`, `lib/feature-flags/`, `lib/extraction/`, `lib/hooks/`, `lib/openalex.ts`.
- Depends on: `@sickrin/openalex-sdk`, `ai` SDK, Clerk client hooks, nuqs, zod, date-fns.
- Used by: `app/`, `components/`, some `convex/` modules that share `lib/ai/core/` schemas and `lib/pdf/download.ts`.

**Convex Backend:**
- Purpose: Authoritative data store, auth-aware queries/mutations/actions, durable workflows, HTTP webhooks, rate limiting, scheduled crons, feature flag gating.
- Location: `convex/`
- Contains: `schema.ts` (all tables + indexes), `http.ts` (Stripe + wallet + OAuth routes), `crons.ts`, per-domain folders (`wallet/`, `credits/`, `subscriptions/`, `extraction/`, `screening/`, `library/`, `zotero/`, `models/`, `users/`, `featureFlags/`, `apiKeys/`, `maintenance/`), shared helpers in `convex/lib/`, generated API in `convex/_generated/`.
- Depends on: Convex components `@convex-dev/stripe`, `@convex-dev/rag`, `@convex-dev/workflow`, `@convex-dev/workpool` (wired in `convex/convex.config.ts`), `convex-helpers` (rate limiting), `ai` SDK providers, `openai`, `zod`.
- Used by: `app/` via generated `api` + Clerk-authenticated `ConvexProviderWithClerk`; external AI clients via wallet HTTP gateway.

**Integration Edge:**
- Purpose: Receive webhooks and OAuth callbacks, register CORS routes.
- Location: `convex/http.ts`, `convex/webhooks/clerk.ts`, `convex/zotero/actions.ts`
- Endpoints: Clerk user sync (`POST /webhooks/clerk`), Stripe events (`POST /webhooks/stripe`, wired by `registerRoutes` from `@convex-dev/stripe`), Zotero OAuth callback (`GET /api/zotero/callback`), OpenAI-compatible wallet routes (`POST /api/wallet/v1/chat/completions`, `GET /api/wallet/v1/models`, `GET /api/wallet/balance`).
- Depends on: Stripe webhook signing, Svix for Clerk signature, encrypted API key store (`convex/apiKeys/`).
- Used by: Stripe, Clerk, Zotero, external consumers of the wallet API.

## Data Flow

**Interactive search flow (most common):**

1. User types into `components/home/SearchInput.tsx` (rendered inside `components/PageContent.tsx`). Query lives in `useCurrentQueryStore` from `lib/store.ts`.
2. On submit, `lib/search/actions.ts` → `submitNewSearch` builds filters via `useCreateSearchFilters` (`lib/hooks.ts`) and returns a URL. `app/page.tsx` routes to `/results/[searchId]` using Next.js `router.push`.
3. `app/results/layout.tsx` → `results-client-layout.tsx` wraps children with `<SearchInitializer>` + `<SearchProvider>` (`lib/search/provider.tsx`).
4. `SearchProvider` reads URL params via `useQueryStates(searchParamsParsers, ...)` from `lib/search-params/parsers.ts`, builds a stable SWR key, and calls `getSearchResultsWithFilters` (`lib/search-utils.ts`) — which delegates to the `"use server"` action in `app/actions/openalex.ts` using the singleton client in `lib/openalex.ts` (`@sickrin/openalex-sdk`).
5. PostHog events are captured via `lib/posthog-search.ts` on success/failure.
6. `components/results-page-content.tsx` consumes `useSearch()` and renders results through `components/results-list.tsx`.

**Extraction pipeline (durable workflow):**

1. `components/extraction/job-creator.tsx` → Convex mutation `api.extraction.mutations.createJob` writes to `extractionJobs`/`extractionQuestions`.
2. Mutation schedules the workflow with `workflow.start(internal.extraction.workflow.runExtractionWorkflow, ...)` where `workflow` is the `WorkflowManager` from `convex/workflow.ts`.
3. `convex/extraction/workflow.ts#runExtractionWorkflow` runs as a durable `step.*` pipeline: fetches papers from OpenAlex (`internal.extraction.actions.fetchPapersFromHistory`), dedupes via `convex/extraction/dedupe.ts#buildDedupeKey`, inserts paper records, then enqueues each paper onto the PDF `pdfProcessingPool` (`convex/workpool.ts`).
4. `convex/extraction/workpoolActions.ts` runs Node actions (`"use node"`): `downloadPdf` (`lib/pdf/download.ts`), `extractPdfJsTextPages`, RAG indexing via `@convex-dev/rag`, answer generation via `ai` SDK with provider clients from `lib/ai/server/providers.ts`.
5. Results write back to `extractionResults`, `extractionEvidenceUnits`, and `extractionResultReviews`; the frontend subscribes via `useProtectedQuery(api.extraction.queries.getJobInternal, …)` for live progress.

**Billing + credits:**

1. Stripe webhooks hit `convex/http.ts` via `registerRoutes` from `@convex-dev/stripe`.
2. Each event is wrapped by `runAuditedStripeHandler` (`convex/lib/stripeWebhookHandlers.ts`) which writes to `stripeEventLogs` for idempotency.
3. Successful events call into `convex/credits/` (e.g., `internal.credits.internal.grantPurchasedCreditsFromPaymentIntent`) or `convex/subscriptions/` to mutate `credits`, `creditTransactions`, and `subscriptions` tables.
4. Hourly crons in `convex/crons.ts` reconcile paid invoices and check subscription status.
5. Client reads balances via `api.credits.queries.getBalance` subscribed through the Convex reactive client.

**Wallet API gateway (outbound AI proxy):**

1. External client calls `POST /api/wallet/v1/chat/completions` with `Authorization: Bearer <walletKey>`.
2. `convex/wallet/gateway/handler.ts#handleChatCompletions` validates the key via `internal.wallet.nodeActions.validateKey` (hashed lookup on `walletKeys`).
3. Request parsed with `parseRequest.ts`, forwarded to the relevant AI SDK provider using `lib/ai/server/providers.ts#getProviderModel`, and streamed back as SSE.
4. `cost.ts` computes usage + credits; `withUserCreditsBatch` deducts from `credits`/`creditTransactions`.
5. CORS is managed by `corsHeaders`/`handleCors` and the per-method `http.route` entries.

**State Management:**
- URL (`nuqs`) is the source of truth for search filters, pagination, and sorts — see `lib/search-params/parsers.ts` and `lib/search/provider.tsx`.
- `lib/store.ts` (Zustand + `persist`) holds: ratings, search history, UI toggles, focus-mode settings, keyword expansion bookmarks, current query, AI config, sidebar dimensions.
- Convex provides live server state via `useProtectedQuery` (`lib/auth/use-auth-query.ts`) which gates queries until `useAuthReadiness().canRunProtectedQueries` is true.
- Feature flags preloaded via `preloadQuery(api.featureFlags.queries.getAll)` in `app/layout.tsx` and exposed through `lib/feature-flags/provider.tsx`.

## Key Abstractions

**`SearchProvider` (React context + SWR):**
- Purpose: Single source for all results-page search state (URL ↔ SWR ↔ Zustand history mirror).
- Examples: `lib/search/provider.tsx`, `lib/search/types.ts`, `lib/search/initializer.tsx`
- Pattern: Context provider wrapping a single SWR instance; URL changes drive refetches; setters update URL and opportunistically sync to Zustand for history persistence.

**Convex function layering per domain:**
- Purpose: Split public-facing queries/mutations from `"use node"` actions and internal helpers.
- Examples: `convex/extraction/queries.ts`, `convex/extraction/mutations.ts`, `convex/extraction/actions.ts`, `convex/extraction/workpoolActions.ts`, `convex/extraction/workflow.ts`
- Pattern: Every major domain has `queries.ts`, `mutations.ts`, `actions.ts`, and for long-running work a `workflow.ts` + `workpoolActions.ts`. Shared policy/helper logic lives in domain-local `lib/` subfolders (e.g., `convex/credits/lib/`, `convex/subscriptions/lib/`).

**Workflow + Workpool:**
- Purpose: Durable, retry-safe execution for PDF processing and bulk screening.
- Examples: `convex/workflow.ts` (`WorkflowManager`, 10-way parallelism), `convex/workpool.ts` (`pdfProcessingPool` 3-way, `screeningPool` 5-way)
- Pattern: Workflows orchestrate steps (`step.runQuery`, `step.runAction`); workpools process fan-out work units with independent retry budgets; cross-pool cancellation is avoided by keeping extraction and screening in separate pools.

**Wallet gateway:**
- Purpose: OpenAI-compatible relay so other apps (registered origins) consume credits through a single endpoint.
- Examples: `convex/wallet/gateway/handler.ts`, `convex/wallet/gateway/parseRequest.ts`, `convex/wallet/gateway/formatResponse.ts`, `convex/wallet/gateway/cost.ts`, `convex/wallet/gateway/reasoning.ts`, `convex/wallet/nodeActions.ts`
- Pattern: `httpAction` handlers in `convex/http.ts` route directly to pure functions; cost accounting and credit deduction happen in a single transactional helper.

**Error envelopes:**
- Purpose: Unified error codes across Convex + UI.
- Examples: `convex/lib/errors.ts` (`ErrorCode` union, `createError`), `lib/toast/error-resolver.ts`, `lib/toast/action-routing.ts`
- Pattern: Backend throws `ConvexError<{ code, message }>`; `lib/toast/` resolves codes into localized messages and optional actions (e.g. "Upgrade plan").

**Feature flags:**
- Purpose: DB-driven feature gates with tier gating.
- Examples: `convex/featureFlags/queries.ts`, `convex/featureFlags/guard.ts`, `lib/feature-flags/registry.ts`, `lib/feature-flags/provider.tsx`, `lib/feature-flags/hook.ts`
- Pattern: Flags preloaded in root layout, resolved in provider context, consumed via `useFeatureFlag("flag_key")`, enforced server-side in `convex/featureFlags/guard.ts`.

## Entry Points

**Next.js Root Layout:**
- Location: `app/layout.tsx`
- Triggers: Every page request.
- Responsibilities: Load locale + messages, preload feature flags via `preloadQuery`, wire providers — `ThemeProvider`, `ConvexClientProvider` (which nests `ClerkProvider` + `ConvexProviderWithClerk` + `FeatureFlagProvider`), `ConfigProvider`, `NuqsAdapter`, `QuerySyncProvider`, `TooltipProvider`, mount `AppSidebar` + `MobileNavbar`, `AuthRouteGate`, `Toaster`, `ConfirmationHost`, `CookieConsentBanner`, and `ConsentAwareGoogleAnalytics`.

**Home page:**
- Location: `app/page.tsx` → `components/PageContent.tsx`
- Triggers: `/` visit.
- Responsibilities: Render hero + `SearchInput`, detect search mode, optionally call `useEnhanceSearchQuery()` for AI expansion, submit to `/results/[searchId]`.

**Results pages:**
- Location: `app/results/layout.tsx` → `app/results/results-client-layout.tsx` (wraps with `SearchInitializer` + `SearchProvider`); `app/results/[searchId]/page.tsx` renders `components/results-page-content.tsx`.
- Triggers: `/results`, `/results/[searchId]`, `/results/[searchId]/history`.
- Responsibilities: Parse URL params, fetch OpenAlex results via the `"use server"` action in `app/actions/openalex.ts`, render list + sidebar filters.

**Extraction pages:**
- Location: `app/extraction/page.tsx`, `app/extraction/new/page.tsx`, `app/extraction/[jobId]/page.tsx`
- Triggers: Authenticated navigation to `/extraction*`.
- Responsibilities: List jobs via `api.extraction.queries.getMyJobs`, create new jobs through `job-creator.tsx`, stream job detail/status + results/citations/review queue.

**Wallet connect consent:**
- Location: `app/connect/page.tsx`
- Triggers: External client redirect for wallet key issuance.
- Responsibilities: OAuth-style consent screen, creates `walletKeys` row against the calling origin (matched against `walletAllowedOrigins`).

**Settings surface:**
- Location: `app/settings/page.tsx`, `app/settings/ai/page.tsx`, `app/settings/billing/page.tsx`, `app/settings/connections/page.tsx`
- Triggers: `/settings*`.
- Responsibilities: Manage Zotero connection, AI provider + BYOK keys, subscription/credits, account preferences.

**Server action (public OpenAlex proxy):**
- Location: `app/actions/openalex.ts` (`"use server"`)
- Triggers: Called from the client SWR fetcher.
- Responsibilities: Wrap the OpenAlex SDK, no auth required.

**Next.js route handler:**
- Location: `app/api/openalex/search/route.ts`
- Triggers: `GET /api/openalex/search`.
- Responsibilities: Unauthenticated OpenAlex search passthrough (listed in `PUBLIC_UNAUTHENTICATED_PATHS`), used for lightweight lookups.

**Proxy/middleware:**
- Location: `proxy.ts` (custom `proxy` export named via `next.config`)
- Triggers: All non-static requests per the `matcher` in `proxy.ts`.
- Responsibilities: Run `clerkMiddleware` protecting non-public paths via `lib/auth/proxy-policy.ts#shouldProtectPath`, detect locale from `Accept-Language` via `i18n/locale-detection.ts`, and set the `NEXT_LOCALE` cookie when missing.

**Convex HTTP router:**
- Location: `convex/http.ts`
- Triggers: External HTTP → Convex deployment.
- Responsibilities: Register Clerk webhook, Stripe webhooks via `registerRoutes`, Zotero OAuth callback, and OpenAI-compatible wallet routes.

**Convex crons:**
- Location: `convex/crons.ts`
- Triggers: Scheduled.
- Responsibilities: Cleanup soft-deleted users, check subscription status, monitor failed Stripe events, reconcile paid invoices, cleanup expired Zotero tokens, sync OpenRouter models, validate env vars.

## Error Handling

**Strategy:** Typed error codes originate in Convex (`convex/lib/errors.ts#createError`), are propagated as `ConvexError<{code,message}>`, caught in client action/query hooks, then routed through `lib/toast/` which resolves the code to a localized message and optional actions (upgrade/redirect).

**Patterns:**
- Backend: `throw createError("CODE", "message")` — never throw raw errors from queries/mutations/actions.
- Client: Convex hooks surface errors to SWR/React state; `useAppToast()` (`lib/toast/use-app-toast.ts`) wraps `toast.search.failed`, `toast.ai.failed`, `toast.zotero.failed` with translated messages and action callbacks.
- Next.js boundaries: `app/error.tsx`, `app/global-error.tsx`, per-route `app/extraction/error.tsx`, plus `app/not-found.tsx` — all rendered with motion-aware skeletons.
- Idempotency contracts for Stripe: each webhook in `convex/http.ts` documents its own idempotency contract above the handler; dedup gates use `stripeInvoiceId` / `stripeEventId` / `stripePaymentIntentId`.
- SWR: `errorRetryCount: 2, errorRetryInterval: 1000`, with PostHog failure tracking (`captureSearchFailed`).
- Workflow: `@convex-dev/workflow` uses `retryActionsByDefault: true, maxAttempts: 3, initialBackoffMs: 1000, base: 2` (`convex/workflow.ts`).

## Cross-Cutting Concerns

**Logging:**
- Server: `console.log`/`console.error` within Convex functions (e.g., `[Workflow] …`, `[StripeWebhook] …`, `[Auth] …`).
- Client: `console.error` + PostHog (`lib/posthog-search.ts`, `lib/posthog-ai.ts`, `lib/posthog-server.ts`, `lib/posthog-ai-shared.ts`) for analytics and error capture.
- Audit: `convex/lib/audit.ts` + `stripeEventLogs` table + `auditLogs` table.

**Validation:**
- Convex validators (`v` from `convex/values`) on every mutation/query — see `convex/extraction/validators.ts`, `convex/screening/validators.ts`, `convex/schema.ts`.
- Zod schemas for AI tool outputs in `lib/ai/core/schemas.ts` and `lib/ai/core/validate.ts`.
- Client filter validation in `lib/keyword-validation.ts`, `lib/filters/filter-builder.ts`.
- i18n message coverage tests in `tests/extraction-i18n-coverage.test.ts`.

**Authentication:**
- Clerk is the identity provider (`@clerk/nextjs`), wrapped by `ConvexProviderWithClerk` in `components/providers/convex-provider.tsx`.
- `convex/auth.config.ts` registers the Clerk issuer.
- `convex/lib/auth.ts` exposes `getCurrentUser`, `requireAuth`, `getOrCreateUserFromIdentity`, `requireActionAuth`.
- Users are mirrored into the `users` table; `AuthRouteGate` + `useAuthReadiness` block UI until `ensureUser` mutation completes.
- Route protection: `proxy.ts` calls `auth.protect()` for non-public paths defined in `lib/auth/public-routes.ts`.

**Authorization / Feature Gating:**
- Plans modeled in `subscriptions` (free/go/pro/enterprise); entitlements computed in `lib/billing/entitlements.ts` + `lib/credits/feature-flags.ts`.
- Feature flag tier gating in `convex/featureFlags/guard.ts` via `minimumTier`.
- Wallet keys gated by `walletAllowedOrigins`; BYOK keys encrypted via `convex/lib/crypto.ts`.

**Rate Limiting:**
- `convex-helpers` rate-limit tables merged into `convex/schema.ts` (`...rateLimitTables`), policy in `convex/lib/rateLimit.ts`.

**Internationalization:**
- `next-intl` with locales `en-US`, `en-GB`, `zh`, `fr`, `hi`, `ja` (`i18n/config.ts`).
- Request config at `i18n/request.ts` reads cookie or `Accept-Language`.
- Translation bundles in `messages/*.json`.
- Clerk localization resolved in `lib/auth/clerk-ui-config.ts`.

**Theming:**
- `next-themes` via `components/theme-provider.tsx`, OKLCH design tokens in `app/globals.css`, toggle in `components/theme-toggle.tsx`.

**Analytics & Consent:**
- PostHog proxied via Next.js rewrites in `next.config.ts` (`/data/:path*` → `eu.i.posthog.com`).
- Consent managed by `components/cookie-consent-banner.tsx` + `lib/consent-storage.ts`; `ConsentAwareGoogleAnalytics` gates GA.
- Instrumentation at `instrumentation-client.ts`.

**Security headers:**
- `next.config.ts` sets `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS, `Permissions-Policy`, `X-DNS-Prefetch-Control` on all responses.

---

*Architecture analysis: 2026-04-14*
