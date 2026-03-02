# Technology Stack

**Analysis Date:** 2026-03-02

## Languages

**Primary:**
- TypeScript ~5.x - All application code (Next.js frontend, Convex backend, tests)

**Secondary:**
- JavaScript - `ecosystem.config.js` (PM2 process manager), `scripts/billing-preflight.mjs`
- JSON - i18n message files in `messages/`

## Runtime

**Environment:**
- Node.js v20.x (detected: v20.20.0 on dev machine; no `.nvmrc` or `.node-version` file present)

**Package Manager:**
- npm (no explicit version pinned)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js ^16.1.6 - Full-stack React framework; App Router used; Turbopack in dev (`next dev --turbopack`)
- React ^19.2.4 - UI layer; React Compiler enabled (`reactCompiler: true` in `next.config.ts`)
- Convex ^1.31.7 - Serverless backend-as-a-service (realtime DB, serverless actions, file storage, cron jobs, HTTP router)

**UI / Styling:**
- Tailwind CSS ^4 - Utility-first CSS
- Radix UI (many `@radix-ui/*` packages ~v1-v2) - Headless accessible component primitives
- shadcn/ui ^3.8.5 - Component library on top of Radix UI (config: `components.json`)
- `lucide-react` ^0.487.0 - Icon library
- `motion` ^12.23.12 - Animation library (Framer Motion successor)
- `tw-animate-css` ^1.4.0 - Tailwind animation utilities
- `class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.4.1 - Class name utilities

**i18n:**
- `next-intl` ^4.8.2 - Internationalisation; configured at `i18n/request.ts`
- Locales: `en-US`, `en-GB`, `zh`, `fr`, `hi`, `ja` (config: `i18n/config.ts`)

**State Management:**
- `zustand` ^5.0.5 - Client-side global state (`lib/store.ts`)
- `swr` ^2.3.3 - Server state / data fetching
- `nuqs` ^2.6.0 - URL search parameter state

**AI SDK:**
- Vercel AI SDK `ai` ^6.0.62 - Core AI streaming/text generation
- Provider adapters: `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/cohere`, `@ai-sdk/deepseek`, `@ai-sdk/google`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`
- Local model support: `ollama` ^0.6.3, `ollama-ai-provider-v2` ^2.0.0 (in dependencies but not wired into server-side `providers.ts`)

**Billing:**
- `stripe` ^20.3.0 - Stripe Node SDK
- `@convex-dev/stripe` ^0.1.3 - Convex Stripe component

**Convex Add-on Components:**
- `@convex-dev/rag` ^0.7.0 - RAG (Retrieval-Augmented Generation) for PDF indexing
- `@convex-dev/workflow` ^0.3.4 - Durable workflows
- `@convex-dev/workpool` ^0.3.1 - Parallel task execution
- `convex-helpers` ^0.1.111 - Rate limiting, utilities

**PDF Handling:**
- `unpdf` ^1.4.0 - PDF text extraction
- `react-pdf` ^10.1.0 - PDF viewing in browser
- `cheerio` ^1.2.0 - HTML/XML parsing (used for GROBID TEI output)

**Data Export:**
- `xlsx` ^0.18.5 - Excel export
- `jsonrepair` ^3.13.2 - Repair malformed AI JSON output
- `date-fns` ^4.1.0 - Date formatting

**Testing:**
- Vitest ^3.2.4 - Unit and integration test runner (config: `vitest.config.ts`)
- `@playwright/test` ^1.58.2 - E2E tests (config: `playwright.config.ts`)
- `@testing-library/react` ^16.3.2 - React component testing
- `convex-test` ^0.0.41 - Convex function in-memory testing
- `jsdom` ^28.1.0 - DOM simulation for hook/component tests

**Build/Dev:**
- Turbopack (via `next dev --turbopack`) - Dev server bundler
- PM2 (`ecosystem.config.js`) - Local multi-process dev (`npm run dev:all` runs Next.js + Convex)
- `knip` ^5.84.1 - Dead code detection (`knip.json`)
- `babel-plugin-react-compiler` ^1.0.0 - React Compiler Babel transform

## Key Dependencies

**Critical:**
- `convex` ^1.31.7 - All backend logic, realtime DB, file storage, and cron jobs live here
- `@clerk/nextjs` ^6.38.2 - Authentication gateway; every protected route goes through Clerk middleware
- `stripe` ^20.3.0 - Billing; subscriptions + credit top-up payments
- `@sickrin/openalex-sdk` ^1.0.0 - Core data source: academic paper search (`lib/openalex.ts`)
- `ai` ^6.0.62 - Powers all AI features (query enhancement, screening, extraction)

**Infrastructure:**
- `svix` ^1.86.0 - Webhook signature verification (used for Clerk webhooks)
- `posthog-js` ^1.342.1 - Client-side analytics and error tracking
- `zod` ^4.3.6 - Runtime schema validation across the app
- `next-themes` ^0.4.6 - Light/dark theme management

## Configuration

**Environment:**
- `.env.local` file present (not committed; gitignored)
- Key variable groups:
  - Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`
  - Convex: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `CONVEX_CLOUD_URL`
  - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREDITS_PRODUCT_ID`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`
  - AI: `AI_PROVIDER`, `AI_MODEL`, `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`
  - Zotero: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`
  - PostHog: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`
  - Encryption: `ENCRYPTION_KEY` (used to encrypt stored API keys and Zotero tokens)
  - GROBID: `GROBID_URL` (default: `http://localhost:8070`), `GROBID_TIMEOUT_MS`
  - Feature flags: `NEXT_PUBLIC_CREDITS_ENABLED`, `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`, `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, `NEXT_PUBLIC_EXTRACTION_ENABLED`, `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED`
  - App URL: `NEXT_PUBLIC_APP_URL` or `NEXT_PUBLIC_URL`
  - Misc: `CREDITS_PER_USD`, `ENABLE_PUBLIC_DEBUG_FUNCTIONS`, `BILLING_LIVE_PUSH_CONVEX` (CI only)

**Build:**
- `next.config.ts` - Next.js config; PostHog proxy rewrites, next-intl plugin, React Compiler enabled
- `tsconfig.json` - Strict TypeScript, `@/*` path alias maps to project root
- `postcss.config.mjs` - PostCSS for Tailwind v4
- `convex/tsconfig.json` - Separate TS config for Convex backend

## Platform Requirements

**Development:**
- Node.js v20+
- Convex dev server running in parallel (`npm run dev:convex` or `npm run dev:all`)
- Optional: local GROBID instance at port 8070 for PDF text extraction

**Production:**
- Convex cloud (handles DB, file storage, serverless functions, cron jobs)
- Next.js application deployable to Vercel or any Node.js host
- GROBID service required for PDF extraction feature (can be Docker-based)

---

*Stack analysis: 2026-03-02*
