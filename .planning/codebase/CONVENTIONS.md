# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `PageContent.tsx`, `HomeHero.tsx`, `SearchInput.tsx`)
- Utility/lib modules: kebab-case (e.g., `filter-builder.ts`, `credit-billing.ts`, `search-actions.ts`)
- Type definition files: `*.types.ts` suffix (e.g., `search.types.ts`, `ai.types.ts`, `extraction.types.ts`)
- Convex backend files: kebab-case for actions/mutations/queries (e.g., `cascade-delete.ts`, `deduct-credits.ts`)
- Test files: `[subject].test.ts` mirroring the module under test (e.g., `filter-builder.test.ts` tests `lib/filters/filter-builder.ts`)
- Config files: `[subject]-config.ts` (e.g., `filter-config.ts`, `vitest.config.ts`)

**Functions:**
- camelCase for all functions and methods
- Prefix query hooks with `use` (e.g., `useEnhanceSearchQuery`, `useQueryChangeHandler`)
- Prefix async data-fetching actions with verbs: `get`, `fetch`, `load`, `build`, `create`, `calculate`, `process`
- Pure predicate functions prefixed with `is` or `has` (e.g., `isRatingFilterActive`, `hasActiveFiltersFromResult`, `isCitesFilterActive`)
- Factory/builder functions: `make`, `create`, `build`, `seed` (e.g., `makeStripeEvent`, `createMockCtx`, `buildFilterData`, `seedUserWithCredits`)

**Variables:**
- camelCase for all variables and constants
- SCREAMING_SNAKE_CASE for module-level constants (e.g., `MIN_YEAR`, `FIXED_TIME`, `DEFAULT_RETRY_CONFIG`, `BILLING_REQUIRED_WEBHOOK_EVENTS`)
- `mock` prefix for mock objects in tests (e.g., `mockExecute`, `mockFetch`, `mockToast`)
- Numeric literals use underscore separators for readability: `1_000_000`, `300_000`, `180_000`

**Types:**
- PascalCase for all interfaces, types, and classes (e.g., `FilterParams`, `BatchPaper`, `BillingLiveEnv`)
- `Error` suffix for custom error classes (e.g., `AIError`, `AIValidationError`, `AIMaxRetriesExceededError`)
- Type imports use `import type` syntax to avoid value-space pollution
- `State` suffix for Zustand state interfaces (e.g., `RatingsState`, `SearchHistoryState`)

## Code Style

**Formatting:**
- No `.prettierrc` or `.eslintrc` detected at project root — formatting enforced by TypeScript strictness and team norms
- Single quotes for imports in lib/convex files; double quotes appear in JSX and some test files (mixed)
- Trailing commas present throughout; semicolons present in lib/convex code, absent in some lib/ai/core files (mixed)
- Line length: no enforced limit, but lines are generally kept under 120 characters

**Linting:**
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- `knip` for unused code detection (`knip.json` present)
- No ESLint config detected at root — type safety via TypeScript compiler

## Import Organization

**Order (observed pattern):**
1. Framework imports (`vitest`, `react`, `next/*`)
2. Third-party libraries (`convex`, `stripe`, `ai`, `zod`)
3. Internal path-aliased imports (`@/lib/...`, `@/components/...`, `@/convex/...`)
4. Relative imports (`../lib/...`, `./types`)
5. Type-only imports (`import type { ... }`) often grouped at end

**Path Aliases:**
- `@/*` maps to project root (e.g., `@/lib/utils`, `@/components/ui/button`, `@/convex/extraction/grobid`)
- Configured in `tsconfig.json` paths and `vitest.config.ts` resolve alias

**Important mocking rule:** When using `vi.mock`, it must be called BEFORE importing the module under test:
```typescript
vi.mock("../lib/ai/core/execute", () => ({ executeAIOperation: vi.fn() }));
import { executeAIOperation } from "../lib/ai/core/execute";
```

## Error Handling

**Patterns:**
- Custom error class hierarchy rooted at `AIError extends Error` in `lib/ai/core/errors.ts`
- Each error class sets `this.name` explicitly for `instanceof` checks
- Convex mutations throw string codes (e.g., `throw new Error("INSUFFICIENT_CREDITS")`) for typed error matching in tests
- `handleAIError()` utility normalizes unknown errors into `AIProviderError`
- `try/catch/finally` used in React event handlers for async operations with loading state cleanup in `finally`
- Silent error swallowing is avoided; errors are either thrown, logged, or surfaced to user via toast

**Error class pattern:**
```typescript
export class AIValidationError extends AIError {
  constructor(details: string, cause?: Error) {
    super(`AI response failed validation: ${details}`, 'AI_VALIDATION_ERROR', cause)
    this.name = 'AIValidationError'
  }
}
```

## Logging

**Framework:** `console` (native browser/Node console)

**Patterns:**
- `console.error()` for caught errors in lib code (e.g., `search-actions.ts`, `search/provider.tsx`)
- `console.log()` with structured prefixes for debug traces: `[PDF Download]`, `[convex stderr]`
- `console.warn()` for recoverable issues (e.g., AI validation retry warnings)
- No structured logging library — console used directly

## Comments

**When to Comment:**
- JSDoc `/** ... */` for all exported public functions with non-obvious behavior
- Section dividers with `// === Section Name ===` pattern used in long files (e.g., `filter-builder.ts`)
- Inline comments explain "why" not "what" for complex business logic
- Test comments explain invariants and production-behavior analogues

**JSDoc pattern:**
```typescript
/**
 * Build structured filter data from search parameters
 * This is the single source of truth for filter display logic
 */
export function buildFilterData(params: FilterParams, t?: FilterT): FilterSection[]
```

**File-level module comments:**
```typescript
/**
 * Filter Builder
 * Core logic for building structured filter data from search parameters
 */
```

## Function Design

**Size:** Functions are generally small and single-purpose; large functions (e.g., `buildFilterData`) are organized with internal section comments

**Parameters:**
- Object destructuring for functions with 3+ parameters
- Optional parameters use `?` syntax, not overloads
- Configuration objects for complex function signatures (e.g., `ExecuteAIOperationConfig<TInput, TOutput>`)
- `args:` named parameter pattern for complex helpers: `waitForCondition({ description, timeoutMs, check })`

**Return Values:**
- Explicit return types on all exported functions
- Discriminated unions for success/failure results (e.g., `{ isValid: boolean; expandedQuery: string; warnings: string[] }`)
- `null` returned for "not found" cases; `undefined` for "not applicable"

## Module Design

**Exports:**
- Named exports preferred over default exports for lib modules
- Default exports used for React components (Next.js convention)
- `export * from './submodule'` barrel pattern used in `lib/ai/core/index.ts`

**Barrel Files:**
- `lib/ai/core/index.ts` re-exports entire core module via `export * from`
- `lib/types/index.ts` aggregates all type definitions
- Not universally applied — many lib submodules lack a barrel

## TypeScript Patterns

**Strict typing:**
- `as const` for literal arrays and objects that should not be widened
- `as unknown as TargetType` cast pattern for test mocks (e.g., `ctx as any`, `makeStripeEvent() as unknown as Stripe.Event`)
- `ReturnType<typeof fn>` used for typing test context objects
- Zod schemas at `lib/ai/core/schemas.ts` used for runtime validation alongside TypeScript types

**Convex-specific:**
- `internal.credits.internal.deductCredits` pattern for internal function references
- `ctx.db.insert(tableName, doc)` for database operations
- `v.` validators from `convex/values` for schema definitions

---

*Convention analysis: 2026-03-04*
