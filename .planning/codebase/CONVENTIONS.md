# Coding Conventions

**Analysis Date:** 2026-03-02

## Naming Patterns

**Files:**
- TypeScript source files: `kebab-case.ts` / `kebab-case.tsx` (e.g., `filter-builder.ts`, `credit-billing.ts`)
- Test files: `{feature-name}.test.ts` in `tests/` or co-located in `convex/` subdirectories
- Config files: `{tool}.config.ts` (e.g., `vitest.config.ts`, `playwright.config.ts`)
- Barrel/index files: typically named by feature, not `index.ts`
- Next.js app directory: standard Next.js conventions (`page.tsx`, `layout.tsx`, `error.tsx`, `route.ts`)

**Functions:**
- camelCase for all functions: `buildFilterData`, `createUserWithDefaults`, `calculateCreditsToDeductFromUsage`
- Verb-noun pattern for actions: `buildFilterData`, `createError`, `getSearchResults`, `seedLibraryItem`
- Boolean checks prefixed with `is`/`has`: `isDateFilterActive`, `hasActiveFiltersFromResult`, `hasTokenUsage`
- Event handlers prefixed with `handle`: `handleSignIn`, `handleDelete`

**Variables:**
- camelCase throughout: `searchHistory`, `creditTransactions`, `billingTestMinChargeCents`
- Constants: SCREAMING_SNAKE_CASE in dedicated constant files: `FREE_SIGNUP_CREDIT_GRANT`, `AI_COST_MARKUP`, `DEFAULT_FILTERS`
- Boolean variables: prefixed with `is`/`has`/`should`: `isYearRangeEnabled`, `hasMore`, `shouldPushConvexCode`
- Numeric separators used for large numbers: `1_000_000`, `180_000`, `1_700_000_000`

**Types / Interfaces:**
- PascalCase: `FilterParams`, `BillingLiveEnv`, `BillingSnapshot`, `ErrorCode`
- Interfaces for object shapes with methods or complex structure: `interface SearchHistoryState`
- Type aliases for unions and simpler shapes: `type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | ...`
- Suffix `State` for Zustand store interfaces: `SearchHistoryState`, `UIState`, `AIConfigState`
- Suffix `Input` for function input objects: `EnhanceSearchQueryInput`, `GenerateScreeningQuestionsInput`
- Suffix `Params` for parameter bags: `FilterParams`, `SearchFilters`

## Code Style

**Formatting:**
- No Prettier config present at project root; formatting enforced by editor convention
- 2-space indentation throughout TypeScript/TSX files
- Trailing commas in multi-line arrays and objects
- Semicolons used consistently

**Linting:**
- No ESLint config at project root (only in `node_modules`)
- TypeScript strict mode enabled: `"strict": true` in `tsconfig.json`
- TypeScript target: `ES2017`
- No `any` use encouraged, though `any` appears in test seed helpers to avoid strict Convex ID typing

## Import Organization

**Order (observed pattern):**
1. External libraries: `import React from "react"`, `import { describe } from "vitest"`
2. Internal aliases with `@/`: `import { cn } from "@/lib/utils"`, `import type { FilterParams } from "@/lib/filters/filter-types"`
3. Relative imports: `import schema from "../schema"`

**Path Aliases:**
- `@/*` maps to project root (e.g., `@/lib/store`, `@/components/ui/button`, `@/lib/types`)
- Configured in `tsconfig.json` and `vitest.config.ts`

**Type Imports:**
- `import type { ... }` used when importing types only: `import type { AIProvider } from "../lib/types/ai.types"`

## Error Handling

**Convex backend pattern:**
- Structured `ConvexError` via `createError(code, message?)` from `convex/lib/errors.ts`
- Typed error codes defined in `ErrorCode` union (`convex/lib/errors.ts`)
- Categories: generic auth/data, AI, API key, billing, Zotero
- Example: `throw createError("NOT_FOUND")` or `throw createError("FORBIDDEN", "You cannot delete another user's item")`

**Next.js server actions:**
- `try/catch` with `throw new Error(...)` for unexpected failures
- Error messages include context: `throw new Error(\`OpenAlex SDK error: \${error.message}\`)`
- Pattern: `error instanceof Error ? error.message : 'Unknown error'`

**Client-side:**
- Errors surfaced via `sonner` toast library (imported via `useAppToast` or similar wrappers)
- Feature flags gated with early returns returning `null` rather than throwing

## Logging

**Framework:** `console.error` / `console.warn` (no structured logging library)

**Patterns:**
- `console.error('[functionName] Error description:', error)` for unexpected failures
- `console.warn('[functionName] Warning description:', context)` for non-fatal issues
- Convex actions use inline bracket prefixes: `console.warn("[fetchItems] ...")`
- Live billing test support uses custom artifact logging via `appendBillingArtifactLog()` in `tests/live-billing/support.ts`
- Do not log in pure utility/library functions; log at the call site (action/mutation level)

## Comments

**When to Comment:**
- JSDoc-style `/** ... */` for exported public functions describing purpose and parameters:
  ```typescript
  /**
   * Build structured filter data from search parameters
   * This is the single source of truth for filter display logic
   */
  export function buildFilterData(...)
  ```
- Section dividers with `// ============ Section Name ============` used inside large files
- Inline comments explaining non-obvious logic: `// The spread ...userData should not add firstName/lastName/avatarUrl keys`
- Test comments explain intent: `// Verify item is actually deleted`, `// Baseline job should NOT be deleted`

**JSDoc/TSDoc:**
- Used for exported utility functions
- `@param` tags not always present; preference for descriptive parameter names

## Function Design

**Size:**
- Pure utility functions kept small (10-40 lines)
- Builder functions (e.g., `buildFilterData`) can be longer (100-200 lines) with clear section comments
- Convex mutations/queries typically 20-60 lines

**Parameters:**
- Named parameter objects for 2+ related args: `calculateCreditsToDeductFromUsage({ usage, provider, modelId })`
- Single plain arguments for simple utilities: `getFieldLabel(field, t)`
- Optional config last: `buildFilterData(params, t?, formatDateTime?)`

**Return Values:**
- Functions return typed values (never untyped `any` in prod code)
- Early returns for guard clauses rather than nested conditionals
- Null returned for missing optional data (not `undefined`)

## Module Design

**Exports:**
- Named exports preferred throughout; default exports only for Next.js convention files (`page.tsx`, `layout.tsx`, etc.)
- `export function`, `export const`, `export type` used directly — not aggregated at bottom

**Barrel Files:**
- `lib/search-params/index.ts` exists as a barrel for search param utilities
- Most modules export directly without barrels — prefer direct imports: `../lib/ai/core/creditBilling`
- Avoid creating new barrel files unless the module has multiple exports that are always used together

## Next.js Specific

**Server/Client boundary:**
- `"use server"` at top of server action files (e.g., `app/actions/openalex.ts`)
- `"use client"` at top of interactive components (e.g., `app-sidebar.tsx`, store-using pages)
- `"use no memo"` added alongside `"use client"` when the React Compiler's memoization must be suppressed (e.g., components with try/finally in handlers)
- Server Components are the default for pages that don't need interactivity

**Zustand stores:**
- Defined in `lib/store.ts` (main stores) and `lib/store/` (feature stores)
- State interfaces are private (not exported) unless consumed externally
- Store names follow `use{Feature}Store` convention

---

*Convention analysis: 2026-03-02*
