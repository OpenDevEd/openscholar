# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- TypeScript 5.x - All application code (frontend, backend, tests)

**Secondary:**
- JavaScript - Config files only (`ecosystem.config.js`, `scripts/*.mjs`)

## Runtime

**Environment:**
- Node.js 20.x (local dev: `v20.20.0`; CI uses Node 22)
- Convex backend runs in edge-runtime (V8 isolates, not Node) for most functions
- Convex actions that require Node APIs use `"use node"` directive (e.g. `convex/zotero/actions.ts`, `convex/extraction/grobid.ts`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js `^16.1.6` - React full-stack framework (App Router); Turbopack used in dev (`next dev --turbopack`)
- Convex `^1.31.7` - Backend-as-a-service: database, serverless functions, real-time subscriptions
- React `^19.2.4` - UI library (uses React Compiler via `babel-plugin-react-compiler`)

**UI / Styling:**
- Tailwind CSS `^4` - Utility-first CSS
- Radix UI `^1.4.3` - Unstyled accessible component primitives
- shadcn CLI `^3.8.5` - Component scaffolding (config: `components.json`)
- `class-variance-authority` `^0.7.1` - Variant-based component styling
- `tailwind-merge` `^3.4.1` - Class merging utility
- `lucide-react` `^0.487.0` - Icon set
- `motion` `^12.23.12` - Animation library (Framer Motion successor)
- `sonner` `^2.0.7` - Toast notifications
- `vaul` `^1.1.2` - Drawer component
- `cmdk` `^1.1.1` - Command palette
- `next-themes` `^0.4.6` - Dark/light theme toggle

**Internationalisation:**
- `next-intl` `^4.8.2` - i18n for Next.js App Router
- `@formatjs/intl-localematcher` `^0.8.1` - Locale detection
- Supported locales: `en-US`, `en-GB`, `fr`, `hi`, `ja`, `zh` (message files in `messages/`)

**AI / LLM:**
- Vercel AI SDK `ai ^6.0.62` - Unified LLM interface
- `@ai-sdk/anthropic` `^3.0.31` - Anthropic (Claude) provider
- `@ai-sdk/azure` `^3.0.26` - Azure OpenAI provider
- `@ai-sdk/deepseek` `^2.0.15` - DeepSeek provider (default server model: `deepseek-chat`)
- `@ai-sdk/google` `^3.0.18` - Google Gemini provider
- `@ai-sdk/openai` `^3.0.23` - OpenAI provider
- `@openrouter/ai-sdk-provider` `^6.0.0-alpha.1` - OpenRouter provider
- Server AI provider configured via env: `AI_PROVIDER` / `AI_MODEL` (`convex/ai/config.ts`)
- Client-side BYOK: users can supply their own API keys for `openai`, `anthropic`, `google`, `openrouter`

**Convex Components (add-on packages):**
- `@convex-dev/stripe` `^0.1.3` - Stripe subscription helpers (`convex/stripe.ts`, `convex/convex.config.ts`)
- `@convex-dev/rag` `^0.7.0` - Retrieval-augmented generation for PDF indexing
- `@convex-dev/workflow` `^0.3.4` - Durable workflow execution
- `@convex-dev/workpool` `^0.3.1` - Concurrency-limited background work queues

**State / Data Management:**
- `zustand` `^5.0.5` - Client-side global state (`lib/store.ts`)
- `swr` `^2.3.3` - Data fetching / cache
- `nuqs` `^2.6.0` - URL query string state management (synced with Next.js App Router)

**PDF / Document:**
- `pdfjs-dist` `^5.4.296` - PDF parsing in browser/edge
- `react-pdf` `^10.1.0` - React PDF viewer component
- GROBID - External self-hosted service for academic PDF structure extraction; URL configured via `GROBID_URL` env var (default: `http://localhost:8070`)
- `cheerio` `^1.2.0` - HTML/XML parsing (used by GROBID response parser)

**Data / Utilities:**
- `zod` `^4.3.6` - Runtime schema validation
- `date-fns` `^4.1.0` - Date utilities
- `xlsx` `^0.18.5` - Excel export
- `jsonrepair` `^3.13.2` - Repair malformed AI JSON output
- `react-markdown` + `remark-gfm` - Markdown rendering
- `@sickrin/openalex-sdk` `^1.0.0` - OpenAlex academic search API client (`lib/openalex.ts`)
- `svix` `^1.86.0` - Clerk webhook signature verification

**Testing:**
- Vitest `^3.2.4` - Unit/integration test runner (config: `vitest.config.ts`, live billing: `vitest.live.config.ts`)
- `convex-test` `^0.0.41` - In-memory Convex test harness
- `@playwright/test` `^1.58.2` - End-to-end browser tests (config: `playwright.config.ts`)
- `@testing-library/react` `^16.3.2` + `@testing-library/dom` + `@testing-library/user-event` - React component tests
- `@testing-library/jest-dom` `^6.9.1` - DOM matchers
- `@clerk/testing` `^1.14.1` - Clerk auth helpers for E2E
- `jsdom` `^28.1.0` - DOM environment for non-browser tests
- `@edge-runtime/vm` `^5.0.0` - Edge runtime environment for Convex function tests

**Build / Dev:**
- TypeScript `^5` - Compiler (strict mode, `tsconfig.json`)
- `@tailwindcss/postcss` `^4` + `postcss.config.mjs` - CSS processing
- `knip` `^5.84.1` - Unused exports/files detection (config: `knip.json`)
- PM2 (via `ecosystem.config.js`) - Runs Next.js dev + Convex dev concurrently in development

## Key Dependencies

**Critical:**
- `convex ^1.31.7` - All backend data and business logic lives in Convex; removing this would require a full backend rewrite
- `@clerk/nextjs ^6.38.2` - Auth is entirely delegated to Clerk; session management, JWTs, user sync
- `stripe ^20.3.0` - Billing and subscription management
- `ai ^6.0.62` + AI SDK providers - All LLM calls go through Vercel AI SDK

**Infrastructure:**
- `convex-helpers ^0.1.111` - Rate limiting tables and utilities (`rateLimitTables` in `convex/schema.ts`)
- `@convex-dev/rag ^0.7.0` - PDF content indexing for extraction jobs

## Configuration

**Environment:**
- Primary config file: `.env.local` (not committed)
- Convex env vars synced via `./sync-env.sh` script (`npx convex env set`)
- Feature flags controlled via `NEXT_PUBLIC_*` env vars:
  - `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED`
  - `NEXT_PUBLIC_CREDITS_ENABLED`
  - `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED`
  - `NEXT_PUBLIC_EXTRACTION_ENABLED`
  - `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED`
  - `NEXT_PUBLIC_EXTRACTION_INSIGHTS`
  - `NEXT_PUBLIC_EXTRACTION_REPORT_BUILDER`
  - `NEXT_PUBLIC_EXTRACTION_REVIEW_QUEUE`

**Build:**
- `next.config.ts` - Next.js config; enables React Compiler, PostHog proxy rewrites
- `tsconfig.json` - TypeScript config; path alias `@/*` maps to project root
- `postcss.config.mjs` - PostCSS with Tailwind CSS v4

## Platform Requirements

**Development:**
- Node.js 20+ (CI uses Node 22)
- npm
- PM2 for concurrent dev processes (`npm run dev:all`)
- Optional: GROBID Docker container for PDF structure extraction (`http://localhost:8070`)
- Convex account and project (CLI: `npx convex dev`)

**Production:**
- Convex cloud deployment (backend, database, file storage)
- Next.js hosting (Vercel or any Node.js host)
- External service accounts required: Clerk, Stripe, PostHog (EU region)
- Optional self-hosted GROBID instance for full PDF extraction

---

*Stack analysis: 2026-03-03*
