# Phase 105: Polish, Integration, E2E - Research

**Researched:** 2026-04-16
**Domain:** CI lint rule, Playwright E2E with auth+API mocking, responsive mobile polish, prefers-reduced-motion, i18n key parity
**Confidence:** HIGH

## Summary

Phase 105 closes five cross-cutting v7.0 gaps using only config + test artifacts, no runtime code changes. Each sub-deliverable has a standard, well-documented mechanism:

1. **ESLint rule (GAP-03)** — Bootstrap ESLint 9 flat config at repo root (nothing exists today), extend `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`, and add a `no-restricted-syntax` rule constrained by glob overrides targeting `components/extraction/**` + `app/extraction/**`. The Next.js 16 docs require `eslint.config.mjs` using `defineConfig` from `eslint/config` and spread-imports from `eslint-config-next/core-web-vitals` (note: `next lint` is removed in Next.js 16 — use `eslint` CLI directly).
2. **E2E spec** — One Playwright spec (`e2e/extraction-workbench.spec.ts`) reuses the existing Clerk test-user infrastructure from `e2e/global.setup.ts`, mocks Zotero via `page.route()`, seeds extraction results via a new dev-guarded Convex `internalAction`, and asserts reduced-motion behavior via `page.emulateMedia({ reducedMotion: 'reduce' })`.
3. **Mobile responsive polish** — shadcn `Sheet` already renders full-width mobile with `sm:max-w-sm` (verified in `components/ui/sheet.tsx:65`); `useIsMobile()` hook exists at `hooks/use-mobile.tsx` with the correct 768px breakpoint; no new hook needed. Targeted `min-h-[44px] min-w-[44px]` className edits on v7.0 interactive elements complete the audit.
4. **Reduced motion** — Wrap `app/layout.tsx` root with `<MotionConfig reducedMotion="user">` (globally forces Motion to skip transform/layout animations) + append a `@media (prefers-reduced-motion: reduce)` CSS rule to `app/globals.css` (covers Tailwind `transition-*` utilities and `tw-animate-css` keyframes).
5. **i18n parity** — One Vitest test flattens all 6 locale JSONs in `messages/` to key-sets and asserts equality; a second assertion samples 8-10 curated French keys for diacritic presence.

**Primary recommendation:** Execute in this order: (a) ESLint bootstrap + rule + structural test [independent, smallest], (b) mobile touch-target audit [independent, className-only edits], (c) reduced-motion wrapper + global CSS [independent, 2-line edits], (d) i18n parity test [independent, new test file], (e) E2E spec + Convex seed action [depends on all above being stable, largest unit]. Each group is ~1-2 plans.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ESLint rule enforcement (GAP-03) | Build-time / CI | — | Lint runs in `npm run test:ci`; static analysis owns constant-drift prevention |
| ESLint rule self-test | Node test runner (Vitest) | — | Programmatic `new ESLint({...}).lintText()` is pure-node, fits `tests/` default env |
| Clerk sign-in for E2E | Playwright (browser) | Clerk backend (test user provisioning) | Existing `e2e/global.setup.ts` owns provisioning; spec owns interactive sign-in |
| Zotero API mocking | Playwright `page.route()` | — | Browser-side intercept; no backend mocking layer needed |
| Extraction seed for E2E | Convex `internalAction` (Node runtime) | — | Writes to `extractionJobs` + `extractionPapers` + `extractionResults` via `ctx.runMutation`; dev-guarded |
| Mobile viewport adaptation | Client component (React) | CSS (Tailwind) | `useIsMobile()` subscribes to `matchMedia`; Tailwind `sm:`/`md:` breakpoints own layout |
| Reduced-motion global policy | Client component (`MotionConfig`) | Global CSS | MotionConfig forces Motion/Framer animations; CSS media query catches non-Motion animations |
| i18n key parity check | Node test runner (Vitest) | — | Pure filesystem read + set comparison, no DOM |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `eslint` | ^10.2.0 | Lint runner (ESLint 9 flat config API — `eslint/config` + `defineConfig`) | Next.js 16 docs reference flat config; ESLint 8 legacy `.eslintrc` is EOL [VERIFIED: npm view eslint version → 10.2.0, 2026-04-16] |
| `eslint-config-next` | ^16.2.4 | Next.js shared config with React + React Hooks + `@next/eslint-plugin-next` rules | Official Next.js 16 package, matches installed `next@^16.1.6` [VERIFIED: npm view eslint-config-next exports shows `./core-web-vitals` and `./typescript` subpath exports; published 2026-04-15] |
| `@playwright/test` | ^1.58.2 (already installed) | E2E framework | Already installed; `page.emulateMedia({ reducedMotion })` and `page.route()` are native [VERIFIED: package.json:84] |
| `@clerk/testing` | ^1.14.1 (already installed) | Clerk E2E helpers (`clerk.loaded`, `clerk.signIn`) | Already installed; matches existing `e2e/global.setup.ts` pattern [VERIFIED: package.json:82] |
| `motion` | ^12.23.12 (already installed) | Motion library with `MotionConfig` + `useReducedMotion()` | Already installed; `reducedMotion="user"` is documented API [VERIFIED: motion.dev/docs/react-motion-config, npm view motion version → 12.38.0 (we're on 12.23.x, still supports the API)] |
| `vitest` | ^3.2.4 (already installed) | Test runner for structural tests + lint-rule self-test | Already installed; default glob picks up new `tests/**/*.test.ts` files [VERIFIED: vitest.config.ts:24] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@typescript-eslint/parser` | ^8.58.2 | TypeScript AST parser for ESLint | Required if any rule uses TS-aware selectors; `eslint-config-next/typescript` pulls it in transitively [VERIFIED: npm view @typescript-eslint/parser version → 8.58.2] |
| `@next/eslint-plugin-next` | (transitive) | Next.js-specific rules | Pulled in by `eslint-config-next`; no direct install needed |
| `next-intl` | ^4.8.2 (already installed) | i18n — source of `messages/*.json` format | Already installed; parity test just reads JSON files directly |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `eslint-config-next/core-web-vitals` + `typescript` | Just `eslint-config-next` (base) | Loses Core Web Vitals errors-not-warnings + TS-specific rules; no benefit for our scope |
| `no-restricted-syntax` with `Literal[value=1000]` | Custom ESLint plugin with AST matcher | Over-engineering for a 2-selector rule; `no-restricted-syntax` is the documented Node.js-style native ESLint approach [CITED: eslint.org/docs/latest/rules/no-restricted-syntax] |
| MSW for Zotero mocking | Playwright `page.route()` | MSW adds a service worker layer — unnecessary overhead for one spec; `page.route()` is native Playwright [CITED: playwright.dev/docs/network#handle-requests] |
| Full Zotero OAuth in E2E | Stub via `page.route()` + pre-seeded connection | Real OAuth 1.0a requires Zotero test account + callback-URL whitelisting per phase 104; brittle in CI |
| Custom `useIsBelowBreakpoint("md")` hook | Existing `useIsMobile()` | Existing hook already uses 768px (`md` breakpoint) — see `hooks/use-mobile.tsx:5`. No new hook needed [VERIFIED: file inspection] |
| Per-component reduced-motion refactor | Global `<MotionConfig>` wrapper | Subtree wrappers miss sidebar badge/basket drawer; root-level is the documented pattern [CITED: motion.dev/docs/react-motion-config] |

**Installation:**
```bash
npm install --save-dev eslint eslint-config-next
```
(Do NOT install `@typescript-eslint/parser` explicitly — `eslint-config-next/typescript` handles it transitively per the 16.2.4 `exports` map.)

**Version verification (2026-04-16):**
- `eslint@10.2.0` — latest on npm
- `eslint-config-next@16.2.4` — published 2026-04-15; matches our `next@^16.1.6`
- `@typescript-eslint/parser@8.58.2` — latest; pulled transitively
- `motion@12.38.0` — we're pinned at `^12.23.12`; `MotionConfig` API stable across 12.x

## Architecture Patterns

### System Architecture Diagram

```
                                   Phase 105 Deliverables
                                            |
       +------------------+-----------------+-----------------+------------------+
       |                  |                 |                 |                  |
       v                  v                 v                 v                  v
  [ESLint Bootstrap]  [E2E Spec]      [Mobile Polish]   [Reduced Motion]  [i18n Parity]
       |                  |                 |                 |                  |
       v                  v                 v                 v                  v
  eslint.config.mjs   extraction-      44px className    <MotionConfig    v7-key-parity
  (new, repo root)    workbench.       edits on v7.0     reducedMotion=   .test.ts
       |              spec.ts (new)    components        "user">          (new)
       v                  |                 |                 |                  |
  no-restricted-         +---+------+       |          app/layout.tsx       Reads all 6
  syntax rule            |   |      |       |          wraps root          messages/*.json
  (1000, 200)          SignIn Mock  Seed    |                 |                  |
       |               Helper Zotero Convex |          + globals.css        Flattens to
       |                     |      action  |          @media reduce        key sets,
       v                     v              |                 |             asserts
  Vitest rule          page.route()    internal.      Assert via           set equality
  self-test          for api.zotero  extraction.    page.emulateMedia       + French
  (tests/...         + stub Convex   testing.      ({reducedMotion})      diacritic
   lint-rule.test)   startOAuth     seedCompleted                         sampling
       |                     |       Job(jobId,                                 |
       |                     v       paperCount)                                v
       |               page.wait                                          Fails build
       |               ForEvent                                           if any key
       |               ("download")                                       missing in
       |               for CSV/JSON                                       any of 6 locales
       |               /XLSX export
       |
       v
  npm run test:ci
  (lint + build + E2E default project + new workbench spec)
```

### Recommended Project Structure

```
repo root/
├── eslint.config.mjs              # NEW — flat config with no-restricted-syntax rule
├── package.json                   # MODIFIED — add eslint + eslint-config-next devDeps, lint + test:e2e:workbench scripts
├── app/
│   ├── layout.tsx                 # MODIFIED — wrap with <MotionConfig reducedMotion="user">
│   └── globals.css                # MODIFIED — append @media (prefers-reduced-motion) block
├── components/extraction/         # MODIFIED (targeted className edits for 44px touch targets)
│   ├── add-to-extraction-button.tsx
│   ├── extraction-counter.tsx
│   ├── extraction-basket-drawer.tsx
│   ├── workbench-toolbar.tsx
│   └── view-switcher.tsx          # MODIFIED — hide non-table on <md (isMobile guard)
├── app/extraction/new/            # MODIFIED (TabsList overflow + ZoteroItemRow hit area)
│   ├── selector-page-client.tsx
│   └── zotero-item-row.tsx
├── convex/extraction/
│   └── testing.ts                 # NEW — dev-guarded seedCompletedJob internalAction
├── e2e/
│   ├── extraction-workbench.spec.ts   # NEW — main E2E spec
│   ├── helpers/
│   │   └── sign-in.ts             # NEW — extracted Clerk signIn helper
│   └── fixtures/                  # NEW (optional) — Zotero API JSON fixtures
│       ├── zotero-collections.json
│       └── zotero-items.json
├── tests/
│   ├── eslint/                    # NEW directory OR use existing tests/extraction/
│   │   └── lint-rule.test.ts
│   └── i18n/                      # NEW directory
│       └── v7-key-parity.test.ts
└── hooks/
    └── use-mobile.tsx             # EXISTING — reuse as-is (768px breakpoint, already correct)
```

### Pattern 1: ESLint 9 Flat Config with Glob Overrides

**What:** Extend Next.js presets and add domain-specific rules via scoped config objects in the same array.
**When to use:** Any ESLint 9 project where a rule must apply only to specific paths.
**Example:**

```js
// eslint.config.mjs
// Source: https://nextjs.org/docs/app/api-reference/config/eslint (VERIFIED 2026-04-16)
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // GAP-03: forbid literal 1000 / 200 in extraction UI surface
  {
    files: [
      "components/extraction/**/*.{ts,tsx}",
      "app/extraction/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=1000]",
          message:
            "Literal '1000' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER.",
        },
        {
          selector: "Literal[value=200]",
          message:
            "Literal '200' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER.",
        },
      ],
    },
  },

  // Test-file exception (D-03)
  {
    files: [
      "components/extraction/**/*.test.{ts,tsx}",
      "app/extraction/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },

  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
```

**Key points:**
- `defineConfig` from `eslint/config` is the documented ESLint 9 helper (provides type inference + validation) [CITED: Next.js 16.2.4 docs]
- `...nextVitals` and `...nextTs` spread-import multiple config objects (files, plugins, parser, rules). Order matters — later entries override earlier ones.
- Rule scoping happens via the `files` array on each config object (flat-config idiom; no `overrides:` key).
- The test-file exception is a SECOND config object with a MORE SPECIFIC glob — it runs after the first (because it appears later) and disables the rule. Do NOT try to nest overrides.
- `globalIgnores()` replaces `ignorePatterns` from legacy config.

### Pattern 2: Programmatic ESLint Test (Vitest)

**What:** Use the `ESLint` class to lint a source string and assert on the returned messages.
**When to use:** Protecting a critical lint rule against silent removal (exactly D-05).
**Example:**

```typescript
// tests/eslint/lint-rule.test.ts (or tests/extraction/lint-rule.test.ts)
// Source: https://eslint.org/docs/latest/integrate/nodejs-api (VERIFIED 2026-04-16)
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";

describe("extraction lint rule: no literal 1000/200", () => {
  it("flags literal 1000 in components/extraction/**/*.tsx", async () => {
    const eslint = new ESLint({
      cwd: path.resolve(__dirname, "../.."),
      // Uses repo-root eslint.config.mjs
    });

    const source = `
      export function Cap() {
        const limit = 1000;
        return <div>{limit}</div>;
      }
    `;

    const [result] = await eslint.lintText(source, {
      filePath: "components/extraction/fake-cap.tsx",
    });

    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
    expect(restricted[0].message).toContain("MAX_EXTRACTION_PAPERS_PER_JOB");
  });

  it("does NOT flag literal 1000 in test files", async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
    const source = `
      import { expect, it } from "vitest";
      it("caps at 1000", () => { expect(getCap()).toBe(1000); });
    `;
    const [result] = await eslint.lintText(source, {
      filePath: "components/extraction/fake-cap.test.tsx",
    });
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBe(0);
  });
});
```

**Key points:**
- `new ESLint({ cwd })` auto-discovers `eslint.config.mjs` at cwd — matches real CI behavior.
- `lintText(source, { filePath })` is critical: the `filePath` option is how ESLint decides which `files` glob applies. Pass a fake path under `components/extraction/` to trigger the rule.
- Run under the default Vitest `node` environment (no jsdom/edge-runtime) — `ESLint` is a pure-node class.

### Pattern 3: Playwright E2E with Clerk + page.route + emulateMedia

**What:** Combine Clerk sign-in, Zotero network mocking, seeded Convex data, and reduced-motion assertion in one spec.
**When to use:** End-to-end workflow verification that crosses auth + external API + Convex + UI.
**Example:**

```typescript
// e2e/extraction-workbench.spec.ts
// Source: playwright.dev/docs/downloads + playwright.dev/docs/network (VERIFIED 2026-04-16)
import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "@/convex/_generated/api";
import zoteroCollections from "./fixtures/zotero-collections.json";
import zoteroItems from "./fixtures/zotero-items.json";

async function signIn(page: Page) {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL!;
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress });
}

async function mockZotero(page: Page) {
  await page.route("**/api.zotero.org/**/collections*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zoteroCollections),
    }),
  );
  await page.route("**/api.zotero.org/**/items*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(zoteroItems),
    }),
  );
}

test.describe("v7.0 extraction workbench end-to-end", () => {
  let seededJobId: string;

  test.beforeAll(async () => {
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    seededJobId = await convex.action(
      // @ts-expect-error internal action call via action ref
      internal.extraction.testing.seedCompletedJob,
      { paperCount: 10, questionCount: 3 },
    );
  });

  test("stage papers across 4 tabs, create job, navigate views, export", async ({ page }) => {
    await signIn(page);
    await mockZotero(page);

    // Step 1: stage papers from 4 tabs
    await page.goto("/extraction/new");
    await page.getByRole("tab", { name: /library/i }).click();
    await page.getByRole("checkbox").first().check();
    // ... repeat for collections, search, zotero
    await expect(page.getByText(/\d+ \/ 1000/)).toBeVisible();

    // Step 2: reduced-motion assertion (D-22)
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/extraction/${seededJobId}`);
    const startSwitch = Date.now();
    await page.getByRole("button", { name: /split view/i }).click();
    await page.getByTestId("split-view").waitFor();
    const elapsed = Date.now() - startSwitch;
    expect(elapsed).toBeLessThan(100);

    // Step 3: exports — CSV, JSON, XLSX
    for (const format of ["csv", "json", "xlsx"]) {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: new RegExp(`export ${format}`, "i") }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`\\.${format}$`, "i"),
      );
      const path = await download.path();
      // ≥ 0 byte assertion
      const { statSync } = await import("node:fs");
      expect(statSync(path!).size).toBeGreaterThan(0);
    }
  });
});
```

**Key points:**
- `page.route()` intercepts BEFORE navigation; set it up in `beforeEach` or at the top of the test [CITED: playwright.dev/docs/network].
- `page.emulateMedia({ reducedMotion: "reduce" })` is the documented Playwright API — no additional library needed [CITED: playwright.dev/docs/api/class-page#page-emulate-media].
- `page.waitForEvent("download")` returns a `Download` object with `suggestedFilename()` and `path()` for assertion [CITED: playwright.dev/docs/downloads].
- Seeding via `ConvexHttpClient` + `internal.*` ref: requires `CONVEX_DEPLOY_KEY` or equivalent to invoke internal actions from the test runner. If not available, call through an HTTP action wrapper — but D-09 specifies seed via `runAction` pattern.

### Pattern 4: Dev-Guarded Convex internalAction

**What:** An internalAction that refuses to execute outside dev/test environments.
**When to use:** Any seed/reset/destructive action that must never touch production.
**Example:**

```typescript
// convex/extraction/testing.ts
// Source: convex/_generated/ai/guidelines.md + convex/lib/env.ts existing pattern (VERIFIED)
"use node";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";

function assertDevEnvironment() {
  const isLocalhost = process.env.CONVEX_CLOUD_URL?.includes("localhost");
  const isDev = process.env.NODE_ENV === "development";
  const explicitlyAllowed = process.env.ALLOW_TEST_SEEDING === "true";
  if (!isLocalhost && !isDev && !explicitlyAllowed) {
    throw new Error(
      "seedCompletedJob is dev/test only. Set ALLOW_TEST_SEEDING=true in Convex env to bypass.",
    );
  }
}

export const seedCompletedJob = internalAction({
  args: {
    paperCount: v.number(),
    questionCount: v.number(),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, { paperCount, questionCount }) => {
    assertDevEnvironment();
    // Mirror createExtractionJob mutation shape; insert completed job + N papers + N*Q results.
    // Uses ctx.runMutation to insert into extractionJobs / extractionPapers / extractionResults.
    // Return the new jobId so the E2E test can navigate to /extraction/[jobId].
    // ... implementation delegates to internal mutations
    const jobId = await ctx.runMutation(
      internal.extraction.testing_mutations.insertSeededJob,
      { paperCount, questionCount },
    );
    return jobId;
  },
});
```

**Key points:**
- `internalAction` (not `action`) — never part of public API; only callable via dashboard or other Convex functions [CITED: convex/_generated/ai/guidelines.md §"Function registration"]
- `"use node"` required because the seed may do bulk insertion + possibly use Node APIs; keep the runtime consistent with `convex/extraction/workpoolActions.ts` [VERIFIED: workpoolActions.ts:1]
- Environment guard mirrors `requireAppUrl()` at `convex/lib/env.ts:6-21` — checks `CONVEX_CLOUD_URL.includes("localhost")` OR `NODE_ENV === "development"`. Consider adding an `ALLOW_TEST_SEEDING` escape hatch for CI preview deployments.
- Insertion must use `ctx.runMutation(internal.extraction.testing_mutations.*)` — actions cannot call `ctx.db` directly [CITED: convex guidelines §"Function calling"]. Pattern mirrors `purgeStaleZoteroState` at `convex/zotero/actions.ts:1135-1164`.

### Pattern 5: MotionConfig Root-Level Wrap

**What:** One `<MotionConfig reducedMotion="user">` at `app/layout.tsx` overrides all motion children.
**When to use:** Any app with multiple Motion components that should respect `prefers-reduced-motion`.
**Example:**

```tsx
// app/layout.tsx (modification — wrap the existing tree inside NextIntlClientProvider)
// Source: motion.dev/docs/react-motion-config (VERIFIED 2026-04-16)
import { MotionConfig } from "motion/react";

export default async function RootLayout({ children }) {
  // ... existing getLocale / getMessages / preloadQuery ...
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <MotionConfig reducedMotion="user">
            {/* existing ThemeProvider / ConvexClientProvider / ... tree */}
          </MotionConfig>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**Key points:**
- `reducedMotion="user"` means "respect the user's OS-level setting" [CITED: motion.dev/docs/react-motion-config]. Alternatives: `"always"` (force on, useful for testing), `"never"` (ignore OS setting).
- When reduced motion is active, Motion disables transform + layout animations; opacity and backgroundColor still animate (intentional — keeps feedback while removing motion sickness triggers).
- Existing `useReducedMotion()` calls in `workbench-shell.tsx`, `paper-result-card.tsx`, `question-builder.tsx` still return `true` under the global config — per-component fine-grained branches still work [VERIFIED: motion.dev docs reference the hook as composable with MotionConfig].
- Place INSIDE `NextIntlClientProvider` so that any use of Motion within `useTranslations` components continues to work. Place OUTSIDE `ThemeProvider` is also fine — order does not matter for this purpose.

### Pattern 6: Global CSS Reduced-Motion Fallback

**What:** A CSS media query that disables non-Motion animations (Tailwind `transition-*`, `tw-animate-css`, any `@keyframes`).
**When to use:** When Motion doesn't cover all animations in the app (confirmed — Tailwind `transition-all` appears widely, and `tw-animate-css` drives shadcn Sheet slide-in at `components/ui/sheet.tsx:63`).

```css
/* app/globals.css — append at end */
/* Source: web.dev/prefers-reduced-motion (standard pattern) */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Key points:**
- `0.01ms` not `0` — some browsers treat zero as "instant cancel" and fire `animationend` oddly; 0.01ms is the industry-standard safe value.
- `!important` is necessary to override Tailwind's generated `transition-duration` custom property.
- `animation-iteration-count: 1` prevents infinite animations (loading spinners) from becoming infinite-instant loops.

### Pattern 7: Vitest i18n Key Parity Test

**What:** Flatten each locale JSON to a set of dot-paths, compare all sets for equality.
**When to use:** Multi-locale app where keys can drift silently.

```typescript
// tests/i18n/v7-key-parity.test.ts
// Source: flattening JSON is stock Node.js; set equality is stock Vitest
import { describe, it, expect } from "vitest";
import enUS from "@/messages/en-US.json";
import enGB from "@/messages/en-GB.json";
import fr from "@/messages/fr.json";
import hi from "@/messages/hi.json";
import ja from "@/messages/ja.json";
import zh from "@/messages/zh.json";

function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...flatten(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

const LOCALES = { "en-US": enUS, "en-GB": enGB, fr, hi, ja, zh };

describe("i18n v7.0 key parity", () => {
  it("every locale has the same set of keys", () => {
    const reference = flatten(LOCALES["en-US"]);
    for (const [locale, data] of Object.entries(LOCALES)) {
      if (locale === "en-US") continue;
      const keys = flatten(data);
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect(missing, `${locale} missing keys vs en-US`).toEqual([]);
      expect(extra, `${locale} has extra keys vs en-US`).toEqual([]);
    }
  });

  it("french keys contain expected diacritics", () => {
    const diacriticRegex = /[éèêëàâäôöûüùïîçÉÈÊËÀÂÄÔÖÛÜÙÏÎÇ]/;
    // Curated at implementation time — 8-10 v7.0 French keys with expected diacritics
    const samples = [
      "extraction.counter.label",        // should include "résolution"-style diacritics
      "extraction.basket.startButton",    // "démarrer"
      "extraction.zoteroTab.inBasket",    // "déjà"
      // ... expand during implementation
    ];
    for (const path of samples) {
      const value = path.split(".").reduce<unknown>(
        (acc, k) => (acc as Record<string, unknown>)?.[k],
        fr,
      );
      expect(
        typeof value === "string" && diacriticRegex.test(value),
        `fr key ${path} = ${JSON.stringify(value)} missing diacritic`,
      ).toBe(true);
    }
  });
});
```

**Key points:**
- Use `import ... from "@/messages/en-US.json"` — TypeScript resolves the JSON at compile time, no runtime file-reads.
- Flatten recursively; skip arrays (none expected in `messages/*.json`).
- For the missing/extra assertion, listing actual differences in the error message (not just `.toEqual`) is the pattern that makes failures actionable — users can see which keys drifted.

### Anti-Patterns to Avoid

- **Using `.eslintrc.json` legacy format:** ESLint 9 + Next.js 16 require flat config (`eslint.config.mjs`). Legacy config is unsupported.
- **Trying to run `next lint` in Next.js 16:** Removed in v16.0 [CITED: Next.js docs]. Use `eslint .` or `npx eslint .` directly.
- **Nested glob overrides inside a single config object:** Flat config doesn't support `overrides:`. Use multiple config objects with progressively more specific `files` globs.
- **Wrapping only `/extraction` subtree with MotionConfig:** Misses sidebar badge, basket drawer, and other v7.0 motion outside extraction routes. Place at root layout.
- **Real LLM calls in E2E:** The extraction cascade takes 1-2 minutes per paper. Use the seed action; unit tests cover cascade correctness.
- **Relying on `next lint`'s auto-discovery:** We're calling `eslint .` directly in `test:ci`.
- **Writing a custom `useIsBelowBreakpoint` hook:** Existing `useIsMobile()` at `hooks/use-mobile.tsx` uses the same 768px (`md`) breakpoint — reuse.
- **Introducing a dedicated mobile "bottom sheet" variant:** Deferred to MOB-F01 per user's Deferred Ideas.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ESLint flat config boilerplate | Custom FlatCompat bridge / manual plugin wiring | `defineConfig` from `eslint/config` + spread `eslint-config-next/core-web-vitals` | Next.js 16 ships the preset; `defineConfig` provides types + validation [CITED: Next.js docs] |
| Rule test harness | Spawn `eslint` CLI as subprocess | `new ESLint({...}).lintText()` | Programmatic API is faster, more reliable, and returns structured messages [CITED: eslint.org/docs/latest/integrate/nodejs-api] |
| Zotero API mocking | MSW / Pretender / custom fetch interceptor | Playwright `page.route()` | Native to Playwright; no extra deps; matches existing `e2e/billing/fixtures.ts` pattern |
| Clerk E2E sign-in | Manual form-fill via `page.fill()` | `@clerk/testing/playwright`'s `clerk.signIn()` | Official Clerk helper; handles verification state + token refresh. Already installed + used in `e2e/auth.spec.ts:18` [VERIFIED] |
| Reduced-motion per-component wiring | `useReducedMotion()` in every motion component | `<MotionConfig reducedMotion="user">` at root | Global policy; child hooks still work for fine-grained control |
| CSS animation disable | Per-component `@media` rules | Global `@media (prefers-reduced-motion: reduce)` in `globals.css` | One rule catches all `transition-*`, `tw-animate-css`, `@keyframes` |
| Flat-JSON library | `lodash.flatten` / custom deep-merge utility | Plain recursive function (≤20 lines) | Zero dep; JSON shape is predictable; see Pattern 7 |
| Set equality for key parity | Custom `compareKeys` utility | `expected.filter(k => !actual.includes(k))` + Vitest `toEqual([])` | Gives concrete diff in failure messages |
| ESLint ignore glob | `.eslintignore` file | `globalIgnores([...])` in flat config | ESLint 9 deprecates `.eslintignore`; flat config centralizes ignores |

**Key insight:** Every deliverable in Phase 105 has a first-party standard. No custom testing harness, no bespoke mocking layer, no new utility libraries. The work is wiring documented APIs together in the right shapes.

## Common Pitfalls

### Pitfall 1: ESLint config discovery in monorepo / wrong cwd

**What goes wrong:** `new ESLint({...}).lintText(source, { filePath })` reports "No matching configuration found" or applies the wrong ruleset.
**Why it happens:** ESLint walks up from `cwd` looking for `eslint.config.mjs`. If Vitest's cwd differs from repo root, discovery fails.
**How to avoid:** Always pass `cwd: path.resolve(__dirname, "../..")` explicitly in the test. Match the path traversal to your `tests/` depth.
**Warning signs:** Test passes when run from repo root but fails in CI; `result.messages` is empty when you expected errors.

### Pitfall 2: Rule self-test's `filePath` must match the rule's `files` glob

**What goes wrong:** Test file sets `filePath: "somewhere/random.tsx"` and the rule doesn't fire — false negative.
**Why it happens:** ESLint only applies config objects whose `files` glob matches the linted path.
**How to avoid:** Pass `filePath: "components/extraction/fake.tsx"` — inside the real glob.
**Warning signs:** `restricted.length === 0` unexpectedly; `lintText` returns empty messages array despite violating source.

### Pitfall 3: Convex internalAction seed action not callable from test runner

**What goes wrong:** E2E test calls `convex.action(internal.extraction.testing.seedCompletedJob, ...)` and gets a 403 / "function not found".
**Why it happens:** `internal.*` functions are not exposed over the HTTP client API by default; only `api.*` (public) is. `ConvexHttpClient` can invoke internal functions only with a deploy key or by going through a public wrapper.
**How to avoid:** Two options — (a) wrap in a thin public `action` that delegates to `internal.extraction.testing.seedCompletedJob` and is itself dev-guarded, OR (b) pass `process.env.CONVEX_DEPLOY_KEY` to `new ConvexHttpClient(...)` so internal refs work. Option (a) is simpler for E2E but duplicates the guard.
**Warning signs:** "UNAUTHORIZED: Could not find public function" or a JSON error about internal-only functions.

### Pitfall 4: MotionConfig placement vs. server/client boundary

**What goes wrong:** Wrapping server-rendered `app/layout.tsx` with `<MotionConfig>` yields a "MotionConfig must be used within a client component" error or nothing happens on SSR.
**Why it happens:** `motion/react` components require the React client runtime. `MotionConfig` itself is a client component.
**How to avoid:** Create a small client component `<GlobalMotionConfig>` that re-exports `<MotionConfig reducedMotion="user">{children}</MotionConfig>` with `"use client"` at the top, then use it in `layout.tsx`. Server components can render client components as children; the `"use client"` directive makes the boundary explicit.
**Warning signs:** Hydration errors; "Cannot read properties of undefined (reducedMotion)"; server log "Functions cannot be passed to client components".

### Pitfall 5: Playwright reduced-motion emulation vs MotionConfig

**What goes wrong:** Test asserts reduced-motion transition completes <100ms, but animation still plays fully.
**Why it happens:** `page.emulateMedia({ reducedMotion: "reduce" })` sets the browser's preference — the app must RESPOND to it. With `MotionConfig reducedMotion="user"`, Motion calls `matchMedia` to check the user preference. If emulation is set AFTER navigation, Motion may have already cached the setting.
**How to avoid:** Set `emulateMedia` BEFORE `page.goto()` (or before the first user interaction that triggers animation). Playwright best practice: set at context or top of test.
**Warning signs:** Animation duration matches production value (e.g., 300ms) not the reduced-motion target (<100ms).

### Pitfall 6: Zotero mock URL pattern too broad or too narrow

**What goes wrong:** `page.route("**/zotero/**")` accidentally mocks Convex's own `/zotero` endpoints, breaking Convex queries. Or `page.route("https://api.zotero.org/users/*/collections")` misses sub-paths.
**Why it happens:** Glob semantics differ between Playwright and curl / fetch.
**How to avoid:** Target the Zotero API host explicitly: `page.route("**/api.zotero.org/**", ...)`. Double-check Convex action URLs don't overlap (Convex uses `*.convex.cloud` — different host, safe).
**Warning signs:** Tests fail with "no response for POST https://your-deployment.convex.cloud/..."

### Pitfall 7: `tw-animate-css` bypasses MotionConfig

**What goes wrong:** Sheet drawer still slides in/out with full animation under reduced-motion, because the slide is a CSS `@keyframes` animation from `tw-animate-css`, not Motion.
**Why it happens:** `shadcn/ui` Sheet uses `data-[state=open]:animate-in data-[state=closed]:animate-out` classes from `tw-animate-css`. These are pure CSS animations — MotionConfig has no effect.
**How to avoid:** The global `@media (prefers-reduced-motion: reduce)` rule in D-19 catches these. Verify via Playwright test that Sheet open/close completes <100ms under emulated reduced motion.
**Warning signs:** Sheet slide animation plays full ~300-500ms duration even with `prefers-reduced-motion: reduce`; `transition-duration` in devtools still shows non-0.01ms values.

### Pitfall 8: i18n nested-object parity failure false positives

**What goes wrong:** Parity test flags `foo.bar.baz` as "extra" in French, but the English file just uses the key at a different nesting.
**Why it happens:** Flattening a structure like `{ foo: { bar: { baz: "..." } } }` vs `{ foo: { bar: { baz: null, qux: "..." } } }` produces different key paths depending on null handling.
**How to avoid:** Decide: are `null` values counted as keys? The Pattern 7 code counts them (treats null as leaf). Be consistent across locales. If the en-US has `null` placeholders for TBD strings, ensure all locales use the same nullability.
**Warning signs:** Test passes for one locale round but fails when a translator fills in a null placeholder with a real string, changing its shape in one locale only.

### Pitfall 9: 44px touch-target regression

**What goes wrong:** `min-h-[44px] min-w-[44px]` makes an existing tight layout overflow or break visual rhythm.
**Why it happens:** Some interactive elements are inside a Grid or Flex with a fixed parent height.
**How to avoid:** Audit parent layout constraints before adding the class. In table rows, for example, 44px may force `height` changes cascading to other cells. Prefer adding padding (`p-2.5` = 10px each side, adds 20px to a 24px icon = 44px total) rather than fixed min sizes where possible.
**Warning signs:** Visual regression in snapshot tests; layout shift on tab switch.

## Runtime State Inventory

Phase 105 is not a rename/refactor/migration phase — it adds new config files, new tests, and targeted className edits. No database keys, collection names, user IDs, cron descriptions, secret keys, or build artifacts change.

**However**, the new Convex `internal.extraction.testing.seedCompletedJob` internalAction introduces runtime state: rows inserted into `extractionJobs` / `extractionPapers` / `extractionResults` during E2E runs. These rows will accumulate in the dev database over successive CI runs unless cleaned up.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | E2E seed rows in `extractionJobs` + `extractionPapers` + `extractionResults` (dev/preview DB only) | Consider a companion cleanup internalAction or a `unique:true` naming convention (e.g., `title = "E2E seed <ulid>"`) so future tests can find-and-delete their own rows. Defer to implementation; not blocking. |
| Live service config | None — no n8n, Datadog, Tailscale, Cloudflare tags affected | None — verified by domain inventory (project uses Convex + Clerk + Stripe + Zotero, none of which store "105" or similar phase identifiers) |
| OS-registered state | None — no Task Scheduler, pm2, launchd, systemd changes | None — Phase 105 is pure repo edits |
| Secrets and env vars | `ALLOW_TEST_SEEDING` env var introduced (dev-guard escape hatch for CI); `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD`, `CLERK_SECRET_KEY` already exist (reused from `e2e/global.setup.ts`) | Document `ALLOW_TEST_SEEDING` in `.env.local.example` + README; CI needs it set to `true` for E2E |
| Build artifacts / installed packages | None stale; `eslint` + `eslint-config-next` newly installed devDependencies only | None — fresh install; existing `node_modules/` will just add new packages |

**The canonical question — after every file in the repo is updated, what runtime systems still have state?** Only the dev Convex DB may accumulate seed rows. All other runtime systems are unaffected.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 20 | ESLint 10, Playwright | Assumed (existing project) | — | — |
| `npm` | Install ESLint + eslint-config-next | Assumed | — | — |
| Playwright browsers (Chromium) | E2E spec | Managed by Playwright (`npx playwright install`) | — | CI must have `npx playwright install --with-deps` step |
| Clerk test user | E2E auth | Provisioned by `e2e/global.setup.ts` | — | CI must set `CLERK_SECRET_KEY`, `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD` |
| Convex deployment (dev) | Seed action | Present (dev deployment active per `.env.local`) | — | CI needs `NEXT_PUBLIC_CONVEX_URL` + optional `CONVEX_DEPLOY_KEY` for internal-action calls |
| `ALLOW_TEST_SEEDING=true` env var | Dev-guard bypass in CI | NEW — must be added to Convex dashboard for the preview deployment used in E2E | — | If not set, seed action throws; E2E can't run |

**Missing dependencies with no fallback:**
- `ALLOW_TEST_SEEDING=true` in Convex CI/preview env — must be set before E2E can run, unless E2E uses a local Convex deployment (then `CONVEX_CLOUD_URL.includes("localhost")` bypass works)

**Missing dependencies with fallback:**
- Real Zotero test account → mocked via `page.route()` (intentional, per D-08)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 + Playwright 1.58.2 (both already installed) |
| Config file | `vitest.config.ts` (default glob matches new tests), `playwright.config.ts` (default project auto-picks up new specs) |
| Quick run command | `npm run test -- tests/eslint/ tests/i18n/` (runs Phase 105 Vitest subset in <5s) |
| Full suite command | `npm run test:ci` (Vitest + build + E2E default project incl. new workbench spec) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GAP-03 | Lint rule fires on literal `1000` in extraction UI | unit | `vitest run tests/eslint/lint-rule.test.ts` | ❌ Wave 0 |
| GAP-03 | Lint rule fires on literal `200` in extraction UI | unit | `vitest run tests/eslint/lint-rule.test.ts` | ❌ Wave 0 |
| GAP-03 | Lint rule exempts test files | unit | `vitest run tests/eslint/lint-rule.test.ts` | ❌ Wave 0 |
| GAP-03 | `npm run lint` exits non-zero when a violation exists | smoke | `npx eslint .` | ❌ Wave 0 (the `eslint.config.mjs` doesn't exist yet) |
| Phase 105 §2 | E2E: connect Zotero → stage → view → export | e2e | `playwright test e2e/extraction-workbench.spec.ts` | ❌ Wave 0 |
| Phase 105 §3 | Mobile responsive: Sheet full-width on <640px | e2e (manual + automated) | `playwright test e2e/extraction-workbench.spec.ts --grep mobile` (optional) | ❌ Wave 0 — deferred, relies on mobile-viewport project config OR manual UAT |
| Phase 105 §4 | Reduced motion: view-switch <100ms | e2e | Part of `extraction-workbench.spec.ts` (test step 2) | ❌ Wave 0 |
| Phase 105 §5 | i18n parity: all 6 locales have identical keys | unit | `vitest run tests/i18n/v7-key-parity.test.ts` | ❌ Wave 0 |
| Phase 105 §5 | French diacritic sample check | unit | `vitest run tests/i18n/v7-key-parity.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run tests/eslint/ tests/i18n/` (~3s)
- **Per wave merge:** `npm run test && npm run lint` (Vitest + ESLint full pass; ~30s)
- **Phase gate:** `npm run test:ci` green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `eslint.config.mjs` (repo root) — enables `npx eslint .` + the lint-rule self-test
- [ ] `tests/eslint/lint-rule.test.ts` OR `tests/extraction/lint-rule.test.ts` — rule regression protection
- [ ] `tests/i18n/v7-key-parity.test.ts` — key parity + French diacritics
- [ ] `e2e/extraction-workbench.spec.ts` — main E2E
- [ ] `e2e/helpers/sign-in.ts` — extracted Clerk sign-in helper (shared with `auth.spec.ts`)
- [ ] `convex/extraction/testing.ts` — dev-guarded seed internalAction
- [ ] `e2e/fixtures/zotero-collections.json` + `zotero-items.json` — mock response payloads
- [ ] `package.json` scripts: `"lint": "eslint ."` + `"test:e2e:workbench": "playwright test e2e/extraction-workbench.spec.ts"` + extend `"test:ci"` to include `lint` + workbench E2E

## Security Domain

> `security_enforcement` is not explicitly set to `false` in `.planning/config.json`; treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (E2E uses real Clerk test user) | Existing Clerk setup; E2E credentials stored in CI secret store |
| V3 Session Management | yes (E2E creates session) | Clerk handles session lifecycle; `clerk.signOut()` in existing teardown pattern |
| V4 Access Control | yes (seed action must be dev-guarded) | `assertDevEnvironment()` check; `internalAction` visibility; `ALLOW_TEST_SEEDING` escape hatch |
| V5 Input Validation | partial (seed args) | Convex `v.*` validators on `seedCompletedJob` args |
| V6 Cryptography | no | Nothing new in scope |

### Known Threat Patterns for {this phase}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Seed action callable in production | Elevation of Privilege | `assertDevEnvironment()` with explicit env var check (CONVEX_CLOUD_URL localhost OR NODE_ENV dev OR ALLOW_TEST_SEEDING=true); `internalAction` (not `action`) so no public HTTP route |
| Zotero OAuth secrets leaked via E2E fixtures | Information Disclosure | Mock-based — fixtures contain no real OAuth tokens; `api.zotero.org` responses are canned JSON with zero secret material |
| Clerk test user reused across environments | Spoofing | Existing `e2e/global.setup.ts` provisions a disposable test user per CI run; skips password checks via Clerk `skipPasswordChecks: true` (already accepted practice per existing `e2e/global.setup.ts:73`) |
| Lint rule bypass via non-literal constants | Tampering | Acknowledged — rule catches `Literal[value=1000]` not `Literal[value=999+1]`. Acceptable; attacker already has repo write access, and the reactive `getExtractionLimit` path is the approved escape |

## Project Constraints (from CLAUDE.md)

| Rule | Source | Impact on Phase 105 |
|------|--------|---------------------|
| DRY — check codebase before implementing | User CLAUDE.md | Reuse `useIsMobile()` at `hooks/use-mobile.tsx` (don't write `useIsBelowBreakpoint`). Reuse `e2e/auth.spec.ts:14` `signIn` helper (extract to `e2e/helpers/sign-in.ts`, don't re-inline). Reuse `requireAppUrl` pattern at `convex/lib/env.ts:6` for dev-guard check |
| No legacy compatibility; destructive, modern, best practices | User CLAUDE.md | Use ESLint 9 flat config (not `.eslintrc`). Skip `FlatCompat` bridge. Accept `next lint` removal (Next.js 16 deletes it — just call `eslint` directly) |
| OpenScholar brand tone: clean, friendly, warm | Project CLAUDE.md | Reduced-motion UX preserves essential feedback (D-20); 44px targets enhance accessibility per "warmth at scale" principle; i18n audit serves "accessibility as first-class" |
| Convex code — read `convex/_generated/ai/guidelines.md` first | Project CLAUDE.md | Seed action uses `internalAction` (not `action`) per §"Function registration"; `ctx.runMutation` for DB inserts (actions have no `ctx.db`) per §"Function calling"; argument validators required |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**ESLint Rule Architecture (D-01 through D-05):**
- **D-01:** Bootstrap `eslint.config.mjs` flat config at repo root (nothing exists today). Extend `next/core-web-vitals` + `next/typescript`. Install `eslint`, `eslint-config-next`, `@typescript-eslint/parser` devDeps. Add `"lint": "next lint"` script + include in `test:ci`.
- **D-02:** `no-restricted-syntax` with selectors `Literal[value=1000]` and `Literal[value=200]`. Scope via two glob overrides: `components/extraction/**/*.{ts,tsx}` + `app/extraction/**/*.{ts,tsx}`. Rule level: `error`.
- **D-03:** Test-file exception via nested glob override: `components/extraction/**/*.test.{ts,tsx}` → rule disabled. `convex/lib/queryBounds.ts` out of scope (outside the glob). Files importing `queryBounds` or using `getExtractionLimit` implicitly allowed.
- **D-04:** Error message: `"Literal '1000'/'200' is forbidden in extraction UI. Import MAX_EXTRACTION_PAPERS_PER_JOB or getExtractionLimit from 'convex/lib/queryBounds' (or use the reactive getExtractionLimit query) to route through EXTRACTION_LIMITS_BY_TIER."`
- **D-05:** Vitest test `tests/extraction/lint-rule.test.ts` runs ESLint programmatically against fixture containing literal 1000 + 200; asserts rule fires. Protects against silent removal.

**E2E Playwright Spec (D-06 through D-12):**
- **D-06:** Single spec `e2e/extraction-workbench.spec.ts` under default project (not `billing`). Reuses existing `e2e/global.setup.ts`. No new `workers: 1`.
- **D-07:** One `test.describe` block. `test.beforeAll` Clerk sign-in (extract helper to `e2e/helpers/sign-in.ts`). Three sequential `test()` steps: (1) stage papers from 4 tabs + counter, (2) create job + navigate 3 views + open evidence drawer, (3) export CSV/JSON/XLSX.
- **D-08:** Zotero — **mock via `page.route()`** for `https://api.zotero.org/**`. Intercept Convex `startOAuth` action URL → stub "already connected". Rationale: live OAuth brittle in CI.
- **D-09:** Extraction — **seed via Convex internal action**, not real LLM cascade. Create `internal.extraction.testing.seedCompletedJob(jobId, paperCount)` internalAction. Test calls via `runAction` before navigating to `/extraction/[jobId]`.
- **D-10:** Export verification via `page.waitForEvent("download")`. Assert filename pattern + byte-size > 0. Content parsing out of scope.
- **D-11:** Zotero, Library, Search, Collections, Manual tabs all exercised. 1-2 papers per tab. Assert counter + drawer per-source grouping. Search uses pre-seeded `searchHistory` row (same testing action); NOT real OpenAlex API.
- **D-12:** New script `"test:e2e:workbench": "playwright test e2e/extraction-workbench.spec.ts --config=playwright.config.ts"`. `test:ci` extended.

**Mobile Responsive Targets (D-13 through D-17):**
- **D-13:** Baseline — full-width Sheet on mobile already. Verify `w-full sm:max-w-md` on `components/extraction/extraction-basket-drawer.tsx`. Do NOT introduce bottom-sheet (deferred to MOB-F01).
- **D-14:** Auto-switch to table view at `<768px`; hide card + split. Implementation: `useIsMobile()` guard in `components/extraction/view-switcher.tsx`. If `isMobile && activeView !== "table"`, force `activeView = "table"` on mount.
- **D-15:** Selector page tabs: verify `overflow-x-auto` on `TabsList` in `app/extraction/new/selector-page-client.tsx`.
- **D-16:** 44px touch targets on `<AddToExtractionButton>`, `<ExtractionCounter>` progress, `<ZoteroItemRow>` checkbox, `<WorkbenchToolbar>` icon buttons, tab triggers. Scope: v7.0-added files only.
- **D-17:** Breakpoints: Tailwind `sm:` (640px) + `md:` (768px). At `<640px`: workbench toolbar stacks; export dropdown → icon only; column-visibility popover disappears.

**Reduced-Motion Implementation (D-18 through D-22):**
- **D-18:** Hybrid — wrap root `app/layout.tsx` with `<MotionConfig reducedMotion="user">` from `motion/react`.
- **D-19:** Global CSS in `app/globals.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- **D-20:** Essential feedback preserved (focus rings, state changes, instant layout, progress-fill). Only easing removed.
- **D-21:** Existing `useReducedMotion()` usages (paper-result-card, workbench-shell, question-builder) LEAVE IN PLACE — per-component fine-grained control stays.
- **D-22:** Playwright test: `page.emulateMedia({ reducedMotion: "reduce" })` before navigating to `/extraction/[jobId]`, assert view-switcher transition completes `<100ms`. One assertion in test step (2).

**i18n Audit Methodology (D-23 through D-28):**
- **D-23:** New Vitest test `tests/i18n/v7-key-parity.test.ts` (new subdirectory). Loads 6 locales, flattens to dot-sep keys, asserts set equality. Default `node` environment.
- **D-24:** Scope: entire key tree of each locale, not hand-picked. No namespace whitelist.
- **D-25:** French diacritic sampling — 8-10 curated v7.0 French keys must contain characters in `[éèêëàâäôöûüùïîçÉÈÊËÀÂÄÔÖÛÜÙÏÎÇ]`.
- **D-26:** Test fails the build. No optional locales.
- **D-27:** NO "unused key" audit (deferred as out-of-scope).
- **D-28:** Run via `npm run test` (default Vitest glob picks it up). No new script.

### Claude's Discretion

- Exact fixture JSON shape for Zotero API mock (collections + items with/without DOI)
- Exact Clerk test user sign-in helper extraction location (`e2e/helpers/sign-in.ts` vs inline)
- Exact glob patterns for ESLint `no-restricted-syntax` override block vs test-file exception nesting
- Exact list of 8-10 French diacritic sample keys (curated at implementation time)
- Whether 44px audit adds a generic wrapper component or inline className patches per mount
- Exact threshold for `<100ms` reduced-motion assertion (50ms / 100ms / 150ms)
- Test organization: `tests/extraction/lint-rule.test.ts` (existing dir) vs `tests/eslint/` (new dir)

### Deferred Ideas (OUT OF SCOPE)

- Pre-commit lint hook / husky — defer to later tech-debt phase
- MOB-F01 mobile bottom-sheet drawer — v7.1
- "Unused i18n keys" audit — requires AST parsing
- Full keyboard shortcut support (j/k/e) — WB-F05 v7.1
- Lint rule extension to `convex/**` — separate phase
- Visual regression testing — project-level out of scope
- Storybook / snapshot tests — not in scope

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAP-03 | ESLint rule forbids literal `1000` / `200` in `components/extraction/**` + `app/extraction/**`, failing CI when bypassed | Pattern 1 (flat config + glob overrides + `no-restricted-syntax`), Pattern 2 (programmatic rule-test via `new ESLint({...}).lintText`), Pitfall 1 + 2 (cwd + filePath must match glob). Verified: `eslint-config-next@16.2.4` ships `./core-web-vitals` + `./typescript` subpath exports; `defineConfig` is ESLint 9 native via `eslint/config` |

## Code Examples

All code examples appear under **Architecture Patterns** above:

- **Pattern 1:** ESLint 9 flat config with glob overrides (GAP-03)
- **Pattern 2:** Programmatic ESLint rule test in Vitest (D-05)
- **Pattern 3:** Playwright E2E with Clerk + `page.route` + `emulateMedia` (D-06 through D-22)
- **Pattern 4:** Dev-guarded Convex `internalAction` (D-09)
- **Pattern 5:** Root-level `<MotionConfig>` wrap (D-18)
- **Pattern 6:** Global CSS reduced-motion fallback (D-19)
- **Pattern 7:** Vitest i18n key parity + French diacritic sampling (D-23 through D-26)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.eslintrc.json` + `extends: ["next/core-web-vitals"]` | `eslint.config.mjs` flat config + `...nextVitals` spread | ESLint 9 (2024), Next.js 15 (late 2024) | Legacy config unsupported in Next.js 16 / ESLint 10 |
| `next lint` command | `eslint` CLI directly (`npx eslint .`) | Next.js 16.0 (2026) | `next lint` removed; codemod available. D-01 says `"lint": "next lint"` — update to `"lint": "eslint ."` [VERIFIED: Next.js 16 docs §"next lint removal"] |
| FlatCompat bridge (`@eslint/compat`) | Direct flat config imports from `eslint-config-next/core-web-vitals` | Next.js 15.1 | eslint-config-next now ships native flat config (no FlatCompat needed) [VERIFIED: npm view eslint-config-next@16.2.4 exports] |
| Subtree-only `useReducedMotion()` branches | `<MotionConfig reducedMotion="user">` root wrap | motion 11+ | One-line global policy; per-component hooks still work for fine-grained control |

**Deprecated/outdated:**
- `.eslintignore` file — replaced by `globalIgnores([...])` in flat config
- `next lint` — removed in Next.js 16 (codemod exists); use `eslint` CLI directly
- `FlatCompat` from `@eslint/eslintrc` — not needed for Next.js 16 + eslint-config-next 16.x

**⚠️ CONTEXT.md D-01 note:** The decision says `"lint": "next lint"` but Next.js 16 removed that command. Planner should adjust to `"lint": "eslint ."` — functionally equivalent, one-word diff. Worth surfacing in the plan because the phrasing in D-01 is literally broken.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ConvexHttpClient` can call `internal.extraction.testing.seedCompletedJob` from the E2E test runner when given `CONVEX_DEPLOY_KEY` | Pattern 3 + Pitfall 3 | MEDIUM — if deploy keys can't invoke internal actions directly, need to add a dev-guarded public `action` wrapper. Budget 1-2 hours for discovery during implementation. |
| A2 | `tw-animate-css`'s generated CSS is covered by the `@media (prefers-reduced-motion: reduce)` `*` selector (animations targeted by class selectors) | Pattern 6 + Pitfall 7 | LOW — `*` selector catches all elements, and `!important` overrides utility classes. Verify in implementation via Playwright 100ms assertion. |
| A3 | `useReducedMotion()` hook continues returning `true` under `<MotionConfig reducedMotion="user">` when OS preference is set | D-21 + Pattern 5 | LOW — motion.dev docs imply the hook respects both sources; documented behavior confirms consistent integration. |
| A4 | Seed action's Convex env-guard recognizes `ALLOW_TEST_SEEDING=true` as valid bypass in CI preview deployments | Pattern 4 + Environment Availability | LOW — pattern mirrors existing `requireAppUrl` escape hatches; Convex env vars are set via `npx convex env set`. |
| A5 | Existing `useIsMobile()` at `hooks/use-mobile.tsx` (768px breakpoint) is correct for D-14 (auto-switch to table view at `<768px`) | Pattern re: Mobile Polish | VERIFIED — file inspection confirmed `MOBILE_BREAKPOINT = 768` exactly matches D-14's `<md` requirement. Not an assumption. |
| A6 | `npm run lint` command name uses `eslint` CLI directly (not `next lint`) because Next.js 16 removed `next lint` | D-01 adjustment | VERIFIED — Next.js 16.2.4 docs explicitly state "Starting with Next.js 16, `next lint` is removed". |

**Confirmation needed from user before execution:** A1 (Convex internal-action invocation mechanism — determines whether we add a public wrapper or use deploy-key HTTP client).

## Open Questions

1. **Convex internal-action HTTP invocation from Playwright test runner**
   - What we know: D-09 specifies `runAction` pattern; `ConvexHttpClient` exists; deploy keys can grant internal access
   - What's unclear: Whether the E2E test's `ConvexHttpClient` can directly call `internal.*` refs with a deploy key, or whether we need to wrap in a public (still dev-guarded) `action`
   - Recommendation: Start with public-wrapper pattern (always works, extra guard layer is benign), drop the wrapper if direct deploy-key invocation proves clean. Flag as A1 in Assumptions Log.

2. **Seed cleanup strategy**
   - What we know: Seed action adds rows to `extractionJobs` + children; no cleanup in current D-09 scope
   - What's unclear: Will accumulated E2E rows interfere with other tests or blow up dev DB size?
   - Recommendation: Use a stable suffix like `title: "E2E seed <runId>"` so a companion `cleanupSeededJobs` internalAction can purge by prefix. Add to plan, not research; implementation-time detail.

3. **Mobile E2E coverage**
   - What we know: D-13 through D-17 specify mobile behavior; current `playwright.config.ts` has no mobile viewport project
   - What's unclear: Does the E2E spec need a mobile-viewport project config, or is desktop viewport + `useIsMobile()` stub coverage enough?
   - Recommendation: Desktop-only E2E verification + manual UAT. Adding mobile project = new config, new worker, more CI time. Out of scope for Phase 105's "LOW research" flag — defer to v7.1 if needed.

4. **`"lint": "next lint"` in D-01 vs Next.js 16 removal**
   - What we know: D-01 says `"lint": "next lint"`, but Next.js 16 removed `next lint`
   - What's unclear: Nothing — the adjustment is mechanical
   - Recommendation: Planner uses `"lint": "eslint ."` and surfaces this in their PLAN as a minor deviation from CONTEXT.md with rationale (Next.js 16 removal cited).

## Sources

### Primary (HIGH confidence)

- **Next.js 16.2.4 ESLint docs** — `https://nextjs.org/docs/app/api-reference/config/eslint` — Verified eslint.config.mjs flat config syntax, `eslint-config-next/core-web-vitals` + `/typescript` subpath exports, `defineConfig` from `eslint/config`, `next lint` removal in v16.0, monorepo `settings.next.rootDir` for `@next/eslint-plugin-next`
- **ESLint 9 Node.js API** — `https://eslint.org/docs/latest/integrate/nodejs-api` — Verified `new ESLint({ cwd, overrideConfig })`, `lintText(source, { filePath })`, `LintResult.messages` shape
- **Motion `MotionConfig` docs** — `https://motion.dev/docs/react-motion-config` — Verified `reducedMotion` prop accepts `"user"` | `"always"` | `"never"`; behavior ("transform and layout animations disabled"); root-level wrap example
- **Playwright API** — `https://playwright.dev/docs/api/class-page` + `https://playwright.dev/docs/downloads` — Verified `page.emulateMedia({ reducedMotion: "reduce" | "no-preference" | null })`, `page.route(pattern, handler)`, `page.waitForEvent("download")` → `Download.suggestedFilename()` + `Download.path()`
- **npm registry (2026-04-16)** — `npm view <pkg> version` — Verified `eslint@10.2.0`, `eslint-config-next@16.2.4`, `@typescript-eslint/parser@8.58.2`, `motion@12.38.0`
- **Codebase** — `hooks/use-mobile.tsx` (768px breakpoint confirmed), `components/ui/sheet.tsx:65` (`sm:max-w-sm` default), `components/ui/tabs.tsx` (shadcn Tabs shape), `e2e/auth.spec.ts:14-22` (signIn helper pattern), `e2e/global.setup.ts` (Clerk provisioning), `convex/lib/env.ts:6-21` (dev-guard pattern), `convex/zotero/actions.ts:1135-1164` (`purgeStaleZoteroState` internalAction pattern), `convex/extraction/workpoolActions.ts:1` (`"use node"` usage), `playwright.config.ts` (default project + billing project structure), `package.json` (installed versions)

### Secondary (MEDIUM confidence)

- **Convex docs via `convex/_generated/ai/guidelines.md`** — Verified `internalAction` + `ctx.runMutation` + argument-validator requirements; the file is project-authoritative per CLAUDE.md
- **Next.js 16 upgrade codemods** — `https://nextjs.org/docs/app/guides/upgrading/codemods#migrate-from-next-lint-to-eslint-cli` referenced but not fetched in full; documented fact that `next lint` has a migration codemod

### Tertiary (LOW confidence)

- None. Every claim traces to an official source or direct codebase inspection.

## Metadata

**Confidence breakdown:**
- ESLint flat config + rule design: HIGH — Next.js 16 docs + `eslint-config-next@16.2.4` exports verified today
- E2E Playwright + Clerk + `page.route` + `emulateMedia` + downloads: HIGH — all Playwright native APIs, all verified via docs
- Convex dev-guarded internalAction: HIGH for pattern (matches existing `purgeStaleZoteroState`), MEDIUM for `ConvexHttpClient` internal-action invocation mechanism (A1 assumption flagged)
- Motion `MotionConfig` + CSS reduced-motion: HIGH — motion.dev docs + standard `@media` pattern
- i18n parity test: HIGH — pure JS logic, trivial to verify
- Mobile polish: HIGH — codebase inspected; existing hook + Sheet primitive verified suitable

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 days — stable tech; refresh only if Next.js 17 or ESLint 11 releases before execution)
