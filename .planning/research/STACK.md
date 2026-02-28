# Stack Research: v2.0 TDD & Test Coverage

**Project:** OpenAlex Count — TDD & Test Coverage Backfill
**Domain:** Unit and integration testing for Next.js + Convex app
**Researched:** 2026-02-28
**Confidence:** HIGH (verified against installed packages, npm registry, official docs)
**Scope:** NEW packages/config only — excludes already-installed vitest ^3.2.4, @playwright/test ^1.58.2, etc.

---

## Executive Summary

The project needs five distinct new testing capabilities: (1) Convex mutation/query/action isolation, (2) React hooks with Convex, (3) AI/LLM mock injection, (4) URL param serialization, and (5) export function testing (xlsx/CSV). The existing stack covers none of these.

The critical insight: **existing tests run in `node` environment** (`vitest.config.ts` sets `environment: "node"`). Adding Convex backend tests requires `edge-runtime`, and React hook tests require `jsdom`. These conflict. The fix is `environmentMatchGlobs` to route test files to the right runtime — but this requires updating `vitest.config.ts`.

Fortunately, the AI SDK already exports `MockLanguageModelV3` from `ai/test` (confirmed in installed `ai@6.0.91`), nuqs already exports `withNuqsTestingAdapter` from `nuqs/adapters/testing` (confirmed in installed `nuqs@2.8.8`), and xlsx tests only require `vi.stubGlobal` for `URL.createObjectURL` — so most capabilities are **unlocked through config changes + thin new packages**, not wholesale package additions.

---

## Packages Already Installed — Use These, Don't Re-add

| Package | Installed Version | Relevant Capability |
|---------|-------------------|---------------------|
| `vitest` | ^3.2.4 | Test runner, `vi.mock`, `vi.stubGlobal`, `vi.fn` |
| `convex` | ^1.31.7 | Convex types, schema, `convex/react` hooks |
| `nuqs` | ^2.6.0 (2.8.8 actual) | `withNuqsTestingAdapter` built-in since v2 |
| `ai` | ^6.0.62 | `ai/test` subpath: `MockLanguageModelV3`, `MockEmbeddingModelV3` |
| `xlsx` | ^0.18.5 | Already the library under test; no test-specific package needed |
| `zod` | ^4.3.6 | Schema validation already tested inline |

---

## New Packages Required

### Core Test Infrastructure

| Package | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `convex-test` | `^0.0.41` | Mock Convex backend for mutation/query/action unit tests | Official Convex testing library. Only way to test Convex functions in JS without a live backend. Peer dep: `convex ^1.16.4` — compatible with installed `1.31.7`. |
| `@edge-runtime/vm` | `^5.0.0` | Provides the edge-runtime environment that `convex-test` requires | Required peer dep of `convex-test`. Vitest routes `convex/**` tests to this environment via `environmentMatchGlobs`. |

### React Hook Testing

| Package | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `@testing-library/react` | `^16.3.2` | `renderHook`, `act`, `waitFor` for React hooks | Industry standard, ships `renderHook` directly (no separate `@testing-library/react-hooks` needed since RTL v13+). React 19 compatible. |
| `@testing-library/user-event` | `^14.6.1` | Simulates realistic user interactions in hook/component tests | Needed for hooks that respond to user events (button clicks, input changes). More realistic than `fireEvent`. |
| `@testing-library/jest-dom` | `^6.9.1` | Custom matchers: `toBeInTheDocument`, `toHaveValue`, etc. | Standard companion to RTL. Import via `@testing-library/jest-dom/vitest` for Vitest compatibility. |
| `jsdom` | `^28.1.0` | Browser-like DOM environment for Vitest | Required for React hook tests. Set via `environmentMatchGlobs` for non-Convex tests. |

### React Plugin (Required for JSX in Vitest)

| Package | Version | Purpose | Why This One |
|---------|---------|---------|--------------|
| `@vitejs/plugin-react` | `^5.1.4` | Enables JSX transform in Vitest for React component/hook tests | Without this, Vitest cannot process `.tsx` files in jsdom environment. Required when using `@testing-library/react`. |

---

## No New Packages Needed For These Capabilities

### AI/LLM Mock Testing

`ai/test` is already available as a subpath export in the installed `ai@6.0.91`. Confirmed by checking `node_modules/ai/package.json` exports — the `./test` key maps to `dist/test/index.mjs`. **No new package needed.**

```typescript
// Use directly in existing Vitest test files
import { MockLanguageModelV3, mockValues } from 'ai/test';

const mockModel = new MockLanguageModelV3({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20 },
    text: JSON.stringify({ enhancedQuery: "machine learning AND cancer" }),
  }),
});
```

### URL Param Serialization Testing (nuqs)

`nuqs/adapters/testing` is already available in installed `nuqs@2.8.8`. The `withNuqsTestingAdapter` function was added in nuqs v2. **No new package needed.**

```typescript
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { render } from '@testing-library/react';

render(<MyComponent />, { wrapper: withNuqsTestingAdapter({ searchParams: '?q=cancer' }) });
```

For pure serialization logic (`serializeSearchParams`, `encodeRegions`, `decodeRegions`) that has no React dependency, **no additional packages needed at all** — test them as pure functions in the existing `node` environment.

### Export Function Testing (xlsx/CSV/JSON)

The `xlsx` library is already installed. The only challenge is `URL.createObjectURL` not existing in Node.js — stub it with `vi.stubGlobal`. **No new package needed.**

```typescript
// In test setup or per-test beforeEach
vi.stubGlobal('URL', {
  createObjectURL: vi.fn(() => 'blob:mock-url'),
  revokeObjectURL: vi.fn(),
});
```

For testing xlsx workbook structure without triggering file download, test the data transformation functions directly (what goes into `XLSX.utils.json_to_sheet`), not the `XLSX.writeFile` call.

---

## Installation

```bash
# Convex backend test isolation
npm install -D convex-test @edge-runtime/vm

# React hook testing
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @vitejs/plugin-react
```

**Total new devDependencies: 7 packages**

---

## Configuration Changes Required

### vitest.config.ts — Critical Update

The current config uses `environment: "node"` globally. This must change to support three environments:
- `convex/**` tests → `edge-runtime` (for `convex-test`)
- Hook/component tests → `jsdom` (for `@testing-library/react`)
- Everything else → `node` (existing behavior preserved)

```typescript
// vitest.config.ts — replace current config
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environmentMatchGlobs: [
      // Convex function tests need edge-runtime to match Convex's JS environment
      ["convex/**/*.test.ts", "edge-runtime"],
      // React hook/component tests need jsdom for DOM APIs
      ["tests/hooks/**/*.test.ts", "jsdom"],
      ["tests/components/**/*.test.ts", "jsdom"],
      // All other tests (existing 43 files) stay in node — no change to behavior
      ["**", "node"],
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading to work correctly
        inline: ["convex-test"],
      },
    },
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: ["tests/live-billing/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

### tests/setup.ts — New Global Setup File

```typescript
// tests/setup.ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup React renders after each test
afterEach(() => {
  cleanup();
});
```

### convex/test.setup.ts — New Convex Module Loader

```typescript
// convex/test.setup.ts
/// <reference types="vite/client" />

// Load all Convex function modules for convex-test
// The glob must match every file containing Convex functions
export const modules = import.meta.glob("./**/!(*.*.*)*.*s", { eager: true });
```

Then in each Convex test file:
```typescript
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "./test.setup";

test("grants credits on subscription creation", async () => {
  const t = convexTest(schema, modules);
  // ... test logic
});
```

---

## Testing Patterns by Capability

### Pattern A: Convex Mutations/Queries in Isolation

**Approach:** `convex-test` with `edge-runtime` environment. Tests live in `convex/**/*.test.ts`.

**What convex-test provides:**
- `t.mutation(api.credits.mutations.grantCredits, args)` — runs mutation against in-memory mock DB
- `t.query(api.credits.queries.getBalance, args)` — reads from mock DB
- `t.action(api.extraction.actions.runExtraction, args)` — runs action with mocked HTTP calls
- `t.withIdentity({ subject: "user_123" })` — simulate authenticated user
- `t.finishAllScheduledFunctions()` — flush scheduled jobs

**What convex-test cannot do:**
- Cron jobs (no support — skip or test the underlying function directly)
- Real HTTP calls from actions (mock them with `vi.mock`)
- Component queries (use `@convex-dev/workflow` patterns as documented)

**File location:** `convex/credits/__tests__/mutations.test.ts`, etc.

### Pattern B: React Hooks with Convex

**Approach:** Two-tier. Choose based on what you're testing.

**Tier 1 — Test business logic, mock Convex hooks (preferred for pure logic):**
```typescript
// vi.mock the convex/react module — intercepting the generic underlying hooks
vi.mock("convex/react", async () => {
  const actual = await vi.importActual<typeof import("convex/react")>("convex/react");
  return {
    ...actual,
    useQueryGeneric: vi.fn(() => undefined),
    useMutationGeneric: vi.fn(() => vi.fn()),
  };
});
```

**Tier 2 — Test hook behavior with live mock Convex client (for hooks that depend on Convex reactivity):**
Use `ConvexReactClientFake` from `convex/react` (if available) or wrap with a `ConvexProvider` using a fake client. This is heavier but tests the full hook contract.

**Key insight for this codebase:** `useSubscriptionState` and `useProtectedQuery` wrap `convex/react`'s `useQuery`. Test the wrapper logic with mocked `useQuery` returns — don't try to bring up a real Convex subscription. The value is in testing the settlement state machine (`auth_loading` → `query_loading` → `ready`), not the Convex transport layer.

**File location:** `tests/hooks/use-subscription-state.test.ts`, etc.

### Pattern C: AI Prompt Builders and Batch Processors

**Approach:** Pure function tests in `node` environment. No mock needed for prompt builder functions (`buildEnhanceQueryPrompts`, `buildEnhancedExtractionPrompt`). For functions that call `executeAIOperation`, inject `MockLanguageModelV3`.

```typescript
import { MockLanguageModelV3 } from 'ai/test';
import { processBatch } from '../../lib/ai/core/batch';

const model = new MockLanguageModelV3({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: 'stop',
    usage: { promptTokens: 5, completionTokens: 10 },
    text: '{"enhancedQuery":"machine learning AND cancer"}',
  }),
});
```

**File location:** `tests/ai-*.test.ts` (matches existing naming convention).

### Pattern D: URL Param Serialization (nuqs + search-params)

**Approach:** Split by purity.

**Pure serialization** (`encodeRegions`, `decodeRegions`, `serializeSearchParams`): pure functions, test in `node` environment with no setup. Already testable today.

**nuqs hook integration** (`useQueryStates` with parsers): requires jsdom + `withNuqsTestingAdapter`.

```typescript
import { withNuqsTestingAdapter } from 'nuqs/adapters/testing';
import { renderHook } from '@testing-library/react';
import { useQueryStates } from 'nuqs';
import { searchParamsParsers } from '../../lib/search-params/parsers';

const { result } = renderHook(
  () => useQueryStates(searchParamsParsers),
  { wrapper: withNuqsTestingAdapter({ searchParams: '?q=cancer&yf=2020&yt=2024' }) }
);
```

**File location:** `tests/search-params-*.test.ts` (node env), `tests/hooks/use-search-params.test.ts` (jsdom env).

### Pattern E: Export Functions (CSV/JSON/xlsx)

**Approach:** Test data transformation separately from file download.

**Step 1 — Test transformation functions directly** (what data goes into the sheet): pure functions, `node` environment, no DOM stubs needed.

**Step 2 — Test the xlsx workbook builder** with `vi.stubGlobal` for browser APIs:
```typescript
beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn(), style: {} })),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
});
```

Verify the xlsx workbook structure using `XLSX.utils.sheet_to_json(workbook.Sheets['Results'])` — this lets you assert on cell values without triggering file download.

**File location:** `tests/extraction-export.test.ts` (matches existing naming convention).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `convex-test` | Local Convex OSS backend | When testing actual cron jobs, real HTTP in actions, or when convex-test limitations block a test scenario. Slower setup but real backend semantics. |
| `@testing-library/react` + `renderHook` | `@testing-library/react-hooks` (deprecated) | Never — the separate package was deprecated when RTL added `renderHook` directly in v13. Don't add the old package. |
| `vi.mock("convex/react")` | `ConvexReactClientFake` | Use `ConvexReactClientFake` when testing hooks that depend on Convex's subscription reactivity model, not just return values. |
| `withNuqsTestingAdapter` | Mocking `useRouter` from Next.js | Use the adapter — it's built for this and avoids fragile Next.js router mocking. |
| `vi.stubGlobal` for xlsx | Running tests in browser environment | `vi.stubGlobal` is simpler and faster. Browser environment for unit tests adds significant complexity. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@testing-library/react-hooks` | Deprecated since React Testing Library v13 added `renderHook` directly | `@testing-library/react`'s built-in `renderHook` |
| `jest-environment-jsdom` | Jest package, not compatible with Vitest | `jsdom` package + `environmentMatchGlobs` in vitest config |
| `msw` (Mock Service Worker) | Heavyweight network mocking; overkill for unit tests. The AI SDK's `MockLanguageModelV3` handles LLM mocking at the model level. | `MockLanguageModelV3` from `ai/test` for AI calls, `vi.mock` for HTTP fetch |
| `nock` | Node.js HTTP interceptor; same concern as msw | `vi.mock` for fetch, or `MockLanguageModelV3` for AI SDK calls |
| `vitest-environment-edge-runtime` | Separate npm package that duplicates `@edge-runtime/vm` functionality. Does not appear to exist as a standalone package. | `@edge-runtime/vm` directly (used by `environmentMatchGlobs: "edge-runtime"`) |
| `convex/testing` (local Convex backend) | Requires running a local backend process, CI setup, much slower | `convex-test` for unit tests; existing live-billing tests for integration |
| `promptfoo` or `poyro` | LLM evaluation frameworks — appropriate for eval harnesses, not unit tests | `MockLanguageModelV3` from `ai/test` for deterministic unit testing |
| `vitest-evals` | LLM eval framework, non-deterministic by design | `MockLanguageModelV3` gives deterministic control |
| `happy-dom` | Alternative DOM implementation; less mature than jsdom | `jsdom` (more complete, better ecosystem support) |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `convex-test@^0.0.41` | `convex@^1.16.4` | Project has `convex@1.31.7` — compatible |
| `convex-test@^0.0.41` | `vitest` any version | Uses `environmentMatchGlobs: "edge-runtime"` which vitest 3.x supports natively |
| `@edge-runtime/vm@^5.0.0` | `vitest@^3.x` | Vitest 3's `edge-runtime` environment uses `@edge-runtime/vm` internally |
| `@testing-library/react@^16.3.2` | React 19 | RTL 16 explicitly supports React 19. Project has `react@19.2.4`. |
| `@testing-library/jest-dom@^6.9.1` | `vitest` | Import from `@testing-library/jest-dom/vitest` (not `/jest`) for Vitest matchers |
| `MockLanguageModelV3` (from `ai/test`) | `ai@6.0.91` (installed) | Confirmed: `ai/test` subpath export exists in installed package |
| `withNuqsTestingAdapter` (from `nuqs/adapters/testing`) | `nuqs@2.8.8` (installed) | Confirmed: nuqs v2+ ships the testing adapter built-in |
| `@vitejs/plugin-react@^5.1.4` | `vitest@^3.x`, React 19 | Required for JSX transform in jsdom environment |

---

## Stack Patterns by Variant

**If testing a Convex mutation or query in isolation:**
- File in `convex/**/*.test.ts`
- `environmentMatchGlobs` routes it to `edge-runtime`
- Use `convexTest(schema, modules)` from `convex-test`
- Mock external calls with `vi.mock`

**If testing a React hook that calls `useQuery` or `useMutation`:**
- File in `tests/hooks/*.test.ts`
- `environmentMatchGlobs` routes it to `jsdom`
- Use `renderHook` from `@testing-library/react`
- Mock `convex/react`'s `useQueryGeneric` / `useMutationGeneric` with `vi.mock`

**If testing a pure business logic function (prompt builder, credit calculator, region encoder):**
- File in `tests/*.test.ts`
- Stays in `node` environment (existing behavior)
- No additional setup — exactly like the existing 43 test files

**If testing an AI batch processor or executor:**
- File in `tests/*.test.ts` (node environment)
- Import `MockLanguageModelV3` from `ai/test`
- Control responses via `doGenerate` or `mockValues`

**If testing nuqs-integrated hooks:**
- File in `tests/hooks/*.test.ts` (jsdom environment)
- Wrap with `withNuqsTestingAdapter` from `nuqs/adapters/testing`
- Use `renderHook` to inspect hook state changes

**If testing xlsx/CSV export builders:**
- Prefer pure function tests in `node` environment
- For download-triggering code: use `vi.stubGlobal` for `URL` and `document` APIs

---

## Sources

- `npm show convex-test` + `npm show @edge-runtime/vm` — versions 0.0.41 / 5.0.0 verified
- `npm show @testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` — versions 16.3.2 / 14.6.1 / 6.9.1 verified
- `npm show jsdom` — version 28.1.0 verified
- `npm show @vitejs/plugin-react` — version 5.1.4 verified
- [convex-test official docs](https://docs.convex.dev/testing/convex-test) — `environmentMatchGlobs` config, `modules` glob pattern, `convexTest()` usage — HIGH confidence
- [Testing React Components with Convex](https://stack.convex.dev/testing-react-components-with-convex) — `vi.mock("convex/react")` pattern, `ConvexReactClientFake` — HIGH confidence
- [AI SDK Core Testing docs](https://ai-sdk.dev/docs/ai-sdk-core/testing) — `MockLanguageModelV3`, `MockEmbeddingModelV3`, import from `ai/test` — HIGH confidence
- [nuqs testing docs](https://nuqs.dev/docs/testing) — `withNuqsTestingAdapter` from `nuqs/adapters/testing` — HIGH confidence
- Direct inspection of `node_modules/ai/package.json` exports — confirmed `./test` subpath exists in `ai@6.0.91` — HIGH confidence
- Direct inspection of `node_modules/nuqs/package.json` — confirmed `nuqs@2.8.8` installed, adapter available — HIGH confidence
- [Vitest environmentMatchGlobs docs](https://vitest.dev/config/environment.html) — routing multiple environments in one config — HIGH confidence
- Direct codebase inspection: `vitest.config.ts`, `package.json`, `lib/ai/core/execute.ts`, `lib/ai/core/batch.ts`, `lib/extraction/export.ts`, `lib/search-params/parsers.ts`, `lib/auth/use-auth-query.ts`, 43 existing test files — HIGH confidence

---
*Stack research for: v2.0 TDD & Test Coverage*
*Researched: 2026-02-28*
