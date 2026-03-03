# Technology Stack

**Analysis Date:** 2026-03-03

## Languages

**Primary:**
- TypeScript 5.x - All application code (frontend, backend, Convex functions)

**Secondary:**
- JavaScript (ES modules) - `ecosystem.config.js`, `scripts/billing-preflight.mjs`
- CSS - `app/globals.css` (Tailwind v4 utility classes)

## Runtime

**Environment:**
- Node.js 22.x (`@types/node: ^22`)
- Edge Runtime - Convex functions marked `"use node"` opt into Node; others run in Convex edge runtime

**Package Manager:**
- npm
- Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- Next.js ^16.1.6 - Full-stack React framework, App Router (`app/` directory)
- React 19.2.4 - UI rendering, concurrent features
- Convex ^1.31.7 - Backend-as-a-service: database, functions, file storage, cron jobs, real-time subscriptions
- next-intl ^4.8.2 - Internationalization (i18n), locale-aware routing via `i18n/request.ts`

**UI Component Library:**
- Radix UI (headless, ~15 packages) - Primitives: dialogs, dropdowns, selects, tooltips, etc.
- shadcn/ui - Component scaffolding over Radix (`components.json`)
- Tailwind CSS v4 - Utility-first CSS, configured via `postcss.config.mjs`
- lucide-react ^0.487.0 - Icon library
- motion ^12.23.12 - Animation (Framer Motion successor)
- sonner ^2.0.7 - Toast notifications
- vaul ^1.1.2 - Drawer component
- cmdk ^1.1.1 - Command palette
- react-day-picker ^9.13.2 - Date picker
- next-themes ^0.4.6 - Dark/light theme toggling

**Testing:**
- Vitest ^3.2.4 - Unit/integration test runner (`vitest.config.ts`)
- convex-test ^0.0.41 - Convex function testing (edge-runtime environment)
- Playwright ^1.58.2 - End-to-end tests (`playwright.config.ts`, `e2e/`)
- @testing-library/react ^16.3.2 - React component testing
- jsdom ^28.1.0 - DOM simulation for hook/component tests

**Build/Dev:**
- Turbopack - Dev bundler (`next dev --turbopack`)
- PM2 - Process manager for `next dev` + `convex dev` in parallel (`ecosystem.config.js`)
- React Compiler (babel-plugin-react-compiler ^1.0.0) - Enabled via `reactCompiler: true` in `next.config.ts`

## Key Dependencies

**Critical:**
- `convex ^1.31.7` - Primary backend: database, mutations, queries, actions, file storage, scheduling
- `@clerk/nextjs ^6.38.2` - Authentication, user identity, JWT-based auth for Convex
- `stripe ^20.3.0` - Billing SDK used in Convex actions
- `ai ^6.0.62` - Vercel AI SDK core, `generateObject` for structured LLM calls
- `@sickrin/openalex-sdk ^1.0.0` - OpenAlex academic paper search API client (`lib/openalex.ts`)
- `zod ^4.3.6` - Schema validation for AI output and Convex action arguments
- `zustand ^5.0.5` - Client-side state management (`lib/store/`)

**Convex Components (self-hosted modules):**
- `@convex-dev/stripe ^0.1.3` - Stripe subscription management component (`convex/stripe.ts`)
- `@convex-dev/rag ^0.7.0` - RAG (Retrieval-Augmented Generation) component for PDF indexing/retrieval
- `@convex-dev/workflow ^0.3.4` - Durable workflow orchestration for extraction jobs
- `@convex-dev/workpool ^0.3.1` - Concurrent work queue for per-paper extraction

**AI Provider SDKs:**
- `@ai-sdk/openai ^3.0.23` - OpenAI models (GPT-4o, o3, o4-mini, etc.)
- `@ai-sdk/anthropic ^3.0.31` - Anthropic Claude models
- `@ai-sdk/google ^3.0.18` - Google Gemini models
- `@ai-sdk/deepseek ^2.0.15` - DeepSeek models (default server AI provider)
- `@ai-sdk/azure ^3.0.26` - Azure OpenAI
- `@ai-sdk/cohere ^3.0.19` - Cohere models
- `@openrouter/ai-sdk-provider ^6.0.0-alpha.1` - OpenRouter multi-model gateway
- `ollama ^0.6.3` - Local Ollama models
- `ollama-ai-provider-v2 ^2.0.0` - Ollama Vercel AI SDK provider

**Infrastructure:**
- `convex-helpers ^0.1.111` - Rate limiting tables, utilities
- `posthog-js ^1.342.1` - Client-side product analytics
- `svix ^1.86.0` - Clerk webhook signature verification
- `nuqs ^2.6.0` - URL search param state management
- `swr ^2.3.3` - Client-side data fetching
- `date-fns ^4.1.0` - Date utility library
- `jsonrepair ^3.13.2` - Repairs malformed JSON from AI responses
- `cheerio ^1.2.0` - HTML parsing (GROBID XML response parsing)
- `unpdf ^1.4.0` + `react-pdf ^10.1.0` - PDF rendering and text extraction
- `xlsx ^0.18.5` - Export extraction results to Excel

## Configuration

**Environment:**
- Development: `.env.local` (not committed)
- Convex env vars synced via `sync-env.sh` (uses `npx convex env set`)
- Feature flags controlled via `NEXT_PUBLIC_*` env vars (all default ON unless explicitly `"false"`)

**Key required env vars:**
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL
- `NEXT_PUBLIC_CONVEX_SITE_URL` - Convex HTTP actions base URL
- `CLERK_JWT_ISSUER_DOMAIN` - Clerk JWT domain for Convex auth
- `CLERK_WEBHOOK_SIGNING_SECRET` - Svix webhook verification
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- `STRIPE_CREDITS_PRODUCT_ID`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` - Billing plan IDs
- `ZOTERO_CLIENT_KEY`, `ZOTERO_CLIENT_SECRET` - Zotero OAuth 1.0a credentials
- `ENCRYPTION_KEY` - AES key for encrypting API keys and Zotero tokens at rest
- `AI_PROVIDER`, `AI_MODEL` - Default server-side AI provider (defaults: `deepseek`, `deepseek-chat`)
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` - Analytics
- `GROBID_URL` - GROBID service URL for PDF text extraction (default: `http://localhost:8070`)
- `OPENALEX_CONTACT_EMAIL` - OpenAlex API User-Agent contact email

**Feature flags (NEXT_PUBLIC env vars):**
- `NEXT_PUBLIC_CREDITS_ENABLED` - Enable credit system
- `NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED` - Enable credit top-ups
- `NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED` - Enable subscription plans
- `NEXT_PUBLIC_EXTRACTION_ENABLED` - Enable extraction feature
- `NEXT_PUBLIC_EXTRACTION_PDF_ENABLED` - Enable PDF processing in extraction
- `NEXT_PUBLIC_EXTRACTION_INSIGHTS` - Enable extraction insights
- `NEXT_PUBLIC_EXTRACTION_REVIEW_QUEUE` - Enable review queue
- `NEXT_PUBLIC_EXTRACTION_REPORT_BUILDER` - Enable report builder

**Build:**
- `tsconfig.json` - TypeScript config targeting ES2017, strict mode, path alias `@/*` → `./`
- `convex/tsconfig.json` - Separate TS config for Convex backend
- `next.config.ts` - Next.js config with next-intl plugin, PostHog proxy rewrites
- `postcss.config.mjs` - Tailwind v4 PostCSS config
- `knip.json` - Dead code detection

## Platform Requirements

**Development:**
- Node.js 22+
- npm
- PM2 for concurrent dev: `npm run dev:all` starts Next.js + Convex dev server
- Optional: GROBID service running at `localhost:8070` for PDF extraction

**Production:**
- Convex cloud (managed backend)
- Vercel or equivalent Next.js hosting
- GROBID service accessible at `GROBID_URL` (Docker container: `http://grobid:8070`)

---

*Stack analysis: 2026-03-03*
