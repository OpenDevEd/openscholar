# Codebase Structure

**Analysis Date:** 2026-03-04

## Directory Layout

```
openalex-count/
├── app/                        # Next.js App Router — pages, layouts, API routes
│   ├── layout.tsx              # Root layout (providers, sidebar)
│   ├── page.tsx                # Home/search page
│   ├── globals.css             # Global styles (Tailwind base)
│   ├── actions/                # Next.js server actions (OpenAlex fetch for extraction)
│   ├── api/                    # Next.js API routes (server-side proxies)
│   │   └── openalex/search/    # OpenAlex search proxy route.ts
│   ├── auth/                   # Auth callback pages
│   ├── extraction/             # Extraction feature pages
│   │   ├── layout.tsx          # Feature gate (NEXT_PUBLIC_EXTRACTION_ENABLED)
│   │   ├── page.tsx            # Extraction job list
│   │   ├── new/                # New job creation
│   │   └── [jobId]/            # Job detail page
│   ├── library/                # Saved library page
│   ├── results/
│   │   └── [searchId]/         # Search results page
│   ├── settings/               # User settings pages
│   ├── sign-in/                # Clerk sign-in
│   ├── sign-up/                # Clerk sign-up
│   ├── pricing/                # Pricing page
│   ├── history/                # Search history page
│   ├── bookmarks/              # Bookmarks page
│   ├── admin/                  # Admin page
│   └── [legal pages]/          # cookie-policy, privacy
│
├── components/                 # React components
│   ├── ui/                     # shadcn/ui primitives (button, dialog, etc.)
│   ├── providers/              # Context providers (convex-provider.tsx)
│   ├── auth/                   # Auth-aware UI components (auth-route-gate, auth-state-panel)
│   ├── extraction/             # Extraction feature components
│   ├── library/                # Library feature components
│   ├── billing/                # Billing/subscription components
│   ├── command-center/         # Global command center shell
│   ├── search-command-center/  # Search-specific command center
│   ├── bookmarks-command-center/
│   ├── history-command-center/
│   ├── paper-card/             # Search result paper card
│   ├── focus-mode/             # Full-screen focus mode
│   ├── layout/                 # Layout primitives (TwoColumnLayout)
│   ├── settings/               # Settings components
│   ├── shared/                 # Cross-feature shared components (sidebar-layout)
│   ├── home/                   # Home page specific components
│   ├── icons/                  # Custom icon components
│   ├── app-sidebar.tsx         # Global navigation sidebar
│   ├── results-list.tsx        # Search results rendering
│   ├── search-sidebar.tsx      # Search query/filter input sidebar
│   ├── search-history.tsx      # Search history tab
│   └── [top-level components]  # Pricing, auth buttons, selectors, etc.
│
├── convex/                     # Convex backend
│   ├── schema.ts               # Database schema (all tables)
│   ├── http.ts                 # HTTP router (webhooks)
│   ├── crons.ts                # Scheduled cron jobs
│   ├── workflow.ts             # WorkflowManager instance
│   ├── workpool.ts             # WorkpoolManager instance
│   ├── stripe.ts               # Stripe client instance
│   ├── convex.config.ts        # Convex app config (components: stripe, rag, workflow, workpool)
│   ├── auth.config.ts          # Clerk auth config for Convex
│   ├── _generated/             # Auto-generated API types (do not edit)
│   ├── extraction/             # Extraction domain module
│   ├── credits/                # Credit balance domain module
│   ├── subscriptions/          # Subscription/billing domain module
│   ├── users/                  # User management domain module
│   ├── zotero/                 # Zotero OAuth integration module
│   ├── ai/                     # AI helpers and config module
│   ├── apiKeys/                # BYOK API key storage module
│   ├── library/                # Saved library domain module
│   ├── maintenance/            # Maintenance/cleanup mutations and crons
│   ├── webhooks/               # Webhook handlers (clerk.ts)
│   ├── lib/                    # Convex-side shared utilities
│   │   ├── auth.ts             # Auth helpers
│   │   ├── env.ts              # Environment access
│   │   ├── envValidation.ts    # Required env var checker
│   │   ├── errors.ts           # Typed error creation (createError)
│   │   ├── crypto.ts           # API key encryption/decryption
│   │   ├── featureFlags.ts     # Server-side feature flags
│   │   ├── rateLimit.ts        # Rate limiting helpers
│   │   ├── stripeWebhookHandlers.ts
│   │   ├── stripeWebhookSecret.ts
│   │   ├── userCreation.ts
│   │   └── validators.ts       # Shared Convex validators
│   └── testing/                # Convex testing helpers
│
├── lib/                        # Client-side library (utilities, hooks, state)
│   ├── store.ts                # Zustand store (search history, UI state, ratings, bookmarks)
│   ├── constants.ts            # App-wide constants
│   ├── utils.ts                # General utilities (cn, createSearchParameters, etc.)
│   ├── types/                  # TypeScript type definitions
│   │   ├── index.ts            # Central re-export
│   │   ├── search.types.ts     # Search-related types
│   │   ├── extraction.types.ts # Extraction-related types
│   │   ├── ai.types.ts         # AI provider types
│   │   ├── screening.types.ts  # Screening types
│   │   └── library.types.ts    # Library types
│   ├── auth/                   # Auth utilities
│   │   ├── use-auth-query.ts   # useProtectedQuery / useProtectedPaginatedQuery
│   │   ├── list-render-state.ts
│   │   ├── clerk-ui-config.ts
│   │   ├── proxy-policy.ts
│   │   └── public-routes.ts
│   ├── billing/                # Billing utilities
│   │   └── entitlements.ts     # resolveEffectivePlan, isEntitledSubscription
│   ├── credits/                # Credit utilities
│   ├── subscriptions/          # Subscription utilities
│   ├── extraction/             # Client-side extraction utilities
│   │   ├── filtering.ts        # FilterState, preprocessPapers, filterPapers
│   │   ├── feature-flags.ts    # Extraction feature flags (insights, reviewQueue, etc.)
│   │   ├── types.ts            # ExtractionResultWithReview etc.
│   │   ├── citations.ts        # Citation utilities
│   │   ├── citation-panel.ts   # Citation panel state
│   │   ├── export.ts           # Export formatting
│   │   ├── insights.ts         # Insights computation
│   │   ├── reviews.ts          # Review state helpers
│   │   └── pdfjs-text.ts       # PDF.js text processing
│   ├── search/                 # Search context
│   │   ├── provider.tsx        # SearchProvider (URL + SWR)
│   │   ├── index.ts            # useSearch hook export
│   │   ├── initializer.tsx     # Search initializer
│   │   └── types.ts            # SearchContextValue types
│   ├── search-params/          # nuqs search param parsers
│   ├── hooks/                  # Shared custom hooks
│   │   ├── use-selection.ts    # Multi-select state
│   │   ├── use-url-state.ts    # URL-persisted state
│   │   ├── use-debounced-value.ts
│   │   ├── use-cooldown.ts
│   │   └── feature-flags.ts
│   ├── filters/                # Filter utilities
│   ├── ai/                     # AI client/server utilities
│   ├── toast/                  # Toast action routing
│   ├── i18n/                   # i18n client helpers
│   ├── pdf/                    # PDF download utilities
│   ├── store/                  # Zustand store slices (split from store.ts)
│   ├── ui/                     # UI utility hooks
│   ├── openalex.ts             # OpenAlex SDK client singleton
│   ├── search-actions.ts       # Download/export actions using store
│   ├── search-utils.ts         # Search fetching utilities
│   ├── keyword-validation.ts   # Query keyword validation
│   ├── hooks.ts                # Root hooks file
│   ├── format.ts               # Display formatting
│   ├── screening-utils.ts      # Screening utilities
│   ├── posthog-search.ts       # PostHog search event tracking
│   ├── posthog-ai.ts           # PostHog AI event tracking
│   └── zotero-utils.ts         # Zotero utilities
│
├── hooks/                      # Top-level custom hooks
│   ├── use-batch-operation.ts  # Batch AI operations
│   ├── use-batch-screening.ts  # Batch screening
│   ├── use-batch-translation.ts
│   ├── use-country-filter.ts
│   └── use-mobile.tsx
│
├── tests/                      # Unit/integration tests (Vitest)
│   ├── setup.ts                # Test setup
│   ├── extraction/             # Extraction-specific test helpers
│   ├── library/                # Library test helpers
│   ├── live-billing/           # Live billing integration tests
│   └── [*.test.ts]             # Test files (flat, domain-named)
│
├── e2e/                        # End-to-end tests (Playwright)
│   ├── auth.spec.ts
│   ├── global.setup.ts
│   └── billing/                # Billing E2E flows
│
├── messages/                   # i18n message files
│   ├── en-US.json
│   ├── en-GB.json
│   ├── fr.json
│   ├── hi.json
│   ├── ja.json
│   └── zh.json
│
├── i18n/                       # next-intl configuration
│   ├── request.ts              # Server-side locale resolution
│   ├── locale.ts
│   ├── locale-detection.ts
│   └── config.ts
│
├── content/                    # Static markdown content (legal, docs)
├── docs/                       # Internal documentation
├── scripts/                    # Utility scripts
├── public/                     # Static assets
├── .planning/                  # GSD planning documents
├── .github/workflows/          # CI/CD (GitHub Actions)
├── next.config.ts              # Next.js config (next-intl, PostHog rewrites)
├── tsconfig.json               # TypeScript config (@/* path alias)
├── vitest.config.ts            # Vitest unit test config
├── playwright.config.ts        # Playwright E2E config
├── components.json             # shadcn/ui config
└── ecosystem.config.js         # PM2 process config
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router routes. Every subdirectory is a route segment.
- Contains: `page.tsx`, `layout.tsx`, `error.tsx`, and route-specific client components
- Key files: `app/layout.tsx` (root provider tree), `app/extraction/[jobId]/page.tsx` (most complex page)

**`components/`:**
- Purpose: All React components. Feature directories mirror `app/` route names. `ui/` holds shadcn primitives only.
- Contains: Feature component directories, global components, shadcn/ui atoms
- Key files: `components/app-sidebar.tsx`, `components/results-list.tsx`, `components/search-sidebar.tsx`, `components/providers/convex-provider.tsx`

**`convex/`:**
- Purpose: The entire backend. Each subdirectory is a domain module.
- Contains: Schema, HTTP router, crons, workflow/workpool managers, domain modules
- Key files: `convex/schema.ts` (all table definitions), `convex/http.ts` (webhook routing), `convex/extraction/workflow.ts` (extraction orchestration)

**`lib/`:**
- Purpose: Client-side business logic, type definitions, shared utilities, state management
- Contains: Zustand stores, custom hooks, feature utilities, API client wrappers
- Key files: `lib/store.ts` (main Zustand store), `lib/types/index.ts` (type re-exports), `lib/billing/entitlements.ts`, `lib/auth/use-auth-query.ts`

**`tests/`:**
- Purpose: Vitest unit and integration tests. Files are flat with domain-prefixed names (e.g. `extraction-filtering.test.ts`).
- Contains: All `.test.ts` files plus subdirectories for test helpers/fixtures
- Key files: `tests/setup.ts`, `tests/extraction/`, `tests/live-billing/`

**`e2e/`:**
- Purpose: Playwright end-to-end tests targeting the running application
- Contains: Specs and test helpers; `billing/` for billing-specific E2E flows

**`messages/`:**
- Purpose: i18n message JSON files, one per locale. These are the source of all UI strings.
- Key: `en-US.json` is the primary/reference locale

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout, provider tree (Clerk + Convex + theme + i18n + nuqs + sidebar)
- `app/page.tsx`: Home/search page
- `convex/http.ts`: Convex HTTP entry point (Clerk webhook, Stripe webhook, Zotero OAuth callback)
- `convex/crons.ts`: All scheduled background jobs

**Configuration:**
- `convex/schema.ts`: All Convex database table definitions
- `convex/convex.config.ts`: Convex component registrations (stripe, rag, workflow, workpool)
- `tsconfig.json`: TypeScript config (`@/*` maps to project root)
- `next.config.ts`: Next.js config (next-intl plugin, PostHog proxy rewrites)
- `components.json`: shadcn/ui component configuration

**Core Logic:**
- `lib/store.ts`: Central Zustand store (search history, bookmarks, ratings, UI state)
- `lib/billing/entitlements.ts`: Plan resolution and entitlement checks
- `lib/auth/use-auth-query.ts`: Auth-aware Convex query hooks
- `lib/extraction/filtering.ts`: Client-side extraction result filtering
- `lib/search/provider.tsx`: Search context provider (URL state + SWR)
- `convex/extraction/workflow.ts`: Extraction durable workflow definition
- `convex/extraction/workpoolActions.ts`: Per-paper PDF download and AI extraction actions
- `convex/lib/errors.ts`: Typed error creation for Convex functions

**Testing:**
- `tests/setup.ts`: Vitest global setup
- `vitest.config.ts`: Vitest configuration
- `playwright.config.ts`: Playwright configuration
- `e2e/global.setup.ts`: Playwright global setup (auth state)

## Naming Conventions

**Files:**
- Next.js pages: `page.tsx`, `layout.tsx`, `error.tsx` (Next.js conventions)
- Components: `kebab-case.tsx` (e.g. `results-list.tsx`, `search-sidebar.tsx`)
- Convex modules: `kebab-case.ts` with role suffix (e.g. `queries.ts`, `mutations.ts`, `actions.ts`, `internal.ts`)
- Tests: `domain-name.test.ts` (flat in `tests/`, e.g. `extraction-filtering.test.ts`)
- Type files: `domain.types.ts` (e.g. `extraction.types.ts`, `search.types.ts`)

**Directories:**
- Feature directories: lowercase kebab-case matching route or domain name
- `convex/` domain modules: single-word or kebab-case matching domain

## Where to Add New Code

**New Page/Route:**
- Create: `app/[route-name]/page.tsx` and optionally `app/[route-name]/layout.tsx`
- Tests: `e2e/[route-name].spec.ts` for E2E

**New Feature Component:**
- Create: `components/[feature-name]/[component-name].tsx`
- If globally shared across features: `components/shared/[component-name].tsx`
- shadcn/ui primitives only: `components/ui/[component-name].tsx`

**New Convex Domain Module:**
- Create directory: `convex/[domain-name]/`
- Add: `queries.ts`, `mutations.ts`, `actions.ts` (as needed), `internal.ts` (for internal-only functions)
- Export public API from: `convex/[domain-name]/queries.ts` etc. (auto-discovered by Convex)

**New Convex Mutation/Query in Existing Module:**
- Add to the appropriate `convex/[domain]/queries.ts` or `convex/[domain]/mutations.ts`
- Internal-only functions go in `convex/[domain]/internal.ts`

**New Client Business Logic:**
- Utilities: `lib/[domain]/[utility-name].ts`
- React hooks: `lib/hooks/use-[hook-name].ts`
- Types: Add to `lib/types/[domain].types.ts` and re-export from `lib/types/index.ts`

**New Zustand State Slice:**
- Add interface and implementation to `lib/store.ts`
- If large, create `lib/store/[slice-name].ts` and compose in `lib/store.ts`

**New i18n Keys:**
- Add to `messages/en-US.json` first (reference locale)
- Mirror in all other locale files: `messages/en-GB.json`, `messages/fr.json`, `messages/hi.json`, `messages/ja.json`, `messages/zh.json`

**New Unit Test:**
- Create: `tests/[domain-area].test.ts` (flat naming, no nesting unless test needs helpers)
- Helpers/fixtures: `tests/[domain]/` subdirectory

**New Cron Job:**
- Add to: `convex/crons.ts`
- Implement handler in: `convex/[domain]/mutations.ts` or `convex/maintenance/mutations.ts`

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated Convex API types and server bindings
- Generated: Yes (by `npx convex deploy` or `npx convex dev`)
- Committed: Yes (required for TypeScript compilation)

**`.planning/`:**
- Purpose: GSD planning documents — milestones, phases, codebase analysis
- Generated: By GSD commands
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build output and cache
- Generated: Yes
- Committed: No

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`public/`:**
- Purpose: Static assets served at root URL
- Contains: App icons, manifest
- Committed: Yes

---

*Structure analysis: 2026-03-04*
