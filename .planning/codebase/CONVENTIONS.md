# Coding Conventions

**Analysis Date:** 2026-02-27

## Naming Patterns

**Files:**
- React components: PascalCase (e.g., `components/paper-card/`, `components/results-list.tsx`, `components/ui/button.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `hooks/use-batch-operation.ts`, `lib/hooks/use-cooldown.ts`)
- Lib utilities: `kebab-case.ts` (e.g., `lib/toast/error-resolver.ts`, `lib/keyword-validation.ts`)
- Convex functions: `camelCase.ts` in domain directories (e.g., `convex/credits/actions.ts`, `convex/webhooks/clerk.ts`)
- Test files: `kebab-case.test.ts` (e.g., `tests/clerk-webhook-handler.test.ts`)
- Some older lib files use `camelCase.ts` (e.g., `lib/store.ts`, `lib/utils.ts`) — prefer kebab-case for new files

**Functions:**
- Exported functions: camelCase (e.g., `resolveToastError`, `createDefaultFilters`, `getToastMessageKeyForErrorCode`)
- React components: PascalCase (e.g., `Button`, `ResultsPage`)
- Internal/private helpers: camelCase prefixed by purpose (e.g., `asRecord`, `trimToString`, `readErrorData`)
- Convex handlers: camelCase with intent (e.g., `processClerkWebhookEvent`, `createTopupCheckoutSession`)

**Variables:**
- camelCase throughout
- Numeric literals use underscores for readability: `1_000_000`, `300_000`, `3_000`
- Boolean constants use `is`/`has`/`should` prefix (e.g., `isPdfExtractionEnabled`, `hasPdfUrl`, `shouldPushConvexCode`)

**Types and Interfaces:**
- Interfaces use PascalCase (e.g., `BillingLiveEnv`, `BillingSnapshot`, `BillingIdentity`)
- Type aliases use PascalCase (e.g., `ErrorCode`, `ToastErrorMessageKey`, `CitationStatus`)
- Union string literals use lowercase (e.g., `"active" | "suspended" | "deleted"`)
- Error codes use `SCREAMING_SNAKE_CASE` (e.g., `"AI_INSUFFICIENT_CREDITS"`, `"BILLING_STRIPE_ERROR"`)

**Constants:**
- Module-level constants: `SCREAMING_SNAKE_CASE` (e.g., `LEGACY_CODE_MATCHERS`, `CONVEX_MESSAGE_SIGNATURES`, `DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS`)
- Exported config constants: `SCREAMING_SNAKE_CASE` (e.g., `FREE_SIGNUP_CREDIT_GRANT`, `BILLING_REQUIRED_WEBHOOK_EVENTS`)

## Code Style

**Formatting:**
- No project-level `.prettierrc` or `eslint.config` detected — formatting is not enforced by tooling
- Observed style: 2-space indentation, double quotes for strings in newer files, single quotes in older files (`lib/utils.ts`, `lib/store.ts`)
- Trailing commas present in multi-line expressions
- Arrow functions preferred for callbacks and short helpers

**Linting:**
- No project-level ESLint config detected at root
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- `knip` used for dead-code detection (`knip.json` present, `knip` in devDependencies)

## Import Organization

**Order (observed in source files):**
1. Node built-ins (e.g., `import fs from "node:fs"`, `import path from "node:path"`)
2. Third-party packages (e.g., `import Stripe from "stripe"`, `import { describe, expect, it } from "vitest"`)
3. Internal with `@/` alias (e.g., `import { cn } from "@/lib/utils"`, `import type { SearchFilters } from "@/lib/types"`)
4. Relative imports (e.g., `import { createError } from "../lib/errors"`, `import { stripeClient } from "../stripe"`)

**Path Aliases:**
- `@/*` maps to project root (configured in `tsconfig.json`)
- Used extensively in `components/`, `app/`, and `lib/` files
- Convex files use relative imports exclusively (no `@/` alias in `convex/`)

**Type Imports:**
- `import type` used consistently for type-only imports (e.g., `import type { SearchFilters } from "@/lib/types"`)

## Error Handling

**Convex errors:**
- Throw `ConvexError` with structured data: `throw createError("ERROR_CODE", "message")`
- All error codes are declared in a union type `ErrorCode` in `convex/lib/errors.ts`
- `createError(code, message?)` is the single factory for all Convex errors
- Client resolves errors via `resolveToastError()` in `lib/toast/error-resolver.ts`

**Pattern in Convex actions:**
```typescript
const user = await ctx.runQuery(internalApi.users.internal.getCurrentUser);
if (!user?._id) {
  throw createError("CREDITS_USER_NOT_FOUND", "Unable to resolve current user");
}
```

**Client-side error catching:**
```typescript
try {
  const result = await someConvexAction();
} catch (error) {
  const details = error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
  throw new Error(`Failed to run ...: ${details}`);
}
```

**Empty catch blocks:**
- Allowed only for expected non-fatal paths; always include a comment explaining the intent:
  ```typescript
  } catch {
    // Ignore missing env files in CI/workflows that rely on injected env vars.
  }
  ```

## Logging

**Framework:** `console` (no structured logger library)

**Patterns:**
- `console.log` for debug/info in older code (e.g., `app/actions/openalex.ts` still has `console.log("query", query)`)
- `console.error` for error paths
- Billing live tests use `appendBillingArtifactLog()` for persistent file-based logs in `tests/live-billing/support.ts`
- Convex server code does not directly call `console` — relies on Convex platform logging

## Comments

**When to Comment:**
- JSDoc `/** */` for exported utility functions in `lib/` (e.g., `createDefaultFilters`, `workToCoins`, `getEffectiveSearchId`)
- Inline `//` comments for non-obvious logic, especially filter logic and regex patterns
- Schema files (`convex/schema.ts`) use section dividers with `// ═══...` banners for table grouping
- Inline type comments for fields that need clarification: `// For idempotency`, `// First chars for display`

**Inline Documentation:**
```typescript
/**
 * Creates search parameters object for OpenAlex API calls
 * Used by both the OpenAlex action and search metadata creation
 */
export function createSearchParameters(query: string, filters: SearchFilters) {
```

## Function Design

**Size:** Functions are generally focused and single-purpose. Helper functions are extracted for reuse (e.g., `asRecord`, `trimToString`, `readErrorData` in `lib/toast/error-resolver.ts`).

**Parameters:**
- Use named object args for functions with 2+ parameters:
  ```typescript
  export async function runConvexFunction<T>(args: {
    functionPath: string;
    payload?: Record<string, unknown>;
    identity?: BillingIdentity;
  }): Promise<T>
  ```
- Simple positional args acceptable for 1-2 parameters

**Return Values:**
- Return typed objects over primitives where data is structured
- `undefined` for optional absent values, `null` for explicit null/not-found
- Convex actions return typed `v.object(...)` return schema

## Module Design

**Exports:**
- Named exports preferred over default exports for library modules
- React page components use default exports (required by Next.js)
- Convex handlers use named exports via Convex API wrappers (`action`, `internalAction`, `query`, `mutation`)

**Barrel Files:**
- Not observed — imports reference specific file paths directly

## Convex-Specific Patterns

**Directive headers:**
- Server Node.js actions: `"use node";` at top of file
- Next.js server actions: `"use server";` at top of file

**Internal API calls:**
- `const internalApi = internal as any;` used in some Convex files to work around generated type strictness

**Zod for AI schemas:**
- `zod` used for AI output validation via `generateObject` + `z.object(...)` schemas

---

*Convention analysis: 2026-02-27*
