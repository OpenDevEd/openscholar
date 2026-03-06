# External Integrations

**Analysis Date:** 2026-03-06

## APIs & External Services

**Academic Data:**
- OpenAlex API - Primary source for academic paper metadata (works, authors, institutions, etc.)
  - SDK: `@sickrin/openalex-sdk` ^1.0.0
  - Client: `lib/openalex.ts` (singleton `OpenAlexClient`)
  - Auth: No API key required (public API)

**AI / LLM Providers:**
- Multi-provider AI via Vercel AI SDK (`ai` ^6.0.62)
  - Provider selection: `lib/ai/server/providers.ts` (`getProviderModel()`)
  - Server config: `convex/ai/config.ts` (`SERVER_AI_CONFIG`)
  - Default: DeepSeek (`deepseek-chat`)
  - Supported providers (env var: `AI_PROVIDER`):
    - OpenAI (`@ai-sdk/openai`) - env: `OPENAI_API_KEY`
    - Anthropic (`@ai-sdk/anthropic`) - env: `ANTHROPIC_API_KEY`
    - Google (`@ai-sdk/google`) - env: `GOOGLE_GENERATIVE_AI_API_KEY`
    - DeepSeek (`@ai-sdk/deepseek`) - env: `DEEPSEEK_API_KEY`
    - Azure OpenAI (`@ai-sdk/azure`) - env: `AZURE_OPENAI_API_KEY`
    - OpenRouter (`@openrouter/ai-sdk-provider`) - env: `OPENROUTER_API_KEY`
  - BYOK support: Users can bring their own API keys (stored encrypted in `apiKeys` table)
  - AI operations: `convex/ai/helpers.ts` (`withAuthAndCredits`, `withUserCreditsBatch`, `createAIAction`)
  - Credit-based billing: AI operations deduct credits based on token usage with markup (`AI_COST_MARKUP`)

**Reference Management:**
- Zotero API - User library sync and paper import
  - OAuth 1.0a flow: `convex/zotero/actions.ts`
  - Callback endpoint: `convex/http.ts` route `/api/zotero/callback`
  - Connections stored in `zoteroConnections` table (encrypted API keys)
  - OAuth tokens: `zoteroOAuthTokens` table (short-lived, cleaned hourly by cron)

## Data Storage

**Database:**
- Convex - Primary database (document-oriented, real-time)
  - Schema: `convex/schema.ts` (20+ tables)
  - Core tables: `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`
  - Feature tables: `extractionJobs`, `extractionPapers`, `extractionResults`, `extractionQuestions`, `extractionEvidenceUnits`
  - Library tables: `libraryItems` (with full-text search index), `collections`, `libraryItemCollections`
  - Integration tables: `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`
  - Audit: `auditLogs`, `stripeEventLogs`
  - Rate limiting: `rateLimitTables` from convex-helpers

**File Storage:**
- Convex file storage (`_storage`) - PDF storage for extraction pipeline
  - Referenced by `extractionPapers.storageId`

**Search / RAG:**
- `@convex-dev/rag` ^0.7.0 - Vector search for extraction pipeline
  - Config: `convex/convex.config.ts` (registered as component)
  - Used for PDF content indexing and retrieval during data extraction
  - Papers indexed via `extractionPapers.ragEntryId` / `isIndexed`

**Caching:**
- SWR (client-side) - React data fetching with caching
- Convex reactive queries - Real-time subscriptions (implicit caching)

## Authentication & Identity

**Auth Provider:**
- Clerk - Authentication and user management
  - SDK: `@clerk/nextjs` ^6.38.2
  - Middleware: `proxy.ts` (Clerk middleware with locale detection)
  - Convex auth config: `convex/auth.config.ts` (JWT issuer domain from env)
  - Webhook sync: `convex/webhooks/clerk.ts` - Syncs Clerk user events to Convex `users` table
  - Webhook endpoint: `/webhooks/clerk` (POST)
  - Webhook verification: `svix` ^1.86.0
  - Route protection: `lib/auth/proxy-policy.ts` (`shouldProtectPath`)
  - Sign-in/up routes: `app/sign-in/`, `app/sign-up/`
  - Localizations: `@clerk/localizations` ^3.37.0
  - Themes: `@clerk/themes` ^2.4.55
  - Testing: `@clerk/testing` ^1.14.1, `@clerk/backend` ^2.32.1

**Encryption:**
- AES-256-GCM encryption for stored API keys and Zotero credentials
  - Implementation: `convex/lib/crypto.ts` (`encrypt`, `decrypt`, `decryptApiKey`)
  - Key: `ENCRYPTION_KEY` env var (32-byte hex)

## Monitoring & Observability

**Product Analytics:**
- PostHog (EU instance)
  - Client init: `instrumentation-client.ts`
  - Proxied through Next.js rewrites to `eu.i.posthog.com` (privacy-friendly)
  - GDPR compliant: `cookieless_mode: "on_reject"`, `opt_out_capturing_by_default: true`
  - Features: exception capture, heatmaps, person profiles
  - AI tracking: `lib/posthog-server.ts` (`captureAIGenerationServer`) - tracks all AI operations
  - Search tracking: `lib/posthog-search.ts`
  - Consent management: `lib/consent-storage.ts`, `components/cookie-consent-banner.tsx`

**Error Tracking:**
- PostHog Error Tracking (`capture_exceptions: true`)

**Logs:**
- Console logging in Convex functions (structured `[TAG]` prefixes)
- Audit logs stored in `auditLogs` table for security-relevant events
- Stripe event logs in `stripeEventLogs` table (lifecycle tracking: received -> processed/failed)

## CI/CD & Deployment

**Hosting:**
- Next.js frontend: Deployment target not explicitly configured (likely Vercel)
- Convex backend: Convex Cloud (deploy via `npx convex deploy`)

**CI Pipeline:**
- Test commands configured in `package.json`:
  - `test:ci` - Unit tests + build + E2E auth tests
  - `test:all` - Full suite including billing E2E
  - `test:billing:live:ci` - Live Stripe billing tests with Convex push
- Playwright CI config: 2 retries, 1 worker, GitHub reporter

**Dev Process Management:**
- PM2 via `ecosystem.config.js` - Runs `next dev` and `convex dev` concurrently
- Start with `npm run dev:all`

## Billing & Payments

**Stripe Integration:**
- SDK: `stripe` ^20.3.0
- Convex component: `@convex-dev/stripe` ^0.1.3
  - Config: `convex/stripe.ts` (StripeSubscriptions client)
  - Convex config: `convex/convex.config.ts`
- Webhook endpoint: `/webhooks/stripe` (POST)
  - Handler: `convex/http.ts` (registered via `registerRoutes`)
  - Secret: `STRIPE_WEBHOOK_SECRET` env var
  - Event handlers with idempotency contracts (INFRA-03):
    - `checkout.session.completed` - Subscription checkout completion
    - `payment_intent.succeeded` - Credit top-up purchases
    - `charge.refunded` - Refund processing
    - `invoice.paid` - Monthly credit grants
    - `invoice.payment_failed` - Payment failure handling
    - `customer.subscription.created/updated/deleted` - Subscription lifecycle
  - All events logged to `stripeEventLogs` table
  - Webhook handlers in `convex/lib/stripeWebhookHandlers.ts`
- Plans: free, go, pro, enterprise (price IDs: `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`)
- Credit system: `convex/credits/` - Free + paid balances, usage tracking, transactions
- Customer mapping: `billingCustomers` table (durable user-to-Stripe identity)
- Billing preflight: `scripts/billing-preflight.mjs`

## Webhooks & Callbacks

**Incoming:**
- `/webhooks/clerk` (POST) - Clerk user lifecycle events (create, update, delete)
  - Handler: `convex/webhooks/clerk.ts`
  - Mappers: `convex/webhooks/clerk_mappers.ts`
- `/webhooks/stripe` (POST) - Stripe billing events
  - Handler: `convex/http.ts` via `@convex-dev/stripe` registerRoutes
- `/api/zotero/callback` (GET) - Zotero OAuth 1.0a callback
  - Handler: `convex/http.ts` inline httpAction

**Outgoing:**
- PostHog event capture (analytics)
- Stripe API calls (subscription management, invoice reconciliation)
- AI provider API calls (OpenAI, Anthropic, Google, DeepSeek, Azure, OpenRouter)
- OpenAlex API calls (paper search/metadata)
- Zotero API calls (library access)

## Scheduled Jobs (Crons)

Defined in `convex/crons.ts`:
- **Every 24h:** Cleanup soft-deleted users (`maintenance.mutations.cleanupDeletedUsers`)
- **Every 1h:** Check subscription status / corrective sync (`maintenance.internal.checkSubscriptionStatus`)
- **Every 1h:** Monitor failed Stripe events (`maintenance.mutations.monitorFailedStripeEvents`)
- **Every 1h:** Reconcile Stripe paid invoices (`credits.actions.reconcileRecentPaidInvoicesFromStripe`)
- **Every 1h:** Cleanup expired Zotero OAuth tokens (`zotero.mutations.cleanupExpiredOAuthTokens`)
- **Every 24h:** Validate required env vars (`lib.envValidation.checkRequiredEnvVars`)

## Environment Configuration

**Required env vars (validated by cron):**
- `STRIPE_SECRET_KEY` - Stripe API key
- `ENCRYPTION_KEY` - AES-256-GCM key for API key/credential encryption
- `STRIPE_GO_PRICE_ID` - Stripe price ID for Go plan
- `STRIPE_PRO_PRICE_ID` - Stripe price ID for Pro plan
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT issuer for Convex auth

**Additional required env vars (not in validation list but used):**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk frontend key
- `NEXT_PUBLIC_POSTHOG_KEY` - PostHog project API key
- `NEXT_PUBLIC_POSTHOG_HOST` - PostHog UI host
- `NEXT_PUBLIC_APP_URL` - Application URL (fallback to localhost in dev)

**Optional env vars:**
- `AI_PROVIDER` - Server AI provider (default: `deepseek`)
- `AI_MODEL` - Server AI model (default: `deepseek-chat`)
- `OPENROUTER_PROVIDER_ORDER` - Comma-separated provider routing for OpenRouter
- `OPENROUTER_ALLOW_FALLBACKS` - Enable/disable OpenRouter fallbacks (default: true)
- Provider-specific API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `DEEPSEEK_API_KEY`, `AZURE_OPENAI_API_KEY`, `OPENROUTER_API_KEY`

**Secrets location:**
- `.env.local` (local development)
- Convex dashboard environment variables (production)

---

*Integration audit: 2026-03-06*
