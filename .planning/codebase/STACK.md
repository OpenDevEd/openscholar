# Technology Stack

**Analysis Date:** 2026-02-27

## Languages

**Primary:**
- TypeScript 5.x - All application code (frontend, backend, Convex functions)

**Secondary:**
- JavaScript - Config files (`ecosystem.config.js`, `postcss.config.mjs`, Convex-related scripts)
- Bash - Environment sync script (`sync-env.sh`)

## Runtime

**Environment:**
- Node.js v20 (`.nvmrc` pinned to `v20.20.0`)

**Package Manager:**
- npm (package-lock.json present)
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- Next.js ^16.1.6 - Full-stack React framework (App Router, Server Components)
- React ^19.2.4 - UI rendering
- Convex ^1.31.7 - Backend-as-a-service (database, real-time queries, actions, cron jobs)

**Internationalisation:**
- next-intl ^4.8.2 - i18n with locale-aware routing; configured via `i18n/request.ts`

**AI SDK:**
- `ai` ^6.0.62 (Vercel AI SDK) - Unified LLM abstraction layer
- `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/deepseek`, `@ai-sdk/azure`, `@ai-sdk/cohere` - Provider adapters
- `@openrouter/ai-sdk-provider` - OpenRouter aggregator adapter
- `ollama` + `ollama-ai-provider-v2` - Local model support

**UI / Component Library:**
- Tailwind CSS ^4 - Utility-first CSS
- Radix UI - Accessible headless primitives (dialog, dropdown, select, tabs, tooltip, etc.)
- shadcn - Component generator tooling; config at `components.json`
- lucide-react ^0.487.0 - Icon set
- motion ^12.23.12 - Animation
- sonner ^2.0.7 - Toast notifications
- vaul ^1.1.2 - Drawer component
- cmdk ^1.1.1 - Command palette
- class-variance-authority + clsx + tailwind-merge - Class utilities
- next-themes ^0.4.6 - Dark/light mode

**State & Data:**
- zustand ^5.0.5 - Global client state
- swr ^2.3.3 - Client-side data fetching
- nuqs ^2.6.0 - URL search param state management
- zod ^4.3.6 - Schema validation throughout

**Testing:**
- vitest ^3.2.4 - Unit/integration test runner
- @playwright/test ^1.58.2 - End-to-end browser testing
- @clerk/testing ^1.14.1 - Clerk auth helpers for E2E

**Build/Dev:**
- Turbopack (via `next dev --turbopack`) - Fast development bundler
- pm2 (via `ecosystem.config.js`) - Concurrent dev process management (Next + Convex)
- knip ^5.84.1 - Unused exports/imports detection
- babel-plugin-react-compiler - React compiler optimisations

## Key Dependencies

**Critical:**
- `convex` ^1.31.7 - Primary database and backend runtime
- `@clerk/nextjs` ^6.38.2 - Authentication
- `stripe` ^20.3.0 - Payment processing
- `@convex-dev/stripe` ^0.1.3 - Convex Stripe integration component
- `@convex-dev/rag` ^0.7.0 - Retrieval-augmented generation for PDF extraction
- `@convex-dev/workflow` ^0.3.4 - Durable workflow execution
- `@convex-dev/workpool` ^0.3.1 - Concurrent action scheduling
- `@sickrin/openalex-sdk` ^1.0.0 - OpenAlex academic literature API client
- `posthog-js` ^1.342.1 - Product analytics + AI observability
- `svix` ^1.86.0 - Webhook verification (Clerk webhook payloads)

**Infrastructure:**
- `react-pdf` ^10.1.0 + `unpdf` ^1.4.0 - PDF rendering and text extraction
- `cheerio` ^1.2.0 - HTML/XML parsing (used for GROBID TEI output)
- `jsonrepair` ^3.13.2 - Repairing malformed AI JSON outputs
- `date-fns` ^4.1.0 - Date utilities
- `xlsx` ^0.18.5 - Excel export
- `react-markdown` + `remark-gfm` - Markdown rendering
- `next-intl` ^4.8.2 - Internationalisation

## Configuration

**Environment:**
- `.env.local` - Primary local config file
- `sync-env.sh` - Syncs `.env.local` variables to Convex cloud environment
- Key env vars required:
  - `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - Clerk auth
  - `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT domain for Convex auth config
  - `CLERK_WEBHOOK_SECRET` - Svix webhook verification
  - `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` - Stripe billing
  - `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` - PostHog analytics
  - `AI_PROVIDER` / `AI_MODEL` - Default server-side AI provider/model
  - `GROBID_URL` - Self-hosted GROBID PDF parser (default: `http://localhost:8070`)
  - `NEXT_PUBLIC_APP_URL` - Public frontend URL

**Build:**
- `next.config.ts` - Next.js config with next-intl plugin and PostHog proxy rewrites
- `tsconfig.json` - TypeScript strict mode, `@/*` path alias for project root
- `postcss.config.mjs` - PostCSS with Tailwind v4
- `vitest.config.ts` - Unit tests in `tests/` (excludes `live-billing/`)
- `vitest.live.config.ts` - Live billing integration tests
- `playwright.config.ts` - E2E tests in `e2e/`

## Platform Requirements

**Development:**
- Node.js 20+
- npm
- Convex CLI (`npx convex dev`) for backend dev
- pm2 optional (for `dev:all` concurrent mode)
- GROBID instance for PDF extraction features (self-hosted or Docker)

**Production:**
- Convex cloud (backend/database hosting)
- Next.js deployment target (Vercel or Node server)
- Stripe account + webhook endpoint registration
- Clerk account
- PostHog instance (EU region used: `eu.i.posthog.com`)

---

*Stack analysis: 2026-02-27*
