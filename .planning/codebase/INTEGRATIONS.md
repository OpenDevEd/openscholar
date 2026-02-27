# External Integrations

**Analysis Date:** 2026-02-27

## APIs & External Services

**Academic Literature:**
- OpenAlex - Free open-access bibliographic API for academic papers
  - SDK/Client: `@sickrin/openalex-sdk` — instantiated in `lib/openalex.ts`
  - Auth: No API key required (public API)
  - Usage: Paper search, filtering, metadata retrieval, citation counts

**AI / LLM Providers (multi-provider BYOK model):**
- OpenAI - GPT-4o, GPT-4.1, GPT-5 family, o-series reasoning models
  - SDK/Client: `@ai-sdk/openai` (Vercel AI SDK adapter)
  - Auth: User-supplied API key stored encrypted in Convex (`apiKeys` table), or env var
- Anthropic - Claude Haiku, Sonnet, Opus families
  - SDK/Client: `@ai-sdk/anthropic`
  - Auth: User-supplied API key or env var
- Google - Gemini 2.5/3 family
  - SDK/Client: `@ai-sdk/google`
  - Auth: User-supplied API key or env var
- DeepSeek - Default server-side AI provider (configurable via `AI_PROVIDER` env var)
  - SDK/Client: `@ai-sdk/deepseek`
  - Auth: User-supplied API key or server env var
- OpenRouter - Aggregated access to hundreds of models
  - SDK/Client: `@openrouter/ai-sdk-provider`
  - Auth: User-supplied API key
  - Config: `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS` env vars
- Azure OpenAI - Azure-hosted models
  - SDK/Client: `@ai-sdk/azure`
  - Auth: User-supplied API key
- Ollama - Local self-hosted models
  - SDK/Client: `ollama` + `ollama-ai-provider-v2`
  - Auth: None (local)
- Cohere - Available via `@ai-sdk/cohere` dependency
  - Auth: User-supplied API key

All AI providers are unified through `lib/ai/client/providers.ts` using Vercel AI SDK's `generateObject`. Server-side default provider is configured via `AI_PROVIDER` / `AI_MODEL` env vars in `convex/ai/config.ts`.

**PDF Text Extraction:**
- GROBID - Self-hosted academic PDF parser (returns TEI XML)
  - Endpoint: `GROBID_URL` env var (default: `http://localhost:8070`)
  - Docker URL fallback: `http://grobid:8070`
  - Implementation: `convex/extraction/grobid.ts`
  - No API key required (self-hosted)

**Analytics & Observability:**
- PostHog - Product analytics, heatmaps, AI observability tracking
  - SDK/Client: `posthog-js` ^1.342.1 (browser) and direct HTTP API (server)
  - Auth: `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_KEY`
  - EU region: `eu.i.posthog.com` (proxied via Next.js rewrites at `/data/*`)
  - Initialized in `instrumentation-client.ts`; server-side capture in `lib/posthog-server.ts`
  - GDPR: Cookie-less mode with opt-out by default until user consents

**Reference Management:**
- Zotero - Academic reference manager OAuth integration
  - Auth: OAuth 1.0a flow (request token → authorize → access token)
  - API base: `https://api.zotero.org`
  - Callback endpoint: `/api/zotero/callback` (Convex HTTP route)
  - OAuth endpoints: `https://www.zotero.org/oauth/*`
  - Implementation: `convex/zotero/actions.ts`, `convex/http.ts`
  - Storage: `zoteroConnections` + `zoteroOAuthTokens` tables in Convex

## Data Storage

**Databases:**
- Convex - Primary database and backend runtime
  - Connection: `NEXT_PUBLIC_CONVEX_URL` env var
  - Client: `convex` SDK — `ConvexReactClient` in `components/providers/convex-provider.tsx`
  - Schema: `convex/schema.ts`
  - Tables: `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, `stripeEventLogs`, `apiKeys`, `zoteroConnections`, `zoteroOAuthTokens`, `extractionJobs`, `extractionQuestions`, `extractionPapers`, `extractionEvidenceUnits`, `extractionResults`, `extractionResultReviews`, `extractionSavedViews`, `extractionWorkflowTemplates`, `extractionReportSnapshots`, `extractionRunDiffs`
  - Auth integration: Convex verifies Clerk JWTs via `CLERK_JWT_ISSUER_DOMAIN` in `convex/auth.config.ts`

**File Storage:**
- Convex File Storage (`_storage`) - PDFs uploaded by users or downloaded for extraction
  - Referenced via `storageId: v.id("_storage")` in `extractionPapers` and `extractionWorkflowTemplates`

**Caching:**
- None (SWR used for client-side cache, backed by Convex real-time subscriptions)

## Authentication & Identity

**Auth Provider:**
- Clerk - Managed auth provider
  - SDK: `@clerk/nextjs` ^6.38.2 (frontend), `@clerk/backend` ^2.32.1 (server)
  - Publishable key: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - Secret key: `CLERK_SECRET_KEY`
  - JWT issuer: `CLERK_JWT_ISSUER_DOMAIN` (used to verify tokens in Convex)
  - Themes: `@clerk/themes` — theme-adaptive UI
  - Localisations: `@clerk/localizations` — locale-aware auth UI
  - Convex bridge: `ConvexProviderWithClerk` in `components/providers/convex-provider.tsx`
  - User sync: Clerk webhooks → `convex/webhooks/clerk.ts` → `users` table in Convex
  - Webhook verification: `svix` ^1.86.0

## Monitoring & Observability

**Error Tracking:**
- PostHog Error Tracking (`capture_exceptions: true` in `instrumentation-client.ts`)

**Logs:**
- `console.log` / `console.error` throughout Convex functions (streamed via Convex dashboard)
- No dedicated structured logging service

## CI/CD & Deployment

**Hosting:**
- Convex cloud — backend/database
- Next.js deployment target not specified in codebase (likely Vercel or self-hosted Node)

**CI Pipeline:**
- Not explicitly configured in codebase (no `.github/workflows` or similar detected)
- Test commands available: `npm run test:ci` runs unit tests + build + E2E auth tests

**Dev Process Management:**
- pm2 via `ecosystem.config.js` — runs Next.js dev server and `convex dev` concurrently

## Environment Configuration

**Required env vars:**
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk frontend key
- `CLERK_SECRET_KEY` - Clerk backend key
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT domain for Convex auth
- `CLERK_WEBHOOK_SECRET` - Svix webhook signature verification
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signature secret
- `NEXT_PUBLIC_POSTHOG_KEY` - PostHog project key (browser)
- `POSTHOG_KEY` - PostHog key (Convex server-side)
- `NEXT_PUBLIC_POSTHOG_HOST` - PostHog host (EU: `https://eu.i.posthog.com`)
- `NEXT_PUBLIC_APP_URL` - App public URL (used in Zotero OAuth redirects)
- `AI_PROVIDER` - Default server AI provider (`deepseek` by default)
- `AI_MODEL` - Default server AI model (`deepseek-chat` by default)
- `GROBID_URL` - GROBID service URL (default: `http://localhost:8070`)
- `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED` - Feature flag to enable/disable subscription billing

**Optional env vars:**
- `OPENROUTER_PROVIDER_ORDER` - Comma-separated provider order for OpenRouter
- `OPENROUTER_ALLOW_FALLBACKS` - Allow fallbacks in OpenRouter (default: `true`)
- `GROBID_TIMEOUT_MS` - GROBID request timeout (default: `45000`)

**Secrets location:**
- `.env.local` for local development
- Convex environment (synced via `sync-env.sh` which calls `npx convex env set`)

## Webhooks & Callbacks

**Incoming (Convex HTTP routes — `convex/http.ts`):**
- `POST /webhooks/clerk` — Clerk user lifecycle events (user created/updated/deleted → syncs to `users` table)
- `POST /webhooks/stripe` — Stripe billing events (subscription lifecycle, invoice paid, payment intent, charge refund)
- `GET /api/zotero/callback` — Zotero OAuth 1.0a callback (exchanges verifier for access token)

**Outgoing:**
- Stripe API calls — subscription management, invoice reconciliation, customer portal
- Zotero API — library items fetch, collection listing (`https://api.zotero.org`)
- OpenAlex API — paper search and metadata (via `@sickrin/openalex-sdk`)
- PostHog HTTP API — server-side AI generation event capture (`lib/posthog-server.ts`)
- GROBID API — PDF fulltext extraction (`convex/extraction/grobid.ts`)
- AI provider APIs — LLM inference (OpenAI, Anthropic, Google, DeepSeek, etc.)

## Convex Components (Internal)

Convex components registered in `convex/convex.config.ts`:
- `@convex-dev/stripe` — Stripe webhook registration and subscription state
- `@convex-dev/rag` — Vector search + retrieval for PDF content extraction
- `@convex-dev/workflow` — Durable multi-step workflow execution (used in `convex/extraction/workflow.ts`)
- `@convex-dev/workpool` — Concurrent work scheduling for per-paper PDF processing (`convex/workpool.ts`)

---

*Integration audit: 2026-02-27*
