# Codebase Structure

**Analysis Date:** 2026-03-02

## Directory Layout

```
openalex-count/
├── app/                    # Next.js App Router routes, layouts, server actions, API routes
│   ├── actions/            # Next.js server actions ("use server")
│   ├── admin/              # Admin-only utility routes
│   ├── api/                # REST API route handlers
│   │   └── openalex/search/  # GET /api/openalex/search (public OpenAlex proxy)
│   ├── auth/               # Clerk OAuth callback routes
│   ├── bookmarks/          # /bookmarks page
│   ├── extraction/         # /extraction pages (list, new, [jobId] detail)
│   │   ├── [jobId]/        # Dynamic job detail page
│   │   └── new/            # Job creation page
│   ├── history/            # /history page
│   ├── library/            # /library page
│   ├── results/[searchId]/ # /results/[searchId] page + history sub-route
│   ├── settings/           # /settings, /settings/ai, /settings/billing
│   ├── sign-in/            # Clerk catch-all sign-in
│   ├── sign-up/            # Clerk catch-all sign-up
│   ├── layout.tsx          # Root layout — providers, sidebar, auth gate
│   ├── page.tsx            # Home page (/)
│   ├── globals.css         # Global CSS / Tailwind base
│   └── error.tsx           # Route error boundary
│
├── components/             # React UI components (client + server)
│   ├── auth/               # Auth UI: route gate, state panels
│   ├── billing/            # Billing UI: upgrade prompts, plan cards
│   ├── bookmarks-command-center/  # Bookmarks feature UI
│   ├── command-center/     # Shared CommandCenterContainer wrapper
│   ├── extraction/         # Extraction feature UI (job creator, results views, PDF viewer)
│   │   ├── results-views/  # TableView, CardView, SplitView components
│   │   └── shared/         # Shared extraction sub-components
│   ├── history-command-center/  # Search history feature UI
│   ├── home/               # Home page components
│   ├── icons/              # Custom SVG icon components
│   ├── layout/             # Layout primitives (two-column-layout)
│   ├── library/            # Library feature UI
│   ├── paper-card/         # Paper card component (used in search results)
│   ├── providers/          # React context providers (convex-provider.tsx)
│   ├── search-command-center/  # Search UI: header, body, footer, modes
│   │   └── components/     # Internal search command sub-components
│   ├── settings/           # Settings page UI
│   ├── shared/             # Generic shared components
│   └── ui/                 # shadcn/ui primitives (button, dialog, card, etc.)
│
├── convex/                 # Convex backend: schema, functions, HTTP router, crons
│   ├── _generated/         # Auto-generated Convex types and API (DO NOT EDIT)
│   ├── ai/                 # AI actions and helpers
│   │   └── lib/            # AI provider client utilities
│   ├── apiKeys/            # BYOK API key management
│   ├── credits/            # Credit balance, transactions, Stripe grant logic
│   │   └── lib/            # Credit calculation utilities
│   ├── extraction/         # Extraction workflow: queries, mutations, actions, workflow
│   ├── lib/                # Convex-side shared utilities (auth, errors, rate limiting, env)
│   ├── library/            # Library items and collections
│   ├── maintenance/        # Cron maintenance jobs
│   ├── subscriptions/      # Stripe subscription management
│   │   └── lib/            # Subscription helpers
│   ├── testing/            # Convex test helpers
│   ├── users/              # User queries and mutations
│   ├── webhooks/           # Clerk webhook handler
│   ├── zotero/             # Zotero OAuth and API integration
│   ├── schema.ts           # Convex database schema (single source of truth)
│   ├── http.ts             # HTTP router (Stripe + Clerk + Zotero webhooks)
│   ├── crons.ts            # Scheduled cron jobs
│   ├── workflow.ts         # WorkflowManager singleton
│   └── workpool.ts         # Workpool singleton (PDF processing)
│
├── lib/                    # Shared client/server utilities and types
│   ├── ai/                 # AI client utilities
│   │   ├── client/         # AI provider client wrappers
│   │   └── core/           # Core AI abstractions
│   ├── auth/               # Auth helpers: public routes, query wrappers, list render state
│   ├── billing/            # Billing entitlement helpers (resolveEffectivePlan)
│   ├── constants/          # App-level constants
│   ├── credits/            # Credit display/calculation helpers
│   ├── extraction/         # Extraction domain logic (filtering, insights, feature flags, citation panel)
│   ├── filters/            # Search filter utilities
│   ├── hooks/              # Shared React hooks (use-selection, use-url-state, use-debounced-value, use-cooldown)
│   ├── i18n/               # i18n helpers
│   ├── library/            # Library domain logic
│   ├── pdf/                # PDF processing utilities
│   ├── search/             # Search-specific utilities
│   ├── search-params/      # URL search param helpers
│   ├── store/              # Feature-specific Zustand slices
│   ├── subscriptions/      # Subscription status helpers
│   ├── toast/              # Domain-scoped toast factories
│   ├── types/              # TypeScript type definitions (search, extraction, ai, library, screening)
│   │   └── index.ts        # Barrel export for all types
│   ├── ui/                 # UI utility helpers
│   ├── openalex.ts         # OpenAlex SDK client singleton
│   ├── store.ts            # Main Zustand store (search, ratings, history, settings)
│   ├── utils.ts            # General utilities (cn, createSearchParameters, download helpers)
│   └── hooks.ts            # Barrel export for root-level hooks
│
├── hooks/                  # Top-level React hooks (batch operations, country filter, mobile)
├── i18n/                   # next-intl configuration (request.ts, routing.ts)
├── messages/               # Translation message files (en.json, etc.)
├── content/                # Static MDX/markdown content (cookie policy, privacy policy)
├── public/                 # Static assets served at /
├── tests/                  # Vitest unit/integration tests
│   └── library/            # Library feature tests
├── e2e/                    # Playwright end-to-end tests
│   └── billing/            # Billing flow e2e specs
├── scripts/                # Utility scripts
├── docs/                   # Developer documentation and plans
├── next.config.ts          # Next.js configuration (next-intl, PostHog proxy rewrites)
├── tsconfig.json           # TypeScript configuration (path alias @/* → ./)
├── vitest.config.ts        # Vitest test config
├── playwright.config.ts    # Playwright e2e test config
└── package.json            # Dependencies and scripts
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js App Router routes. Each subfolder maps to a URL path.
- Contains: `page.tsx` (route), `layout.tsx` (shared layout), `error.tsx` (error boundary), `route.ts` (API handler)
- Key files: `app/layout.tsx` (root provider setup), `app/page.tsx` (home), `app/extraction/[jobId]/page.tsx` (primary complex page)

**`components/`:**
- Purpose: All React UI components, organized by feature domain
- Contains: Feature command centers, shared primitives, shadcn/ui wrappers
- Key files: `components/providers/convex-provider.tsx` (auth + Convex setup), `components/auth/auth-route-gate.tsx` (protected route guard), `components/ui/` (shadcn primitives)

**`convex/`:**
- Purpose: Entire backend — database schema, server functions, webhooks, background jobs
- Contains: Domain-organized modules with `queries.ts`, `mutations.ts`, `actions.ts` per domain
- Key files: `convex/schema.ts` (DB tables), `convex/http.ts` (webhook routes), `convex/extraction/workflow.ts` (durable extraction pipeline)
- Note: `convex/_generated/` is auto-generated — never edit manually

**`lib/`:**
- Purpose: Shared utilities, types, and stores used by both frontend and Convex backend
- Contains: Type definitions, Zustand store, domain logic, OpenAlex SDK client, auth helpers
- Key files: `lib/store.ts` (Zustand state), `lib/types/index.ts` (type barrel), `lib/openalex.ts` (SDK singleton), `lib/auth/public-routes.ts` (public path definitions)

**`messages/`:**
- Purpose: next-intl translation files
- Contains: JSON translation files per locale (e.g., `en.json`)

**`tests/`:**
- Purpose: Vitest unit and integration tests
- Contains: Feature-organized test files co-located by domain

**`e2e/`:**
- Purpose: Playwright end-to-end tests
- Contains: Page object models in `pages/`, test specs in `specs/`

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout — all providers initialized here
- `app/page.tsx`: Home page / search interface
- `convex/schema.ts`: Database schema — authoritative data model
- `convex/http.ts`: All incoming HTTP webhooks (Stripe, Clerk, Zotero)
- `convex/crons.ts`: All scheduled background jobs

**Configuration:**
- `next.config.ts`: Next.js config (PostHog proxy, next-intl plugin)
- `tsconfig.json`: TypeScript config (path alias `@/*`)
- `vitest.config.ts`: Unit test config
- `playwright.config.ts`: E2E test config
- `convex/auth.config.ts`: Convex-side Clerk auth config
- `convex/convex.config.ts`: Convex component registrations (workflow, workpool, stripe)

**Core Logic:**
- `lib/store.ts`: Zustand global state store (search history, ratings, UI prefs)
- `lib/utils.ts`: `createSearchParameters` (search query builder), `cn` (Tailwind class merger)
- `lib/openalex.ts`: OpenAlex SDK client singleton
- `lib/auth/public-routes.ts`: Public (unauthenticated) path list
- `lib/auth/use-auth-query.ts`: `useProtectedQuery` / `useProtectedPaginatedQuery` hooks
- `lib/billing/entitlements.ts`: `resolveEffectivePlan` — maps subscription to feature tier
- `lib/extraction/filtering.ts`: `filterPapers`, `preprocessPapers` — client-side extraction filtering
- `convex/lib/auth.ts`: `requireAuth`, `getCurrentUser` — Convex auth helpers
- `convex/lib/errors.ts`: `createError`, `ErrorCode` — typed error factory
- `convex/extraction/workflow.ts`: Durable extraction pipeline

**Testing:**
- `tests/`: Vitest unit tests
- `e2e/`: Playwright e2e tests
- `convex/testing/`: Convex test helpers
- `convex/extraction/cascade-delete.test.ts`: Co-located Convex integration test

## Naming Conventions

**Files:**
- React components: `kebab-case.tsx` (e.g., `extraction-results-shell.tsx`, `auth-route-gate.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-url-state.ts`, `use-selection.ts`)
- Utilities/lib: `kebab-case.ts` (e.g., `openalex.ts`, `search-utils.ts`)
- Types: `kebab-case.types.ts` (e.g., `search.types.ts`, `extraction.types.ts`)
- Convex modules: `queries.ts`, `mutations.ts`, `actions.ts`, `internal.ts` per domain folder
- Test files: `*.test.ts` or `*.spec.ts`
- Next.js special files: lowercase (`page.tsx`, `layout.tsx`, `route.ts`, `error.tsx`)

**Directories:**
- Feature components: `kebab-case/` matching feature name (e.g., `extraction/`, `search-command-center/`)
- Convex domains: singular lowercase (e.g., `users/`, `credits/`, `extraction/`)
- App routes: URL-matching names (e.g., `extraction/[jobId]/`, `settings/billing/`)

**Identifiers:**
- React components: PascalCase exports (e.g., `ExtractionResultsShell`, `AuthRouteGate`)
- Convex functions: camelCase exports (e.g., `getJobDetails`, `createExtractionJob`)
- Zustand stores: `use[Feature]Store` (e.g., `useUIStore`, `useSearchHistoryStore`)
- Types: PascalCase interfaces/types (e.g., `SearchFilters`, `ExtractionJob`)
- Error codes: SCREAMING_SNAKE_CASE (e.g., `UNAUTHENTICATED`, `INSUFFICIENT_CREDITS`)

## Where to Add New Code

**New Feature Page:**
- Route: `app/[feature-name]/page.tsx`
- Page content component: `components/[feature-name]-command-center/` or `components/[feature-name]/`
- Wrap in `<PageWrapper>` and `<CommandCenterContainer>`

**New Convex Domain:**
- Create `convex/[domain]/queries.ts`, `mutations.ts`, `actions.ts` as needed
- Export from Convex API — auto-generated in `convex/_generated/api`
- Add tables to `convex/schema.ts`

**New Shared Utility:**
- Pure functions: `lib/[feature].ts` or `lib/[feature]/[util].ts`
- New types: `lib/types/[feature].types.ts` + export from `lib/types/index.ts`
- New React hook: `lib/hooks/use-[hook-name].ts` (or `hooks/use-[hook-name].ts` for top-level)

**New Component:**
- Feature-specific: `components/[feature]/[component-name].tsx`
- Shared UI primitive: `components/ui/[component-name].tsx`
- Shared utility component: `components/shared/[component-name].tsx`

**New Zustand Slice:**
- Add to `lib/store.ts` as a new `create()` slice (follow existing pattern with `persist` if needed)

**New Translation Keys:**
- Add to `messages/en.json` (and other locale files)
- Access via `useTranslations('namespace')` (client) or `getTranslations('namespace')` (server)

**New Test:**
- Unit test: `tests/[feature]/[feature].test.ts`
- E2E test: `e2e/[feature]/specs/[test].spec.ts` with page objects in `e2e/[feature]/pages/`
- Convex integration test: co-locate as `convex/[domain]/[name].test.ts`

## Special Directories

**`.planning/`:**
- Purpose: GSD project management docs (phases, milestones, codebase analysis)
- Generated: No
- Committed: Yes

**`convex/_generated/`:**
- Purpose: Auto-generated Convex API types and server bindings
- Generated: Yes — by `npx convex dev` / `npx convex deploy`
- Committed: Yes (for type checking)
- Note: Never edit manually — regenerated on any schema or function change

**`.next/`:**
- Purpose: Next.js build output and cache
- Generated: Yes
- Committed: No

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`test-results/`:**
- Purpose: Playwright test artifacts and screenshots
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-02*
