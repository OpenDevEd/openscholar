# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

**Files:**
- React components: PascalCase (`SearchFilterSidebar.tsx`, `PageContent.tsx`, `PaperCard/`)
- Utility modules: kebab-case (`filter-builder.ts`, `search-actions.ts`, `credit-billing.ts`)
- Type definition files: kebab-case with `.types.ts` suffix (`ai.types.ts`, `search.types.ts`, `extraction.types.ts`)
- Test files: match the source file name with `.test.ts` suffix (`filter-builder.test.ts`, `ai-cost.test.ts`)
- Convex functions: kebab-case (`userCreation.ts`, `stripeWebhookHandlers.ts`)

**Functions:**
- Regular functions: camelCase (`buildFilterData`, `calculateCostInDollars`, `createUserWithDefaults`)
- React components: PascalCase (`SearchFilterSidebar`, `PageContent`)
- React hooks: camelCase prefixed with `use` (`useIsMobile`, `useCurrentSearchFormState`, `useFilterSidebarStore`)
- Event handlers: camelCase prefixed with `handle` (`handleClearAllFilters`)
- Boolean predicates: camelCase prefixed with `is`/`has` (`isDateFilterActive`, `hasActiveFiltersFromResult`)
- Factory/builder helpers: camelCase (`createFilterItem`, `createSection`, `createMockCtx`)

**Variables:**
- camelCase for all variables (`activeFiltersCount`, `citationItems`, `currentSearchField`)
- UPPER_SNAKE_CASE for constants/config objects (`FREE_SIGNUP_CREDIT_GRANT`, `PLAN_CONFIG`, `DEFAULT_FILTERS`, `FILTER_ICONS`)
- Boolean variables: prefixed with `is`/`has`/`should` (`isMobile`, `isYearRangeEnabled`, `shouldPushConvexCode`)

**Types and Interfaces:**
- PascalCase for all (`FilterParams`, `FilterSection`, `BillingLiveEnv`, `AIProvider`, `ErrorCode`)
- `type` preferred over `interface` for plain data shapes
- `interface` used for component-style shapes (`AIModel`, `AIProviderConfig`)
- Union string types for enums (`ErrorCode`, `AIProvider`, `AIKeyMode`)
- Exported via barrel index files (e.g., `lib/types/index.ts`)

## Code Style

**Formatting:**
- No project-level Prettier or ESLint config detected (TypeScript strict mode enforced via `tsconfig.json`)
- `"strict": true` in tsconfig — all TypeScript strict checks enabled
- Double quotes for strings in source files
- Trailing commas in multi-line structures

**Import Style:**
- Named imports preferred over default imports for utilities
- `import type` used consistently for type-only imports
- Path alias `@/` maps to project root (e.g., `@/lib/utils`, `@/components/shared/filter-sidebar`)

## Import Organization

**Order observed in source files:**
1. External packages (`react`, `next-intl/server`, `date-fns`, `convex/values`)
2. Internal path-aliased imports (`@/components/...`, `@/lib/...`)
3. Relative imports (`../lib/filters/filter-builder`, `./search-sidebar`)
4. Type-only imports last when co-located with value imports

**Path Aliases:**
- `@/*` → project root (configured in `tsconfig.json` and `vitest.config.ts`)

## Error Handling

**Convex Backend Errors:**
- Use `createError(code, message?)` from `convex/lib/errors.ts`
- Errors are `ConvexError<ErrorData>` with typed `ErrorCode` union
- All error codes are SCREAMING_SNAKE_CASE strings defined in `ErrorCode` type
- Example: `createError("INSUFFICIENT_CREDITS")`, `createError("NOT_FOUND", "User not found")`

**Client-Side Errors:**
- `instanceof Error` checks before accessing `.message`
- Errors thrown from async functions propagate as standard `Error` with descriptive messages
- Error strings include context: `Failed to run convex function ${args.functionPath}: ${details}`

**Unknown Error Pattern:**
```typescript
const details = error instanceof Error
  ? error.message
  : `Unknown convex CLI error: ${String(error)}`;
```

## Logging

**Framework:** No structured logging library; `console`-level not observed in production paths. Live tests use custom artifact logging to files (`appendBillingArtifactLog`).

**Patterns:**
- Test/live-billing code writes timestamped lines to `test-results/billing-live/live.log`
- Production code avoids `console.log`; errors surface via `ConvexError` throws

## Comments

**When to Comment:**
- Module-level JSDoc blocks on exported utilities (e.g., `filter-builder.ts`)
- Inline comments explaining non-obvious logic (e.g., `// Should use promptTokens (1M * $0.05/1M = $0.05), not inputTokens (2M)`)
- Section separators using `// ============ Section Name ============` in larger files
- Comment comment on test setup concerns, especially mocking rationale

**JSDoc Style:**
```typescript
/**
 * Build structured filter data from search parameters
 * This is the single source of truth for filter display logic
 */
export function buildFilterData(...)
```

**Inline Type Annotations in Tests:**
- `as const` for literal tuples
- `as AIProvider` for string literals needing type narrowing
- `as any` used explicitly when bypassing strict types in test helpers (`ctx as any`)

## Function Design

**Size:** Functions are focused and small. Complex orchestration split into private helpers (e.g., `createSection`, `createFilterItem` supporting `buildFilterData`).

**Parameters:**
- Single object destructuring for functions with 3+ parameters (`{ usage, provider, modelId }`)
- Optional parameters use `?:` type syntax, never default-to-`undefined` tricks
- Convex mutation/query contexts typed as `MutationCtx` / `QueryCtx` from `convex/_generated/server`

**Return Values:**
- Functions return early on invalid/empty input (e.g., `if (!promptTokens && !completionTokens) return 0`)
- Async functions always `await`; no implicit promise chaining

## Module Design

**Exports:**
- Named exports preferred (no `export default` for utility functions)
- `export default` used only for Next.js pages/layouts/configs (convention-required)
- Convex functions use `mutation(...)` / `query(...)` / `action(...)` wrappers with named exports

**Barrel Files:**
- `lib/types/index.ts` re-exports all types from domain-specific files
- `lib/filters/index.ts` (implied) centralizes filter exports
- `convex/_generated/api` auto-generated — do not manually edit

## TypeScript Patterns

**Convex-Specific:**
- `Id<"tableName">` for typed document IDs from `convex/_generated/dataModel`
- `internal.module.functionName` references for internal-only Convex functions
- `api.module.functionName` references for public-facing Convex functions

**React Patterns:**
- `"use client"` directive at top of client components
- `React.useCallback` for event handlers passed to child components
- `ReturnType<typeof createMockCtx>` for typed mock context in tests

---

*Convention analysis: 2026-03-03*
