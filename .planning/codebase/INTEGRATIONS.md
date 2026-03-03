# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**Academic Research Data:**
- OpenAlex - Free academic paper search API; no auth required
  - SDK/Client: `@sickrin/openalex-sdk ^1.0.0`
  - Client instantiation: `lib/openalex.ts`
  - Polite pool: `OPENALEX_CONTACT_EMAIL` env var sent in requests

**AI / LLM Providers (server-side, platform-paid):**
- DeepSeek - Default server provider; model `deepseek-chat`
  - SDK: `@ai-sdk/deepseek ^2.0.15`
  - Auth: AI provider API key stored as Convex env var
- OpenAI - Alternative server provider; also BYOK
  - SDK: `@ai-sdk/openai ^3.0.23`
- Anthropic (Claude) - Alternative server provider; also BYOK
  - SDK: `@ai-sdk/anthropic ^3.0.31`
- Google Gemini - Alternative server provider; also BYOK
  - SDK: `@ai-sdk/google ^3.0.18`
- Azure OpenAI - Alternative server provider
  - SDK: `@ai-sdk/azure ^3.0.26`
- OpenRouter - Aggregator for multiple LLM providers; also BYOK
  - SDK: `@openrouter/ai-sdk-provider ^6.0.0-alpha.1`
  - Config: `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS` env vars

**AI / LLM Providers (BYOK - user-supplied keys):**
- Users can store encrypted API keys for: `openai`, `anthropic`, `google`, `openrouter`
- Keys stored encrypted in `apiKeys` Convex table (`convex/schema.ts`)
- Encryption: `ENCRYPTION_KEY` Convex env var; implementation in `convex/lib/crypto.ts`
- Key prefix stored for display (first few chars, e.g. `sk-xxxx...`)

**Reference Management:**
- Zotero - OAuth 1.0a integration for importing user's research library
  - OAuth endpoints: `https://www.zotero.org/oauth/request`, `/oauth/access`, `/oauth/authorize`
  - API: `https://api.zotero.org`
  - Auth: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` Convex env vars
  - OAuth callback: `POST /api/zotero/callback` handled in `convex/http.ts`
  - Connection stored encrypted in `zoteroConnections` Convex table
  - Temp OAuth tokens in `zoteroOAuthTokens` table (TTL-based cleanup via cron)

**PDF Structure Extraction:**
- GROBID - Self-hosted academic PDF parser (TEI XML output)
  - URL: `GROBID_URL` env var (default: `http://localhost:8070`)
  - Timeout: `GROBID_TIMEOUT_MS` env var (default: 45000ms)
  - Implementation: `convex/extraction/grobid.ts`
  - Used for extracting structured text blocks from research paper PDFs

## Data Storage

**Databases:**
- Convex Database - Primary database; all application data
  - Connection: `NEXT_PUBLIC_CONVEX_URL` (frontend), `CONVEX_CLOUD_URL` (server-side)
  - Client: Convex SDK (`convex` package); queries/mutations/actions defined in `convex/` directory
  - Schema: `convex/schema.ts`
  - Tables: `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, `stripeEventLogs`, `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`, `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionRunDiffs`, `libraryItems`, `collections`, `libraryItemCollections`

**File Storage:**
- Convex File Storage - PDF files uploaded for extraction jobs stored in Convex's built-in `_storage`
  - Referenced via `storageId: v.id("_storage")` in `extractionPapers` and `extractionJobs` tables

**Caching:**
- None (no Redis or external cache); Convex provides real-time reactive queries

**Rate Limiting:**
- `convex-helpers` `rateLimitTables` - In-database rate limiting (table names from `convex-helpers/server/rateLimit`); imported into schema in `convex/schema.ts`

## Authentication & Identity

**Auth Provider:**
- Clerk - Full authentication provider
  - Next.js SDK: `@clerk/nextjs ^6.38.2`
  - Backend SDK: `@clerk/backend ^2.32.1` (dev dependency for testing)
  - Auth config: `convex/auth.config.ts` uses `CLERK_JWT_ISSUER_DOMAIN` for JWT verification
  - Middleware: `proxy.ts` (Next.js middleware) uses `clerkMiddleware` from `@clerk/nextjs/server`
  - User sync: Clerk → Convex via webhook at `POST /webhooks/clerk` (handler: `convex/webhooks/clerk.ts`)
  - Webhook verification: `svix ^1.86.0`; secret: `CLERK_WEBHOOK_SIGNING_SECRET`
  - UI localizations: `@clerk/localizations ^3.37.0`
  - Themes: `@clerk/themes ^2.4.55`
  - Public keys: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - Secret key: `CLERK_SECRET_KEY`
  - Sign-in URL: `NEXT_PUBLIC_CLERK_SIGN_IN_URL` (default: `/sign-in`)
  - Sign-up URL: `NEXT_PUBLIC_CLERK_SIGN_UP_URL` (default: `/sign-up`)

## Monitoring & Observability

**Analytics & Product Monitoring:**
- PostHog EU - User analytics, feature flags, error tracking, AI generation tracking
  - Client SDK: `posthog-js ^1.342.1`
  - Server-side: custom fetch-based implementation (`lib/posthog-server.ts`) to avoid Convex bundling issues
  - Initialization: `instrumentation-client.ts` (Next.js client instrumentation)
  - Proxy: Next.js rewrites in `next.config.ts` proxy `/data/*` → `https://eu.i.posthog.com/*` and `/data/static/*` → EU assets
  - Key: `NEXT_PUBLIC_POSTHOG_KEY`
  - Host: `NEXT_PUBLIC_POSTHOG_HOST` (EU region: `https://eu.i.posthog.com`)
  - GDPR: Cookie-less mode enabled by default; opt-in required
  - AI tracking: `$ai_generation` events captured for all LLM calls via `lib/posthog-server.ts` and `lib/posthog-ai.ts`

**Error Tracking:**
- PostHog Error Tracking - `capture_exceptions: true` in PostHog init (no separate Sentry)

**Logs:**
- `console.log` / `console.error` throughout Convex functions; PM2 aggregates logs in development

## CI/CD & Deployment

**Hosting:**
- Convex Cloud - Backend/database/file storage
- Next.js frontend: hosting platform not hardcoded (Vercel assumed; no deployment config committed)

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml`)
  - `unit-and-build` job: runs `npm run test` + `npm run build` on every PR and push to `main`
  - `e2e-auth` job: runs Playwright auth E2E tests (Chromium only) after unit tests pass
  - `billing-live` job: runs live Stripe billing tests against real Convex deployment on every PR
  - `billing-live-extended` job: extended billing regressions, runs only on push to `main`, non-blocking
- GitHub Actions (`.github/workflows/billing-nightly.yml`) - Nightly billing regression run

**Background Jobs (Convex Crons):**
Defined in `convex/crons.ts`:
- Every 24h: `cleanup deleted users` - purges soft-deleted users after 30 days
- Every 1h: `check subscription status` - corrective Stripe sync + past-due expiry
- Every 1h: `monitor failed stripe events` - flags stale failed Stripe webhook events
- Every 1h: `reconcile stripe paid invoices` - reconciles recent paid Stripe invoices for credit grants
- Every 1h: `cleanup expired zotero oauth tokens` - removes expired OAuth request tokens

## Webhooks & Callbacks

**Incoming:**
- `POST /webhooks/clerk` - Clerk user lifecycle events (create, update, delete); verified via Svix; syncs users to Convex `users` table. Handler: `convex/webhooks/clerk.ts`
- `POST /webhooks/stripe` - Stripe billing events; registered via `@convex-dev/stripe`'s `registerRoutes`; handles: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.{created,updated,deleted}`. Handler: `convex/http.ts`
- `GET /api/zotero/callback` - Zotero OAuth 1.0a callback after user authorization; completes OAuth flow and stores encrypted API key. Handler: `convex/http.ts`

**Outgoing:**
- Stripe API calls from Convex actions (subscription creation, customer lookup, invoice reconciliation via `@convex-dev/stripe`)
- Zotero API calls from `convex/zotero/actions.ts` (item fetching, collection listing)
- OpenAlex API calls from `lib/openalex.ts` via `@sickrin/openalex-sdk`
- PostHog HTTP API from `lib/posthog-server.ts` (AI generation tracking)
- GROBID HTTP calls from `convex/extraction/grobid.ts` (PDF text extraction)

## Environment Configuration

**Required env vars (frontend - `NEXT_PUBLIC_*`):**
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk public key
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` - Auth routing
- `NEXT_PUBLIC_POSTHOG_KEY` - PostHog analytics key
- `NEXT_PUBLIC_POSTHOG_HOST` - PostHog EU host

**Required env vars (Convex backend):**
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk domain for JWT verification
- `CLERK_WEBHOOK_SIGNING_SECRET` - Svix webhook secret
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` - Stripe price IDs per plan
- `STRIPE_CREDITS_PRODUCT_ID` - Stripe product ID for credit top-ups
- `CREDITS_PER_USD` - Credit grant rate
- `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` - Zotero OAuth app credentials
- `ENCRYPTION_KEY` - AES encryption key for stored API keys and Zotero tokens
- `AI_PROVIDER`, `AI_MODEL` - Server-side LLM provider and model selection

**Optional env vars (Convex backend):**
- `GROBID_URL`, `GROBID_TIMEOUT_MS` - GROBID service location
- `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS` - OpenRouter routing config
- `OPENALEX_CONTACT_EMAIL` - Polite pool identifier for OpenAlex
- `POSTHOG_KEY`, `POSTHOG_HOST` - Server-side PostHog for AI tracking
- `ENABLE_PUBLIC_DEBUG_FUNCTIONS` - Enables debug endpoints (dev only)
- `NEXT_PUBLIC_CONVEX_SITE_URL` - Public Convex site URL for OAuth callbacks

**Secrets location:**
- Local development: `.env.local` (not committed); synced to Convex via `./sync-env.sh`
- CI: GitHub Actions secrets
- Production: Convex environment variables (set via `npx convex env set`)

---

*Integration audit: 2026-03-03*
