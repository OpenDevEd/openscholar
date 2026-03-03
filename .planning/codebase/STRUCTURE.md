# Codebase Structure

**Analysis Date:** 2026-03-03

## Directory Layout

```
openalex-count/
├── app/                    # Next.js App Router pages and layouts
│   ├── actions/            # Next.js Server Actions (OpenAlex, OpenRouter)
│   ├── api/                # API route handlers
│   │   └── openalex/search/route.ts
│   ├── bookmarks/          # Bookmarks page
│   ├── extraction/         # Extraction feature pages
│   │   ├── [jobId]/page.tsx       # Job detail view (full extraction results UI)
│   │   ├── new/page.tsx           # Create new extraction job
│   │   └── page.tsx               # Extraction jobs list
│   ├── history/            # Search history page
│   ├── library/            # Saved papers library page
│   ├── results/            # Search results pages
│   │   └── [searchId]/     # Per-search-session results + history
│   ├── settings/           # User settings (AI keys, billing)
│   │   ├── ai/page.tsx
│   │   └── billing/page.tsx
│   ├── sign-in/            # Clerk sign-in page
│   ├── sign-up/            # Clerk sign-up page
│   ├── layout.tsx          # Root layout (provider tree)
│   ├── page.tsx            # Home page (search)
│   └── globals.css         # Global CSS
│
├── components/             # React components (UI building blocks)
│   ├── auth/               # Auth state gates and panels
│   ├── billing/            # Credit and subscription UI cards
│   ├── bookmarks-command-center/  # Bookmarks feature components
│   ├── command-center/     # Shared command center shell
│   ├── extraction/         # All extraction feature components
│   │   ├── results-views/  # Table, card, split view renderers
│   │   └── ...             # 30+ extraction-specific components
│   ├── history-command-center/    # History feature components
│   ├── home/               # Home page hero and search input
│   ├── icons/              # Custom icon components
│   ├── layout/             # Layout primitives (two-column, etc.)
│   ├── library/            # Library feature components
│   ├── providers/          # React context providers
│   │   └── convex-provider.tsx    # Clerk + Convex + auth readiness
│   ├── results-page-content/      # Search results UI
│   ├── ui/                 # shadcn/ui base components (button, card, dialog, etc.)
│   └── app-sidebar.tsx     # Primary navigation sidebar
│
├── convex/                 # Convex backend (serverless functions + schema)
│   ├── _generated/         # Auto-generated types — DO NOT EDIT
│   ├── ai/                 # AI Convex actions (query enhancement, screening, extraction)
│   │   └── lib/            # AI billing helpers
│   ├── apiKeys/            # BYOK (Bring Your Own Key) management
│   ├── credits/            # Credit balance and billing actions
│   │   └── lib/            # Invoice grant and retry policies
│   ├── extraction/         # Extraction workflow, paper processing, RAG pipeline
│   │   └── (30+ files)     # Workflow, actions, mutations, queries, prompts, chunking, grobid, etc.
│   ├── library/            # Library items and collections CRUD
│   ├── lib/                # Shared Convex utilities
│   │   ├── auth.ts         # getAuthenticatedUser() helper
│   │   ├── errors.ts       # createError() + ErrorCode types
│   │   ├── crypto.ts       # Encrypt/decrypt for API keys
│   │   └── ...             # env, rate limiting, validators, etc.
│   ├── maintenance/        # Cron-driven cleanup and subscription health checks
│   ├── subscriptions/      # Stripe subscription sync and event handling
│   │   └── lib/            # Cancellation, scheduling, event log policy
│   ├── testing/            # Test helpers and billing stubs
│   ├── users/              # User management (mutations, queries, internal)
│   ├── webhooks/           # Inbound webhook handlers (Clerk)
│   ├── zotero/             # Zotero OAuth integration
│   ├── auth.config.ts      # Convex auth (Clerk JWT config)
│   ├── convex.config.ts    # Component registrations (stripe, rag, workflow, workpool)
│   ├── crons.ts            # Cron job registrations
│   ├── http.ts             # HTTP router (webhooks + Zotero OAuth callback)
│   ├── schema.ts           # Full Convex database schema
│   ├── workflow.ts         # Workflow component instance
│   └── workpool.ts         # Workpool component instance
│
├── lib/                    # Shared client+server utilities
│   ├── ai/                 # AI configuration and execution engine
│   │   ├── client/         # Client-side AI routing and hooks
│   │   └── core/           # Prompts, schemas, configs, batch logic (shared with Convex)
│   ├── auth/               # Auth utilities (use-auth-query, subscription state, proxy policy)
│   ├── billing/            # Entitlements and plan resolution
│   ├── constants/          # View modes and other constants
│   ├── credits/            # Feature flags for credit-related features
│   ├── extraction/         # Extraction client utilities (citations, filtering, export, PDF)
│   ├── filters/            # OpenAlex filter builder utilities
│   ├── hooks/              # Shared custom hooks (cooldown, debounce, selection, URL state)
│   ├── i18n/               # Locale maps and region name lookups
│   ├── library/            # Library export and search param helpers
│   ├── pdf/                # PDF download utilities
│   ├── search/             # Search context provider, actions, types
│   ├── search-params/      # URL search param parsers and serializers (nuqs)
│   ├── store/              # Zustand sub-stores (extraction draft)
│   ├── subscriptions/      # Feature flags for subscription-gated features
│   ├── toast/              # Toast system (domain-specific toast helpers)
│   ├── types/              # TypeScript type definitions by domain
│   ├── ui/                 # UI animation helpers
│   ├── openalex.ts         # OpenAlex API client instance
│   ├── store.ts            # Main Zustand store (search history, ratings, AI settings, etc.)
│   └── utils.ts            # Shared utilities (cn, createSearchParameters, etc.)
│
├── hooks/                  # Additional React hooks (batch operations, country filter)
├── i18n/                   # next-intl configuration and locale detection
├── messages/               # i18n translation files
│   ├── en-US.json          # Primary locale
│   ├── en-GB.json
│   ├── fr.json
│   ├── zh.json
│   ├── ja.json
│   └── hi.json
├── tests/                  # Unit and integration tests (Vitest)
├── e2e/                    # End-to-end tests (Playwright)
├── content/                # Static content (legal pages, etc.)
├── docs/                   # Internal documentation
├── scripts/                # Utility scripts
├── public/                 # Static assets
├── .planning/              # GSD planning documents
├── next.config.ts          # Next.js config (next-intl, PostHog rewrites)
├── tsconfig.json           # TypeScript config
├── vitest.config.ts        # Vitest config
└── playwright.config.ts    # Playwright config
```

## Directory Purposes

**`app/`:**
- Purpose: All Next.js App Router pages, layouts, error boundaries, and Server Actions
- Contains: RSC page components, client page components, route handlers, global CSS
- Key files: `app/layout.tsx` (root), `app/page.tsx` (home), `app/extraction/[jobId]/page.tsx` (main extraction UI)

**`components/`:**
- Purpose: All React UI components — both domain-specific feature components and base UI primitives
- Contains: Feature component directories (extraction, billing, library, auth, etc.) + `ui/` (shadcn primitives) + top-level shared components
- Key files: `components/providers/convex-provider.tsx`, `components/app-sidebar.tsx`

**`convex/`:**
- Purpose: Entire Convex backend — schema, functions, HTTP routes, crons, workflows
- Contains: Domain module directories (ai, credits, extraction, subscriptions, users, zotero, etc.) + lib utilities + generated types
- Key files: `convex/schema.ts`, `convex/http.ts`, `convex/crons.ts`, `convex/convex.config.ts`

**`lib/`:**
- Purpose: Shared TypeScript code used by both the frontend and Convex backend
- Contains: AI core (`lib/ai/core/` — imported by `convex/ai/`), types, search utilities, Zustand store, hooks, billing logic
- Key files: `lib/store.ts`, `lib/search/provider.tsx`, `lib/ai/core/`, `lib/types/`

**`messages/`:**
- Purpose: next-intl translation files for all supported locales
- Contains: JSON translation bundles keyed by component/feature namespace
- Key files: `messages/en-US.json` (primary/reference locale)

**`tests/`:**
- Purpose: Unit and integration tests (Vitest), including Convex backend tests
- Contains: Test files mirroring `convex/` and `lib/` structure

**`e2e/`:**
- Purpose: End-to-end tests using Playwright
- Contains: Playwright test specs for user flows

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root Next.js layout; mounts all global providers
- `convex/http.ts`: Convex HTTP router for webhooks and OAuth callbacks
- `convex/crons.ts`: All scheduled cron job registrations
- `convex/schema.ts`: Complete database schema — the authoritative data model

**Configuration:**
- `next.config.ts`: Next.js config (next-intl plugin, PostHog proxy rewrites)
- `convex/convex.config.ts`: Convex component registrations (stripe, rag, workflow, workpool)
- `convex/auth.config.ts`: Convex auth (Clerk JWT domain)
- `tsconfig.json`: TypeScript config with `@/` path alias to project root
- `i18n/request.ts`: next-intl server config and locale detection

**Core Logic:**
- `convex/extraction/workflow.ts`: Durable extraction workflow definition
- `convex/extraction/workpoolActions.ts`: Per-paper PDF + AI extraction action
- `lib/search/provider.tsx`: Search state context provider (URL + SWR)
- `lib/store.ts`: Zustand stores for all client-side session state
- `convex/lib/auth.ts`: `getAuthenticatedUser()` — used in all protected Convex functions
- `convex/lib/errors.ts`: `createError()` + `ErrorCode` union type

**Testing:**
- `tests/`: Vitest unit/integration tests
- `e2e/`: Playwright end-to-end tests
- `vitest.config.ts`: Vitest configuration
- `playwright.config.ts`: Playwright configuration
- `convex/test.setup.ts`: Convex test setup

## Naming Conventions

**Files:**
- Next.js pages: `page.tsx`, `layout.tsx`, `error.tsx` (Next.js conventions)
- Client components suffixed with: `-client.tsx` when co-located with RSC page (e.g., `history-page-client.tsx`)
- Component files: `kebab-case.tsx` (e.g., `extraction-citation-sidebar.tsx`)
- Convex domain files: `queries.ts`, `mutations.ts`, `actions.ts`, `internal.ts` within domain directories
- Convex debug files: `debug.ts`, `debug_*.ts` prefix for debugging/dev utilities
- Shared lib utilities: `kebab-case.ts` (e.g., `filter-builder.ts`, `search-utils.ts`)
- Store files: `use-*` prefix for hooks exported from stores

**Directories:**
- Component feature directories: `kebab-case/` matching feature name (e.g., `extraction/`, `command-center/`)
- Convex domain directories: `lowercase/` (e.g., `convex/credits/`, `convex/zotero/`)
- Lib sub-directories: `kebab-case/` by concern (e.g., `lib/ai/core/`, `lib/search-params/`)

## Where to Add New Code

**New Page/Route:**
- Primary code: `app/{route-name}/page.tsx`
- Layout (if needed): `app/{route-name}/layout.tsx`
- Complex client logic: extract to `components/{feature-name}/{feature-name}-client.tsx`

**New Feature Component:**
- Implementation: `components/{feature-name}/{component-name}.tsx`
- Barrel: add to `components/{feature-name}/index.ts` if one exists

**New Convex Domain (new backend feature):**
- Create directory: `convex/{domain}/`
- Add: `queries.ts`, `mutations.ts`, `actions.ts` as needed
- Add: `internal.ts` for functions only called by other Convex functions
- Add `lib/` subdirectory for complex business logic helpers

**New Convex Function in Existing Domain:**
- Queries (client-readable): `convex/{domain}/queries.ts` using `query()`
- Mutations (write operations): `convex/{domain}/mutations.ts` using `mutation()`
- Actions (external API calls / Node.js): `convex/{domain}/actions.ts` using `action()` or `internalAction()`
- Internal-only functions: use `internalQuery/internalMutation/internalAction`

**New Shared Utility:**
- Shared helpers: `lib/{concern}/{file}.ts`
- Domain types: `lib/types/{domain}.types.ts`
- Feature flags: `lib/{domain}/feature-flags.ts`

**New i18n Strings:**
- Primary: add keys to `messages/en-US.json`
- Also add to: `messages/en-GB.json`, `messages/fr.json`, `messages/zh.json`, `messages/ja.json`, `messages/hi.json`
- Use in components: `useTranslations('namespace')` (client), `getTranslations('namespace')` (RSC)

**New Test:**
- Unit/integration: `tests/{domain}/{file}.test.ts`
- Convex unit tests: co-locate in `convex/{domain}/{file}.test.ts` (e.g., `convex/library/collections.test.ts`)
- E2E: `e2e/{flow}.spec.ts`

## Special Directories

**`convex/_generated/`:**
- Purpose: Auto-generated Convex type declarations
- Generated: Yes — by `npx convex dev` / `npx convex deploy`
- Committed: Yes (checked into git)
- Note: Never edit manually; regenerated on each deploy

**`.next/`:**
- Purpose: Next.js build output and dev cache
- Generated: Yes
- Committed: No (in `.gitignore`)

**`.planning/`:**
- Purpose: GSD planning documents, milestone tracking, phase plans
- Generated: No (human + AI authored)
- Committed: Yes

**`node_modules/`:**
- Purpose: NPM dependencies
- Generated: Yes (via `npm install`)
- Committed: No

---

*Structure analysis: 2026-03-03*
