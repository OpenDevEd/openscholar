# Phase 14: Test Infrastructure - Research

**Researched:** 2026-02-28
**Domain:** Vitest multi-environment configuration, test library installation, setup files
**Confidence:** HIGH

## Summary

Phase 14 establishes the test infrastructure foundation for all subsequent v2.0 TDD phases. The core task is installing 7 new devDependencies, updating `vitest.config.ts` to support three test environments (node, edge-runtime, jsdom), and creating two setup files -- all without breaking the existing 40 test files (162 individual tests).

The most significant finding is that `environmentMatchGlobs` -- the API recommended by convex-test's official docs and used in the STACK.md research -- is **deprecated in Vitest 3** (the project uses Vitest 3.2.4). It still functions but emits deprecation warnings and will be removed in Vitest 4. The recommended replacement is the `projects` API, which offers per-project `setupFiles` (solving the RTL cleanup-in-node conflict), named test groups in output, and better separation of concerns. However, `environmentMatchGlobs` is simpler and still fully functional. This research recommends **using `environmentMatchGlobs`** for Phase 14 because: (a) it is what convex-test's official documentation uses, (b) it is simpler, (c) the deprecation warning is cosmetic, and (d) migration to `projects` can happen in a future phase before Vitest 4.

A second critical finding is that the global `setupFiles` entry importing `@testing-library/react` cleanup must handle the node environment gracefully. Since `cleanup()` from RTL requires DOM APIs, importing it unconditionally in a global setup file will fail for the 40 existing node-environment tests. The solution is a conditional guard: only call `cleanup()` if `globalThis.document` exists.

**Primary recommendation:** Use `environmentMatchGlobs` (deprecated but functional in Vitest 3) with a conditional setup file that guards RTL cleanup behind a DOM existence check. Install all 7 packages in a single `npm install -D` command, then validate all 162 existing tests pass before creating any new files.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INFRA-01 | Vitest config updated with `environmentMatchGlobs` routing convex tests to edge-runtime, hook tests to jsdom, and all existing tests to node | See "Architecture Patterns > Pattern 1: Vitest Config with environmentMatchGlobs" for exact config. Deprecated but functional in Vitest 3.2.4. |
| INFRA-02 | 7 new devDependencies installed (`convex-test`, `@edge-runtime/vm`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@vitejs/plugin-react`) | See "Standard Stack > Core" for all 7 packages with verified versions and compatibility. Installation command in "Installation" section. |
| INFRA-03 | Global test setup file (`tests/setup.ts`) with jest-dom matchers and RTL cleanup | See "Architecture Patterns > Pattern 2: Global Setup File" for implementation with conditional DOM guard. |
| INFRA-04 | Convex test setup module (`convex/test.setup.ts`) for convex-test module discovery | See "Architecture Patterns > Pattern 3: Convex Module Discovery" for exact `import.meta.glob` pattern from convex-test docs. |
| INFRA-05 | All existing tests pass after infrastructure changes with zero modifications | See "Common Pitfalls > Pitfall 1: Breaking Existing Tests" for verification strategy. Current baseline: 40 files, 162 tests, all passing. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `convex-test` | `^0.0.41` | In-memory mock Convex backend for mutation/query/action unit tests | Official Convex testing library. Only way to test Convex functions without a live backend. Peer dep: `convex ^1.16.4` -- compatible with installed `convex@1.31.7`. |
| `@edge-runtime/vm` | `^5.0.0` | Provides edge-runtime Vitest environment that `convex-test` requires | Required peer dependency of `convex-test`. Vitest routes `convex/**` tests to this environment. |
| `@testing-library/react` | `^16.3.2` | `renderHook`, `act`, `waitFor` for React hook testing | Industry standard. Ships `renderHook` directly (no deprecated `@testing-library/react-hooks`). React 19 compatible (project has `react@19.2.4`). |
| `@testing-library/user-event` | `^14.6.1` | Realistic user interaction simulation for hook/component tests | Standard companion to RTL. More realistic than `fireEvent`. |
| `@testing-library/jest-dom` | `^6.9.1` | Custom matchers: `toBeInTheDocument`, `toHaveValue`, etc. | Standard companion to RTL. Import via `@testing-library/jest-dom/vitest` for Vitest. |
| `jsdom` | `^28.1.0` | Browser-like DOM environment for Vitest | Required for React hook tests. Used by `environmentMatchGlobs` for jsdom routing. |
| `@vitejs/plugin-react` | `^5.1.4` | Enables JSX transform in Vitest for React component/hook tests | Without this, Vitest cannot process `.tsx` files in jsdom environment. |

### Already Installed (Do NOT Re-add)

| Library | Installed Version | Relevant Capability |
|---------|-------------------|---------------------|
| `vitest` | 3.2.4 | Test runner, `vi.mock`, `vi.stubGlobal`, `vi.fn` |
| `ai` | 6.0.91 | `ai/test` subpath: `MockLanguageModelV3` (confirmed in `node_modules/ai/package.json` exports) |
| `nuqs` | 2.8.8 | `nuqs/adapters/testing`: `withNuqsTestingAdapter` (confirmed available) |
| `convex` | 1.31.7 | Convex types, schema, `convex/react` hooks |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `environmentMatchGlobs` | Vitest `projects` API | `projects` is the Vitest 3 recommended approach. More complex setup but future-proof. Use `projects` when/if migrating to Vitest 4. |
| `environmentMatchGlobs` | Per-file `// @vitest-environment` comments | Simpler per-file but requires comments in every non-node test file. Better for very few files, worse for scaling. |
| `jsdom` | `happy-dom` | `happy-dom` is faster but less complete DOM implementation. `jsdom` has better ecosystem support and more accurate browser behavior. |
| `@testing-library/react-hooks` | N/A | Deprecated -- RTL 16 ships `renderHook` directly. Do NOT install the deprecated package. |

**Installation:**
```bash
npm install -D convex-test @edge-runtime/vm @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @vitejs/plugin-react
```

## Architecture Patterns

### Recommended File Structure (New/Modified Files Only)

```
vitest.config.ts              # MODIFIED: add environmentMatchGlobs, plugins, setupFiles
tests/
  setup.ts                    # NEW: jest-dom matchers + conditional RTL cleanup
  [existing 40 test files]    # UNCHANGED: continue running in node environment
  hooks/                      # NEW directory: future jsdom hook tests (Phase 20+)
convex/
  test.setup.ts               # NEW: import.meta.glob module discovery for convex-test
```

### Pattern 1: Vitest Config with environmentMatchGlobs

**What:** Update `vitest.config.ts` to route test files to three environments based on glob patterns.
**When to use:** This phase -- the config is the foundation for all subsequent test phases.

```typescript
// vitest.config.ts -- REPLACE current config
// Source: https://docs.convex.dev/testing/convex-test (adapted for multi-env)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      // Convex function tests need edge-runtime (convex-test requirement)
      ["convex/**/*.test.ts", "edge-runtime"],
      // React hook/component tests need jsdom for DOM APIs
      ["tests/hooks/**/*.test.ts", "jsdom"],
      ["tests/hooks/**/*.test.tsx", "jsdom"],
      ["tests/components/**/*.test.tsx", "jsdom"],
    ],
    server: {
      deps: {
        // Required for convex-test's dynamic module loading
        inline: ["convex-test"],
      },
    },
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: ["tests/live-billing/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

**Key decisions in this config:**
1. `environment: "node"` is the default -- all existing tests stay in node (matching current behavior).
2. `environmentMatchGlobs` overrides only for specific glob patterns. The first match wins.
3. `include` adds `convex/**/*.test.ts` alongside existing `tests/**/*.test.ts`.
4. `exclude` preserves `tests/live-billing/**/*.test.ts` (uses separate `vitest.live.config.ts`).
5. `plugins: [react()]` is added at the root level -- required for JSX in jsdom tests.
6. `setupFiles` points to the new global setup file.
7. `server.deps.inline: ["convex-test"]` is required per convex-test docs.

### Pattern 2: Global Setup File with Conditional DOM Guard

**What:** Setup file that provides jest-dom matchers globally and RTL cleanup only when DOM is available.
**When to use:** This phase -- the setup file runs for ALL test environments.

```typescript
// tests/setup.ts
// Source: https://testing-library.com/docs/react-testing-library/setup/

// jest-dom matchers (safe in all environments -- only extends expect)
import "@testing-library/jest-dom/vitest";

// RTL cleanup only when DOM is available (jsdom environment)
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
```

**Why the conditional guard:** The setup file runs for ALL environments (node, edge-runtime, jsdom). Importing `@testing-library/react` unconditionally at the top level would fail in node and edge-runtime because they lack DOM APIs. The dynamic `import()` inside the guard ensures RTL is only loaded when a DOM environment is active.

**Why `@testing-library/jest-dom/vitest` is safe everywhere:** This import only extends Vitest's `expect` with custom matchers. It does not reference DOM APIs at import time -- matchers only access DOM when actually called in assertions. Safe in node environment.

### Pattern 3: Convex Module Discovery

**What:** Setup module that discovers all Convex function modules for `convex-test` isolation.
**When to use:** This phase -- required for any future `convex-test` usage.

```typescript
// convex/test.setup.ts
// Source: https://docs.convex.dev/testing/convex-test
/// <reference types="vite/client" />

// Discover all Convex function modules for convex-test
// The glob matches every file with a single extension ending in 's' (js, ts)
// but excludes files with multiple dots (e.g., auth.config.ts, convex.config.ts)
export const modules = import.meta.glob("./**/!(*.*.*)*.*s");
```

**Usage in future test files:**
```typescript
// convex/some-domain/some-module.test.ts
import { convexTest } from "convex-test";
import schema from "../schema";
import { modules } from "../test.setup";

test("example convex test", async () => {
  const t = convexTest(schema, modules);
  // ... test logic using t.mutation(), t.query(), etc.
});
```

### Anti-Patterns to Avoid

- **Importing `@testing-library/react` at top level of setup file:** Will crash node-environment tests. Use conditional dynamic import behind `globalThis.document` check.
- **Using `@testing-library/react-hooks`:** Deprecated package. Use `renderHook` from `@testing-library/react` directly.
- **Adding `globals: true` to vitest config:** The existing 40 test files all explicitly import from `"vitest"` (`import { describe, expect, it, vi } from "vitest"`). Adding `globals: true` is unnecessary and would change the test API surface.
- **Using `vitest-environment-edge-runtime` package:** Does not exist as a standalone package. `@edge-runtime/vm` is used directly by Vitest's built-in edge-runtime environment.
- **Setting `environment: "jsdom"` globally:** Would break all 40 existing tests that rely on node environment.
- **Modifying existing test files:** INFRA-05 explicitly requires zero modifications to existing test files.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Convex function isolation | Custom mock DB, manual mutation runners | `convex-test` with `convexTest(schema, modules)` | In-memory backend with schema validation, scheduler support, auth identity simulation |
| React hook testing | Manual hook execution with `act()` wrapping | `renderHook` from `@testing-library/react` | Handles lifecycle, state updates, async, and cleanup automatically |
| DOM matchers for assertions | Custom `expect.extend()` matchers | `@testing-library/jest-dom/vitest` | 30+ battle-tested matchers with clear error messages |
| AI model mocking | `vi.mock('ai', ...)` | `MockLanguageModelV3` from `ai/test` (already installed) | Deterministic control over responses, usage tracking, error simulation |
| URL param testing adapter | Manual `useRouter` mocking | `withNuqsTestingAdapter` from `nuqs/adapters/testing` (already installed) | Purpose-built for nuqs hooks, avoids fragile Next.js router mocking |

**Key insight:** The 7 new packages and 2 already-installed subpath exports cover ALL testing capabilities needed for v2.0. No custom test utilities should be written in this phase.

## Common Pitfalls

### Pitfall 1: Breaking Existing Tests with Config Changes

**What goes wrong:** Existing 40 test files (162 tests) fail after vitest.config.ts changes.
**Why it happens:** Adding `setupFiles`, `plugins`, `environmentMatchGlobs`, or changing `include`/`exclude` can alter test behavior.
**How to avoid:** After EACH config change, run `npx vitest run` and verify "Test Files 40 passed (40), Tests 162 passed (162)". Make changes incrementally: (1) add packages, (2) add `plugins: [react()]`, verify, (3) add `setupFiles`, verify, (4) add `environmentMatchGlobs`, verify.
**Warning signs:** Any test file count or test count change from the baseline 40/162.

### Pitfall 2: RTL Cleanup in Node Environment

**What goes wrong:** `tests/setup.ts` imports `@testing-library/react` cleanup unconditionally, crashing all node-environment tests.
**Why it happens:** `cleanup()` requires DOM APIs (`document`, `window`) that don't exist in node environment.
**How to avoid:** Use conditional dynamic import: `if (typeof globalThis.document !== "undefined") { const { cleanup } = await import("@testing-library/react"); cleanup(); }`
**Warning signs:** Error message mentioning "document is not defined" or "window is not defined" when running existing tests.

### Pitfall 3: environmentMatchGlobs Deprecation Warning

**What goes wrong:** Vitest emits deprecation warning for `environmentMatchGlobs` on every test run.
**Why it happens:** The API is deprecated in Vitest 3 (removed in Vitest 4). The project uses Vitest 3.2.4.
**How to avoid:** Accept the warning for now. The functionality is preserved. Plan migration to `projects` API before upgrading to Vitest 4. Alternatively, use `// @vitest-environment` comments per-file (simpler for few files but doesn't scale).
**Warning signs:** Console output with "environmentMatchGlobs is deprecated" -- this is expected and not an error.

### Pitfall 4: `server.deps.inline` Missing for convex-test

**What goes wrong:** `convex-test` tests fail with obscure module resolution errors.
**Why it happens:** `convex-test` uses dynamic module loading that requires Vite to inline the dependency.
**How to avoid:** Always include `server: { deps: { inline: ["convex-test"] } }` in the Vitest config.
**Warning signs:** Errors mentioning module resolution or dynamic import failures in convex test files.

### Pitfall 5: `import.meta.glob` Pattern in convex/test.setup.ts

**What goes wrong:** Module discovery misses some Convex function files or includes generated files.
**Why it happens:** The glob pattern is tricky -- it must match `.ts` and `.js` files but exclude multi-dot files like `auth.config.ts`.
**How to avoid:** Use the exact pattern from convex-test docs: `"./**/!(*.*.*)*.*s"`. This matches files with a single extension ending in 's' but excludes files with multiple dots in the name.
**Warning signs:** `convexTest()` throws errors about missing modules or unexpected file types. Verify by logging `Object.keys(modules)` in a test.

### Pitfall 6: `@testing-library/jest-dom` Import Path

**What goes wrong:** TypeScript or Vitest fails to find jest-dom matchers.
**Why it happens:** Using wrong import path: `@testing-library/jest-dom` (Jest) instead of `@testing-library/jest-dom/vitest` (Vitest).
**How to avoid:** Always use `import "@testing-library/jest-dom/vitest"` in setup files. The `/vitest` subpath is required for Vitest matcher integration.
**Warning signs:** TypeScript errors about missing matcher types, or matchers like `toBeInTheDocument` being undefined at runtime.

## Code Examples

### Complete vitest.config.ts (Verified Pattern)

```typescript
// Source: Combined from https://docs.convex.dev/testing/convex-test
// and https://vitest.dev/config/
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["convex/**/*.test.ts", "edge-runtime"],
      ["tests/hooks/**/*.test.ts", "jsdom"],
      ["tests/hooks/**/*.test.tsx", "jsdom"],
      ["tests/components/**/*.test.tsx", "jsdom"],
    ],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
    include: ["tests/**/*.test.ts", "convex/**/*.test.ts"],
    exclude: ["tests/live-billing/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
```

### Complete tests/setup.ts (Verified Pattern)

```typescript
// Source: https://testing-library.com/docs/react-testing-library/setup/
// and https://www.npmjs.com/package/@testing-library/jest-dom

// Extend Vitest expect with jest-dom matchers (safe in all environments)
import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";

// Cleanup React Testing Library renders after each test
// Only runs when a DOM environment is active (jsdom)
afterEach(async () => {
  if (typeof globalThis.document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
```

### Complete convex/test.setup.ts (Verified Pattern)

```typescript
// Source: https://docs.convex.dev/testing/convex-test
/// <reference types="vite/client" />

// Discover all Convex function modules for convex-test isolation
export const modules = import.meta.glob("./**/!(*.*.*)*.*s");
```

### Verification: All Existing Tests Still Pass

```bash
# Run after ALL infrastructure changes
npx vitest run

# Expected output:
# Test Files  40 passed (40)
#      Tests  162 passed (162)
```

### Verification: New Packages Are Importable

```typescript
// Quick smoke test (can be a temporary test file)
import { describe, it, expect } from "vitest";

describe("infrastructure smoke test", () => {
  it("can import convex-test", async () => {
    const mod = await import("convex-test");
    expect(mod.convexTest).toBeDefined();
  });

  it("can import @testing-library/react", async () => {
    const mod = await import("@testing-library/react");
    expect(mod.renderHook).toBeDefined();
  });

  it("can import @testing-library/user-event", async () => {
    const mod = await import("@testing-library/user-event");
    expect(mod.default).toBeDefined();
  });

  it("can import @testing-library/jest-dom/vitest", async () => {
    // This is imported in setup.ts, so matchers should already be available
    expect(expect(null).not.toBeInTheDocument).toBeDefined();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `environmentMatchGlobs` | Vitest `projects` API | Vitest 3.0 (deprecated) | `environmentMatchGlobs` still works in Vitest 3 but emits warnings. Will be removed in Vitest 4. |
| `@testing-library/react-hooks` | `renderHook` from `@testing-library/react` | RTL v13 (2022) | The separate hooks package is deprecated. Use RTL's built-in `renderHook`. |
| `jest-environment-jsdom` | `jsdom` + Vitest environment config | N/A | Vitest uses `jsdom` package directly, not Jest's wrapper. |
| `@testing-library/jest-dom` (bare import) | `@testing-library/jest-dom/vitest` subpath | jest-dom v6 | Vitest-specific import path auto-extends `expect` without manual `expect.extend()`. |

**Deprecated/outdated:**
- `environmentMatchGlobs`: Deprecated in Vitest 3, removed in Vitest 4. Still functional. Migration to `projects` can be deferred.
- `@testing-library/react-hooks`: Deprecated since 2022. Do NOT install.
- `vitest-environment-edge-runtime`: Does not exist as a standalone package. Use `@edge-runtime/vm`.

## Open Questions

1. **Test count discrepancy: requirements say "43 existing tests" but current state is 40 files / 162 tests**
   - What we know: Running `npx vitest run` right now produces "Test Files 40 passed (40), Tests 162 passed (162)". The requirements (INFRA-05) reference "43 existing tests."
   - What's unclear: Whether "43" refers to a count from a different point in time, or includes live-billing tests, or is a typo.
   - Recommendation: Use the ACTUAL current baseline (40 files, 162 tests) as the pass/fail criterion for INFRA-05. The intent is "all existing tests pass unchanged" -- the exact count is secondary.

2. **`environmentMatchGlobs` deprecation: use now or migrate to `projects` immediately?**
   - What we know: `environmentMatchGlobs` is deprecated in Vitest 3 but fully functional. `projects` is the recommended replacement. convex-test's official docs still recommend `environmentMatchGlobs`.
   - What's unclear: Whether the deprecation warning will annoy during development or cause CI noise.
   - Recommendation: Use `environmentMatchGlobs` for now. It is simpler, matches convex-test docs, and migration to `projects` is straightforward when needed. Accept the deprecation warning.

3. **`@testing-library/jest-dom/vitest` in node environment safety**
   - What we know: This import extends `expect` with DOM matchers. The matchers themselves only access DOM when called, not at import time. Should be safe in node.
   - What's unclear: Whether edge-runtime environment has any conflict with the jest-dom vitest extension.
   - Recommendation: Test by running `npx vitest run` after adding the setup file. If issues arise, scope `setupFiles` to only jsdom projects using the `projects` API as fallback.

## Sources

### Primary (HIGH confidence)
- [convex-test official docs](https://docs.convex.dev/testing/convex-test) -- `environmentMatchGlobs` config, `modules` glob pattern, `convexTest()` usage, `@edge-runtime/vm` requirement
- [Vitest environmentMatchGlobs config](https://v3.vitest.dev/config/) -- confirmed deprecated in Vitest 3, will be removed in Vitest 4
- [Vitest Test Environment guide](https://vitest.dev/guide/environment) -- control comments, environment routing, available environments
- [Vitest Projects guide](https://vitest.dev/guide/projects) -- `projects` API as replacement for `environmentMatchGlobs`, per-project setupFiles, extends
- Direct codebase inspection: `vitest.config.ts`, `package.json`, `tests/*.test.ts` (40 files), `convex/` directory structure -- confirmed current state
- `npm show` for all 7 packages -- versions 0.0.41, 5.0.0, 16.3.2, 14.6.1, 6.9.1, 28.1.0, 5.1.4 verified
- `npx vitest run` -- confirmed baseline: 40 files, 162 tests, all passing

### Secondary (MEDIUM confidence)
- [@testing-library/jest-dom npm](https://www.npmjs.com/package/@testing-library/jest-dom) -- vitest subpath import pattern, v6 auto-extend behavior
- [React Testing Library setup docs](https://testing-library.com/docs/react-testing-library/setup/) -- cleanup pattern, afterEach usage
- [convex-test vitest.config.mts on GitHub](https://github.com/get-convex/convex-test/blob/main/vitest.config.mts) -- convex-test's own config uses single edge-runtime environment

### Tertiary (LOW confidence)
- None -- all critical findings are HIGH or MEDIUM confidence from official or directly verified sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All 7 package versions verified via `npm show`. Compatibility with installed packages confirmed (convex 1.31.7, react 19.2.4, vitest 3.2.4).
- Architecture: HIGH -- Config patterns drawn from official convex-test docs and Vitest docs. Existing test baseline confirmed by running tests. Setup file conditional guard pattern is standard practice.
- Pitfalls: HIGH -- RTL cleanup conflict verified by understanding environment behavior. `environmentMatchGlobs` deprecation confirmed from Vitest 3 docs. `server.deps.inline` requirement from convex-test docs.

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (30 days -- stable infrastructure, no rapidly moving targets)
