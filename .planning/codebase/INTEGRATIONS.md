# External Integrations

**Analysis Date:** 2026-03-02

## APIs & External Services

**Academic Data:**
- OpenAlex - Academic paper search and metadata (free, no auth)
  - SDK/Client: `@sickrin/openalex-sdk` ^1.0.0
  - Client instantiation: `lib/openalex.ts` (no API key; unauthenticated public API)
  - Used via Next.js API route: `app/api/openalex/search/route.ts`

**AI Providers (server-side via Convex):**
- DeepSeek - Default server AI provider (`AI_PROVIDER=deepseek`, `AI_MODEL=deepseek-chat`)
  - SDK: `@ai-sdk/deepseek`
  - Auth: env var (resolved per-request in `convex/ai/config.ts` and `lib/ai/client/providers.ts`)
- OpenAI - Optional server AI provider
  - SDK: `@ai-sdk/openai`
  - Auth: `OPENAI_API_KEY` env var or user BYOK key from `apiKeys` table
- Anthropic - Optional server AI provider
  - SDK: `@ai-sdk/anthropic`
  - Auth: `ANTHROPIC_API_KEY` env var or user BYOK key
- Google Gemini - Optional server AI provider
  - SDK: `@ai-sdk/google`
  - Auth: `GOOGLE_GENERATIVE_AI_API_KEY` env var or user BYOK key
- OpenRouter - Optional server AI provider (multi-model routing)
  - SDK: `@openrouter/ai-sdk-provider`
  - Auth: `OPENROUTER_API_KEY` env var or user BYOK key
  - Config: `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`
- Azure OpenAI - Optional server AI provider
  - SDK: `@ai-sdk/azure`
  - Auth: Azure env vars

**AI BYOK (Bring Your Own Key):**
- Users can store their own API keys for `openai`, `anthropic`, `google`, `openrouter`
- Keys encrypted at rest using `ENCRYPTION_KEY`; stored in `convex/schema.ts` `apiKeys` table
- Key management: `convex/apiKeys/actions.ts`

**Reference Management:**
- Zotero - OAuth 1.0a integration for importing paper libraries
  - API base: `https://api.zotero.org`
  - OAuth endpoints: `https://www.zotero.org/oauth/request`, `.../oauth/access`, `.../oauth/authorize`
  - Auth: OAuth 1.0a; `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` env vars
  - Callback route (Convex HTTP): `/api/zotero/callback` (`convex/http.ts`)
  - Connection stored in `zoteroConnections` table; API key encrypted with `ENCRYPTION_KEY`
  - Implementation: `convex/zotero/actions.ts`

**PDF Parsing:**
- GROBID - Self-hosted ML service for structured PDF text extraction
  - Default URL: `http://localhost:8070` (or `GROBID_URL` env var)
  - Docker alias: `http://grobid:8070`
  - Timeout: `GROBID_TIMEOUT_MS` (default 45000ms)
  - Implementation: `convex/extraction/grobid.ts`
  - Used during extraction job PDF indexing phase

## Data Storage

**Databases:**
- Convex DB (cloud-hosted, serverless, realtime)
  - Connection: `NEXT_PUBLIC_CONVEX_URL` (client), `CONVEX_CLOUD_URL` (server)
  - Schema: `convex/schema.ts`
  - Tables: `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, `stripeEventLogs`, `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`, `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionRunDiffs`, `libraryItems`, `collections`, `libraryItemCollections`
  - Rate limiting tables: included via `convex-helpers/server/rateLimit`

**File Storage:**
- Convex File Storage - PDF files uploaded and stored by Convex `_storage`
  - Referenced by `storageId: v.id("_storage")` in `extractionPapers` and `extractionWorkflowTemplates`
  - Used for PDF download caching during extraction jobs

**RAG Vector Store:**
- Convex RAG Component (`@convex-dev/rag` ^0.7.0)
  - Used for indexing PDFs and hybrid-retrieval (dense + lexical + rerank) during extraction
  - Configured in `convex/convex.config.ts` (`app.use(rag)`)
  - RAG entry IDs tracked in `extractionPapers.ragEntryId`

**Caching:**
- None (no Redis or external cache layer detected)

## Authentication & Identity

**Auth Provider:**
- Clerk (`@clerk/nextjs` ^6.38.2)
  - Middleware: `proxy.ts` (wraps `clerkMiddleware`; protects routes via `lib/auth/proxy-policy.ts`)
  - JWT verification in Convex: `convex/auth.config.ts` uses `CLERK_JWT_ISSUER_DOMAIN`
  - User sync: Clerk webhooks → Convex `webhooks/clerk` → `users` table
  - Webhook verification: `svix` library, `CLERK_WEBHOOK_SIGNING_SECRET` env var
  - Localizations: `@clerk/localizations` ^3.37.0
  - Themes: `@clerk/themes` ^2.4.55
  - Sign-in/sign-up pages: `app/sign-in/`, `app/sign-up/`
  - User data: Convex `users` table is authoritative; synced from Clerk via webhooks

## Monitoring & Observability

**Analytics & Error Tracking:**
- PostHog (EU instance)
  - Client-side: `posthog-js` ^1.342.1; initialised in `instrumentation-client.ts`
  - API proxied through Next.js rewrites: `/data/*` → `https://eu.i.posthog.com/*`, `/data/static/*` → `https://eu-assets.i.posthog.com/static/*`
  - GDPR: cookie-less mode on reject; opt-out capturing by default
  - Error tracking: `capture_exceptions: true`
  - AI generation tracking: `$ai_generation` events from both client (`lib/posthog-ai.ts`) and server (`lib/posthog-server.ts`)
  - Required env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
  - Server-side (Convex actions): uses raw HTTP API via `lib/posthog-server.ts` (avoids Node dependency issues)

**Logs:**
- `console.log` / `console.error` throughout Convex actions and Next.js API routes
- No structured logging framework detected

## CI/CD & Deployment

**Hosting:**
- Next.js app: Vercel or Node.js host (not explicitly declared; Next.js optimized build)
- Convex backend: Convex cloud (managed)

**CI Pipeline:**
- Not explicitly declared in codebase (no GitHub Actions workflow files detected in repo root)
- Test commands configured in `package.json`: `npm run test:ci` runs unit tests + build + E2E auth tests

## Environment Configuration

**Required env vars (application won't function without these):**
- `NEXT_PUBLIC_CONVEX_URL` - Convex backend connection
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk authentication
- `CLERK_SECRET_KEY` - Clerk server-side operations
- `CLERK_JWT_ISSUER_DOMAIN` - Convex ↔ Clerk JWT verification
- `CLERK_WEBHOOK_SIGNING_SECRET` - Clerk webhook validation (`whsec_...` format)
- `STRIPE_SECRET_KEY` - Stripe billing operations
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook validation
- `ENCRYPTION_KEY` - Encrypt/decrypt stored user API keys and Zotero tokens

**Optional but feature-enabling env vars:**
- `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_KEY` - Analytics
- `NEXT_PUBLIC_POSTHOG_HOST` - PostHog host (default: `https://eu.i.posthog.com`)
- `AI_PROVIDER` / `AI_MODEL` - Server AI provider selection (default: `deepseek` / `deepseek-chat`)
- `ZOTERO_CLIENT_KEY` / `ZOTERO_CLIENT_SECRET` - Zotero OAuth
- `GROBID_URL` - GROBID PDF parser URL (default: `http://localhost:8070`)
- `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` - Subscription price IDs
- `STRIPE_CREDITS_PRODUCT_ID` - Credit top-up product
- Feature flags: `NEXT_PUBLIC_CREDITS_ENABLED`, `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`, `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, `NEXT_PUBLIC_EXTRACTION_ENABLED`, `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED`

**Secrets location:**
- `.env.local` (gitignored) for local development
- Convex environment variables set via `convex dev` / Convex dashboard for backend secrets
- `sync-env.sh` script available for syncing env vars

## Webhooks & Callbacks

**Incoming (Convex HTTP router - `convex/http.ts`):**
- `POST /webhooks/clerk` - Clerk user lifecycle events (user.created, user.updated, user.deleted); verified via svix
- `POST /webhooks/stripe` - Stripe billing events; handled by `@convex-dev/stripe` component
  - Events handled: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
  - All handlers are idempotent with dedup gates (documented inline in `convex/http.ts`)
- `GET /api/zotero/callback` - Zotero OAuth 1.0a callback; exchanges request token for access token

**Outgoing:**
- Stripe API calls: subscription management, invoice fetching (from `convex/subscriptions/actions.ts`, `convex/credits/actions.ts`, `convex/maintenance/internal.ts`)
- Zotero API calls: library/collection fetching (`https://api.zotero.org`)
- OpenAlex API calls: academic paper search (unauthenticated)
- GROBID API calls: PDF text extraction (`/api/processFulltextDocument` endpoint)
- PostHog API calls: server-side event capture (`https://eu.i.posthog.com/i/v0/e/`)

## Convex Cron Jobs (`convex/crons.ts`)

- Every 24h: cleanup soft-deleted users (30-day grace period)
- Every 1h: subscription status sync + past-due expiry correction
- Every 1h: monitor failed Stripe events (flag only, no auto-retry)
- Every 1h: reconcile recent paid Stripe invoices (credit grant recovery)

---

*Integration audit: 2026-03-02*
