# Coding Conventions

**Analysis Date:** 2026-04-14

## Naming Patterns

**Files:**
- React components: `kebab-case.tsx` (e.g., `grouped-answer-row.tsx`, `cookie-consent-banner.tsx`, `insights-question-panel.tsx`)
- TypeScript modules: `kebab-case.ts` (e.g., `use-auth-query.ts`, `animation-config.ts`, `feature-flags/registry.ts`)
- Custom hook files: `use-*.ts` / `use-*.tsx` (e.g., `hooks/use-batch-screening.ts`, `hooks/use-mobile.tsx`, `lib/auth/use-sign-in-redirect.ts`)
- Type modules: `*.types.ts` (e.g., `lib/types/extraction.types.ts`, `lib/types/screening.types.ts`)
- Test files: `*.test.ts(x)` (e.g., `tests/auth-state-machine.test.ts`, `tests/components/grouped-answer-row.test.tsx`)
- E2E specs: `*.spec.ts` (e.g., `e2e/auth.spec.ts`)
- Config files: `*.config.ts` / `*.config.mjs` (e.g., `vitest.config.ts`, `next.config.ts`, `playwright.config.ts`)
- Convex modules: lowercase or camelCase (e.g., `convex/lib/auth.ts`, `convex/lib/rateLimit.ts`, `convex/lib/stripeWebhookHandlers.ts`)
- A few PascalCase exceptions for legacy components: `components/Pricing.tsx`, `components/PageContent.tsx`, `components/PageWrapper.tsx`

**Functions:**
- Pure functions: `camelCase` (e.g., `createDefaultFilters`, `jsonToCSV`, `downloadAsFile`, `getEffectiveSearchId`)
- Hooks: `use*` (e.g., `useFeatureFlag`, `useProtectedQuery`, `useSignInRedirect`)
- React components: `PascalCase` (e.g., `GroupedAnswerRow`, `InsightsOverview`, `Button`)
- Server-side capture/event helpers: action-like camelCase (e.g., `captureAIGenerationServer`, `processClerkWebhookEvent`)
- Convex factories: `createMockQueryCtx`, `createMockMutationCtx`, `createMockUser`
- Boolean predicates: `is*` / `has*` (e.g., `isRatingFilterActive`, `isCountryFilterActive`, `hasConsentDecision`)

**Variables:**
- Local variables and props: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MIN_YEAR`, `ITEMS_PER_PAGE`, `CONSENT_UPDATED_EVENT`, `EXTRACTION_INSIGHTS_NEW_KEYS`)
- Frozen object maps: `SCREAMING_SNAKE_CASE` with `as const` (e.g., `DEFAULT_FILTERS`, `FLAG_REGISTRY`, `TRACKED_GRANT_EVENT_TYPES`, `COLOR_PALETTE`)
- Discriminated unions and string literals: lowercase string members ("active", "free", "subscription_create")

**Types:**
- TypeScript types and interfaces: `PascalCase` (e.g., `SearchFilters`, `PaperResult`, `AuthContext`, `FlagName`, `ResolvedFlags`)
- Type-prefix for context-specific aliases: `AuthContext`, `ActionAuthContext`, `ErrorCode`, `PlanType`
- Validators (Convex): `*Validator` suffix (e.g., `planValidator`, `userStateValidator`, `creditTransactionTypeValidator`, `creditBalanceValidator`)
- Generic helpers: short, descriptive, PascalCase (e.g., `DeepPartial<T>`)

## Code Style

**Formatting:**
- No Prettier config file detected at the project root (`.prettierrc*` not present)
- Indentation: 2 spaces (consistent across `.ts`, `.tsx`, and JSON)
- Quotes: double quotes for TS/TSX strings; single quotes seen in some legacy files (`lib/utils.ts`)
- Semicolons: used consistently in modern files; legacy `lib/utils.ts` mixes styles
- Trailing commas: present in multi-line objects, function args, and TS generics

**Linting:**
- No ESLint config file present at root (no `.eslintrc*`, no `eslint.config.*`)
- `knip.json` configured to detect unused exports/files (ignores `ecosystem.config.js`)
- Custom shell script enforces `no-any` discipline: `scripts/verify-no-any.sh`
  - Forbids `: any`, `as any`, `any[]`, and `<any>` in `app/`, `components/`, `lib/`, `convex/`, `tests/`
  - Excludes `convex/_generated/` (auto-generated)
  - Runs `tsc --noEmit` as final gate
- A few `eslint-disable-next-line @typescript-eslint/no-explicit-any` comments survive in components that proxy `useTranslations` (e.g., `components/extraction/grouped-answer-row.tsx:37`, `components/extraction/insights-overview.tsx:30`)

**TypeScript:**
- `strict: true` enforced via `tsconfig.json`
- `noEmit: true` (typecheck-only)
- `moduleResolution: "bundler"`
- Path alias `@/*` maps to project root
- Target ES2017, lib `dom`, `dom.iterable`, `esnext`

## Import Organization

**Order (observed pattern across `lib/`, `components/`, `convex/`):**
1. Built-in / third-party packages (e.g., `import { useState } from "react"`, `import { create } from "zustand"`, `import { ConvexError } from "convex/values"`)
2. Type-only imports from third-party packages (e.g., `import type { FunctionReference } from "convex/server"`)
3. Internal aliased modules via `@/` (e.g., `import { api } from "@/convex/_generated/api"`, `import { Button } from "@/components/ui/button"`)
4. Relative imports for sibling modules (e.g., `import { SummaryCards } from "./summary-cards"`)
5. Type-only relative imports last (e.g., `import type { Doc } from "../convex/_generated/dataModel"`)

**Path Aliases:**
- `@/*` → project root (defined in `tsconfig.json` and mirrored in `vitest.config.ts`)
- Used liberally throughout the app: `@/components/...`, `@/lib/...`, `@/convex/_generated/...`, `@/hooks/...`

## Error Handling

**Convex (server) errors:**
- Centralized error factory in `convex/lib/errors.ts` exporting `createError(code, message)`
- All error codes are members of a discriminated union `ErrorCode` (over 60 codes covering auth, billing, AI, wallet, screening, integrations)
- Throws `ConvexError<ErrorData>` so the client can switch on `err.data.code`
- Example pattern in `convex/lib/auth.ts`:
  ```ts
  if (!identity) {
    throw createError("UNAUTHENTICATED", "Authentication required");
  }
  ```
- State-based assertions live in dedicated helpers (e.g., `assertActiveUser` in `convex/lib/auth.ts`)

**Client (UI) errors:**
- Display fallbacks via discriminated `status` fields on query responses (e.g., `insights.status === "ok" | "no_access" | "unauthenticated"` in `components/extraction/insights-overview.tsx`)
- Toast-based user error surfacing via `lib/toast/` helpers (tested in `tests/toast-action-routing.test.ts`, `tests/toast-error-resolver.test.ts`)
- Form/file errors thrown as `new Error(...)` with descriptive messages (see `lib/utils.ts` `uploadFile`)

**API routes:**
- `try`/`catch` wrapper returning `NextResponse.json({ error }, { status })` (see `app/api/openalex/search/route.ts`)
- Validation errors return `400`; missing required params return `400` with explicit messages

**Webhook handlers:**
- Return `{ status, body }` shape so transport layer can dispatch (see `processClerkWebhookEvent` in `convex/webhooks/clerk.ts`)
- Malformed payloads return `400`; unknown events return `200` with no-op

## Logging

**Framework:** Structured server-side analytics via PostHog HTTP API; no general logger abstraction

**Patterns:**
- Server-side AI usage capture is fire-and-forget via `captureAIGenerationServer` and `captureServerEvent` in `lib/posthog-server.ts`
  - Wraps `fetch` to PostHog `/i/v0/e/` endpoint
  - Swallows errors to avoid breaking the main flow
- Client-side analytics via `posthog-js` initialized in `instrumentation-client.ts`
- Test artifacts use append-only file logging via `appendBillingArtifactLog` in `tests/live-billing/support.ts`
- Convex audit logging lives in `convex/lib/audit.ts`
- No `console.log` litter in production code; relies on structured analytics events

## Comments

**When to Comment:**
- File-level JSDoc blocks describe module purpose at the top (e.g., `lib/posthog-server.ts`, `lib/feature-flags/registry.ts`, `lib/animation-config.ts`)
- Function-level JSDoc on exported helpers and complex logic (e.g., `getEffectiveSearchId` in `lib/utils.ts`, `useFeatureFlag` in `lib/feature-flags/hook.ts`)
- Section dividers using `// ─── Section ────` are common in `convex/wallet/wallet.test.ts` and `tests/factories/convex-context.ts`
- Inline comments explain non-obvious type bridging (e.g., `Cast to never to satisfy Convex's exact generic constraint` in `lib/auth/use-auth-query.ts`)

**JSDoc/TSDoc:**
- Standard JSDoc, no required tags
- Used to document `@param` and `@returns` on exported pure functions (see `lib/utils.ts` `getEffectiveSearchId`)
- Avoid stale "old/new" or "before/after" comments — codebase follows current-state-only documentation

## Function Design

**Size:** Small, single-purpose helpers preferred. Functions over ~80 lines tend to be Convex action handlers, top-level routes, or React components with substantial JSX.

**Parameters:**
- Single object parameter for >2 args (e.g., `processClerkWebhookEvent({ eventId, eventType, data, runMutation, mutationRefs })`)
- Optional named parameters via `overrides?: { ... }` pattern in factories (`tests/factories/convex-context.ts`)
- Use of `DeepPartial<T>` for selective overrides in test factories

**Return Values:**
- Discriminated unions for status-bearing responses: `{ status: "ok", ... } | { status: "no_access" }`
- Branded types for IDs: `Id<"users">` from Convex
- Tuples for fixed-length lists: `[number, number]` for ranges

## Module Design

**Exports:**
- Named exports preferred (no default-export bias)
- Default exports reserved for Next.js page components (`app/**/page.tsx`) and client singletons (`lib/openalex.ts`)
- Re-export barrels for type aggregation (`lib/types/index.ts`, `tests/factories/index.ts`)

**Barrel Files:**
- `lib/types/index.ts` aggregates all type exports across `lib/types/*.types.ts`
- `tests/factories/index.ts` re-exports `convex-context`, `convex-ids`, `stripe-events`
- Convex modules avoid barrels — each file exports its own queries/mutations/actions

## React Conventions

**Client/server boundary:**
- All interactive components start with `"use client"` directive (e.g., `components/extraction/grouped-answer-row.tsx`, `components/cookie-consent-banner.tsx`)
- Server components and Convex query handlers omit the directive

**Component structure:**
- Props interface declared above the component, typically named `*Props` (e.g., `GroupedAnswerRowProps`, `InsightsOverviewProps`)
- Internal small subcomponents declared in the same file when only used locally (e.g., `MiniBar` in `components/extraction/insights-question-panel.tsx`)
- Class composition via `cn(...)` from `lib/utils.ts` (clsx + tailwind-merge)
- Variant patterns use `class-variance-authority` (`cva`) — see `components/ui/button.tsx`
- Animation values pulled from `lib/animation-config.ts` (`subtleSpring`, `cardEntrance`, `commandCenterSpring`) rather than inlined

**State management:**
- Global state via Zustand stores in `lib/store.ts` with `persist` middleware and JSON storage
- Server state via Convex `useQuery` wrapped by `useProtectedQuery` / `useOptionalAuthQuery` in `lib/auth/use-auth-query.ts`
- Search params via `nuqs` (URL-as-state)
- Local state via `useState`, memoization via `useMemo`/`useCallback`

**Styling:**
- TailwindCSS v4 with `@tailwindcss/postcss`
- Theme via `next-themes` and OKLCH colors
- Dark-mode classes via `dark:` prefix
- Custom UI primitives in `components/ui/` (shadcn-derived)

## Internationalization

- Strings consumed via `useTranslations(namespace)` from `next-intl`
- All i18n keys must exist across all 6 supported locales (en-US, en-GB, fr, ja, zh, hi) — enforced by `tests/extraction-i18n-coverage.test.ts`
- Translation files under `messages/*.json`
- Locale matchers via `@formatjs/intl-localematcher`

## Convex Conventions

- Always read `convex/_generated/ai/guidelines.md` before working on Convex code (per `CLAUDE.md`)
- All public functions specify `args` and `returns` validators using `v.*` from `convex/values`
- Validators centralized in `convex/lib/validators.ts` and reused across queries/mutations
- Internal vs. public separation: `convex/credits/internal.ts` vs `convex/credits/queries.ts`
- Generated artifacts under `convex/_generated/` are off-limits to manual edits

---

*Convention analysis: 2026-04-14*
