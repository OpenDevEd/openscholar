# Phase 105: Polish, Integration, E2E - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 16 (6 new, 10 modified)
**Analogs found:** 14 / 16

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `eslint.config.mjs` | NEW | config | build-time | — (no prior ESLint config in repo) | no-analog |
| `tests/extraction/lint-rule.test.ts` | NEW | test (structural) | filesystem-read | `tests/extraction/parse.test.ts` (neighboring vitest file; mocking style reference) | role-match |
| `tests/i18n/v7-key-parity.test.ts` | NEW | test (structural) | filesystem-read | `tests/locale-detection.test.ts` | exact |
| `e2e/helpers/sign-in.ts` | NEW | test helper | request-response | `e2e/auth.spec.ts` (inlined `signIn` — source of extraction) | exact |
| `e2e/extraction-workbench.spec.ts` | NEW | test (e2e) | request-response + streaming | `e2e/auth.spec.ts` | exact |
| `e2e/fixtures/zotero-*.json` | NEW | test fixture | static data | `tests/factories/*` (fixture-style JSON pattern) | role-match |
| `convex/extraction/testing.ts` | NEW | service (internalAction, dev-guarded) | CRUD / seed | `convex/zotero/actions.ts:1135-1164` (`purgeStaleZoteroState`) + `convex/lib/env.ts` (dev guard) | exact |
| `package.json` | MOD | config | build-time | existing `scripts` block | self-analog |
| `app/layout.tsx` | MOD | component (RSC root) | request-response | existing file — wrap new provider in place | self-analog |
| `app/globals.css` | MOD | style | static | existing `@custom-variant dark` + `:root` blocks | self-analog |
| `components/extraction/view-switcher.tsx` | MOD | component (client) | event-driven | `components/shared/sidebar-layout.tsx` (`useIsMobile` guard pattern) | exact |
| `components/extraction/workbench-toolbar.tsx` | MOD | component (client) | event-driven | current file — flex-wrap + className adjustments in situ | self-analog |
| `components/extraction/extraction-basket-drawer.tsx` | MOD | component (client) | event-driven | `components/ui/sheet.tsx:65` (shadcn default `sm:max-w-sm`) | exact |
| `components/extraction/add-to-extraction-button.tsx` | MOD | component (client) | event-driven | `components/extraction/zotero-item-row.tsx` (icon-button pattern) | role-match |
| `components/extraction/extraction-counter.tsx` | MOD | component (client) | request-response | current file — className patch only | self-analog |
| `app/extraction/new/selector-page-client.tsx` | MOD | component (client) | event-driven | current file — verification only | self-analog |
| `app/extraction/new/zotero-tab.tsx` | MOD | component (client) | event-driven | current file — `ZoteroItemRow` invocation prop-threading | self-analog |

---

## Pattern Assignments

### `e2e/helpers/sign-in.ts` (test helper, request-response) — NEW

**Analog:** `e2e/auth.spec.ts:4-22` (inlined helper that gets extracted verbatim)

**Imports pattern** (`e2e/auth.spec.ts:1-2`):
```typescript
import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
```
For the extracted helper, keep only `Page` + `clerk`:
```typescript
import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
```

**Core pattern (sign-in helper)** (`e2e/auth.spec.ts:4-22`):
```typescript
function getTestUserEmail() {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL;
  if (!emailAddress) {
    throw new Error(
      "Missing E2E_CLERK_USER_EMAIL for auth E2E tests.",
    );
  }
  return emailAddress;
}

async function signIn(page: Page) {
  const emailAddress = getTestUserEmail();
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({
    page,
    emailAddress,
  });
}
```

**Export shape for the new helper:**
```typescript
export { signIn, getTestUserEmail };
```

**Error-handling convention:** Throws directly on missing env var (no `try/catch`). Matches `e2e/global.setup.ts:42-47` (`requireEnv`).

**After extraction:** Update `e2e/auth.spec.ts` to `import { signIn } from "./helpers/sign-in"` and delete the local copy. DRY per user CLAUDE.md rule #1.

---

### `e2e/extraction-workbench.spec.ts` (test/e2e, request-response + streaming) — NEW

**Analog:** `e2e/auth.spec.ts` (entire file, test structure) + `e2e/billing/fixtures.ts` (seed-action invocation via `execFile`-style Convex CLI shell-out)

**Imports pattern** (`e2e/auth.spec.ts:1-2` + Convex seed invocation):
```typescript
import { test, expect, type Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";
import { signIn } from "./helpers/sign-in";
```

**`test.describe` structure** (`e2e/auth.spec.ts:24-56`):
```typescript
test.describe("clerk auth flows", () => {
  test("anonymous user is redirected from protected route to /sign-in", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("sign in allows access to protected routes", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
  });
});
```

**Page-route mocking pattern** (new; no exact prior analog — closest is `e2e/billing/fixtures.ts` which uses stripe-helpers instead):
```typescript
// Use Playwright native page.route() for https://api.zotero.org/**
await page.route("**/api.zotero.org/**/collections*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(zoteroCollectionsFixture),
  }),
);
```

**Convex seed invocation pattern** (`e2e/billing/fixtures.ts:115-148` — shell out to `npx convex run` with identity):
```typescript
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const execFileAsync = promisify(execFile);

const cliArgs = [
  "convex",
  "run",
  "extraction/testing:seedCompletedJob",
  JSON.stringify({ paperCount: 10, questionCount: 3 }),
  "--typecheck",
  "disable",
  "--codegen",
  "disable",
];

if (process.env.CONVEX_DEPLOYMENT_NAME) {
  cliArgs.push("--deployment-name", process.env.CONVEX_DEPLOYMENT_NAME);
}

const { stdout } = await execFileAsync("npx", cliArgs, {
  env: process.env,
  maxBuffer: 1024 * 1024,
  timeout: 30_000,
});
```

**Download-waiting pattern (new; no prior analog):**
```typescript
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: /export csv/i }).click();
const download = await downloadPromise;
expect(download.suggestedFilename()).toMatch(/\.csv$/);
```

**Reduced-motion emulation pattern (new; no prior analog):**
```typescript
await page.emulateMedia({ reducedMotion: "reduce" });
// ... then navigate and assert transition completes < 100ms
```

**Project targeting:** Leave project undefined. `playwright.config.ts:63-67` default project `testIgnore: "**/billing/**"` — `e2e/extraction-workbench.spec.ts` auto-lands in the default project.

---

### `tests/extraction/lint-rule.test.ts` (test/structural, filesystem-read) — NEW

**Analog:** `tests/locale-detection.test.ts` (neighboring structural/pure-logic vitest file) + `tests/extraction/parse.test.ts:16-20` (describe/it/expect import shape)

**Imports pattern** (from `tests/locale-detection.test.ts:1-2`):
```typescript
import { describe, expect, it } from "vitest";
```

**Node/ESLint-specific additions (no analog — first of kind):**
```typescript
import { ESLint } from "eslint";
import path from "node:path";
```

**Test structure pattern** (from `tests/locale-detection.test.ts:4-47`):
```typescript
describe("extraction lint rule: no literal 1000/200", () => {
  it("flags literal 1000 in components/extraction/**/*.tsx", async () => {
    // arrange: instantiate ESLint with repo-root cwd
    const eslint = new ESLint({
      cwd: path.resolve(__dirname, "../.."),
    });

    // act: lint a fixture string with filePath inside the glob
    const source = `export function Cap() { const limit = 1000; return <div>{limit}</div>; }`;
    const [result] = await eslint.lintText(source, {
      filePath: "components/extraction/fake-cap.tsx",
    });

    // assert
    const restricted = result.messages.filter(
      (m) => m.ruleId === "no-restricted-syntax",
    );
    expect(restricted.length).toBeGreaterThanOrEqual(1);
    expect(restricted[0].message).toContain("MAX_EXTRACTION_PAPERS_PER_JOB");
  });
});
```

**File placement decision:** Per CONTEXT.md §"Claude's Discretion", choose `tests/extraction/` (existing directory; already contains `parse.test.ts`). Matches D-05 literal text: `tests/extraction/lint-rule.test.ts`.

**Vitest environment:** No `environmentMatchGlobs` change needed. `vitest.config.ts:13` default is `node`; glob on line 30 includes `tests/**/*.test.ts` — new file picked up automatically.

---

### `tests/i18n/v7-key-parity.test.ts` (test/structural, filesystem-read) — NEW

**Analog:** `tests/locale-detection.test.ts` (same role: pure-logic, default-env Vitest)

**Imports pattern** (mirror of `tests/locale-detection.test.ts:1`):
```typescript
import { describe, expect, it } from "vitest";
import enUS from "@/messages/en-US.json";
import enGB from "@/messages/en-GB.json";
import fr from "@/messages/fr.json";
import hi from "@/messages/hi.json";
import ja from "@/messages/ja.json";
import zh from "@/messages/zh.json";
```
`@/` path alias is already configured at `vitest.config.ts:8-10`:
```typescript
resolve: {
  alias: {
    "@": path.resolve(__dirname, "."),
  },
},
```

**Test structure pattern** (from `tests/locale-detection.test.ts:4-47`):
```typescript
describe("i18n v7.0 key parity", () => {
  it("every locale has the same set of keys", () => {
    // arrange + act: flatten each; assert set equality
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
});
```

**File placement decision:** `tests/i18n/` (new subdirectory). Path mirrors `tests/extraction/`, `tests/hooks/`, `tests/live-billing/`, `tests/crash-prevention/`, `tests/factories/`, `tests/evals/` (all siblings). `tests/i18n/**/*.test.ts` is matched by the default glob at `vitest.config.ts:30`.

**Vitest environment:** Default `node` (pure JSON-read + Set comparison). No `environmentMatchGlobs` entry needed.

---

### `convex/extraction/testing.ts` (service/internalAction, CRUD-seed) — NEW

**Analog (runtime shape):** `convex/zotero/actions.ts:1135-1164` (`purgeStaleZoteroState` — internalAction with `"use node"`, audit logging, `ctx.runMutation` for DB writes, dev-only semantics)

**Analog (dev-guard):** `convex/lib/env.ts:6-21` (`requireAppUrl` — branches on `CONVEX_CLOUD_URL.includes("localhost")` + `NODE_ENV === "development"`)

**Analog (internalMutation for DB insertion):** `convex/zotero/mutations.ts:188` (`purgeAllZoteroData` internalMutation — writes invoked via `ctx.runMutation` from the paired action)

**Imports pattern** (`convex/zotero/actions.ts:1-10`):
```typescript
"use node";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
```

**Dev-guard pattern** (copy shape from `convex/lib/env.ts:9-14`, adapt for seed semantics):
```typescript
function assertDevEnvironment(): void {
  const isLocalhost = process.env.CONVEX_CLOUD_URL?.includes("localhost") === true;
  const isDev = process.env.NODE_ENV === "development";
  const explicitlyAllowed = process.env.ALLOW_TEST_SEEDING === "true";
  if (!isLocalhost && !isDev && !explicitlyAllowed) {
    throw new Error(
      "seedCompletedJob is dev/test only. Set ALLOW_TEST_SEEDING=true in Convex env to bypass.",
    );
  }
}
```

**Core pattern (internalAction + audit + runMutation)** (mirror `convex/zotero/actions.ts:1135-1164`):
```typescript
export const seedCompletedJob = internalAction({
  args: {
    paperCount: v.number(),
    questionCount: v.number(),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, { paperCount, questionCount }): Promise<Id<"extractionJobs">> => {
    assertDevEnvironment();

    // Delegate DB writes to an internalMutation (actions cannot use ctx.db)
    const jobId: Id<"extractionJobs"> = await ctx.runMutation(
      internal.extraction.testing_mutations.insertSeededJob,
      { paperCount, questionCount },
    );
    return jobId;
  },
});
```

**Companion internalMutation pattern** (mirror `convex/zotero/mutations.ts:188-`):
```typescript
export const insertSeededJob = internalMutation({
  args: {
    paperCount: v.number(),
    questionCount: v.number(),
  },
  returns: v.id("extractionJobs"),
  handler: async (ctx, { paperCount, questionCount }) => {
    // 1. Insert extractionJobs row (status: "completed")
    // 2. Insert N extractionPapers rows
    // 3. Insert N*Q extractionResults rows
    // Mirror the ctx.db.insert(...) shape from convex/extraction/mutations.ts:96-
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      // ... mirror createExtractionJob's insert object shape
      status: "completed",
      totalPapers: paperCount,
      processedPapers: paperCount,
      // ... rest from convex/extraction/mutations.ts:96-
    });
    // ... insert papers + results
    return jobId;
  },
});
```

**Companion file placement:** Both `seedCompletedJob` (internalAction) and `insertSeededJob` (internalMutation) go in `convex/extraction/testing.ts` — Convex supports multiple function types in one file (see `convex/zotero/mutations.ts` which mixes `mutation` + `internalMutation`).

**Validator conventions:** All args validated per Convex guidelines.md §"Function registration" line 84. `returns` specified per §"Validators" — use `v.id("extractionJobs")` for the return shape.

---

### `app/layout.tsx` (component/RSC root, request-response) — MOD

**Analog:** Self (existing file — targeted insertion only).

**Imports pattern to add** (`app/layout.tsx:1-21` existing shape; append one line):
```typescript
// ADD: one import at the top (in alphabetical order near other motion-related imports, or grouped with providers)
import { MotionConfig } from "motion/react";
```

**Client-boundary consideration (Pitfall 4 in RESEARCH.md):** `MotionConfig` is a client-only component. Since `app/layout.tsx` is an `async` server component, wrap via a small client wrapper (e.g., `components/providers/reduced-motion-provider.tsx` with `"use client"`) OR rely on Motion 12.x's support for RSC-nested client components.

**Wrap placement pattern** (`app/layout.tsx:82-111` existing tree — target inside `NextIntlClientProvider`):
```tsx
<NextIntlClientProvider locale={locale} messages={messages}>
  <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <ConvexClientProvider preloadedFlags={preloadedFlags}>
        {/* ... existing tree unchanged ... */}
      </ConvexClientProvider>
    </ThemeProvider>
  </MotionConfig>
</NextIntlClientProvider>
```

**Why INSIDE `NextIntlClientProvider`, OUTSIDE `ThemeProvider`:** per CONTEXT.md §"Canonical References / Reduced-Motion" — root-level wrap captures sidebar badge + basket drawer + all extraction motion. Order between MotionConfig and ThemeProvider doesn't matter for reduced-motion semantics, but MotionConfig must wrap every client subtree that uses `motion.div` or `useReducedMotion()`.

---

### `app/globals.css` (style, static) — MOD

**Analog:** Self (existing file — append one `@media` block).

**Existing rule structure pattern** (`app/globals.css:6`):
```css
@custom-variant dark (&:is(.dark *));

:root {
  /* existing tokens ... */
}
```

**Append at file end** (per D-19):
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

**Placement:** End of file, after all `:root` / `.dark` / theme blocks. Order doesn't matter (CSS media queries are declarative), but convention in this repo is to place `@media` blocks at the end.

---

### `components/extraction/view-switcher.tsx` (component/client, event-driven) — MOD

**Analog:** `components/shared/sidebar-layout.tsx:43-48` (existing `useIsMobile` guard that conditionally switches UI on mobile — closest exact analog)

**Import pattern to add** (from `components/shared/sidebar-layout.tsx:6` but use the canonical hook path):
```typescript
// Existing imports unchanged. ADD:
import { useIsMobile } from "@/hooks/use-mobile";
// Note: components/shared/sidebar-layout.tsx imports from @/lib/hooks (which re-exports);
// components/extraction/workbench-shell.tsx already imports directly from @/hooks/use-mobile (canonical).
// Prefer direct canonical path for consistency with workbench-shell.tsx.
```

**Guard pattern** (adapt from `components/shared/sidebar-layout.tsx:48-113`):
```typescript
export function ViewSwitcher({ value, onChange }: ViewSwitcherProps) {
  const t = useTranslations("extraction");
  const isMobile = useIsMobile();

  const viewOptions: CompactIconToggleOption<ActiveView>[] = [
    {
      value: "table",
      icon: <Table2 className="h-4 w-4" />,
      label: t("workbench.viewTable"),
    },
    // Conditionally include card + split only on >=md
    ...(!isMobile ? [
      {
        value: "card" as const,
        icon: <LayoutGrid className="h-4 w-4" />,
        label: t("workbench.viewCard"),
      },
      {
        value: "split" as const,
        icon: <Columns className="h-4 w-4" />,
        label: t("workbench.viewSplit"),
      },
    ] : []),
  ];

  return (
    <CompactIconToggleGroup
      value={value}
      onChange={onChange}
      options={viewOptions}
    />
  );
}
```

**Force-switch pattern** (reuse `components/extraction/workbench-shell.tsx:103-108` — existing isMobile-triggers-setActiveView('table') effect):
```typescript
// This effect already exists at workbench-shell.tsx:103-108 for split-view fallback.
// Extend or duplicate for card-view:
useEffect(() => {
  if (isMobile && activeView !== "table") {
    setActiveView("table");
    toast.info(t("splitMobileToast")); // reuse toast key or add a new one
  }
}, [isMobile, activeView, setActiveView, t]);
```

**Key architectural note:** Per D-14, the forced switch lives in `workbench-shell.tsx` (not `view-switcher.tsx`). The view-switcher is a pure presentation component; state logic stays in the shell.

---

### `components/extraction/workbench-toolbar.tsx` (component/client, event-driven) — MOD

**Analog:** Self (existing file — targeted className edits only).

**Existing responsive root** (`components/extraction/workbench-toolbar.tsx:149-150`):
```tsx
<div className="bg-card/80 backdrop-blur-sm border-b border-border/40 px-4 py-3 flex items-center gap-4 flex-wrap">
```

**Mobile-stack adjustment pattern** (per D-17, stack vertically <640px):
```tsx
// Change to:
<div className="bg-card/80 backdrop-blur-sm border-b border-border/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-3 sm:gap-4">
```

**Icon-only export button pattern (per D-17):** Switch button content to hide text label on mobile:
```tsx
<Button variant="outline" size="sm" disabled={isExporting} className="sm:w-auto">
  {isExporting ? (
    <Loader2 className="mr-0 sm:mr-2 h-4 w-4 animate-spin" />
  ) : (
    <Download className="mr-0 sm:mr-2 h-4 w-4" />
  )}
  <span className="hidden sm:inline">{t("workbench.exportButton")}</span>
</Button>
```

**Touch-target adjustment pattern (per D-16):** The existing search `<button>` at lines 166-175 is a 1em icon in a `p-1` wrapper — does not meet 44px. Replace:
```tsx
// Before:
<button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted">
// After (add min sizes while preserving hit area inside the input):
<button className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-muted">
```
Or prefer padding approach per RESEARCH.md Pitfall 9.

---

### `components/extraction/extraction-basket-drawer.tsx` (component/client, event-driven) — MOD

**Analog:** `components/ui/sheet.tsx:63-67` (shadcn default — `h-full w-3/4 border-l sm:max-w-sm` for `side="right"`)

**Existing SheetContent usage** (`components/extraction/extraction-basket-drawer.tsx:66`):
```tsx
<SheetContent side="right" className="flex flex-col p-0">
```

**Per-D-13 verification pattern** — Override default `sm:max-w-sm` to `sm:max-w-md` if wider drawer wanted. Per D-13 literal requirement `w-full sm:max-w-md`:
```tsx
<SheetContent side="right" className="flex flex-col p-0 w-full sm:max-w-md">
```
Note: shadcn Sheet's built-in `w-3/4` (75% viewport width for `right`/`left`) is overridden by `w-full` class (later in cascade). The `sm:max-w-md` overrides shadcn's default `sm:max-w-sm`.

**Touch-target adjustment in SheetFooter Button** (lines 96-103) — Button already `className="w-full"`; the `<Button>` component's default size provides adequate height but verify actually rendering ≥44px min-height:
```tsx
<Button
  className="w-full min-h-[44px]"
  disabled={count === 0}
  onClick={handleCTA}
>
  {t("cta")}
</Button>
```

---

### `components/extraction/add-to-extraction-button.tsx` (component/client, event-driven) — MOD

**Analog:** `app/extraction/new/zotero-item-row.tsx:90-100` (similar icon-button pattern: Button wrapping a Lucide icon with aria-label; closest role match for hit-area enforcement)

**Existing Button shape** (`components/extraction/add-to-extraction-button.tsx:86-106`):
```tsx
<Button
  variant="ghost"
  size="icon-sm"
  className={cn(inBasket && "text-primary")}
  disabled={isAtCap && !inBasket}
  onClick={handleToggle}
  aria-label={inBasket ? t("inBasket") : t("add")}
>
```

**Touch-target adjustment pattern (per D-16 — "44px min size"):** The `size="icon-sm"` variant is smaller than 44px. Either:
- **Option A (className additive):** Add `min-h-[44px] min-w-[44px]` while keeping the visual icon at 16px (the button grows to 44×44 with the icon centered):
  ```tsx
  <Button
    variant="ghost"
    size="icon-sm"
    className={cn("min-h-[44px] min-w-[44px]", inBasket && "text-primary")}
    disabled={isAtCap && !inBasket}
    onClick={handleToggle}
    aria-label={inBasket ? t("inBasket") : t("add")}
  >
  ```
- **Option B (size change):** Switch to a larger preset size (e.g., `size="icon"` if it resolves to 44px) — verify in `components/ui/button.tsx` before choosing.

**Recommendation:** Option A — scoped, reversible, no cross-file coupling.

---

### `components/extraction/extraction-counter.tsx` (component/client, request-response) — MOD

**Analog:** Self.

**Existing Progress container** (`components/extraction/extraction-counter.tsx:46-56`):
```tsx
<Progress
  value={Math.min(ratio * 100, 100)}
  className={cn(
    "h-2",
    ratio >= 1 &&
      "[&>[data-slot=progress-indicator]]:bg-destructive",
    ratio >= 0.8 &&
      ratio < 1 &&
      "[&>[data-slot=progress-indicator]]:bg-amber-500 dark:[&>[data-slot=progress-indicator]]:bg-amber-400",
  )}
/>
```

**Touch-target adjustment pattern (per D-16 — "44px on progress bar container"):** The progress bar itself is decorative (not interactive). Per D-20, interpret "progress bar container" as the wrapper so tapping anywhere in it (if that becomes interactive later) has room. Minimal patch:
```tsx
<div className={cn("space-y-1.5 min-h-[44px] flex flex-col justify-center", className)}>
  {/* existing inner markup unchanged */}
</div>
```
Alternate: leave the outer wrapper alone since Progress is non-interactive; scope can narrow to only the parent when it becomes tappable.

**Recommendation:** Make the outer wrapper meet 44px min-height. This is the `className` prop on the root div (line 32). Low-risk.

---

### `app/extraction/new/selector-page-client.tsx` (component/client, event-driven) — MOD

**Analog:** Self.

**Existing TabsList** (`app/extraction/new/selector-page-client.tsx:66-77`):
```tsx
<Tabs defaultValue="library">
  <TabsList>
    <TabsTrigger value="library">{t("tabs.library")}</TabsTrigger>
    ...
  </TabsList>
```

**Per-D-15 verification pattern** — shadcn `TabsList` default does NOT include `overflow-x-auto`. Explicit patch:
```tsx
<TabsList className="overflow-x-auto">
  <TabsTrigger value="library" className="min-h-[44px]">{t("tabs.library")}</TabsTrigger>
  <TabsTrigger value="collections" className="min-h-[44px]">{t("tabs.collections")}</TabsTrigger>
  {/* ... apply min-h-[44px] to every TabsTrigger per D-16 */}
</TabsList>
```

**Touch-target pattern on TabsTrigger:** Apply `min-h-[44px]` via className to each trigger (per D-16 "tab triggers on `<SelectorPage>`").

---

### `app/extraction/new/zotero-tab.tsx` (component/client, event-driven) — MOD

**Analog:** Self.

**Existing ZoteroItemRow invocation** (`app/extraction/new/zotero-tab.tsx:263-272`):
```tsx
<ZoteroItemRow
  key={item.key}
  item={item}
  resolutionState={resState}
  onResolve={handleResolve}
  onRetry={handleRetry}
  isInBasket={inBasket}
/>
```

**Touch-target adjustment pattern (per D-16 — "44px on ZoteroItemRow checkboxes"):** The actual checkbox lives in `app/extraction/new/zotero-item-row.tsx:46-110`. Options:
- **Option A (upstream patch):** Add `min-h-[44px] min-w-[44px]` to the checkbox-area div at `app/extraction/new/zotero-item-row.tsx:122`:
  ```tsx
  <div className="flex-shrink-0 w-6 flex items-center justify-center min-h-[44px] min-w-[44px]">
  ```
- **Option B (keep outer touch area, inflate hit target via padding on Checkbox):** Swap the row hit area to hand off to the checkbox via padding.

**Recommendation:** Option A — edits `zotero-item-row.tsx` directly (already in scope per CONTEXT.md §"Integration Points" implicit — `components/extraction/**` + `app/extraction/**`). Same file as the existing retry-button at lines 90-94 which could also benefit from `min-h-[44px] min-w-[44px]`.

**Note for planner:** D-16 lists `<ZoteroItemRow> checkbox hit area` — the edit happens in `zotero-item-row.tsx`, not `zotero-tab.tsx`. Surfacing this in the plan prevents scope confusion.

---

### `package.json` (config, build-time) — MOD

**Analog:** Existing file.

**Existing scripts block** (`package.json:5-22`):
```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "test": "vitest run",
    "test:billing:e2e": "playwright test --project=billing",
    "test:e2e:auth": "playwright test e2e/auth.spec.ts --config=playwright.config.ts",
    "test:ci": "npm run test && npm run build && npm run test:e2e:auth"
  }
}
```

**Add/modify scripts pattern** (per D-01, D-12; RESEARCH.md §"State of the Art" note about Next.js 16 removing `next lint`):
```json
{
  "scripts": {
    "lint": "eslint .",
    "test:e2e:workbench": "playwright test e2e/extraction-workbench.spec.ts --config=playwright.config.ts",
    "test:ci": "npm run lint && npm run test && npm run build && npm run test:e2e:auth && npm run test:e2e:workbench"
  }
}
```
Note: D-01 CONTEXT says `"lint": "next lint"` but RESEARCH §"State of the Art" A6 confirms Next.js 16 removed `next lint`; use `"lint": "eslint ."`.

**Add devDependencies pattern** (from `package.json:80-105` — alphabetical order inside `devDependencies`):
```json
{
  "devDependencies": {
    "eslint": "^10.2.0",
    "eslint-config-next": "^16.2.4"
  }
}
```
Do NOT add `@typescript-eslint/parser` explicitly — per RESEARCH §"Installation", `eslint-config-next/typescript` pulls it in transitively at 16.2.4.

---

### `eslint.config.mjs` (config, build-time) — NEW

**Analog:** None (no prior ESLint config exists in repo).

**Source pattern (VERIFIED in RESEARCH.md Pattern 1, `https://nextjs.org/docs/app/api-reference/config/eslint`):**
```js
// eslint.config.mjs
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

**Key structural notes:**
- `defineConfig` from `eslint/config` (ESLint 9 native; see `https://eslint.org/docs/latest/use/configure/configuration-files`).
- Spread-import from `eslint-config-next/core-web-vitals` and `/typescript` (subpath exports verified in RESEARCH at `eslint-config-next@16.2.4`).
- Two separate config objects for rule + test-file exception (flat config does NOT use nested `overrides:`).
- `globalIgnores()` replaces legacy `.eslintignore`.

---

## Shared Patterns

### Clerk Sign-In (E2E)
**Source:** `e2e/auth.spec.ts:4-22` (to be extracted to `e2e/helpers/sign-in.ts`)
**Apply to:** All new E2E specs (only `e2e/extraction-workbench.spec.ts` in this phase; updates `e2e/auth.spec.ts` to import from the new helper).
```typescript
async function signIn(page: Page) {
  const emailAddress = getTestUserEmail();
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress });
}
```

### Dev-Environment Guard (Convex)
**Source:** `convex/lib/env.ts:6-21` (`requireAppUrl`)
**Apply to:** `convex/extraction/testing.ts:seedCompletedJob` (and any future dev-only internalAction)
```typescript
function assertDevEnvironment(): void {
  const isLocalhost = process.env.CONVEX_CLOUD_URL?.includes("localhost") === true;
  const isDev = process.env.NODE_ENV === "development";
  const explicitlyAllowed = process.env.ALLOW_TEST_SEEDING === "true";
  if (!isLocalhost && !isDev && !explicitlyAllowed) {
    throw new Error("seedCompletedJob is dev/test only.");
  }
}
```

### Action → InternalMutation DB Writes (Convex)
**Source:** `convex/zotero/actions.ts:1149-1151` (`purgeStaleZoteroState` → `internal.zotero.mutations.purgeAllZoteroData`)
**Apply to:** `convex/extraction/testing.ts:seedCompletedJob` → `insertSeededJob` internalMutation (same file; see `convex/zotero/mutations.ts` for mixed `mutation` + `internalMutation` in one file)
```typescript
const jobId: Id<"extractionJobs"> = await ctx.runMutation(
  internal.extraction.testing.insertSeededJob, // or testing_mutations, naming decision
  { paperCount, questionCount },
);
```

### Mobile Responsive Guard (UI)
**Source:** `components/shared/sidebar-layout.tsx:43-48` and `components/extraction/workbench-shell.tsx:30+99+103-108` (canonical `useIsMobile` hook + conditional render + effect-driven state force)
**Apply to:** `components/extraction/view-switcher.tsx` (new card/split hide), `components/extraction/workbench-shell.tsx` (extend existing effect to include card view).
```typescript
import { useIsMobile } from "@/hooks/use-mobile";
// inside component:
const isMobile = useIsMobile();
if (isMobile) { /* render reduced surface */ }
useEffect(() => {
  if (isMobile && activeView !== "table") {
    setActiveView("table");
  }
}, [isMobile, activeView, setActiveView]);
```

### Touch-Target Enforcement (UI)
**Source:** No prior analog — net new pattern.
**Apply to:** `add-to-extraction-button.tsx`, `extraction-counter.tsx`, `extraction-basket-drawer.tsx` CTA Button, `workbench-toolbar.tsx` icon buttons, `zotero-item-row.tsx` checkbox area, `selector-page-client.tsx` TabsTrigger elements.
```tsx
// Pattern: append min-h-[44px] min-w-[44px] via cn()
<Button className={cn("min-h-[44px] min-w-[44px]", existingClasses)}>
// Or inflate hit area via padding on a non-button element:
<div className="min-h-[44px] min-w-[44px] flex items-center justify-center">
```

### Programmatic ESLint in Vitest (Test)
**Source:** No prior analog — net new pattern.
**Apply to:** `tests/extraction/lint-rule.test.ts`
```typescript
const eslint = new ESLint({ cwd: path.resolve(__dirname, "../..") });
const [result] = await eslint.lintText(source, {
  filePath: "components/extraction/fake-cap.tsx", // MUST match the rule's glob
});
const restricted = result.messages.filter((m) => m.ruleId === "no-restricted-syntax");
expect(restricted.length).toBeGreaterThanOrEqual(1);
```

### Locale JSON Import via `@/` Alias (Test)
**Source:** `vitest.config.ts:8-10` (existing alias) + `tests/locale-detection.test.ts:1-2` (existing locale test pattern)
**Apply to:** `tests/i18n/v7-key-parity.test.ts`
```typescript
import enUS from "@/messages/en-US.json";
// ... repeat for all 6 locales
```

---

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns directly):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `eslint.config.mjs` | config | build-time | No prior ESLint config exists in the repo. Use RESEARCH.md Pattern 1. |
| `e2e/fixtures/zotero-collections.json`, `e2e/fixtures/zotero-items.json` | test fixture | static data | No Zotero API fixture files exist. Shape discoverable from `convex/zotero/actions.ts` API-response type definitions (lines 54-66) and Zotero's public JSON schema. |

---

## Metadata

**Analog search scope:** `e2e/`, `tests/`, `convex/`, `components/extraction/`, `components/shared/`, `components/ui/`, `app/extraction/`, `app/layout.tsx`, `app/globals.css`, `hooks/`, `lib/`, `package.json`, `playwright.config.ts`, `vitest.config.ts`.

**Files scanned:** 24 read for analog extraction; additional directory listings for role identification.

**Key patterns identified (for planner quick-reference):**
- All client components use `"use client"` directive (verified across 10+ components).
- Mobile guard uses `useIsMobile()` from `@/hooks/use-mobile` (canonical path used by `workbench-shell.tsx`); `@/lib/hooks` re-export is a secondary path used by `sidebar-layout.tsx` — prefer canonical.
- Convex internalActions with Node runtime use `"use node"` at top of file (see `convex/zotero/actions.ts:1`, `convex/extraction/workpoolActions.ts:1`).
- Convex internalActions delegate DB writes to internalMutations via `ctx.runMutation` (Convex guideline §"Function calling").
- Vitest tests under `tests/` default to `node` environment (`vitest.config.ts:13`); override only for JSX/DOM with `environmentMatchGlobs`.
- Playwright default project auto-picks new specs under `e2e/` unless `testIgnore` excludes them (`playwright.config.ts:63-67`).
- `MotionConfig` from `motion/react` is currently unused at root; adding it at `app/layout.tsx` is a first-of-kind pattern in this repo (see Pitfall 4 for client-boundary handling).

**Pattern extraction date:** 2026-04-16

---

*Phase: 105-polish-integration-e2e*
*Pattern map generated: 2026-04-16*
