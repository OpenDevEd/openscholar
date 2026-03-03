# External Integrations

**Analysis Date:** 2026-03-03

## APIs & External Services

**Academic Search:**
- OpenAlex - Free open-access academic paper search API
  - SDK/Client: `@sickrin/openalex-sdk` (`lib/openalex.ts`)
  - Auth: None (public API, contact email in User-Agent via `OPENALEX_CONTACT_EMAIL`)
  - Proxy route: `app/api/openalex/search/`
  - Used for: paper search, citation lookups, related paper discovery

**PDF Processing:**
- GROBID - Open-source PDF text extraction and structuring service
  - Client: Direct HTTP (`convex/extraction/grobid.ts`)
  - Auth: None (self-hosted)
  - URL: `GROBID_URL` env var (default `http://localhost:8070`; Docker: `http://grobid:8070`)
  - Used for: parsing academic PDFs into structured text blocks for RAG indexing

**Zotero - Reference Manager:**
- Zotero - Academic reference management and PDF library
  - SDK/Client: Custom OAuth 1.0a implementation (`convex/zotero/actions.ts`)
  - Auth: OAuth 1.0a with HMAC-SHA1 signatures; credentials stored encrypted (`ENCRYPTION_KEY`)
  - Env vars: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`
  - OAuth endpoints: `https://www.zotero.org/oauth/request`, `https://www.zotero.org/oauth/authorize`, `https://www.zotero.org/oauth/access`
  - API base: `https://api.zotero.org`
  - Callback: Convex HTTP action at `/api/zotero/callback` (`convex/http.ts`)
  - Used for: importing paper libraries and fetching PDF attachments for extraction

## AI Providers (Multi-Provider Architecture)

All AI calls go through Vercel AI SDK (`ai` package). Provider selection is controlled by:
- Server-side: `AI_PROVIDER` + `AI_MODEL` env vars (default: DeepSeek `deepseek-chat`)
- Client/BYOK: User-supplied API keys stored encrypted in `apiKeys` Convex table

Provider routing implemented in `lib/ai/client/providers.ts`.

**Supported Providers:**
- **OpenAI** - GPT-4o, GPT-5.x, o-series reasoning models
  - SDK: `@ai-sdk/openai`
  - Auth: `OPENAI_API_KEY` (server) or user BYOK stored encrypted in Convex
- **Anthropic** - Claude 3.x, 4.x models
  - SDK: `@ai-sdk/anthropic`
  - Auth: `ANTHROPIC_API_KEY` (server) or user BYOK
- **Google** - Gemini 2.x, 2.5, 3.x models
  - SDK: `@ai-sdk/google`
  - Auth: `GOOGLE_API_KEY` (server) or user BYOK
- **DeepSeek** - DeepSeek Chat, DeepSeek Coder (default server provider)
  - SDK: `@ai-sdk/deepseek`
  - Auth: `DEEPSEEK_API_KEY` (server)
- **Azure OpenAI** - Azure-hosted OpenAI models
  - SDK: `@ai-sdk/azure`
  - Auth: Azure API key
- **Cohere** - Cohere models
  - SDK: `@ai-sdk/cohere`
- **OpenRouter** - Multi-model gateway (hundreds of models)
  - SDK: `@openrouter/ai-sdk-provider`
  - Auth: User BYOK or server key
  - Config: `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`
- **Ollama** - Local self-hosted models
  - SDK: `ollama`, `ollama-ai-provider-v2`
  - Auth: None (local)

## Data Storage

**Databases:**
- Convex Database (managed, built-in)
  - Connection: `NEXT_PUBLIC_CONVEX_URL`
  - Client: Convex SDK (`convex` npm package)
  - Schema: `convex/schema.ts`
  - Tables: users, credits, creditTransactions, subscriptions, billingCustomers, stripeEventLogs, apiKeys, zoteroConnections, zoteroOAuthTokens, extractionJobs, extractionPapers, extractionQuestions, extractionResults, extractionResultReviews, extractionEvidenceUnits, extractionSavedViews, extractionWorkflowTemplates, extractionReportSnapshots, extractionRunDiffs, libraryItems, collections, libraryItemCollections

**File Storage:**
- Convex File Storage (built-in `_storage`) - PDF files uploaded for extraction
  - Referenced via `storageId: v.id("_storage")` in `extractionPapers` and `sourceManualItems`

**Caching:**
- None (SWR used client-side for stale-while-revalidate patterns, not a separate cache store)

**RAG Vector Store:**
- `@convex-dev/rag` component - Hybrid dense+lexical retrieval for PDF content
  - Stores indexed PDF chunks within Convex
  - Used by extraction workflow for evidence retrieval

## Authentication & Identity

**Auth Provider:**
- Clerk (primary identity provider)
  - SDK: `@clerk/nextjs ^6.38.2`, `@clerk/themes`, `@clerk/localizations`
  - Env vars: `CLERK_JWT_ISSUER_DOMAIN` (Convex JWT auth), `CLERK_WEBHOOK_SIGNING_SECRET` (webhooks)
  - Implementation: `ConvexClientProvider` wraps `ClerkProvider`; Convex uses JWT from Clerk for auth
  - Webhook: `/webhooks/clerk` Convex HTTP route syncs Clerk user events to `users` table (`convex/webhooks/clerk.ts`)
  - User sync: Clerk events → `clerkWebhook` → `users` table in Convex
  - Sign-in/sign-up pages: `app/auth/signin/`, `app/sign-in/`, `app/sign-up/`

**BYOK API Key Encryption:**
- User-supplied AI provider keys stored in `apiKeys` table as AES-encrypted values
  - Encryption key: `ENCRYPTION_KEY` env var
  - Implementation: `convex/lib/crypto.ts` (encrypt/decrypt/getKeyPrefix)

## Monitoring & Observability

**Product Analytics:**
- PostHog (EU instance)
  - SDK: `posthog-js ^1.342.1` (client-side)
  - Server-side: Custom fetch-based capture (`lib/posthog-server.ts`) to avoid Node.js bundling issues in Convex
  - Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`
  - Proxy: Next.js rewrites `/data/*` → `https://eu.i.posthog.com/*` (adblocker bypass, `next.config.ts`)
  - Tracks: AI generation events (`$ai_generation`), search events, user actions

**Error Tracking:**
- None detected (no Sentry or similar)

**Logs:**
- Console logging via `console.log`/`console.error` in Convex functions
- PM2 process logs in development

## CI/CD & Deployment

**Hosting:**
- Next.js frontend: Vercel or self-hosted (not explicitly configured, inferred from Next.js usage)
- Convex backend: Convex cloud (managed)
- GROBID: Self-hosted Docker container

**CI Pipeline:**
- `npm run test:ci` - Runs unit tests + build + e2e auth tests
- Playwright tests: `e2e/` directory, `playwright.config.ts`
- Live billing tests: `tests/live-billing/` (separate config `vitest.live.config.ts`, optional CI flag `BILLING_LIVE_PUSH_CONVEX`)

**Process Management (dev):**
- PM2 with `ecosystem.config.js` - runs `next dev` (Turbopack) and `convex dev` in parallel

## Environment Configuration

**Required env vars (production):**
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NEXT_PUBLIC_CONVEX_SITE_URL` - Convex site URL for HTTP actions
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT issuer for Convex
- `CLERK_WEBHOOK_SIGNING_SECRET` - Svix-verified Clerk webhook secret
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_CREDITS_PRODUCT_ID` - Stripe product for credit purchases
- `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` - Subscription plan price IDs
- `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` - Zotero OAuth app credentials
- `ENCRYPTION_KEY` - Symmetric key for encrypting API keys at rest
- `AI_PROVIDER`, `AI_MODEL` - Default server AI provider/model
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` - PostHog analytics
- `GROBID_URL` - GROBID service endpoint
- `NEXT_PUBLIC_APP_URL` - Frontend app URL (used by Convex for redirects)

**Secrets location:**
- `.env.local` (local development, not committed)
- Synced to Convex env via `./sync-env.sh` (`npx convex env set`)

## Webhooks & Callbacks

**Incoming webhooks (Convex HTTP routes, `convex/http.ts`):**
- `POST /webhooks/clerk` - Clerk user lifecycle events (create, update, delete) → syncs to `users` table
- `POST /webhooks/stripe` - Stripe billing events (registered via `@convex-dev/stripe`)
  - Handles: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created/updated/deleted`
  - All handlers are idempotent with dedup gates

**Incoming callbacks:**
- `GET /api/zotero/callback` - Zotero OAuth 1.0a callback after user authorization

**Outgoing (Convex cron jobs, `convex/crons.ts`):**
- Hourly: Reconcile paid Stripe invoices → `credits.actions.reconcileRecentPaidInvoicesFromStripe`
- Hourly: Check subscription status (corrective sync + past-due expiry)
- Hourly: Monitor failed Stripe events
- Hourly: Cleanup expired Zotero OAuth tokens
- Daily: Cleanup soft-deleted users (after 30-day grace period)

---

*Integration audit: 2026-03-03*
