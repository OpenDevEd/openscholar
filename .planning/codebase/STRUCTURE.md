# Codebase Structure

**Analysis Date:** 2026-02-27

## Directory Layout

```
openalex-count/
├── app/                        # Next.js App Router — pages and API routes
│   ├── actions/                # Next.js "use server" server actions
│   ├── admin/                  # Admin-only pages
│   ├── api/                    # Next.js API route handlers
│   │   └── openalex/search/    # GET /api/openalex/search
│   ├── auth/                   # Auth flow pages (callback, sign-in redirect, etc.)
│   ├── bookmarks/              # Bookmarks list page
│   ├── cookie-policy/          # Static policy page
│   ├── extraction/             # Extraction feature pages
│   │   ├── [jobId]/            # Job detail page (results, insights, review)
│   │   └── new/                # New extraction job creation page
│   ├── history/                # Search history page
│   ├── pricing/                # Pricing page
│   ├── privacy/                # Privacy policy page
│   ├── results/
│   │   └── [searchId]/         # Search results page
│   │       └── history/        # Per-search history sub-page
│   ├── settings/
│   │   ├── ai/                 # AI key/mode settings
│   │   └── billing/            # Billing/subscription settings
│   ├── sign-in/[[...sign-in]]/ # Clerk-hosted sign-in
│   ├── sign-up/[[...sign-up]]/ # Clerk-hosted sign-up
│   ├── layout.tsx              # Root layout with all providers
│   ├── page.tsx                # Home page (search interface)
│   ├── globals.css             # Global Tailwind CSS
│   ├── error.tsx               # Route-level error boundary
│   └── global-error.tsx        # App-level error boundary
│
├── components/                 # React components (feature and shared)
│   ├── auth/                   # Auth gate, auth state panels
│   ├── billing/                # Billing UI components
│   ├── bookmarks-command-center/ # Bookmarks list shell
│   ├── command-center/         # Reusable command center shell components
│   ├── extraction/             # Extraction feature components
│   │   ├── results-views/      # Table, card, split view renderers
│   │   └── shared/             # Shared extraction sub-components
│   ├── history-command-center/ # History list shell
│   ├── home/                   # Home page specific components
│   ├── icons/                  # Custom SVG icon components
│   ├── layout/                 # Layout primitives (two-column, etc.)
│   ├── paper-card/             # Paper result card component
│   ├── providers/              # React context providers
│   │   └── convex-provider.tsx # Clerk + Convex provider + AuthReadiness context
│   ├── search-command-center/  # Search UI shell
│   │   └── components/         # Search sub-components
│   ├── settings/               # Settings page components
│   ├── ui/                     # shadcn/ui base components
│   ├── app-sidebar.tsx         # Desktop sidebar navigation
│   ├── mobile-navbar.tsx       # Mobile top navigation
│   ├── PageContent.tsx         # Home page main content
│   ├── PageWrapper.tsx         # Page layout wrapper
│   └── theme-provider.tsx      # next-themes provider
│
├── convex/                     # Convex backend (database, logic, jobs)
│   ├── _generated/             # Auto-generated API types (do not edit)
│   ├── ai/                     # AI Convex actions
│   │   └── lib/                # AI helpers (auth, credits middleware)
│   ├── apiKeys/                # BYOK API key storage mutations/queries
│   ├── credits/                # Credit balance mutations/actions
│   │   └── lib/                # Credit calculation utilities
│   ├── extraction/             # Extraction pipeline — the largest module
│   ├── lib/                    # Shared Convex utilities (errors, etc.)
│   ├── maintenance/            # Cron-driven maintenance jobs
│   ├── subscriptions/          # Stripe subscription sync
│   │   └── lib/                # Stripe status normalization helpers
│   ├── testing/                # Testing helpers for Convex
│   ├── users/                  # User upsert/lookup
│   ├── webhooks/               # Clerk webhook handler
│   ├── zotero/                 # Zotero OAuth and queries
│   ├── auth.config.ts          # Convex auth (Clerk JWT)
│   ├── convex.config.ts        # Convex component configuration
│   ├── crons.ts                # Scheduled cron jobs
│   ├── http.ts                 # HTTP router (webhooks entry point)
│   ├── schema.ts               # Database schema (all tables)
│   ├── stripe.ts               # Stripe client initialization
│   ├── workflow.ts             # WorkflowManager instance
│   └── workpool.ts             # Workpool instance (PDF processing)
│
├── lib/                        # Shared client-side utilities and logic
│   ├── ai/
│   │   ├── client/             # AI React hooks and client-side executor
│   │   └── core/               # Shared AI configs, prompts, schemas, batch logic
│   ├── auth/                   # Auth utilities (public routes, query wrappers)
│   ├── billing/                # Entitlement resolution
│   ├── constants/              # App-wide constants
│   ├── credits/                # Credit-related client utilities
│   ├── extraction/             # Client-side extraction logic (filtering, export, citations)
│   ├── filters/                # Search filter utilities
│   ├── hooks/                  # Shared custom React hooks
│   ├── i18n/                   # i18n client utilities
│   ├── pdf/                    # PDF rendering/highlighting utilities
│   ├── search/                 # Search utility functions
│   ├── search-params/          # URL search param serialization
│   ├── store/                  # (legacy path) — store is at lib/store.ts
│   ├── subscriptions/          # Subscription client utilities
│   ├── toast/                  # Toast notification helpers
│   ├── types/                  # TypeScript type definitions (index.ts + domain files)
│   ├── ui/                     # UI utility functions
│   ├── openalex.ts             # OpenAlex SDK client instance
│   ├── store.ts                # Zustand global store (persisted)
│   └── utils.ts                # Miscellaneous utilities (cn, createSearchParameters)
│
├── hooks/                      # Root-level custom React hooks
│   ├── use-batch-operation.ts
│   ├── use-batch-screening.ts
│   ├── use-batch-translation.ts
│   ├── use-country-filter.ts
│   └── use-mobile.tsx
│
├── i18n/                       # next-intl configuration
│   ├── config.ts               # Supported locales list
│   ├── locale-detection.ts     # Locale negotiation logic
│   ├── locale.ts               # Locale utilities
│   └── request.ts              # next-intl request config (loaded by next.config.ts)
│
├── messages/                   # Translation JSON files
│   ├── en-US.json              # Primary locale (source of truth for keys)
│   ├── en-GB.json
│   ├── fr.json
│   ├── hi.json
│   ├── ja.json
│   └── zh.json
│
├── content/                    # MDX/static page content
│   ├── cookie-policy/
│   └── privacy-policy/
│
├── e2e/                        # Playwright end-to-end tests
├── tests/                      # Vitest unit/integration tests
│   └── live-billing/           # Live billing integration tests
├── scripts/                    # Utility scripts
├── public/                     # Static assets
├── docs/                       # Internal documentation and plans
├── next.config.ts              # Next.js configuration
├── convex/tsconfig.json        # Convex-specific TypeScript config
├── tsconfig.json               # Root TypeScript config
├── package.json                # Dependencies and scripts
├── vitest.config.ts            # Vitest unit test config
├── vitest.live.config.ts       # Vitest live integration test config
└── playwright.config.ts        # Playwright e2e config
```

## Directory Purposes

**`app/`:**
- Purpose: All Next.js pages and API routes using App Router conventions
- Contains: `page.tsx`, `layout.tsx`, `error.tsx` per route segment; `route.ts` for API handlers; server actions in `app/actions/`
- Key files: `app/layout.tsx` (root layout), `app/page.tsx` (home), `app/extraction/[jobId]/page.tsx` (job detail — largest page component)

**`components/`:**
- Purpose: All React components, organized by feature domain
- Contains: Feature-specific components in named subdirectories; shared primitives in `ui/` (shadcn/ui)
- Key files: `components/providers/convex-provider.tsx` (auth wiring), `components/auth/auth-route-gate.tsx` (route protection), `components/PageWrapper.tsx` (standard page shell)

**`convex/`:**
- Purpose: Entire Convex backend — schema, queries, mutations, actions, workflows, webhooks, crons
- Contains: Domain modules each with `queries.ts` (readable state), `mutations.ts` (write state), `actions.ts` (side-effects/external calls), `internal.ts` (internal-only functions)
- Key files: `convex/schema.ts` (all tables), `convex/http.ts` (webhook entry), `convex/extraction/workflow.ts` (core extraction pipeline)

**`lib/`:**
- Purpose: All shared client-side logic, utilities, types, and hooks
- Contains: Feature-specific subdirectories for complex domains (`ai/`, `auth/`, `extraction/`); flat files for simpler utilities
- Key files: `lib/store.ts` (global Zustand store), `lib/utils.ts` (cn + search param builder), `lib/types/index.ts` (central type exports)

**`convex/extraction/`:**
- Purpose: The largest backend module — manages extraction jobs, papers, results, evidence units, review states, templates, reports
- Contains: ~25 files covering workflow orchestration, PDF processing, AI extraction, evidence anchoring, test utilities

**`components/extraction/`:**
- Purpose: All UI for extraction feature — job creation, results viewing, citation panel, PDF viewer, insights, review queue, report builder
- Contains: ~25+ components; `results-views/` has `TableView`, `CardView`, `SplitView` renderers

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout — add new global providers here
- `app/page.tsx`: Home page
- `convex/http.ts`: Webhook router — add new external webhook routes here
- `convex/crons.ts`: Scheduled jobs — add new crons here

**Configuration:**
- `convex/schema.ts`: Database schema — add/modify tables here
- `convex/auth.config.ts`: Convex auth providers
- `next.config.ts`: Next.js config (i18n, rewrites)
- `tsconfig.json`: TypeScript paths (`@/*` → project root)
- `i18n/config.ts`: Supported locales
- `i18n/request.ts`: next-intl request config

**Core Logic:**
- `lib/store.ts`: Global Zustand store with all client state slices
- `lib/utils.ts`: `createSearchParameters()` — the canonical search filter → OpenAlex params builder
- `lib/openalex.ts`: OpenAlex SDK client instance
- `lib/ai/client/router.ts`: All AI operation hooks exported for components
- `lib/ai/client/mode-routing.ts`: AI routing decision logic (local vs credits)
- `lib/ai/core/configs.ts`: AI prompt configurations per operation
- `lib/auth/public-routes.ts`: `PUBLIC_UNAUTHENTICATED_PATHS` list
- `lib/auth/use-auth-query.ts`: `useProtectedQuery` / `useProtectedPaginatedQuery`
- `lib/billing/entitlements.ts`: `resolveEffectivePlan()` — plan tier resolution
- `lib/types/index.ts`: Central type re-exports

**Convex Domain Index:**
- `convex/extraction/index.ts`: All extraction exports (public + internal)
- `convex/ai/actions.ts`: All AI Convex actions
- `convex/credits/actions.ts`: Credit grant/reconciliation actions
- `convex/subscriptions/`: Stripe subscription sync
- `convex/users/mutations.ts`: `ensureUser` — user upsert on auth

**Testing:**
- `tests/`: Vitest tests
- `e2e/`: Playwright tests
- `playwright.config.ts`: Playwright configuration
- `vitest.config.ts`: Vitest unit test configuration

## Naming Conventions

**Files:**
- Page components: `page.tsx` (Next.js convention)
- Layout components: `layout.tsx` (Next.js convention)
- API routes: `route.ts` (Next.js convention)
- Feature components: kebab-case (e.g., `extraction-citation-sidebar.tsx`, `job-list-item.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-url-state.ts`, `use-auth-query.ts`)
- Convex modules: domain verb (e.g., `queries.ts`, `mutations.ts`, `actions.ts`, `internal.ts`)
- Type files: `kebab-case.types.ts` in `lib/types/` (e.g., `search.types.ts`, `ai.types.ts`)
- Utility files: noun or noun-verb (e.g., `filtering.ts`, `entitlements.ts`, `mode-routing.ts`)

**Directories:**
- Feature directories: kebab-case matching route or domain name
- Convex domain dirs: singular noun (e.g., `extraction/`, `credits/`, `users/`)
- Component feature dirs: kebab-case (e.g., `search-command-center/`, `paper-card/`)

**React Components:**
- PascalCase for component functions and files that export them (e.g., `ExtractionCitationSidebar`, `AuthRouteGate`)
- Exception: `page.tsx`, `layout.tsx` export default anonymous/named functions per Next.js convention

**Convex Functions:**
- camelCase for all exported function names (e.g., `startExtraction`, `ensureUser`, `getJobDetails`)
- Internal functions use same pattern but exported via `internal` namespace

## Where to Add New Code

**New Page Route:**
- Create `app/[route-name]/page.tsx`
- If auth-protected: no extra work — `AuthRouteGate` blocks by default
- If public: add path to `lib/auth/public-routes.ts:PUBLIC_UNAUTHENTICATED_PATHS`
- Add i18n strings to `messages/en-US.json` (other locales follow)

**New Feature Component:**
- Create `components/[feature-name]/` directory
- Component file: `components/[feature-name]/[component-name].tsx`
- Export from `components/[feature-name]/index.ts` if multiple sub-components

**New Convex Table:**
- Add table definition to `convex/schema.ts`
- Create domain directory `convex/[domain]/` with `queries.ts`, `mutations.ts`, optional `actions.ts`, `internal.ts`
- Run `npx convex dev` to regenerate `convex/_generated/`

**New Convex Query/Mutation:**
- Add to appropriate `convex/[domain]/queries.ts` or `mutations.ts`
- Export from `convex/[domain]/index.ts` if the module has one
- Use `query({ args, returns, handler })` for queries; `mutation(...)` for mutations
- Internal-only functions: use `internalQuery`/`internalMutation` and export from `internal.ts`

**New AI Operation:**
- Define prompt config in `lib/ai/core/configs.ts`
- Add input/output types in `lib/ai/core/types.ts`
- Add Convex action in `convex/ai/actions.ts` using `createAIAction()`
- Add client executor in `lib/ai/client/executor.ts`
- Export hook from `lib/ai/client/router.ts` using `createAIHook()`

**New Cron Job:**
- Add to `convex/crons.ts` using `crons.interval()` or `crons.cron()`
- Target an `internalMutation` or `internalAction`

**Utilities:**
- Generic utilities: `lib/utils.ts`
- Domain-specific: `lib/[domain]/` (create new file or add to existing)
- Shared Convex utilities: `convex/lib/`

**New Translation Key:**
- Add to `messages/en-US.json` first (canonical)
- Propagate to other locale files in `messages/`

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated TypeScript types and API references for Convex
- Generated: Yes (by `npx convex dev` / `npx convex deploy`)
- Committed: Yes (checked into git)
- Do not edit manually

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
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

**`test-results/`:**
- Purpose: Playwright test result artifacts
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-02-27*
