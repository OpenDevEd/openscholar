# Technology Stack

**Analysis Date:** 2026-03-06

## Languages

**Primary:**
- TypeScript ^5 - All application code (frontend, backend, shared libs)

**Secondary:**
- JavaScript - PM2 config (`ecosystem.config.js`)

## Runtime

**Environment:**
- Node.js (version not pinned; no `.nvmrc` or `.node-version` detected)
- Convex backend runtime (edge-runtime for Convex functions, Node.js for `"use node"` actions)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js ^16.1.6 - Full-stack React framework (App Router, RSC enabled)
- React ^19.2.4 - UI library
- Convex ^1.31.7 - Backend-as-a-service (database, functions, file storage, scheduling)

**UI:**
- Radix UI ^1.4.3 - Headless component primitives
- shadcn/ui (new-york style) - Component library (`components.json`)
- Tailwind CSS ^4 - Utility-first CSS
- Lucide React ^0.487.0 - Icon library
- Motion ^12.23.12 - Animation library (Framer Motion successor)
- Vaul ^1.1.2 - Drawer component
- cmdk ^1.1.1 - Command palette

**Testing:**
- Vitest ^3.2.4 - Unit/integration test runner (config: `vitest.config.ts`)
- convex-test ^0.0.41 - Convex function testing (edge-runtime environment)
- Testing Library (React ^16.3.2, DOM ^10.4.1, User Event ^14.6.1, jest-dom ^6.9.1) - Component testing
- Playwright ^1.58.2 - E2E testing (config: `playwright.config.ts`)
- jsdom ^28.1.0 - DOM simulation for hook/component tests
- @edge-runtime/vm ^5.0.0 - Edge runtime simulation for Convex tests

**Build/Dev:**
- Turbopack - Dev server (`next dev --turbopack`)
- React Compiler (babel-plugin-react-compiler ^1.0.0) - Auto-memoization (`reactCompiler: true` in `next.config.ts`)
- PostCSS with @tailwindcss/postcss ^4
- PM2 - Local dev process management (`ecosystem.config.js` runs Next.js + Convex dev)
- Knip ^5.84.1 - Dead code detection (`knip.json`)

## Key Dependencies

**Critical:**
- `ai` ^6.0.62 (Vercel AI SDK) - Core AI orchestration layer
- `@ai-sdk/openai` ^3.0.23 - OpenAI provider
- `@ai-sdk/anthropic` ^3.0.31 - Anthropic provider
- `@ai-sdk/google` ^3.0.18 - Google AI provider
- `@ai-sdk/deepseek` ^2.0.15 - DeepSeek provider
- `@ai-sdk/azure` ^3.0.26 - Azure OpenAI provider
- `@openrouter/ai-sdk-provider` ^6.0.0-alpha.1 - OpenRouter provider
- `@sickrin/openalex-sdk` ^1.0.0 - OpenAlex academic paper API client
- `stripe` ^20.3.0 - Stripe billing SDK
- `@clerk/nextjs` ^6.38.2 - Authentication

**Infrastructure (Convex Components):**
- `@convex-dev/stripe` ^0.1.3 - Stripe webhook integration for Convex
- `@convex-dev/rag` ^0.7.0 - RAG (Retrieval-Augmented Generation) pipeline
- `@convex-dev/workflow` ^0.3.4 - Durable workflow execution
- `@convex-dev/workpool` ^0.3.1 - Parallel job processing with concurrency control
- `convex-helpers` ^0.1.111 - Rate limiting tables, utilities

**State & Data:**
- `zustand` ^5.0.5 - Client-side state management
- `nuqs` ^2.6.0 - URL query string state (with Next.js adapter)
- `swr` ^2.3.3 - Data fetching/caching
- `zod` ^4.3.6 - Runtime schema validation

**Content & Export:**
- `pdfjs-dist` ^5.4.296 / `react-pdf` ^10.1.0 - PDF rendering
- `exceljs` ^4.4.0 - Excel export
- `react-markdown` ^10.1.0 / `remark-gfm` ^4.0.1 - Markdown rendering
- `jsonrepair` ^3.13.2 - JSON repair for AI output

**Internationalization:**
- `next-intl` ^4.8.2 - i18n framework
- `@clerk/localizations` ^3.37.0 - Clerk UI translations
- `@formatjs/intl-localematcher` ^0.8.1 - Locale matching
- Supported locales: en-US, en-GB, zh, fr, hi, ja (config: `i18n/config.ts`)
- Translation files: `messages/{locale}.json`

**Analytics:**
- `posthog-js` ^1.342.1 - Product analytics, error tracking, heatmaps

**Other:**
- `svix` ^1.86.0 - Webhook signature verification (Clerk webhooks)
- `sonner` ^2.0.7 - Toast notifications
- `date-fns` ^4.1.0 - Date utilities
- `next-themes` ^0.4.6 - Dark/light theme
- `class-variance-authority` ^0.7.1 / `clsx` ^2.1.1 / `tailwind-merge` ^3.4.1 - CSS class utilities
- `react-day-picker` ^9.13.2 - Date picker component

## Configuration

**Environment:**
- `.env.local` present (contains secrets - never read)
- Required env vars validated by cron (`convex/lib/envValidation.ts`):
  - `STRIPE_SECRET_KEY`
  - `ENCRYPTION_KEY` (AES-256-GCM for API key encryption)
  - `STRIPE_GO_PRICE_ID`
  - `STRIPE_PRO_PRICE_ID`
  - `STRIPE_WEBHOOK_SECRET`
  - `CLERK_JWT_ISSUER_DOMAIN`
- Additional env vars used:
  - `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_URL` - Frontend URL
  - `NEXT_PUBLIC_POSTHOG_KEY` - PostHog project key
  - `NEXT_PUBLIC_POSTHOG_HOST` - PostHog host
  - `AI_PROVIDER` - Default AI provider (defaults to `deepseek`)
  - `AI_MODEL` - Default AI model (defaults to `deepseek-chat`)
  - `OPENROUTER_PROVIDER_ORDER` - Comma-separated provider routing
  - `OPENROUTER_ALLOW_FALLBACKS` - OpenRouter fallback toggle
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_PUBLISHABLE_KEY`
- Sync script: `sync-env.sh`

**TypeScript:**
- Config: `tsconfig.json`
- Target: ES2017, Module: ESNext, Module Resolution: Bundler
- Strict mode enabled
- Path alias: `@/*` maps to project root
- Separate Convex tsconfig: `convex/tsconfig.json`

**Build:**
- `next.config.ts` - Next.js config with next-intl plugin, PostHog proxy rewrites, React Compiler
- `postcss.config.mjs` - PostCSS with Tailwind
- `vitest.config.ts` - Unit tests (environment-matched: edge-runtime for Convex, jsdom for React)
- `vitest.live.config.ts` - Live billing integration tests
- `playwright.config.ts` - E2E tests (120s timeout, 2 projects: default + billing)

## Platform Requirements

**Development:**
- Node.js (recent LTS recommended for Next.js 16 / React 19)
- npm for package management
- PM2 for running Next.js + Convex dev servers concurrently (`npm run dev:all`)
- Convex CLI for backend development (`npx convex dev`)

**Production:**
- Next.js deployment target (Vercel or similar)
- Convex cloud for backend (database, functions, file storage, scheduling, crons)
- Stripe account for billing
- Clerk account for authentication
- PostHog instance (EU region, proxied through Next.js rewrites)

---

*Stack analysis: 2026-03-06*
