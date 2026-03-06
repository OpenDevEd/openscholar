# Codebase Structure

**Analysis Date:** 2026-03-06

## Directory Layout

```
openalex-count/
├── app/                        # Next.js App Router pages and API routes
│   ├── layout.tsx              # Root layout with provider tree
│   ├── page.tsx                # Home / search entry page
│   ├── globals.css             # Global styles (Tailwind)
│   ├── actions/                # Next.js server actions
│   ├── api/openalex/search/    # OpenAlex search proxy API route
│   ├── auth/                   # Auth flow pages (signin, signout, callback, access-token)
│   ├── sign-in/[[...sign-in]]/ # Clerk sign-in page
│   ├── sign-up/[[...sign-up]]/ # Clerk sign-up page
│   ├── results/                # Search results page
│   │   └── [searchId]/         # Dynamic search result with history
│   ├── library/                # User paper library
│   ├── bookmarks/              # Saved bookmarks page
│   ├── history/                # Search history page
│   ├── extraction/             # Extraction jobs list and detail
│   │   ├── new/                # Create new extraction job
│   │   └── [jobId]/            # Extraction job detail
│   ├── settings/               # User settings
│   │   ├── ai/                 # AI provider settings (BYOK)
│   │   └── billing/            # Billing/subscription settings
│   ├── pricing/                # Pricing page
│   ├── admin/cleanup/          # Admin cleanup tools
│   ├── privacy/                # Privacy policy
│   └── cookie-policy/          # Cookie policy
├── components/                 # React components
│   ├── ui/                     # Shadcn/ui primitives (button, dialog, etc.)
│   ├── shared/                 # Shared components across features
│   ├── layout/                 # Layout components
│   ├── providers/              # Context providers (Convex, etc.)
│   ├── auth/                   # Auth-related components
│   ├── home/                   # Home page components
│   ├── library/                # Library feature components
│   ├── extraction/             # Extraction feature components
│   ├── settings/               # Settings page components
│   ├── billing/                # Billing/subscription components
│   ├── command-center/         # Command palette
│   ├── search-command-center/  # Search-specific command palette
│   ├── bookmarks-command-center/ # Bookmarks command palette
│   ├── paper-card/             # Paper card display components
│   ├── focus-mode/             # Focus mode components
│   ├── icons/                  # Custom icon components
│   └── *.tsx                   # Feature-level components (sidebar, navbar, filters, etc.)
├── convex/                     # Convex backend (all server-side logic)
│   ├── schema.ts               # Database schema (all tables)
│   ├── convex.config.ts        # Convex app config (Stripe, RAG, workflow, workpool components)
│   ├── auth.config.ts          # Clerk JWT auth config
│   ├── http.ts                 # HTTP router (webhooks: Clerk, Stripe, Zotero OAuth)
│   ├── crons.ts                # Scheduled cron jobs
│   ├── workflow.ts             # WorkflowManager instance
│   ├── workpool.ts             # Workpool instance for PDF processing
│   ├── stripe.ts               # Stripe client config
│   ├── _generated/             # Auto-generated Convex types and API refs
│   ├── lib/                    # Shared backend utilities
│   │   ├── auth.ts             # Auth helpers (requireUser, etc.)
│   │   ├── errors.ts           # Structured error factory
│   │   ├── crypto.ts           # Encryption for API keys
│   │   ├── env.ts              # Environment variable helpers
│   │   ├── envValidation.ts    # Env var validation (cron-checked)
│   │   ├── featureFlags.ts     # Feature flag system
│   │   ├── rateLimit.ts        # Rate limiting config
│   │   ├── audit.ts            # Audit logging
│   │   ├── constants.ts        # Backend constants
│   │   ├── validators.ts       # Shared validators
│   │   ├── freeCredits.ts      # Free credit grant logic
│   │   ├── creditTopups.ts     # Credit top-up pricing
│   │   ├── userCreation.ts     # User creation helper
│   │   └── stripeWebhook*.ts   # Stripe webhook utilities
│   ├── users/                  # User domain (queries, mutations, internal)
│   ├── subscriptions/          # Subscription domain (queries, actions, internal, lib/)
│   ├── credits/                # Credits domain (queries, actions, internal, lib/)
│   ├── extraction/             # Extraction domain (workflow, actions, mutations, queries, prompts, etc.)
│   ├── ai/                     # AI config and actions (server-side)
│   ├── library/                # Library domain (queries, mutations, collections)
│   ├── apiKeys/                # BYOK API key management
│   ├── zotero/                 # Zotero integration (OAuth, queries, mutations)
│   ├── webhooks/               # Webhook handlers (Clerk user sync)
│   ├── maintenance/            # Maintenance cron handlers
│   └── testing/                # Test helpers for Convex
├── lib/                        # Shared frontend utilities and business logic
│   ├── types/                  # TypeScript type definitions
│   │   ├── index.ts            # Re-exports
│   │   ├── search.types.ts     # Search-related types
│   │   ├── ai.types.ts         # AI provider types
│   │   ├── extraction.types.ts # Extraction types
│   │   ├── library.types.ts    # Library types
│   │   └── screening.types.ts  # Screening types
│   ├── search/                 # Search system
│   │   ├── provider.tsx        # SearchProvider context (core search state)
│   │   ├── types.ts            # Search context types
│   │   ├── actions.ts          # Search action helpers
│   │   ├── index.ts            # Re-exports
│   │   └── initializer.tsx     # Search state initializer
│   ├── search-params/          # URL param parsing (nuqs)
│   ├── ai/                     # AI integration
│   │   ├── client/             # Client-side AI (executor, router, mode routing)
│   │   ├── core/               # Core AI logic (prompts, schemas, batch, cost, types)
│   │   └── server/             # Server-side AI providers
│   ├── store/                  # Zustand store modules
│   │   └── extraction.ts       # Extraction-specific store
│   ├── store.ts                # Main Zustand stores (ratings, search history, bookmarks, AI, etc.)
│   ├── extraction/             # Extraction feature utilities
│   ├── filters/                # Filter utilities
│   ├── auth/                   # Auth utilities (Clerk UI config, public routes, hooks)
│   ├── billing/                # Billing entitlements
│   ├── credits/                # Credit feature flags
│   ├── subscriptions/          # Subscription feature flags
│   ├── library/                # Library utilities
│   ├── toast/                  # Toast notification helpers
│   ├── hooks/                  # Custom React hooks
│   ├── constants/              # Constants
│   ├── pdf/                    # PDF utilities
│   ├── i18n/                   # i18n utilities
│   ├── ui/                     # UI utilities
│   ├── utils.ts                # General utilities (cn, createSearchParameters, etc.)
│   ├── openalex.ts             # OpenAlex SDK client
│   ├── constants.ts            # App-wide constants
│   ├── format.ts               # Formatting utilities
│   └── posthog-*.ts            # PostHog analytics helpers
├── hooks/                      # Top-level React hooks
│   ├── use-batch-operation.ts  # Batch operation hook
│   ├── use-batch-screening.ts  # Batch screening hook
│   ├── use-batch-translation.ts# Batch translation hook
│   ├── use-country-filter.ts   # Country filter hook
│   └── use-mobile.tsx          # Mobile detection hook
├── i18n/                       # Internationalization config
│   ├── config.ts               # i18n configuration
│   ├── locale.ts               # Locale utilities
│   ├── locale-detection.ts     # Browser locale detection
│   └── request.ts              # next-intl request config
├── messages/                   # Translation files
│   ├── en-US.json              # English (US)
│   ├── en-GB.json              # English (GB)
│   ├── fr.json                 # French
│   ├── hi.json                 # Hindi
│   ├── ja.json                 # Japanese
│   └── zh.json                 # Chinese
├── content/                    # Static content (legal pages)
│   ├── cookie-policy/          # Cookie policy markdown
│   └── privacy-policy/         # Privacy policy markdown
├── tests/                      # Test files
│   ├── factories/              # Test data factories
│   ├── extraction/             # Extraction feature tests
│   ├── library/                # Library feature tests
│   └── live-billing/           # Live billing integration tests
├── e2e/                        # Playwright E2E tests
│   ├── auth.spec.ts            # Auth flow E2E tests
│   ├── billing/                # Billing E2E tests
│   └── global.setup.ts         # Global E2E setup
├── scripts/                    # Build/CI scripts
│   ├── billing-preflight.mjs   # Billing test preflight checks
│   ├── verify-legal-markdown-parity.mjs
│   └── verify-no-any.sh        # TypeScript `any` usage check
├── public/                     # Static assets
├── docs/                       # Documentation
│   └── plans/                  # Planning documents
├── .github/                    # GitHub Actions
├── package.json                # Dependencies and scripts
├── next.config.ts              # Next.js config (react compiler, PostHog proxy, next-intl)
├── tsconfig.json               # TypeScript config
├── vitest.config.ts            # Vitest config (unit tests)
├── vitest.live.config.ts       # Vitest config (live billing tests)
├── playwright.config.ts        # Playwright config (E2E tests)
├── postcss.config.mjs          # PostCSS (Tailwind)
├── components.json             # Shadcn/ui config
├── ecosystem.config.js         # PM2 config (dev:all runs next + convex)
├── proxy.ts                    # Dev proxy script
├── knip.json                   # Dead code detection config
└── global.d.ts                 # Global type declarations
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router pages and API routes
- Contains: Page components (`page.tsx`), layouts (`layout.tsx`), route handlers (`route.ts`), server actions
- Key files: `app/layout.tsx` (root layout + provider tree), `app/page.tsx` (home), `app/results/[searchId]/page.tsx` (search results)

**`components/`:**
- Purpose: All React components organized by feature
- Contains: UI primitives (shadcn), feature components, layout components, providers
- Key files: `components/ui/` (shadcn primitives), `components/providers/convex-provider.tsx` (auth + Convex)

**`convex/`:**
- Purpose: Entire backend - database schema, server functions, webhooks, cron jobs
- Contains: Domain modules (users, credits, subscriptions, extraction, library, zotero, apiKeys), shared libs
- Key files: `convex/schema.ts` (database), `convex/http.ts` (HTTP routes), `convex/crons.ts` (scheduled jobs)

**`lib/`:**
- Purpose: Shared utilities, business logic, type definitions used by both pages and components
- Contains: Search system, AI integration, stores, types, utilities, feature flags
- Key files: `lib/store.ts` (Zustand stores), `lib/search/provider.tsx` (search context), `lib/utils.ts` (utilities)

**`hooks/`:**
- Purpose: Top-level custom React hooks for cross-cutting concerns
- Contains: Batch operations, mobile detection, country filtering
- Key files: `hooks/use-batch-operation.ts`, `hooks/use-mobile.tsx`

**`tests/`:**
- Purpose: Unit and integration tests (Vitest)
- Contains: Feature-specific test suites, test factories, live billing tests
- Key files: `tests/factories/` (test data), `tests/live-billing/` (Stripe integration tests)

**`e2e/`:**
- Purpose: End-to-end tests (Playwright)
- Contains: Auth flow tests, billing E2E tests
- Key files: `e2e/auth.spec.ts`, `e2e/billing/`

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout, provider tree, global UI shell
- `app/page.tsx`: Home page / search entry
- `convex/http.ts`: All HTTP endpoints (webhooks)
- `convex/crons.ts`: Scheduled background jobs

**Configuration:**
- `next.config.ts`: Next.js config (React Compiler, PostHog rewrites, next-intl)
- `convex/convex.config.ts`: Convex component registration (Stripe, RAG, Workflow, Workpool)
- `convex/auth.config.ts`: Clerk JWT auth for Convex
- `convex/schema.ts`: Complete database schema
- `tsconfig.json`: TypeScript config with `@/*` path alias
- `vitest.config.ts`: Unit test config
- `playwright.config.ts`: E2E test config

**Core Logic:**
- `lib/search/provider.tsx`: Search state management (URL -> SWR -> context)
- `lib/store.ts`: All Zustand stores (ratings, search history, bookmarks, AI settings, screening)
- `convex/extraction/workflow.ts`: Extraction pipeline orchestration
- `convex/extraction/prompts.ts`: AI extraction prompt templates
- `convex/credits/internal.ts`: Credit grant/deduct/reverse logic
- `convex/subscriptions/actions.ts`: Subscription lifecycle management
- `lib/ai/client/router.ts`: AI provider routing (BYOK vs platform)
- `lib/ai/core/execute.ts`: AI execution engine

**Testing:**
- `tests/`: Vitest unit/integration tests
- `e2e/`: Playwright E2E tests
- `convex/testing/`: Convex test utilities
- `convex/extraction/*.test.ts`: Co-located Convex tests

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `PageContent.tsx`, `Pricing.tsx`)
- Non-component modules: `kebab-case.ts` (e.g., `search-utils.ts`, `feature-flags.ts`)
- Convex domain files: `camelCase.ts` following Convex convention (e.g., `queries.ts`, `mutations.ts`, `actions.ts`)
- Test files: `*.test.ts` (e.g., `deduct-credits.test.ts`, `collections.test.ts`)
- E2E test files: `*.spec.ts` (e.g., `auth.spec.ts`)
- Type definition files: `*.types.ts` (e.g., `search.types.ts`, `ai.types.ts`)

**Directories:**
- Feature domains: `kebab-case` (e.g., `command-center/`, `paper-card/`)
- Convex domains: `camelCase` (e.g., `apiKeys/`, `library/`)

**Convex Module Pattern:**
- Each domain has: `queries.ts`, `mutations.ts`, `actions.ts`, optionally `internal.ts`, `lib/`
- Internal functions use `internalQuery`/`internalMutation`/`internalAction`
- Public functions use `query`/`mutation`/`action`

## Where to Add New Code

**New Page/Route:**
- Create directory under `app/` following App Router conventions
- Add `page.tsx` for the page component
- Use `layout.tsx` if the page needs a custom layout
- Dynamic routes: `app/[paramName]/page.tsx`

**New Feature (full-stack):**
- Backend: Create new directory under `convex/` with `queries.ts`, `mutations.ts`, `actions.ts`
- Frontend components: Create new directory under `components/`
- Shared types: Add to `lib/types/` as `feature.types.ts`
- Feature utilities: Create directory under `lib/`
- Tests: Add to `tests/` or co-locate in `convex/` for backend tests

**New Component:**
- UI primitive (reusable): `components/ui/` (use `npx shadcn add`)
- Feature-specific: `components/{feature-name}/`
- Shared across features: `components/shared/`

**New Convex Function:**
- Public query/mutation: Add to existing `queries.ts`/`mutations.ts` in the relevant domain directory
- Internal function: Add to `internal.ts` in the domain directory
- Shared backend utility: Add to `convex/lib/`

**New Hook:**
- Feature-specific: `lib/hooks/` or inline in feature directory
- Cross-cutting: `hooks/` (top-level)

**New Store:**
- Add to `lib/store.ts` (main stores file) or create a module in `lib/store/`

**New API Route:**
- Create `app/api/{path}/route.ts`

**New Server Action:**
- Add to `app/actions/`

**New Test:**
- Unit test: `tests/{feature}/` with `*.test.ts` extension
- Live billing test: `tests/live-billing/`
- E2E test: `e2e/` with `*.spec.ts` extension
- Convex backend test: Co-locate as `*.test.ts` in `convex/{domain}/`

**Translations:**
- Add keys to all files in `messages/` (en-US.json, fr.json, etc.)

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated Convex types, API references, data model types
- Generated: Yes (by `convex dev` or `convex deploy`)
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes
- Committed: No

**`node_modules/`:**
- Purpose: NPM dependencies
- Generated: Yes
- Committed: No

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: By tooling
- Committed: Yes

**`content/`:**
- Purpose: Static legal content (privacy policy, cookie policy) in markdown
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-06*
