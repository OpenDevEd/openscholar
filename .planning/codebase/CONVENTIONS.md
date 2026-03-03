# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

**Files:**
- React components: PascalCase — `PageContent.tsx`, `SearchInput.tsx`, `HomeHero.tsx`
- Next.js pages/routes: lowercase — `page.tsx`, `layout.tsx`, `error.tsx`
- Non-component TypeScript modules: kebab-case — `filter-builder.ts`, `credit-billing.ts`, `use-auth-query.ts`
- Test files: match source file name with `.test.ts` suffix — `filter-builder.test.ts`, `ai-cost.test.ts`
- Convex function files: lowercase descriptive — `mutations.ts`, `queries.ts`, `actions.ts`, `internal.ts`

**Functions:**
- Event handlers: `handle` prefix — `handleSearchSubmit`, `handleQueryChange`
- Boolean helpers: `is`/`has`/`can` prefix — `isRatingFilterActive`, `isCitesFilterActive`, `isFilterAtDefault`
- Factory/builder functions: `create`/`build`/`make` prefix — `createDefaultFilters`, `buildFilterData`, `createError`, `buildEnhanceQueryPrompts`
- React hooks: `use` prefix (camelCase) — `useUIStore`, `useAppToast`, `useCreateSearchFilters`
- Async operations: verb + noun — `loadBillingLiveEnv`, `runConvexFunction`, `waitForCondition`

**Variables:**
- camelCase throughout
- Constants: SCREAMING_SNAKE_CASE for module-level constants — `FREE_SIGNUP_CREDIT_GRANT`, `PLAN_CONFIG`, `DEFAULT_CREDITS_PER_USD`, `BILLING_REQUIRED_WEBHOOK_EVENTS`
- Boolean flags: descriptive without `is` prefix where clear from context — `shouldPushConvexCode`, `requirePaid`

**Types and Interfaces:**
- PascalCase for all type/interface names — `BillingLiveEnv`, `BillingSnapshot`, `ErrorCode`, `Usage`
- Type unions exported alongside validators — `PlanType`, `SubscriptionStatus`
- Suffix `Validator` for Convex value validators — `planValidator`, `subscriptionStatusValidator`, `userValidator`
- Suffix `Error` for custom error classes — `AIError`, `AIApiKeyRequiredError`, `AIProviderError`

**Convex functions:**
- Handlers always destructure args: `handler: async (ctx, args) => {` or `handler: async (ctx, { userId }) => {`
- Internal functions in `internal.ts` files; public in `mutations.ts`, `queries.ts`, `actions.ts`

## Code Style

**Formatting:**
- No Prettier or ESLint config file detected (`.eslintrc*`, `.prettierrc*`, `biome.json` absent)
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- Trailing commas used in multi-line objects and function arguments (observed consistently)
- Consistent 2-space indentation

**Linting:**
- No linting config found at root; `knip.json` present for unused exports/imports detection
- `knip` used for dead code analysis — config at `knip.json`

## Import Organization

**Order (observed pattern):**
1. External framework imports — `"react"`, `"next/navigation"`, `"vitest"`, `"convex/values"`
2. Internal path-aliased imports using `@/` — `"@/lib/store"`, `"@/components/ui/button"`, `"@/lib/utils"`
3. Relative imports — `"../lib/filters/filter-builder"`, `"./types"`, `"../convex/lib/constants"`

**Path Aliases:**
- `@/` maps to project root (configured in `tsconfig.json` and `vitest.config.ts`)
- Used in Next.js app and component code; test files use relative imports (`../lib/...`, `../convex/...`)

## Error Handling

**Convex backend pattern:**
- Typed error codes via `createError(code: ErrorCode, message?)` from `convex/lib/errors.ts`
- Throws `ConvexError<ErrorData>` with a `code` string — `createError("UNAUTHENTICATED", "Authentication required")`
- Error codes defined in union type `ErrorCode` covering auth, AI, billing, and integration errors
- Callers check `error instanceof ConvexError` to discriminate structured vs. unexpected errors

**Frontend/library pattern:**
- Custom error class hierarchy rooted at `AIError` in `lib/ai/core/errors.ts`
- Specific subclasses: `AIApiKeyRequiredError`, `AIInsufficientCreditsError`, `AIProviderError`, `AIValidationError`, etc.
- `handleAIError(error, context)` re-throws typed errors, wraps unknown errors in `AIProviderError`
- `try/finally` used for cleanup in UI handlers (note: `"use no memo"` pragma added to components with `try/finally`)

**General:**
- `error instanceof Error ? error.message : String(error)` pattern for safe error message extraction
- Functions that can error return `never` or throw (no returning error objects from non-throwing functions)

## Logging

**Framework:** `console.error` / `console.warn` (no structured logging library)

**Patterns:**
- `console.error(...)` in catch blocks of UI event handlers
- Convex backend errors propagate as `ConvexError` (no logging at throw site)
- Live billing tests append to artifact logs via `appendBillingArtifactLog(message)` in `tests/live-billing/support.ts`

## Comments

**When to Comment:**
- JSDoc-style `/** ... */` for exported public functions in `lib/` — e.g., `createSearchParameters`, `workToCoins`, `getEffectiveSearchId`
- Inline comments explain non-obvious behavior or edge cases
- Test files use inline comments to clarify setup intent — `// Enable fake timers BEFORE the mutation`
- `// Source:` comments reference external docs — `// Source: https://testing-library.com/docs/...`

**TSDoc:**
- `@param` and `@returns` used selectively in lib functions (not universally applied)

## Function Design

**Size:** Functions kept focused; complex orchestration extracted to helpers
**Parameters:** Object destructuring preferred for 3+ parameters — `{ provider, modelId, usage }`
**Return Values:** Functions return typed values; `null` returned (not `undefined`) for "not found" cases in Convex queries — `return v.null()`

## Module Design

**Exports:**
- Named exports preferred; default export for React components (Next.js convention)
- Convex functions exported as named mutations/queries/actions matching file organization
- `convex/_generated/api` used for strongly-typed Convex API references in tests

**Barrel Files:**
- `lib/ai/core/index.ts` acts as barrel for AI core exports
- `lib/types/index.ts` re-exports type definitions
- Convex `_generated/` is auto-generated; never hand-edit

## React Patterns

**Component Organization:**
- `"use client"` directive at top of client components (Next.js App Router pattern)
- `"use no memo"` added when `try/finally` blocks are present (React Compiler compatibility)
- `dynamic(() => Promise.resolve(Component), { ssr: false })` for components requiring browser APIs

**State Management:**
- Zustand stores in `lib/store/` and `lib/store.ts` for client state
- Convex reactive queries for server state
- Local `React.useState` for ephemeral UI state

---

*Convention analysis: 2026-03-03*
