# Technology Stack

**Analysis Date:** 2026-03-04

## Languages

**Primary:**
- TypeScript 5.x - All source code: `app/`, `convex/`, `lib/`, `components/`, `hooks/`, `tests/`

**Secondary:**
- JavaScript - `ecosystem.config.js`, `scripts/billing-preflight.mjs`
- CSS - `app/globals.css` via Tailwind v4

## Runtime

**Environment:**
- Node.js v20.20.0 (active runtime)

**Package Manager:**
- npm 10.8.2
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js ^16.1.6 - App Router, SSR/RSC, API routes — entry: `app/layout.tsx`, `app/page.tsx`
- React 19.x - UI rendering; `reactCompiler: true` enabled in `next.config.ts`
- Convex ^1.31.7 - Backend-as-a-service: database, serverless functions, real-time subscriptions — all backend in `convex/`

**Internationalization:**
- next-intl ^4.8.2 - i18n routing and translations — config: `i18n/request.ts`, messages in `messages/`
- `@formatjs/intl-localematcher` ^0.8.1 - Locale matching

**Styling:**
- Tailwind CSS ^4 - Utility-first CSS; config via `postcss.config.mjs`
- tw-animate-css ^1.4.0 - Animation utilities
- tailwind-merge ^3.4.1 - Class merging utility

**UI Component Library:**
- radix-ui ^1.4.3 - Headless accessible primitives
- shadcn ^3.8.5 (dev) - Component scaffolding; config: `components.json`
- class-variance-authority ^0.7.1 - Variant handling
- lucide-react ^0.487.0 - Icons
- cmdk ^1.1.1 - Command palette
- vaul ^1.1.2 - Drawer component
- sonner ^2.0.7 - Toast notifications
- motion ^12.23.12 - Animations
- react-day-picker ^9.13.2 - Date picker
- nuqs ^2.6.0 - URL search param state management

**State Management:**
- zustand ^5.0.5 - Client-side global state — `lib/store.ts`
- swr ^2.3.3 - Data fetching/caching on client

**Testing:**
- vitest ^3.2.4 - Primary unit/integration test runner; config: `vitest.config.ts`
- `@playwright/test` ^1.58.2 - E2E tests; config: `playwright.config.ts`
- convex-test ^0.0.41 - Convex function testing with edge-runtime environment
- `@testing-library/react` ^16.3.2 - React component testing
- `@testing-library/user-event` ^14.6.1 - User interaction simulation
- `@testing-library/jest-dom` ^6.9.1 - DOM matchers
- jsdom ^28.1.0 - DOM environment for hook/component tests

**Build/Dev:**
- Turbopack - Used via `next dev --turbopack` for fast development builds
- PM2 - Process manager for running Next.js + Convex dev together; config: `ecosystem.config.js`
- knip ^5.84.1 - Dead code detection; config: `knip.json`

## Key Dependencies

**Critical:**
- `@clerk/nextjs` ^6.38.2 - Auth provider integration (frontend + Next.js middleware)
- `convex` ^1.31.7 - All backend: database, mutations, queries, actions, real-time
- `stripe` ^20.3.0 - Stripe SDK (direct use for Stripe API calls)
- `@convex-dev/stripe` ^0.1.3 - Convex-native Stripe subscription component
- `ai` ^6.0.62 - Vercel AI SDK core (streaming, generateObject, etc.)
- `zod` ^4.3.6 - Runtime validation throughout

**AI Provider SDKs (Vercel AI SDK adapters):**
- `@ai-sdk/anthropic` ^3.0.31 - Claude models
- `@ai-sdk/openai` ^3.0.23 - OpenAI/GPT models
- `@ai-sdk/google` ^3.0.18 - Gemini models
- `@ai-sdk/deepseek` ^2.0.15 - DeepSeek models (default server provider)
- `@ai-sdk/azure` ^3.0.26 - Azure OpenAI
- `@openrouter/ai-sdk-provider` ^6.0.0-alpha.1 - OpenRouter proxy

**Infrastructure:**
- `@convex-dev/rag` ^0.7.0 - RAG (Retrieval Augmented Generation) component for PDF indexing
- `@convex-dev/workflow` ^0.3.4 - Durable workflow orchestration for extraction jobs
- `@convex-dev/workpool` ^0.3.1 - Concurrent work queue for per-paper processing
- `convex-helpers` ^0.1.111 - Rate limiting tables + utility helpers
- `svix` ^1.86.0 - Clerk webhook signature verification
- `pdfjs-dist` ^5.4.296 - PDF text extraction (client + server)
- `react-pdf` ^10.1.0 - PDF rendering in browser
- `cheerio` ^1.2.0 - HTML/XML parsing (TEI XML from GROBID)
- `exceljs` ^4.4.0 - Excel export for extraction results
- `jsonrepair` ^3.13.2 - Repair malformed AI JSON outputs
- `posthog-js` ^1.342.1 - Analytics and AI generation tracking
- `date-fns` ^4.1.0 - Date formatting
- `@sickrin/openalex-sdk` ^1.0.0 - OpenAlex API client

## Configuration

**Environment:**
- Configured via `.env.local` (present, not committed)
- Synced to Convex via `sync-env.sh` script (`npx convex env set`)
- Feature flags controlled by `NEXT_PUBLIC_*` boolean env vars

**Key env vars (by category):**
- Auth: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Convex: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CREDITS_PRODUCT_ID`
- AI: `AI_PROVIDER`, `AI_MODEL`, `OPENROUTER_PROVIDER_ORDER`, `OPENROUTER_ALLOW_FALLBACKS`
- Encryption: `ENCRYPTION_KEY` (for BYOK and Zotero key encryption at rest)
- Analytics: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_KEY`, `POSTHOG_HOST`
- GROBID: `GROBID_URL`, `GROBID_TIMEOUT_MS`
- Zotero OAuth: `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET`
- Feature flags: `NEXT_PUBLIC_CREDITS_ENABLED`, `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`, `NEXT_PUBLIC_EXTRACTION_ENABLED`, `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED`, `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`
- OpenAlex: `OPENALEX_CONTACT_EMAIL`
- Credits: `CREDITS_PER_USD`, `EXTRACTION_EMBEDDING_USD_PER_*`

**Build:**
- `next.config.ts` - PostHog proxy rewrites, React Compiler, next-intl
- `tsconfig.json` - Strict TypeScript, `@/*` path alias mapping to project root
- `postcss.config.mjs` - Tailwind v4 PostCSS plugin

## Platform Requirements

**Development:**
- Node.js 20.x
- PM2 for concurrent Next.js + Convex dev (`npm run dev:all`)
- GROBID service accessible (Docker: `http://grobid:8070` or local: `http://localhost:8070`)
- Convex account or self-hosted instance

**Production:**
- Convex cloud deployment (or self-hosted Convex)
- Next.js deployment target (Vercel or compatible Node.js host)
- GROBID service for PDF parsing
- Stripe account for billing
- Clerk account for auth

---

*Stack analysis: 2026-03-04*
