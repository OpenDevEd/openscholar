# External Integrations

**Analysis Date:** 2026-03-04

## APIs & External Services

**Academic Research:**
- OpenAlex - Open academic paper database; primary data source for paper search, metadata, PDF URLs
  - SDK/Client: `@sickrin/openalex-sdk`; singleton at `lib/openalex.ts`
  - Direct HTTP calls also made in `convex/extraction/actions.ts` to `https://api.openalex.org/works`
  - Auth: `OPENALEX_CONTACT_EMAIL` (polite pool header)
  - No API key required; email in User-Agent recommended

**Reference Management:**
- Zotero - OAuth 1.0a integration for importing user library/collections into extraction jobs
  - OAuth endpoints: `https://www.zotero.org/oauth/request`, `.../oauth/access`, `.../oauth/authorize`
  - API base: `https://api.zotero.org`
  - Auth: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` (OAuth consumer credentials)
  - User API keys stored encrypted in Convex (`zoteroConnections.encryptedApiKey`), decrypted via `ENCRYPTION_KEY`
  - OAuth callback route: `convex/http.ts` → `/api/zotero/callback`
  - Implementation: `convex/zotero/actions.ts`, `convex/zotero/mutations.ts`, `convex/zotero/queries.ts`

**AI / LLM Providers (BYOK + server-side):**
All AI providers accessed via Vercel AI SDK (`ai` package). Provider selected at runtime via `AI_PROVIDER` env var (default: `deepseek`). Users can also supply their own keys (BYOK) stored encrypted in `apiKeys` table.

- DeepSeek - Default server AI provider; `deepseek-chat` default model
  - SDK: `@ai-sdk/deepseek`; instantiated in `lib/ai/server/providers.ts`
- OpenAI - GPT models; BYOK or server key
  - SDK: `@ai-sdk/openai`
- Anthropic - Claude models; BYOK or server key
  - SDK: `@ai-sdk/anthropic`
- Google Gemini - Gemini models; BYOK or server key
  - SDK: `@ai-sdk/google`
- Azure OpenAI - Azure-hosted OpenAI models
  - SDK: `@ai-sdk/azure`
- OpenRouter - Multi-provider proxy with fallback routing
  - SDK: `@openrouter/ai-sdk-provider`
  - Config: `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`

**PDF Processing:**
- GROBID - Self-hosted service for PDF structure extraction (TEI XML output)
  - Endpoint: `GROBID_URL` (default: `http://localhost:8070`; Docker: `http://grobid:8070`)
  - Implementation: `convex/extraction/grobid.ts`
  - Used for: sentence-level extraction, section labels, coordinate mapping for evidence anchoring

## Data Storage

**Databases:**
- Convex (BaaS) - Primary data store; all application data
  - Connection: `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_CLOUD_URL`; self-hosted: `CONVEX_SELF_HOSTED_URL`
  - Client: `convex` npm package; React provider in `components/providers/convex-provider.tsx`
  - Schema: `convex/schema.ts`
  - Tables: `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, `stripeEventLogs`, `auditLogs`, `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`, `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionJobStats`, `extractionRunDiffs`, `libraryItems`, `collections`, `libraryItemCollections`

**File Storage:**
- Convex File Storage - PDF binary storage; referenced via `_storage` IDs in `extractionPapers.storageId`

**Caching:**
- SWR `swr` - Client-side data fetching cache for some frontend queries
- Convex real-time subscriptions handle most server data freshness

**RAG Index:**
- `@convex-dev/rag` - Convex component providing vector + lexical search index for PDF content
  - Registered in `convex/convex.config.ts` as `components.rag`
  - Used by extraction workflow for evidence retrieval

## Authentication & Identity

**Auth Provider:**
- Clerk - Full auth provider (sign-up, sign-in, session management, user management)
  - Frontend SDK: `@clerk/nextjs` ^6.38.2; `@clerk/themes`, `@clerk/localizations`
  - Backend SDK: `@clerk/backend` ^2.32.1 (dev); `@clerk/testing` ^1.14.1 (E2E)
  - Convex JWT verification: `convex/auth.config.ts` uses `CLERK_JWT_ISSUER_DOMAIN`
  - User sync: Clerk webhooks → `convex/webhooks/clerk.ts` → upsert into Convex `users` table
  - Webhook verification: `svix` library using `CLERK_WEBHOOK_SIGNING_SECRET`
  - Convex identity: Users identified by `clerkId` string linked to Convex `users._id`

## Monitoring & Observability

**Product Analytics:**
- PostHog (EU region) - User behavior analytics + AI generation tracking + error tracking
  - Client: `posthog-js` ^1.342.1; initialized in `instrumentation-client.ts`
  - Server-side tracking (Convex actions): custom fetch-based client in `lib/posthog-server.ts`
  - Next.js proxy rewrites in `next.config.ts` route `/data/*` → `https://eu.i.posthog.com`
  - GDPR: cookieless mode with opt-in consent; config: `lib/consent-storage.ts`
  - Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`
  - Features used: heatmaps, person profiles, unhandled exception capture, AI generation events (`$ai_generation`)

**Logs:**
- Convex built-in logging (`console.log`/`console.error` within Convex functions)
- PM2 process logs for development (`npm run dev:all`)

## CI/CD & Deployment

**Hosting:**
- Next.js frontend: Vercel or any Node.js-compatible host
- Convex backend: Convex cloud (managed) or self-hosted Convex instance

**Dev Process Manager:**
- PM2 - Runs Next.js + Convex dev servers concurrently; config: `ecosystem.config.js`

**CI Pipeline:**
- `npm run test:ci` - Runs vitest unit tests + Next.js build + Playwright auth E2E
- `npm run test:billing:live:ci` - Live Stripe billing integration tests (requires Stripe test account)

## Webhooks & Callbacks

**Incoming (Convex HTTP routes - `convex/http.ts`):**

- `POST /webhooks/clerk` - Clerk user lifecycle events (user.created, user.updated, user.deleted)
  - Verified via Svix signature headers (`svix-id`, `svix-timestamp`, `svix-signature`)
  - Handler: `convex/webhooks/clerk.ts`

- `POST /webhooks/stripe` - Stripe subscription and payment events
  - Registered via `@convex-dev/stripe` `registerRoutes()`
  - Verified via `STRIPE_WEBHOOK_SECRET`
  - Events handled: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
  - All handlers are idempotent with dedup gates on Stripe IDs

- `GET /api/zotero/callback` - Zotero OAuth 1.0a callback (redirect from Zotero)
  - Exchanges `oauth_token` + `oauth_verifier` for access token
  - Redirects user back to frontend with `?zotero_connected=true` or `?zotero_error=...`

**Outgoing:**
- OpenAlex REST API: `https://api.openalex.org/works` (paper search + metadata)
- GROBID: `{GROBID_URL}/api/processFulltextDocument` (PDF → TEI XML)
- Zotero API: `https://api.zotero.org` (library/collection fetching)
- AI provider endpoints via Vercel AI SDK (OpenAI, Anthropic, DeepSeek, Google, Azure, OpenRouter)
- PostHog EU ingestion: `https://eu.i.posthog.com/i/v0/e/` (server-side AI events)
- Stripe API: via `stripe` SDK + `@convex-dev/stripe` component

## Environment Configuration

**Required env vars (minimum to run):**
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk frontend key
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT domain for Convex auth verification
- `CLERK_WEBHOOK_SIGNING_SECRET` - Clerk webhook signature verification
- `ENCRYPTION_KEY` - AES encryption key for BYOK API keys and Zotero tokens
- `AI_PROVIDER` + `AI_MODEL` - Server-side AI model selection (or use defaults: `deepseek` / `deepseek-chat`)
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` - Stripe integration
- `ZOTERO_CLIENT_KEY` + `ZOTERO_CLIENT_SECRET` - Zotero OAuth consumer credentials

**Secrets location:**
- `.env.local` (local development; never committed)
- Convex environment variables (synced via `./sync-env.sh`)
- API keys stored in Convex `apiKeys` table (encrypted with `ENCRYPTION_KEY`)
- Zotero API keys stored in `zoteroConnections.encryptedApiKey` (encrypted with `ENCRYPTION_KEY`)

---

*Integration audit: 2026-03-04*
