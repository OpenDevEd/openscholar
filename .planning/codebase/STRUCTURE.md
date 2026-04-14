# Codebase Structure

**Analysis Date:** 2026-04-14

## Directory Layout

```
openalex-count/
├── app/                     # Next.js 16 App Router (pages, route handlers, server actions)
│   ├── actions/             # `"use server"` server actions (OpenAlex proxy)
│   ├── api/                 # Route handlers (currently only /api/openalex/search)
│   ├── bookmarks/           # /bookmarks page
│   ├── connect/             # Wallet OAuth-style consent page
│   ├── cookie-policy/       # /cookie-policy legal page
│   ├── extraction/          # /extraction list, /extraction/new creator, /extraction/[jobId] detail
│   ├── history/             # /history page
│   ├── library/             # /library page
│   ├── pricing/             # /pricing page
│   ├── privacy/             # /privacy legal page
│   ├── results/             # /results/[searchId] + nested /history
│   ├── settings/            # /settings (ai, billing, connections, root)
│   ├── sign-in/             # Clerk sign-in catch-all
│   ├── sign-up/             # Clerk sign-up catch-all
│   ├── layout.tsx           # Root layout — providers + gates
│   ├── page.tsx             # Home
│   ├── globals.css          # Tailwind v4 tokens, OKLCH palette
│   ├── error.tsx            # Route error boundary
│   ├── global-error.tsx     # Root error boundary
│   └── not-found.tsx        # 404
│
├── components/              # All React components (UI + feature folders)
│   ├── ai/                  # AI setup gate
│   ├── auth/                # Auth route gate + panels
│   ├── billing/             # Credit balance, top-up, upgrade dialog
│   ├── bookmarks-command-center/
│   ├── command-center/      # Shared command center layout primitives
│   ├── extraction/          # Extraction feature UI (viewer, results, builders)
│   ├── focus-mode/          # Focus mode reader
│   ├── history-command-center/
│   ├── home/                # Hero, ambient background, search input, mode toggle
│   ├── icons/               # Custom SVG icons
│   ├── layout/              # Two-column layout
│   ├── library/             # Library command center + filters
│   ├── paper-card/          # Paper result card
│   ├── providers/           # Convex + Clerk provider wrapper
│   ├── screening/           # Screening dialogs, jobs, scoring UI
│   ├── search-command-center/
│   ├── settings/            # Settings sub-pages UI
│   ├── shared/              # Shared building blocks (sidebar-layout, etc.)
│   ├── ui/                  # shadcn/ui primitives (button, dialog, sonner, table, …)
│   ├── app-sidebar.tsx      # Left nav with Motion animations
│   ├── auth-button.tsx      # Auth control in sidebar
│   ├── cookie-consent-banner.tsx
│   ├── mobile-navbar.tsx
│   ├── PageContent.tsx      # Home page client content
│   ├── PageWrapper.tsx
│   ├── Pricing.tsx
│   ├── results-list.tsx
│   ├── results-page-content.tsx
│   ├── search-filter-sidebar.tsx
│   ├── search-history*.tsx  # History command center siblings
│   └── theme-provider.tsx / theme-toggle.tsx
│
├── convex/                  # Convex backend
│   ├── _generated/          # Generated API + data model (DO NOT EDIT)
│   ├── ai/                  # Credit-billed AI helpers (actions, config, helpers, lib/creditBilling)
│   ├── apiKeys/             # BYOK key management (actions, mutations, queries)
│   ├── credits/             # Credit ledger (actions, internal, queries, lib policies)
│   ├── extraction/          # Extraction pipeline (queries, mutations, actions, workflow, workpoolActions, prompts, evidence_units, pdfjs_extract, validators, types, etc.)
│   ├── featureFlags/        # Flag reads + guard + internal setters
│   ├── lib/                 # Shared backend utilities (auth, errors, crypto, rateLimit, env, envValidation, stripeWebhookHandlers, audit, validators, …)
│   ├── library/             # User library collections + backfill
│   ├── maintenance/         # Cron-driven maintenance mutations
│   ├── models/              # Model catalog sync from OpenRouter
│   ├── screening/           # Screening workflow + mutations/queries/scoring/validators
│   ├── subscriptions/       # Stripe-backed subscription logic + lib policies
│   ├── testing/             # Test-only helpers
│   ├── users/               # ensureUser, mutations, queries, internal helpers
│   ├── wallet/              # Wallet keys, nodeActions, gateway/* (OpenAI-compatible HTTP)
│   ├── webhooks/            # Clerk webhook + mappers
│   ├── zotero/              # Zotero OAuth + actions/mutations/queries
│   ├── schema.ts            # Every table + index in one file
│   ├── convex.config.ts     # Components: stripe, rag, workflow, workpool × 2
│   ├── http.ts              # HTTP router (webhooks + wallet API)
│   ├── crons.ts             # Scheduled jobs
│   ├── workflow.ts          # WorkflowManager config
│   ├── workpool.ts          # pdfProcessingPool + screeningPool
│   ├── stripe.ts            # Stripe client factory
│   ├── auth.config.ts       # Clerk issuer for Convex auth
│   └── tsconfig.json
│
├── lib/                     # Shared TS lib (client-safe + server-neutral)
│   ├── ai/
│   │   ├── client/          # Router hook, executor, mode-routing, hook-factory
│   │   ├── core/            # Provider-neutral schemas, prompts, types, validate, batch, cost, configs, execute
│   │   └── server/          # `getProviderModel` factory for @ai-sdk providers
│   ├── auth/                # Public routes, proxy policy, Clerk UI config, auth query hooks
│   ├── billing/             # Entitlements
│   ├── constants/           # View mode constants
│   ├── credits/             # Feature flags for credits
│   ├── extraction/          # UI helpers: filtering, grouping, citations, thresholds, insights, reviews, export, pdfjs-text, pdf-highlight
│   ├── feature-flags/       # Registry, provider, hook, resolve
│   ├── filters/             # Filter builder/config/types
│   ├── hooks/               # use-cooldown, use-debounced-value, use-selection, use-url-state
│   ├── i18n/                # Locale map helpers
│   ├── library/             # Library export, download handlers, param codecs
│   ├── openalex/            # Abstract reconstruction
│   ├── pdf/                 # PDF download helper
│   ├── screening/           # Export helper
│   ├── search/              # SearchProvider, actions, detect-mode, initializer, types
│   ├── search-params/       # nuqs parsers + serializers + converters + regions
│   ├── store/               # extraction store slice
│   ├── subscriptions/       # Subscription feature flags
│   ├── toast/               # Styled toast system (core, error-resolver, action-routing, use-app-toast)
│   ├── types/               # Central type re-exports (ai, extraction, library, screening, search)
│   ├── ui/                  # sidebar-motion config
│   ├── ai-models.ts         # Client AI model catalog
│   ├── animation-config.ts  # Motion spring presets
│   ├── confirmation.tsx     # Global confirmation host
│   ├── consent-storage.ts
│   ├── constants.ts         # Large constants (21KB)
│   ├── convex-site.ts
│   ├── format.ts
│   ├── hooks.ts             # Large cross-cutting hooks file (14KB)
│   ├── keyword-validation.ts
│   ├── legal-content.ts
│   ├── openalex.ts          # OpenAlex SDK singleton
│   ├── posthog-*.ts         # PostHog wrappers (ai, server, search, shared)
│   ├── search-actions.ts    # Download/export search result handlers
│   ├── search-utils.ts
│   ├── store.ts             # Zustand root store (42KB)
│   ├── utils.ts             # Tailwind cn, createSearchParameters, etc. (20KB)
│   └── zotero-utils.ts
│
├── hooks/                   # App-level hooks not under lib/
│   ├── use-batch-operation.ts
│   ├── use-batch-screening.ts
│   ├── use-batch-translation.ts
│   ├── use-country-filter.ts
│   └── use-mobile.tsx
│
├── i18n/                    # next-intl config
│   ├── config.ts            # Locale list
│   ├── locale.ts
│   ├── locale-detection.ts
│   └── request.ts           # getRequestConfig
│
├── messages/                # next-intl translation bundles
│   ├── en-US.json
│   ├── en-GB.json
│   ├── zh.json
│   ├── fr.json
│   ├── hi.json
│   └── ja.json
│
├── content/                 # Markdown legal content
│   ├── cookie-policy/
│   └── privacy-policy/
│
├── tests/                   # Vitest unit + component tests
│   ├── components/          # Component test helpers
│   ├── extraction/          # Extraction-specific tests
│   ├── factories/           # Test data factories
│   ├── library/             # Library feature tests
│   ├── live-billing/        # Live Stripe billing tests (separate config)
│   ├── setup.ts             # Vitest setup
│   └── *.test.ts(x)         # Unit/integration tests
│
├── e2e/                     # Playwright tests
│   ├── auth.spec.ts
│   ├── billing/             # Billing e2e specs
│   └── global.setup.ts
│
├── scripts/                 # Operational scripts
│   ├── billing-preflight.mjs
│   ├── verify-legal-markdown-parity.mjs
│   ├── verify-no-any.sh
│   └── wallet-cli.ts
│
├── skills/                  # GSD skill definitions
├── docs/                    # Internal docs + plans
├── public/                  # Static assets
│
├── proxy.ts                 # Next.js edge middleware (renamed from middleware.ts)
├── next.config.ts           # Next.js config (React Compiler, headers, rewrites, next-intl plugin)
├── tsconfig.json            # TS config (paths: "@/*" → "./*")
├── vitest.config.ts         # Default Vitest config
├── vitest.live.config.ts    # Live-billing Vitest config
├── playwright.config.ts
├── knip.json                # knip dead-code config
├── postcss.config.mjs       # Tailwind v4 via @tailwindcss/postcss
├── components.json          # shadcn/ui config
├── instrumentation-client.ts# PostHog instrumentation
├── ecosystem.config.js      # pm2 config (`npm run dev:all`)
├── global.d.ts
├── next-env.d.ts
├── AGENTS.md                # Agent instructions
├── CLAUDE.md                # Design context + conventions
├── package.json
└── README.md
```

## Directory Purposes

**`app/`:**
- Purpose: Next.js 16 App Router — pages, layouts, route handlers, server actions, error boundaries.
- Contains: `layout.tsx` + `page.tsx` per route, a single route handler under `app/api/openalex/search/route.ts`, and one server action file `app/actions/openalex.ts`.
- Key files: `app/layout.tsx` (all providers), `app/page.tsx` (home), `app/results/[searchId]/page.tsx`, `app/extraction/[jobId]/page.tsx`, `app/settings/layout.tsx`.

**`components/`:**
- Purpose: All React components. No nested route-scoped component folders inside `app/`.
- Contains: Feature folders (`extraction/`, `library/`, `screening/`, `home/`, `billing/`, `ai/`, `auth/`, `search-command-center/`, `bookmarks-command-center/`, `history-command-center/`, `command-center/`, `layout/`, `paper-card/`, `focus-mode/`, `shared/`), `ui/` (shadcn primitives), `providers/`, `icons/`, and many top-level `.tsx` feature components.
- Key files: `components/app-sidebar.tsx` (32KB nav), `components/results-list.tsx` (18KB), `components/Pricing.tsx` (27KB), `components/search-sidebar.tsx` (18KB), `components/providers/convex-provider.tsx`.

**`convex/`:**
- Purpose: Authoritative backend — schema, queries, mutations, actions, workflows, HTTP routes, crons.
- Contains: One folder per domain plus shared `lib/`. Root files hold cross-domain config.
- Key files: `convex/schema.ts` (all tables/indexes), `convex/http.ts` (webhooks + wallet API), `convex/convex.config.ts` (components), `convex/workflow.ts`, `convex/workpool.ts`, `convex/crons.ts`, `convex/lib/auth.ts`, `convex/lib/errors.ts`, `convex/lib/stripeWebhookHandlers.ts`.

**`lib/`:**
- Purpose: Client/server neutral TypeScript shared by `app/`, `components/`, and some `convex/` files.
- Contains: Subfolders per domain/concern plus top-level helper files.
- Key files: `lib/store.ts` (Zustand root, 42KB), `lib/search/provider.tsx`, `lib/search-params/parsers.ts`, `lib/types/index.ts`, `lib/ai/server/providers.ts`, `lib/auth/public-routes.ts`, `lib/openalex.ts`, `lib/utils.ts`.

**`hooks/`:**
- Purpose: App-level hooks that don't fit inside `lib/hooks/`. Historical / batch hooks.
- Contains: `use-batch-*.ts`, `use-country-filter.ts`, `use-mobile.tsx`.
- Note: New shared hooks should go in `lib/hooks/` (co-located with their domain).

**`i18n/`:**
- Purpose: `next-intl` setup — locale list, request config, detection, locale helpers.
- Key files: `i18n/config.ts`, `i18n/request.ts`, `i18n/locale-detection.ts`.

**`messages/`:**
- Purpose: One JSON file per locale consumed by `next-intl`.

**`content/`:**
- Purpose: Markdown source for legal pages.

**`convex/_generated/`:**
- Purpose: Code generated by `convex dev`. Contains `api.d.ts`, `dataModel.d.ts`, `server.d.ts`, `api.js`, `server.js`.
- Generated: Yes (by Convex CLI).
- Committed: Yes.

**`tests/`:**
- Purpose: Vitest unit and component tests with jsdom. `tests/setup.ts` wires Testing Library.
- Contains: Flat `*.test.ts(x)` files + domain subfolders (`extraction/`, `library/`, `components/`, `factories/`, `live-billing/`).

**`e2e/`:**
- Purpose: Playwright end-to-end tests.
- Key files: `e2e/auth.spec.ts`, `e2e/billing/*`, `e2e/global.setup.ts`.

**`scripts/`:**
- Purpose: Node/TSX CLI utilities — billing preflight, legal parity check, wallet CLI.

**`docs/`:**
- Purpose: Internal documentation and planning notes (`docs/plans/`).

**`public/`:**
- Purpose: Static assets served by Next.js.

## Key File Locations

**Entry Points:**
- `app/layout.tsx`: Root layout; sets up Clerk + Convex + next-intl + theme + nuqs + feature flags + sidebar + toasts.
- `app/page.tsx`: Home route; wraps `components/PageContent.tsx`.
- `proxy.ts`: Edge middleware (referred to as "proxy"); runs Clerk route protection and locale cookie detection.
- `convex/http.ts`: Convex HTTP router — webhooks + wallet gateway.
- `convex/crons.ts`: Scheduled tasks.
- `instrumentation-client.ts`: PostHog instrumentation entry.

**Configuration:**
- `next.config.ts`: React Compiler on, security headers, PostHog rewrites, wraps with `next-intl` plugin.
- `tsconfig.json`: Path alias `@/*` → `./*`, strict mode.
- `convex/convex.config.ts`: Registers `@convex-dev/stripe`, `@convex-dev/rag`, `@convex-dev/workflow`, two `@convex-dev/workpool` instances.
- `convex/auth.config.ts`: Clerk JWT issuer for Convex.
- `vitest.config.ts`: Default Vitest.
- `vitest.live.config.ts`: Live-billing test config.
- `playwright.config.ts`: Playwright.
- `knip.json`: Dead code analysis.
- `components.json`: shadcn/ui config.
- `postcss.config.mjs`: Tailwind v4 plugin.
- `ecosystem.config.js`: pm2 (`npm run dev:all` starts Next + Convex).
- `i18n/config.ts`, `i18n/request.ts`: Locale config + request binding.

**Core Logic:**
- `convex/schema.ts`: All Convex tables + indexes (source of truth for data model).
- `lib/search/provider.tsx`: URL-driven search state (single SWR instance).
- `lib/search-params/parsers.ts`: nuqs parsers and serializers.
- `lib/store.ts`: Zustand root (history, UI, focus, keywords, AI config, sidebar).
- `lib/ai/core/schemas.ts`, `lib/ai/core/prompts.ts`, `lib/ai/core/validate.ts`: Shared AI contracts.
- `lib/ai/server/providers.ts`: `getProviderModel` factory for `@ai-sdk/*`.
- `convex/extraction/workflow.ts` + `convex/extraction/workpoolActions.ts`: Extraction pipeline.
- `convex/wallet/gateway/handler.ts`: OpenAI-compatible HTTP wallet gateway.
- `convex/lib/auth.ts`: `requireAuth`, `getCurrentUser`, etc.
- `convex/lib/errors.ts`: Typed `ErrorCode` union + `createError` helper.
- `convex/lib/stripeWebhookHandlers.ts`: Audited Stripe webhook wrapper.

**Testing:**
- `tests/setup.ts`: Vitest + Testing Library setup.
- `tests/factories/`: Reusable test data builders.
- `tests/live-billing/`: Live-billing suite (runs under `vitest.live.config.ts`).
- `e2e/global.setup.ts`: Playwright global setup (Clerk test harness).

## Naming Conventions

**Files:**
- Components: `kebab-case.tsx` (e.g., `components/search-filter-sidebar.tsx`, `components/results-list.tsx`).
  - Exceptions: a few PascalCase legacy files — `components/PageContent.tsx`, `components/PageWrapper.tsx`, `components/Pricing.tsx`, and `components/home/HomeHero.tsx`/`AmbientBackground.tsx`/`SearchInput.tsx`/`ModeToggle.tsx`.
- shadcn primitives: lowercase, dash-separated (`components/ui/dropdown-menu.tsx`, `components/ui/alert-dialog.tsx`).
- Hooks: `use-*.ts` / `use-*.tsx` (e.g., `hooks/use-batch-screening.ts`, `lib/hooks/use-debounced-value.ts`).
- Convex functions: `queries.ts`, `mutations.ts`, `actions.ts`, `workflow.ts`, `workpoolActions.ts`, `validators.ts`, `internal.ts` per domain folder.
- Tests: `*.test.ts` / `*.test.tsx` colocated under `tests/` (not next to source), live-billing under `tests/live-billing/`.
- Playwright: `*.spec.ts` under `e2e/`.

**Directories:**
- Feature folders under `components/` and `convex/` use `kebab-case` (`search-command-center/`) or `camelCase` in Convex (`featureFlags/`, `apiKeys/`). Matching folder names between `lib/<domain>/`, `convex/<domain>/`, and `components/<domain>/` is preferred.
- Route segments: Next.js `[searchId]`, `[[...sign-in]]` conventions.

**Code:**
- Functions/hooks/variables: `camelCase`.
- Types/interfaces/React components: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` (e.g., `PUBLIC_UNAUTHENTICATED_PATHS`, `DEFAULT_SEARCH_PARAMS`).
- Convex error codes: `UPPER_SNAKE_CASE` string union in `convex/lib/errors.ts`.
- Zustand stores: `useXxxStore` (e.g., `useSearchHistoryStore`, `useUIStore`, `useKeywordExpansionStore`, `useAIConfigStore`, `useCurrentQueryStore`).

## Where to Add New Code

**New App Page:**
- Folder: `app/<route>/page.tsx` (+ optional `layout.tsx`, `error.tsx`, `loading.tsx`).
- Client content: extract into `components/<route>/<route>-page-client.tsx` or a feature folder under `components/`.
- Register in `lib/auth/public-routes.ts` if unauthenticated access is needed.
- Add translations under `messages/*.json`.

**New UI Component:**
- Feature-specific: `components/<feature>/<component>.tsx`.
- Shared primitive: `components/ui/<component>.tsx` (run `shadcn` CLI; config in `components.json`).
- Shared feature-agnostic: `components/shared/<component>.tsx`.

**New Server Action:**
- Create a file under `app/actions/<domain>.ts` with `"use server"` at the top.
- Prefer Convex mutations/actions for authenticated work. Use Next.js server actions only for public/unauthenticated work like OpenAlex proxying.

**New Next.js Route Handler:**
- `app/api/<path>/route.ts` with HTTP method exports. Currently used only for `app/api/openalex/search/route.ts`.

**New Convex Domain:**
- Add `convex/<domain>/queries.ts`, `mutations.ts`, `actions.ts` (and `internal.ts` for internal-only helpers).
- Long-running work: add `workflow.ts` + `workpoolActions.ts` and wire a new workpool if needed in `convex/workpool.ts`.
- Shared helpers: `convex/<domain>/lib/*.ts`.
- Add tables to `convex/schema.ts` — all tables live in one file.
- Add validators in `convex/<domain>/validators.ts` if shared.
- If HTTP-exposed: register route in `convex/http.ts`.
- If scheduled: register in `convex/crons.ts`.

**New Convex Helper (cross-domain):**
- `convex/lib/<name>.ts`.

**New Shared Lib Module:**
- Folder `lib/<domain>/` with `index.ts` and named files.
- If types only: add to `lib/types/<domain>.types.ts` and re-export from `lib/types/index.ts`.
- AI additions: `lib/ai/core/` for provider-neutral contracts, `lib/ai/client/` for React hooks, `lib/ai/server/` for server-only factories.

**New Hook:**
- Domain-specific: `lib/hooks/<hook>.ts` or `lib/<domain>/hooks/*`.
- App-level batch hooks (historical): `hooks/*.ts` (prefer `lib/hooks/` for new code).

**New Test:**
- Unit/integration (Vitest): `tests/<name>.test.ts(x)`. Use `tests/factories/` for builders and `tests/setup.ts` for global setup.
- Live-billing: `tests/live-billing/*` (runs under `vitest.live.config.ts`).
- E2E (Playwright): `e2e/*.spec.ts`.

**New Locale Key:**
- Add to all `messages/<locale>.json` files (coverage is enforced by tests in `tests/extraction-i18n-coverage.test.ts`).

**New Feature Flag:**
- Register in `lib/feature-flags/registry.ts`; consume with `useFeatureFlag` from `lib/feature-flags/hook.ts`; seed via `convex/featureFlags/internal.ts`; enforce server-side with `convex/featureFlags/guard.ts`.

**New Stripe Webhook Handler:**
- Add the event inside `registerRoutes` in `convex/http.ts`, wrap with `runAuditedStripeHandler`, document an idempotency contract in a JSDoc block, and route real work into `convex/credits/` or `convex/subscriptions/`.

**New Wallet Gateway Endpoint:**
- Add handler in `convex/wallet/gateway/handler.ts`, register with `http.route` in `convex/http.ts`, add a matching `OPTIONS` CORS route.

## Special Directories

**`convex/_generated/`:**
- Purpose: Convex CLI output (`api`, `internal`, `dataModel`, `components`).
- Generated: Yes (by `convex dev` / `convex deploy`).
- Committed: Yes.

**`messages/`:**
- Purpose: next-intl translation JSON.
- Generated: No.
- Committed: Yes. All locales must stay in sync.

**`.planning/`:**
- Purpose: GSD planning artifacts (phases, research, codebase maps, milestones, state).
- Generated: Partly (by GSD commands).
- Committed: Yes.

**`public/`:**
- Purpose: Static assets.
- Generated: No.
- Committed: Yes.

**`.next/`, `node_modules/`, `test-results/`, `tsconfig.tsbuildinfo`:**
- Generated: Yes.
- Committed: No.

**`skills/`:**
- Purpose: GSD/agent skill definitions referenced by `skills-lock.json`.
- Committed: Yes.

---

*Structure analysis: 2026-04-14*
