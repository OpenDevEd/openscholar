# Technology Stack

**Analysis Date:** 2026-04-14

## Languages

**Primary:**
- TypeScript ~5 (strict mode enabled) — application code, Convex functions, tests
- TSX (React 19) — UI components and pages under `app/`, `components/`

**Secondary:**
- JavaScript (ESM) — `ecosystem.config.js`, `scripts/billing-preflight.mjs`, `postcss.config.mjs`
- Bash — `sync-env.sh` (Convex env sync helper)

## Runtime

**Environment:**
- Node.js 22 (pinned in `.github/workflows/ci.yml`)
- Convex Deno-like runtime for backend functions in `convex/` (isolated from Node); selected files opt into Node via `"use node";` directive (e.g. `convex/zotero/actions.ts`, `convex/models/sync.ts`, `convex/webhooks/actions.ts`, `convex/credits/actions.ts`)
- Edge Runtime for Convex HTTP actions and tests (via `@edge-runtime/vm`)

**Package Manager:**
- npm (inferred from `package-lock.json` and `npm ci` usage in CI)
- Lockfile: `package-lock.json` present
- Process manager for combined dev: PM2 via `ecosystem.config.js` (runs `next` + `convex` concurrently)

## Frameworks

**Core:**
- Next.js ^16.1.6 — App Router, React Server Components, Turbopack dev (`next dev --turbopack`), React Compiler enabled (`reactCompiler: true` in `next.config.ts`)
- React ^19.2.4 + React DOM ^19.2.4 — with `babel-plugin-react-compiler` ^1.0.0
- Convex ^1.34.1 — reactive backend (database, queries, mutations, actions, HTTP endpoints, crons, workflows)

**Testing:**
- Vitest ^3.2.4 — unit + contract test runner (`vitest.config.ts`, `vitest.live.config.ts`)
- `@vitejs/plugin-react` ^5.1.4 — React support in Vitest
- `convex-test` ^0.0.46 — Convex function testing harness (runs in `edge-runtime` env)
- `@edge-runtime/vm` ^5.0.0 — edge runtime emulation for Convex tests
- `jsdom` ^28.1.0 — DOM env for React hook/component tests under `tests/hooks/**`, `tests/components/**`
- `@testing-library/react` ^16.3.2, `@testing-library/dom` ^10.4.1, `@testing-library/jest-dom` ^6.9.1, `@testing-library/user-event` ^14.6.1
- Playwright ^1.58.2 (`@playwright/test`) — e2e tests (`playwright.config.ts`, `e2e/`); projects: `default`, `billing`

**Build/Dev:**
- Turbopack — dev bundler (`next dev --turbopack`)
- Next.js bundler — production build (`next build`)
- TypeScript ^5 — type-checking (`tsc` via `tsconfig.json`, separate `convex/tsconfig.json`)
- Knip ^5.84.1 — unused code detection (`knip.json`)
- shadcn ^3.8.5 CLI — component scaffolding (config at `components.json`, style "new-york", base color neutral, Lucide icons)

## Key Dependencies

**Critical:**
- `@clerk/nextjs` ^6.38.2 — authentication provider wrapper
- `@clerk/backend` ^2.32.1 — server-side Clerk SDK (dev dependency for tests)
- `@clerk/localizations` ^3.37.0, `@clerk/themes` ^2.4.55 — Clerk UI localization/appearance
- `@clerk/testing` ^1.14.1 — Playwright Clerk auth fixtures
- `convex` ^1.34.1 — backend client and server runtime
- `convex-helpers` ^0.1.114 — rate limiting (`rateLimitTables`) and utilities
- `@convex-dev/stripe` ^0.1.4 — Stripe subscriptions component for Convex
- `@convex-dev/rag` ^0.7.2 — retrieval-augmented generation component
- `@convex-dev/workflow` ^0.3.9 — durable workflow manager (`convex/workflow.ts`)
- `@convex-dev/workpool` ^0.3.2 — bounded-parallelism worker pools (`convex/workpool.ts`, used as `workpool` and named `screeningWorkpool`)
- `stripe` ^20.3.0 — Stripe Node SDK (used in `convex/credits/actions.ts`, `convex/subscriptions/actions.ts`, `convex/maintenance/internal.ts`, `convex/lib/stripeCustomer.ts`, `scripts/billing-preflight.mjs`, `tests/live-billing/support.ts`, `e2e/billing/stripe-helpers.ts`)
- `svix` ^1.86.0 — Clerk webhook signature verification (`convex/webhooks/actions.ts`)
- `ai` ^6.0.62 — Vercel AI SDK core (`streamText`, `generateText`)
- `@ai-sdk/openai` ^3.0.23, `@ai-sdk/anthropic` ^3.0.31, `@ai-sdk/google` ^3.0.18, `@ai-sdk/azure` ^3.0.26, `@ai-sdk/deepseek` ^2.0.15 — AI provider adapters (see `lib/ai/server/providers.ts`)
- `@openrouter/ai-sdk-provider` ^6.0.0-alpha.1 — OpenRouter provider with custom routing
- `@sickrin/openalex-sdk` ^1.0.0 — OpenAlex API client (`lib/openalex.ts`)
- `next-intl` ^4.8.2 — i18n plugin and runtime (`i18n/request.ts`, wired via `next.config.ts`)

**UI / State / Frontend:**
- `radix-ui` ^1.4.3 — unstyled UI primitives
- `lucide-react` ^0.487.0 — icon library
- `class-variance-authority` ^0.7.1, `clsx` ^2.1.1, `tailwind-merge` ^3.4.1 — class composition helpers
- `tailwindcss` ^4, `@tailwindcss/postcss` ^4, `tw-animate-css` ^1.4.0 — styling
- `cmdk` ^1.1.1 — command palette
- `vaul` ^1.1.2 — drawer component
- `sonner` ^2.0.7 — toast notifications
- `next-themes` ^0.4.6 — theme switcher (light/dark)
- `react-day-picker` ^9.13.2 — date picker (overridden to React 19 in `package.json.overrides`)
- `react-markdown` ^10.1.0 + `remark-gfm` ^4.0.1 — markdown rendering
- `react-pdf` ^10.1.0 + `pdfjs-dist` ^5.4.296 — in-browser PDF viewer (`components/extraction/pdf-viewer.tsx`)
- `motion` ^12.23.12 — spring-based animations (Motion)
- `nuqs` ^2.6.0 — URL query-param state (`NuqsAdapter` in `app/layout.tsx`)
- `zustand` ^5.0.5 — client store (`lib/store.ts`, `lib/store/`)
- `swr` ^2.3.3 — client data fetching
- `zod` ^4.3.6 — schema validation
- `date-fns` ^4.1.0 — date utilities

**Infrastructure / Utilities:**
- `exceljs` ^4.4.0 — Excel export (dynamically imported; see `.planning/research/PITFALLS.md`)
- `jsonrepair` ^3.13.2 — tolerant JSON parsing
- `glob` ^13.0.6 — file matching
- `@formatjs/intl-localematcher` ^0.8.1 — locale negotiation
- `@next/third-parties` ^16.2.2 — Google Analytics wrapper
- `posthog-js` ^1.342.1 — product analytics + error tracking (client) + server helpers in `lib/posthog-server.ts`

## Configuration

**TypeScript:**
- Root: `tsconfig.json` — `strict: true`, `target: ES2017`, `moduleResolution: bundler`, path alias `@/*` → `./*`, includes `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`
- Convex: `convex/tsconfig.json` — `target: ESNext`, `lib: [ES2021, dom]`, strict, excludes `_generated/`
- Next type plugin: `{ "name": "next" }`
- Global types: `global.d.ts`, `next-env.d.ts`

**Next.js (`next.config.ts`):**
- `reactCompiler: true` — React Compiler enabled
- `devIndicators: false`, `poweredByHeader: false`
- Security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (HSTS preload), `Permissions-Policy` (camera/mic/geolocation disabled), `X-DNS-Prefetch-Control: off`
- Rewrites: `/data/static/:path*` → `https://eu-assets.i.posthog.com/static/:path*` and `/data/:path*` → `https://eu.i.posthog.com/:path*` (PostHog reverse-proxy)
- `skipTrailingSlashRedirect: true` (required for PostHog)
- Wrapped with `createNextIntlPlugin("./i18n/request.ts")` for i18n

**PostCSS (`postcss.config.mjs`):**
- Plugins: `@tailwindcss/postcss`

**Environment Sync:**
- `sync-env.sh` — reads `.env.local` and pushes vars to Convex via `npx convex env set` (skips `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `NEXT_PUBLIC_CONVEX_URL`)
- Convex env validation cron: `internal.lib.envValidation.checkRequiredEnvVars` (daily, `convex/crons.ts`)
- Required env vars (per `convex/lib/envValidation.ts`): `STRIPE_SECRET_KEY`, `ENCRYPTION_KEY`, `STRIPE_GO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `CLERK_JWT_ISSUER_DOMAIN`

**shadcn (`components.json`):**
- Style: `new-york`, RSC enabled, Tailwind CSS file `app/globals.css`, base color `neutral`, CSS variables on
- Icon library: `lucide`
- Aliases: `components` → `@/components`, `utils` → `@/lib/utils`, `ui` → `@/components/ui`, `lib` → `@/lib`, `hooks` → `@/hooks`

**Knip (`knip.json`):**
- Ignores `ecosystem.config.js`

**Playwright (`playwright.config.ts`):**
- Test dir `./e2e`, global setup `./e2e/global.setup.ts`
- `webServer` runs `npm run build && npm run start -- --port 3000` (overridable via `PLAYWRIGHT_WEB_SERVER_COMMAND`)
- Projects: `default` (ignores billing) and `billing` (`e2e/billing`, workers=1, serial)
- CI retries=2, workers=1

**Vitest (`vitest.config.ts`):**
- Alias `@` → project root
- Default env `node`
- `environmentMatchGlobs`: `convex/**/*.test.ts` → `edge-runtime`; `tests/hooks/**`, `tests/components/**`, `tests/*.test.tsx` → `jsdom`
- `server.deps.inline: ["convex-test"]`
- Includes `tests/**/*.test.ts(x)` and `convex/**/*.test.ts`; excludes `tests/live-billing/**/*.test.ts`
- Setup: `./tests/setup.ts`
- Separate live config: `vitest.live.config.ts` for billing live tests

**Internationalization (`i18n/config.ts`):**
- Locales: `en-US`, `en-GB`, `zh`, `fr`, `hi`, `ja`
- Default: `en-US`
- Messages in `messages/*.json`; request config at `i18n/request.ts`

## Platform Requirements

**Development:**
- Node.js 22
- npm
- Convex CLI (`npx convex`) — for `dev:convex`, env sync, deploy
- PM2 (optional) — for `dev:all` script running Next.js + Convex concurrently
- Browser compatible with ES2017+ for local preview
- Environment file: `.env.local` (present at repo root; contents not inspected for secrets)

**Production:**
- **Hosting**: Vercel (project `prj_Af8JZymOKzufVYDzFngyWpJyXNN2`, team `team_yToPjppvYYuxEAh1JZiBKH9c`, `openalex-count` — see `.vercel/project.json`)
- **Backend**: Convex Cloud (reactive DB, HTTP, crons, workflows, workpools)
- **CI**: GitHub Actions — `.github/workflows/ci.yml` (unit + build + e2e auth), `.github/workflows/billing-nightly.yml` (nightly billing)
- **Instrumentation**: `instrumentation-client.ts` wires PostHog on the client

**Scripts (`package.json`):**
- `dev` — `next dev --turbopack`
- `dev:convex` — `convex dev`
- `dev:all` — `pm2 start ecosystem.config.js`
- `build` — `next build`
- `start` — `next start`
- `sync:env` — `./sync-env.sh`
- `test` — `vitest run`
- `test:billing:preflight` — `node ./scripts/billing-preflight.mjs`
- `test:billing:live` — `vitest run --config vitest.live.config.ts tests/live-billing/required.test.ts`
- `test:billing:live:ci` — preflight w/ `--push-convex` then live
- `test:billing:extended` / `test:billing:extended:ci` — extended billing live tests
- `test:billing:e2e` — `playwright test --project=billing`
- `test:e2e:auth` — `playwright test e2e/auth.spec.ts`
- `test:ci` — `test` + `build` + `test:e2e:auth`
- `test:all` — `test:ci` + `test:billing:e2e`
- `wallet-cli` — `tsx scripts/wallet-cli.ts`

---

*Stack analysis: 2026-04-14*
