# Codebase Structure

**Analysis Date:** 2026-03-03

## Directory Layout

```
openalex-count/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/                # Next.js API routes (server-side proxies)
│   ├── actions/            # Next.js Server Actions
│   ├── auth/               # Auth callback/redirect pages
│   ├── extraction/         # Extraction job pages ([jobId], new)
│   ├── library/            # User paper library page
│   ├── results/            # Search results pages ([searchId])
│   ├── settings/           # Settings pages (ai, billing)
│   ├── sign-in/            # Clerk sign-in page
│   ├── sign-up/            # Clerk sign-up page
│   ├── pricing/            # Pricing page (public)
│   ├── history/            # Search history page
│   ├── bookmarks/          # Bookmarks page
│   ├── layout.tsx          # Root layout with all providers
│   └── page.tsx            # Home page
├── components/             # React components
│   ├── auth/               # Auth gate, state panels
│   ├── billing/            # Billing UI components
│   ├── extraction/         # Extraction job UI
│   │   ├── results-views/  # Table/card views for extraction results
│   │   └── shared/         # Shared extraction UI pieces
│   ├── layout/             # Two-column layout component
│   ├── library/            # Library page components
│   ├── paper-card/         # Reusable paper card
│   ├── providers/          # React context providers (Convex, config)
│   ├── search-command-center/  # Search UI + filter controls
│   │   └── components/     # Sub-components (animated count, etc.)
│   ├── settings/           # Settings page components
│   ├── shared/             # Shared/generic components
│   └── ui/                 # shadcn/ui component library
├── convex/                 # Convex backend
│   ├── _generated/         # Auto-generated Convex types (do not edit)
│   ├── ai/                 # AI action handlers (screening, extraction, translation)
│   ├── apiKeys/            # BYOK API key management
│   ├── credits/            # Credit balance management and grant actions
│   ├── extraction/         # Extraction job queries, mutations, actions, workflow
│   ├── lib/                # Convex-specific utilities (auth, errors, rateLimit, etc.)
│   ├── library/            # Library item queries and mutations
│   ├── maintenance/        # Cron maintenance tasks
│   ├── subscriptions/      # Stripe subscription management
│   │   └── lib/            # Subscription domain helpers (cancellation, scheduling, etc.)
│   ├── testing/            # Test helpers for Convex functions
│   ├── users/              # User mutations (ensureUser, sync)
│   ├── webhooks/           # Clerk webhook handler
│   ├── zotero/             # Zotero OAuth and API integration
│   ├── schema.ts           # Convex database schema (single source of truth)
│   ├── http.ts             # HTTP router (webhooks, OAuth callbacks)
│   ├── crons.ts            # Cron job definitions
│   ├── workflow.ts         # WorkflowManager instance
│   ├── workpool.ts         # Workpool instance (PDF processing)
│   ├── convex.config.ts    # Convex component registrations (stripe, rag, workflow, workpool)
│   └── auth.config.ts      # Clerk JWT issuer config for Convex auth
├── lib/                    # Shared TypeScript utilities (used by both frontend and Convex)
│   ├── ai/
│   │   ├── core/           # AI prompt configs, batch processing, schemas, cost calc
│   │   └── client/         # AI client routing (BYOK vs platform credits)
│   ├── auth/               # Auth helpers (public routes, proxy policy, Clerk UI config)
│   ├── billing/            # Subscription entitlements logic
│   ├── credits/            # Credit feature flags
│   ├── extraction/         # Extraction insights, answer formatting
│   ├── filters/            # Search filter predicates and builders
│   ├── hooks/              # Shared React hooks (batch operations, country filter)
│   ├── i18n/               # i18n utilities
│   ├── library/            # Library item types and helpers
│   ├── pdf/                # PDF utilities
│   ├── search/             # Search param construction
│   ├── search-params/      # URL search param serialization
│   ├── store/              # Zustand extraction store
│   ├── subscriptions/      # Subscription feature flags
│   ├── toast/              # Toast action routing and error resolver
│   ├── types/              # TypeScript type definitions (central export index)
│   ├── ui/                 # UI utilities
│   ├── openalex.ts         # OpenAlex API client wrapper
│   ├── store.ts            # Main Zustand store (search history, UI state, AI config)
│   ├── utils.ts            # Shared utility functions
│   └── search-actions.ts   # Search/download action helpers
├── hooks/                  # Top-level React hooks (batch operations)
├── i18n/                   # next-intl configuration and request handler
├── messages/               # i18n message files (JSON per locale)
├── tests/                  # Vitest unit/integration test files
│   └── library/            # Library-specific tests
├── e2e/                    # Playwright end-to-end tests
│   └── billing/            # Billing E2E specs
├── content/                # Static MDX content (cookie policy, privacy policy)
├── public/                 # Static assets
├── scripts/                # Utility scripts
├── docs/                   # Documentation and plans
├── next.config.ts          # Next.js configuration
├── vitest.config.ts        # Vitest unit test configuration
├── vitest.live.config.ts   # Vitest live billing test configuration
├── playwright.config.ts    # Playwright E2E configuration
├── tsconfig.json           # TypeScript configuration
└── ecosystem.config.js     # PM2 process manager config
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router pages, layouts, and API routes
- Contains: Page components, route layouts, error boundaries, API route handlers
- Key files: `app/layout.tsx` (root layout), `app/page.tsx` (home), `app/api/openalex/search/route.ts`

**`components/`:**
- Purpose: All React UI components, organized by feature domain
- Contains: Client and server components, shadcn/ui primitives in `components/ui/`
- Key files: `components/providers/convex-provider.tsx` (auth bridge), `components/auth/auth-route-gate.tsx`

**`convex/`:**
- Purpose: All backend logic running on Convex platform
- Contains: Schema, queries, mutations, actions, HTTP routes, cron jobs
- Key files: `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/convex.config.ts`
- **Never import from `convex/_generated/` by hand** — generated automatically on deploy

**`lib/`:**
- Purpose: Framework-agnostic shared TypeScript code imported by both frontend and Convex
- Contains: Business logic, type definitions, utility functions
- Key files: `lib/store.ts` (main Zustand store), `lib/types/index.ts` (type exports), `lib/openalex.ts`

**`tests/`:**
- Purpose: Vitest unit and integration tests (co-located with source by feature, not file)
- Contains: `.test.ts` files testing Convex functions, lib utilities, AI logic, billing
- Key pattern: Tests import from `lib/` and `convex/` directly without needing a running server

**`e2e/`:**
- Purpose: Playwright end-to-end tests requiring a live environment
- Contains: Page object models (`e2e/billing/pages/`), spec files (`e2e/billing/specs/`)

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout, mounts all providers
- `convex/http.ts`: Convex HTTP router (all webhooks)
- `convex/crons.ts`: All scheduled background jobs
- `convex/schema.ts`: Complete database schema

**Configuration:**
- `convex/convex.config.ts`: Convex component registrations
- `convex/auth.config.ts`: Clerk JWT config for Convex auth
- `next.config.ts`: Next.js config (PostHog rewrites, next-intl)
- `tsconfig.json`: TypeScript paths (`@/*` → project root)
- `vitest.config.ts`: Test runner config
- `playwright.config.ts`: E2E test config

**Core Logic:**
- `convex/schema.ts`: Database tables and indexes
- `convex/extraction/workflow.ts`: Durable extraction pipeline
- `convex/lib/auth.ts`: Backend auth helpers (`requireAuth`, `getCurrentUser`)
- `convex/lib/errors.ts`: Typed error codes and `createError` factory
- `convex/lib/rateLimit.ts`: Rate limit definitions
- `lib/store.ts`: Main Zustand store (search history, UI, AI config)
- `lib/store/extraction.ts`: Extraction draft job Zustand store
- `lib/billing/entitlements.ts`: Subscription plan entitlement logic
- `lib/types/index.ts`: Central type export

**Testing:**
- `tests/`: All unit tests (`*.test.ts`)
- `tests/setup.ts`: Vitest global setup
- `e2e/billing/specs/`: Playwright billing specs
- `convex/testing/`: Test helpers for Convex function testing

## Naming Conventions

**Files:**
- Convex backend files: `queries.ts`, `mutations.ts`, `actions.ts`, `internal.ts` per domain folder
- Next.js pages: `page.tsx`, `layout.tsx` per route folder (App Router convention)
- Components: `kebab-case.tsx` (e.g., `auth-route-gate.tsx`, `paper-card.tsx`)
- Tests: `kebab-case.test.ts` in `tests/` directory (e.g., `stripe-webhook-handler.test.ts`)
- Lib utilities: `kebab-case.ts` (e.g., `entitlements.ts`, `search-actions.ts`)
- Types files: `*.types.ts` in `lib/types/` (e.g., `search.types.ts`, `extraction.types.ts`)

**Directories:**
- Convex domain directories: lowercase singular (e.g., `extraction/`, `subscriptions/`, `credits/`)
- Component directories: kebab-case (e.g., `search-command-center/`, `paper-card/`)
- Next.js dynamic routes: `[paramName]` (e.g., `[searchId]/`, `[jobId]/`)
- Catch-all Clerk routes: `[[...sign-in]]`

## Where to Add New Code

**New Convex domain (e.g., new feature with DB tables):**
- Schema: Add table to `convex/schema.ts`
- Queries: `convex/{domain}/queries.ts`
- Mutations: `convex/{domain}/mutations.ts`
- Actions (Node.js, external calls): `convex/{domain}/actions.ts`
- Internal-only functions: `convex/{domain}/internal.ts`
- Tests: `tests/{domain}-feature-name.test.ts`

**New page:**
- Implementation: `app/{route}/page.tsx` (RSC by default)
- Client logic: `components/{feature}/` component imported by page
- If auth-protected: already handled by `AuthRouteGate` for non-public paths

**New UI component:**
- Feature-specific: `components/{feature}/component-name.tsx`
- Shared across features: `components/shared/component-name.tsx`
- Base UI primitives: `components/ui/` (shadcn/ui additions)

**New shared utility:**
- Pure logic used by both frontend and Convex: `lib/{domain}/utility-name.ts`
- Frontend-only hook: `lib/hooks/use-hook-name.ts` or `hooks/use-hook-name.ts`
- Convex-only helper: `convex/lib/helper-name.ts`

**New types:**
- Domain types: `lib/types/{domain}.types.ts`
- Export from: `lib/types/index.ts`

**New cron job:**
- Add to `convex/crons.ts` using `crons.interval()` or `crons.cron()`
- Implementation function in `convex/maintenance/mutations.ts` or relevant domain

**New webhook handler:**
- Stripe events: Add handler to `registerRoutes` call in `convex/http.ts`
- New HTTP endpoint: Add `http.route()` in `convex/http.ts`

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated Convex TypeScript types and API references
- Generated: Yes, by `npx convex deploy` or `npx convex dev`
- Committed: Yes (for type checking without running dev server)
- Never manually edit

**`.planning/`:**
- Purpose: GSD planning documents (milestones, phases, codebase analysis)
- Generated: No (manually created by planning process)
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes
- Committed: No

**`test-results/`:**
- Purpose: Playwright test artifacts and screenshots
- Generated: Yes
- Committed: No (gitignored)

**`messages/`:**
- Purpose: next-intl i18n message JSON files per locale
- Key files: `messages/en.json` and other locale files
- Committed: Yes

**`content/`:**
- Purpose: Static legal/policy content (cookie policy, privacy policy in MDX-like format)
- Committed: Yes

---

*Structure analysis: 2026-03-03*
