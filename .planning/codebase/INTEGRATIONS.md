# External Integrations

**Analysis Date:** 2026-04-14

## APIs & External Services

**Authentication & Identity (Clerk):**
- **Clerk** — end-user authentication, sign-in/sign-up flows, JWT issuance for Convex
  - Client SDK: `@clerk/nextjs` ^6.38.2 (wraps app via `ClerkProvider` in `components/providers/convex-provider.tsx`)
  - Server SDK: `@clerk/backend` ^2.32.1
  - Theming/localization: `@clerk/themes` ^2.4.55, `@clerk/localizations` ^3.37.0 — resolved per-locale/theme in `lib/auth/clerk-ui-config.ts` (referenced from `convex-provider.tsx`)
  - Auth middleware: `clerkMiddleware` in `proxy.ts` (Next.js edge middleware); protects paths via `shouldProtectPath` from `lib/auth/proxy-policy.ts`
  - Convex JWT config: `convex/auth.config.ts` — `domain: process.env.CLERK_JWT_ISSUER_DOMAIN`, `applicationID: "convex"`
  - Sign-in/sign-up routes: `app/sign-in/[[...sign-in]]/`, `app/sign-up/`
  - Testing helpers: `@clerk/testing` ^1.14.1 (Playwright fixtures, `e2e/global.setup.ts`)
  - Env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`

**Payments & Billing (Stripe):**
- **Stripe** — subscriptions, one-time credit top-ups, invoicing, webhooks
  - Node SDK: `stripe` ^20.3.0 — used in `convex/credits/actions.ts`, `convex/subscriptions/actions.ts`, `convex/maintenance/internal.ts`, `convex/lib/stripeCustomer.ts`, `convex/lib/stripeWebhookHandlers.ts`, `scripts/billing-preflight.mjs`, `e2e/billing/stripe-helpers.ts`, `tests/live-billing/support.ts`
  - Convex component: `@convex-dev/stripe` ^0.1.4 — registered in `convex/convex.config.ts`; client in `convex/stripe.ts` (`StripeSubscriptions(components.stripe, {})`)
  - Plans: `free`, `go`, `pro`, `enterprise` (see `convex/schema.ts` `subscriptions` table, `convex/lib/constants.ts`)
  - Price IDs (env): `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`
  - Credit top-up product: `STRIPE_CREDITS_PRODUCT_ID`, credit rate via `CREDITS_PER_USD`
  - Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus price IDs above

**AI / LLM Providers (via Vercel AI SDK):**
- **OpenAI** — `@ai-sdk/openai` ^3.0.23 (factory in `lib/ai/server/providers.ts`)
- **Anthropic** — `@ai-sdk/anthropic` ^3.0.31
- **Google** — `@ai-sdk/google` ^3.0.18 (Generative AI / Gemini)
- **Azure OpenAI** — `@ai-sdk/azure` ^3.0.26
- **DeepSeek** — `@ai-sdk/deepseek` ^2.0.15
- **OpenRouter** — `@openrouter/ai-sdk-provider` ^6.0.0-alpha.1 — also used as the unified model catalog source (see below)
- Default provider/model (server): `AI_PROVIDER=deepseek`, `AI_MODEL=deepseek-chat` (`convex/ai/config.ts`)
- OpenRouter routing tuning: `OPENROUTER_PROVIDER_ORDER` (comma list), `OPENROUTER_ALLOW_FALLBACKS` (boolean, default `true`)
- AI runtime entrypoints: `lib/ai/core/execute.ts`, `lib/ai/client/*.ts`, `convex/ai/*.ts`, `convex/wallet/gateway/handler.ts`
- API key storage: user-supplied keys encrypted with `ENCRYPTION_KEY` and stored in Convex; decryption via `convex/lib/crypto.ts` (`encrypt`, `decryptApiKey`, `getKeyPrefix`) — referenced from `convex/apiKeys/actions.ts`, `convex/zotero/actions.ts`, `convex/extraction/workpoolActions.ts`

**Model Catalog (OpenRouter):**
- Daily sync of OpenRouter model metadata into Convex `models` table
- Source: `https://openrouter.ai/api/v1/models` (see `convex/models/sync.ts` `OPENROUTER_MODELS_URL`)
- Cron: `sync openrouter models` every 24 hours (`convex/crons.ts` → `internal.models.sync.syncFromOpenRouter`)
- Stored fields include provider, modality, pricing per-million tokens (input, output, cache read/write, reasoning, web search, image, audio), context length, supported parameters (`convex/schema.ts` `models` table)

**Research Data (OpenAlex):**
- **OpenAlex** — public research metadata API covering 250M+ works
  - SDK: `@sickrin/openalex-sdk` ^1.0.0 — default client in `lib/openalex.ts` (`new OpenAlexClient()`)
  - Used by: `app/api/openalex/search/route.ts` (Next.js Route Handler for search)
  - Direct HTTP usage: `convex/extraction/actions.ts` hits `https://api.openalex.org/works` with `URLSearchParams` for extraction workflows
  - Abstract reconstruction helper: `lib/openalex/reconstruct-abstract.ts`
  - Polite-pool contact email: `OPENALEX_CONTACT_EMAIL` (used in `convex/extraction/actions.ts`)

**Reference Manager (Zotero):**
- **Zotero** — OAuth 1.0a flow and library import
  - Endpoints (constants in `convex/zotero/actions.ts`):
    - Request token: `https://www.zotero.org/oauth/request`
    - Access token: `https://www.zotero.org/oauth/access`
    - Authorize: `https://www.zotero.org/oauth/authorize`
    - API base: `https://api.zotero.org`
  - OAuth signing: HMAC-SHA1 via Node `crypto` (`convex/zotero/actions.ts`)
  - API credentials encrypted with `ENCRYPTION_KEY` and persisted in Convex
  - Env vars: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`, `ENCRYPTION_KEY`
  - Expired OAuth request tokens cleaned hourly via `cleanup expired zotero oauth tokens` cron (`convex/crons.ts`)

**Product Analytics & Error Tracking (PostHog):**
- **PostHog** — product analytics, heatmaps, error tracking (EU region)
  - Client: `posthog-js` ^1.342.1 (init in `instrumentation-client.ts` with `api_host: "/data"`, GDPR `cookieless_mode: "on_reject"`, `opt_out_capturing_by_default: true`, `capture_exceptions: true`, `person_profiles: "always"`, `capture_heatmaps: true`, defaults `"2026-01-30"`)
  - Reverse proxy rewrites in `next.config.ts`: `/data/static/:path*` → `https://eu-assets.i.posthog.com/static/:path*`; `/data/:path*` → `https://eu.i.posthog.com/:path*`
  - Server helpers: `lib/posthog-server.ts`, `lib/posthog-ai-shared.ts`, `lib/posthog-ai.ts`, `lib/posthog-search.ts`
  - Consent banner: `components/cookie-consent-banner.tsx` (gated on `NEXT_PUBLIC_POSTHOG_KEY`)
  - Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`

**Google Analytics:**
- **Google Analytics (GA4)** — via `@next/third-parties` ^16.2.2
  - Component: `components/google-analytics.tsx` (consent-aware; only in `NODE_ENV=production`)
  - Env var: `NEXT_PUBLIC_GA_ID`

## Data Storage

**Primary Database (Convex):**
- **Convex Cloud** — reactive DB + functions (`convex` ^1.34.1)
  - Schema: `convex/schema.ts` (defines `models`, `featureFlags`, `users`, `credits`, `creditTransactions`, `subscriptions`, `billingCustomers`, plus `...rateLimitTables` from `convex-helpers`, extraction tables, library tables, wallet tables, etc.)
  - Components registered in `convex/convex.config.ts`: `stripe`, `rag`, `workflow`, `workpool`, `screeningWorkpool` (second workpool instance)
  - Key tables (non-exhaustive): `users` (synced from Clerk by `clerkId`), `credits` (free+paid balances), `creditTransactions` (Stripe idempotency via `stripeInvoiceId`, `stripePaymentIntentId`, `stripeChargeId`, `stripeCheckoutSessionId`), `subscriptions` (plans `free`/`go`/`pro`/`enterprise`, Stripe IDs), `billingCustomers` (user ↔ Stripe customer mapping), `models` (OpenRouter catalog), `featureFlags`
  - Env vars: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `CONVEX_CLOUD_URL`, optional self-hosted: `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`
  - Client initialization: `ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)` in `components/providers/convex-provider.tsx`
  - Auth bridge: `ConvexProviderWithClerk` from `convex/react-clerk`

**Retrieval-Augmented Generation:**
- `@convex-dev/rag` ^0.7.2 — vector/RAG storage component (registered in `convex/convex.config.ts`) — used for document chunking/retrieval during extraction (`convex/extraction/chunking.ts`, `convex/extraction/evidence_units.ts`)

**File Storage:**
- Convex file storage (uploads via `convex/extraction/uploads.ts` — PDF uploads for extraction pipeline)
- No S3/GCS/Azure Blob integration detected

**Caching:**
- SWR ^2.3.3 — client-side caching/revalidation
- Convex reactive queries — server-side real-time cache
- No Redis/Memcached detected

## Authentication & Identity

**Primary Provider:** Clerk
- Integration pattern: `ClerkProvider` → `ConvexProviderWithClerk` → `FeatureFlagProvider` → app (`components/providers/convex-provider.tsx`)
- Local user sync: `api.users.mutations.ensureUser` called from `AuthReadinessProvider` with exponential-backoff retry (base 1s, cap 30s, max 6 attempts)
- Users table single source of truth in Convex (`users` in `convex/schema.ts`, indexed `by_clerk_id`, `by_email`, `by_state`)
- Route protection: `proxy.ts` checks `shouldProtectPath` and calls `auth.protect()`
- JWT issuer validated by Convex via `CLERK_JWT_ISSUER_DOMAIN`

**Secrets Encryption:**
- Application-level symmetric encryption for user-supplied API keys and OAuth tokens
- Key: `ENCRYPTION_KEY` env var
- Implementation: `convex/lib/crypto.ts` (`encrypt`, `decryptApiKey`, `getKeyPrefix`) with structured audit logging on decryption (see `resolveZoteroApiKey` in `convex/zotero/actions.ts`)

## Monitoring & Observability

**Error Tracking:**
- PostHog Error Tracking via `posthog-js` (`capture_exceptions: true` in `instrumentation-client.ts`)

**Logs:**
- `console.log`/`console.error` throughout Convex functions (e.g. `convex/http.ts` Stripe webhook logs: `[StripeWebhook] checkout.session.completed ...`)
- Audit logs: `internal.lib.audit.writeAuditLog` mutation (`convex/lib/audit.ts`) — used for env-validation failures, decryption events, webhook outcomes
- Stripe event log: `stripeEventLogs` table tracked via `markStripeEventProcessed`, `markStripeEventFailed`, `markStripeEventRetrying`, `recordStripeEventReceived` (`convex/subscriptions/internal.ts`)

**Health Checks / Crons (`convex/crons.ts`):**
- `cleanup deleted users` — daily (`internal.maintenance.mutations.cleanupDeletedUsers`)
- `check subscription status` — hourly corrective sync (`internal.maintenance.internal.checkSubscriptionStatus`)
- `monitor failed stripe events` — hourly flagging (`internal.maintenance.mutations.monitorFailedStripeEvents`)
- `reconcile stripe paid invoices` — hourly (`internal.credits.actions.reconcileRecentPaidInvoicesFromStripe`)
- `cleanup expired zotero oauth tokens` — hourly (`internal.zotero.mutations.cleanupExpiredOAuthTokens`)
- `sync openrouter models` — daily (`internal.models.sync.syncFromOpenRouter`)
- `validate required env vars` — daily (`internal.lib.envValidation.checkRequiredEnvVars`)

## CI/CD & Deployment

**Hosting:**
- **Vercel** — Next.js deployment, project `openalex-count` (`.vercel/project.json`)
- **Convex Cloud** — backend deployment (`NEXT_PUBLIC_CONVEX_URL`)

**CI Pipeline (GitHub Actions):**
- `.github/workflows/ci.yml`:
  - Job `unit-and-build` — Node 22, `npm ci`, `npm run test`, `npm run build` with placeholder Clerk + Convex env
  - Job `e2e-auth` — depends on unit-and-build; runs `npm run test:e2e:auth` with secrets `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CONVEX_URL`, `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`
- `.github/workflows/billing-nightly.yml` — nightly billing live tests

**Test Suites:**
- Unit / contract (Vitest): `tests/**` + `convex/**/*.test.ts`
- Convex function tests in edge-runtime (`convex-test` inlined dep)
- E2E (Playwright): `e2e/auth.spec.ts`, `e2e/billing/**` (serial, workers=1)
- Billing live: `tests/live-billing/*.test.ts` (separate config `vitest.live.config.ts`)
- Billing preflight: `scripts/billing-preflight.mjs` (`npm run test:billing:preflight`; `--push-convex` mode supported via `BILLING_LIVE_PUSH_CONVEX`)

## Environment Configuration

**Required env vars (validated by `convex/lib/envValidation.ts`):**
- `STRIPE_SECRET_KEY`
- `ENCRYPTION_KEY`
- `STRIPE_GO_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `CLERK_JWT_ISSUER_DOMAIN`

**Additional env vars referenced in code:**
- **Clerk**: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `CLERK_WEBHOOK_SIGNING_SECRET`
- **Convex**: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `CONVEX_CLOUD_URL`, `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`
- **Stripe**: `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CREDITS_PRODUCT_ID`, `CREDITS_PER_USD`
- **AI**: `AI_PROVIDER`, `AI_MODEL`, `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`, `EXTRACTION_EMBEDDING_USD_PER_1M_TOKENS`
- **Zotero**: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`
- **OpenAlex**: `OPENALEX_CONTACT_EMAIL`
- **PostHog**: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`
- **Google Analytics**: `NEXT_PUBLIC_GA_ID`
- **App URL**: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_URL` (fallback to `http://localhost:3000` in dev; see `convex/lib/env.ts::requireAppUrl`)
- **E2E**: `E2E_BASE_URL`, `PLAYWRIGHT_WEB_SERVER_COMMAND`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`
- **Billing live**: `BILLING_LIVE_PUSH_CONVEX`

**Secrets location:**
- Local: `.env.local` (present at repo root; not inspected)
- Convex: pushed via `sync-env.sh` → `npx convex env set` (skips `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_SELF_HOSTED_*`)
- CI: GitHub Actions secrets (`secrets.*` in `.github/workflows/ci.yml`)

## Webhooks & Callbacks

**Incoming (handled by Convex HTTP router `convex/http.ts`):**
- `POST /webhooks/clerk` — Clerk user lifecycle webhook (`clerkWebhook` in `convex/webhooks/clerk.ts`)
  - Signature verification via `svix` ^1.86.0 (`convex/webhooks/actions.ts` — requires `svix-id`, `svix-timestamp`, `svix-signature` headers and `CLERK_WEBHOOK_SIGNING_SECRET` starting with `whsec_`)
  - Handled events: `user.created`, `user.updated`, `user.deleted` → `internal.users.internal.upsertUserFromClerk`, `markUserDeletedFromClerk`
- `POST /webhooks/stripe` — Stripe subscription/billing webhook (registered via `@convex-dev/stripe` `registerRoutes` with `STRIPE_WEBHOOK_SECRET` normalized through `normalizeStripeWebhookSecret`)
  - Handled events: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `invoice.created`, `invoice.finalized`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
  - All handlers wrapped with `runAuditedStripeHandler` (idempotent — logged to `stripeEventLogs`); `onEvent` callback records every received event via `internal.subscriptions.internal.recordStripeEventReceived`
  - Idempotency contracts documented inline (INFRA-03, CRED-01, SUB-02)
- `GET /api/zotero/callback` — Zotero OAuth 1.0a callback (`convex/http.ts`); redirects to `${NEXT_PUBLIC_APP_URL}/?zotero_connected=true` or `?zotero_error=...` via `ctx.runAction(internal.zotero.actions.completeOAuth, ...)`

**Wallet AI Gateway (OpenAI-compatible surface, `convex/http.ts` + `convex/wallet/gateway/handler.ts`):**
- `POST /api/wallet/v1/chat/completions` + `OPTIONS` — `handleChatCompletions` / `handleCors`
- `GET /api/wallet/v1/models` + `OPTIONS` — `handleModelsV1` / `handleCors`
- `GET /api/wallet/balance` + `OPTIONS` — `handleBalance` / `handleCors`
- Bearer-token auth via `extractBearerToken` → `internal.wallet.nodeActions.validateKey`
- CORS via `corsHeaders(origin)` helper
- Error format mimics OpenAI (`openAIError(message, type, status, origin)`)
- Backed by `ai` ^6.0.62 (`streamText`, `generateText`) and `lib/ai/server/providers.ts::getProviderModel`

**Next.js Route Handlers (`app/api/`):**
- `GET /api/openalex/search` — proxies OpenAlex search with shared `createSearchParameters` from `lib/utils.ts` (`app/api/openalex/search/route.ts`)

**Outgoing HTTP calls:**
- OpenRouter: `https://openrouter.ai/api/v1/models` (daily model sync)
- OpenAlex: `https://api.openalex.org/works` (paper extraction)
- Zotero: `https://www.zotero.org/oauth/*`, `https://api.zotero.org`
- Stripe API: via `stripe` Node SDK (`new Stripe(process.env.STRIPE_SECRET_KEY)`)
- AI providers: via `@ai-sdk/*` factories (OpenAI, Anthropic, Google, Azure, DeepSeek, OpenRouter)
- PostHog EU ingest: `https://eu.i.posthog.com` (via Next.js rewrite from `/data`)

---

*Integration audit: 2026-04-14*
