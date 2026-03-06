# Coding Conventions

**Analysis Date:** 2026-03-06

## Naming Patterns

**Files:**
- Use kebab-case for all files: `filter-builder.ts`, `search-actions.ts`, `credit-grant-policy.test.ts`
- React components use kebab-case files: `results-list.tsx`, `paper-card.tsx`, `cookie-consent-banner.tsx`
- Convex backend files use camelCase only for multi-word lib files: `stripeWebhookHandlers.ts`, `userCreation.ts`
- Convex domain modules follow `domain/queries.ts`, `domain/mutations.ts`, `domain/actions.ts` pattern
- Type definition files use `.types.ts` suffix: `ai.types.ts`, `search.types.ts`, `extraction.types.ts`
- Test files use `.test.ts` suffix: `ai-cost.test.ts` (never `.spec.ts` for unit/integration)
- E2E test files use `.spec.ts` suffix: `auth.spec.ts`, `subscribe.spec.ts`

**Functions:**
- Use camelCase for all functions: `buildFilterData()`, `requireAuth()`, `calculateCostInDollars()`
- Convex queries/mutations exported as named `const`: `export const browseLibrary = query({...})`
- Helper/private functions use plain camelCase: `matchesLibraryFilters()`, `assertActiveUser()`
- Factory functions use `create` prefix: `createError()`, `createMockStripeEvent()`, `createDefaultFilters()`
- Boolean-returning functions use `is`/`has` prefix: `isEligibleMonthlyCreditBillingReason()`, `hasActiveLibraryFilters()`

**Variables:**
- Use camelCase for variables: `collectionItemIds`, `parsedUserId`
- Constants use UPPER_SNAKE_CASE: `SORT_INDEX_MAP`, `DEFAULT_FILTERS`, `ITEMS_PER_PAGE`, `MIN_YEAR`
- Map/lookup constants use UPPER_SNAKE_CASE: `FIELD_KEY_MAP`, `SORT_KEY_MAP`, `ELIGIBLE_MONTHLY_CREDIT_BILLING_REASONS`

**Types:**
- Use PascalCase for types and interfaces: `AIProvider`, `FilterParams`, `LibraryItem`, `ErrorCode`
- Prefix interfaces with descriptive nouns (no `I` prefix): `AIModel`, `AIProviderConfig`, `SearchFilters`
- Union types for enums over TypeScript `enum`: `type AIProvider = 'openai' | 'google' | 'anthropic' | ...`
- Convex validators use camelCase: `librarySortValidator`, `searchFiltersValidator`

**React Components:**
- Use PascalCase for component names: `ResultsList`, `PaperCard`, `AppSidebar`
- Props interfaces use `ComponentNameProps` pattern: `PapersListProps`
- Use `"use client"` directive at top of client components

## Code Style

**Formatting:**
- No dedicated formatter config (no `.prettierrc` or `.editorconfig` in project root)
- 2-space indentation throughout
- Semicolons used consistently
- Single quotes for string literals in most source files
- Double quotes acceptable in JSX attributes
- Trailing commas in multi-line arrays/objects

**Linting:**
- No project-level ESLint config detected
- Knip used for dead code detection: `knip.json`
- TypeScript strict mode enabled in `tsconfig.json`
- React Compiler enabled in `next.config.ts` (`reactCompiler: true`)

**TypeScript:**
- Strict mode with `"strict": true`
- `"noEmit": true` (Next.js handles compilation)
- Module resolution: `"bundler"`
- Target: `"ES2017"`

## Import Organization

**Order:**
1. Node built-ins: `import path from "node:path"`, `import { readFileSync } from "node:fs"`
2. External packages: `import { describe, expect, it } from "vitest"`, `import { v } from "convex/values"`
3. Internal aliases using `@/`: `import { cn } from "@/lib/utils"`, `import { useSearch } from "@/lib/search"`
4. Relative imports: `import { requireAuth } from "../lib/auth"`, `import { createMockStripeEvent } from "./factories"`

**Path Aliases:**
- `@/*` maps to project root `"./*"` (configured in `tsconfig.json`)
- Use `@/components/...`, `@/lib/...`, `@/hooks/...` in Next.js app/component code
- Use relative imports (`../`, `./`) in Convex backend code and test files

**Type imports:**
- Use `import type` for type-only imports: `import type { Doc, Id } from "../_generated/dataModel"`
- Mixed imports separate values from types: `import { v } from "convex/values"` + `import type { Cursor } from "convex/server"`

## Error Handling

**Convex Backend:**
- Use typed error codes via `createError()` from `convex/lib/errors.ts`
- Error codes are UPPER_SNAKE_CASE string literals: `"UNAUTHENTICATED"`, `"FORBIDDEN"`, `"NOT_FOUND"`
- Errors wrap `ConvexError` with `{ code, message }` payload
- Auth errors throw immediately at handler entry via `requireAuth(ctx)`
- Domain-specific error codes are namespaced: `AI_*`, `BILLING_*`, `ZOTERO_*`, `CREDITS_*`

```typescript
// Pattern: use createError() for all backend errors
import { createError } from "../lib/errors";
throw createError("UNAUTHENTICATED", "Authentication required");
throw createError("NOT_FOUND", "Item not found");
throw createError("AI_INSUFFICIENT_CREDITS", "Not enough credits");
```

**Frontend:**
- Error resolver in `lib/toast/error-resolver.ts` maps Convex error codes to i18n toast message keys
- Toast notifications via sonner (configured in `components/ui/sonner.tsx`)
- Action routing in `lib/toast/action-routing.ts` attaches CTA buttons to specific error toasts

**General:**
- Empty `catch {}` blocks acceptable for best-effort cleanup (e.g., sign-out in e2e teardown)
- Never silently swallow errors in business logic

## Logging

**Framework:** Console (no structured logging library)

**Patterns:**
- Backend: Convex provides built-in logging for function calls
- Debug gating via `convex/lib/debug_gate.ts` for conditional debug output
- PostHog analytics integration for user-facing events (`lib/posthog-ai.ts`, `lib/posthog-server.ts`)

## Comments

**When to Comment:**
- File-level JSDoc describing module purpose: `/** Filter Builder - Core logic for building structured filter data */`
- Section dividers in test files and factories use ASCII art: `// ---------------------------------------------------------------------------`
- Inline comments for non-obvious business logic or Stripe-specific behavior
- Step comments in E2E tests: `// 1. Subscribe via checkout-bypass`, `// 2. Wait for Convex webhook processing`

**JSDoc/TSDoc:**
- Used on exported types and interfaces in type definition files
- Used on Page Object Model methods in e2e page objects
- Not required on every function -- used when purpose is non-obvious

## Function Design

**Size:** Functions are generally focused and small (10-40 lines). Helper functions are extracted when logic is reusable.

**Parameters:**
- Convex handlers receive `(ctx, args)` where args are validated via `v` validators
- Complex parameter objects use destructuring or typed interfaces
- Optional parameters via `v.optional()` in Convex, `?` in TypeScript

**Return Values:**
- Convex queries return typed documents or arrays
- Convex mutations return IDs or null
- Helper functions return explicit types, avoid `any`

## Module Design

**Exports:**
- Named exports preferred over default exports
- Default exports used only for Next.js pages/layouts and Convex schema
- Barrel files (`index.ts`) used for grouped modules: `lib/types/index.ts`, `lib/filters/index.ts`
- Barrel files re-export with explicit `export type` for types and `export` for values

**Convex Module Pattern:**
- Each domain has a directory: `convex/library/`, `convex/users/`, `convex/subscriptions/`
- Split into `queries.ts`, `mutations.ts`, `actions.ts`, and optionally `internal.ts`
- Shared logic in `convex/lib/` directory
- Sub-domain libs in `convex/domain/lib/`: `convex/subscriptions/lib/schedulePlanning.ts`

## State Management

**Client State:**
- Zustand stores in `lib/store.ts` with `persist` middleware for localStorage
- Each store is a separate `create()` call: `useRatingsStore`, `useSearchHistoryStore`, `useUIStore`

**Server State:**
- Convex reactive queries for real-time data
- SWR for OpenAlex API calls (`swr` package)
- `nuqs` for URL search parameter state synchronization

## Internationalization

**Framework:** `next-intl` (v4)

**Patterns:**
- Translation files in `messages/`: `en-US.json`, `en-GB.json`, `fr.json`, etc.
- Server components use `getTranslations()` from `next-intl/server`
- Client components use `useTranslations()` hook
- Locale detection in `i18n/locale-detection.ts`
- All user-facing strings should use translation keys, not hardcoded strings

## UI Component Patterns

**Component Library:** shadcn/ui (new-york style)
- Configuration in `components.json`
- UI primitives in `components/ui/`: `button.tsx`, `card.tsx`, `dialog.tsx`
- Radix UI primitives via `radix-ui` package
- Icons via `lucide-react`

**Styling:**
- Tailwind CSS v4 with `@tailwindcss/postcss`
- `cn()` utility from `lib/utils.ts` for conditional class merging (clsx + tailwind-merge)
- CSS variables for theming (configured via shadcn)
- Animation via `motion` (Framer Motion) package

**Component Organization:**
- UI primitives in `components/ui/`
- Feature components directly in `components/`
- Sub-features in `components/feature-name/`: `components/command-center/`

---

*Convention analysis: 2026-03-06*
