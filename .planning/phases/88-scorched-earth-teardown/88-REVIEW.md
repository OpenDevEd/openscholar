---
phase: 88-scorched-earth-teardown
reviewed: 2026-04-14T12:00:00Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - components/app-sidebar.tsx
  - components/Pricing.tsx
  - convex/_generated/api.d.ts
  - convex/ai/actions.ts
  - convex/convex.config.ts
  - convex/credits/actions.ts
  - convex/featureFlags/internal.ts
  - convex/lib/constants.ts
  - convex/lib/queryBounds.ts
  - convex/lib/rateLimit.ts
  - convex/lib/stripeCustomer.ts
  - convex/maintenance/internal.ts
  - convex/maintenance/mutations.ts
  - convex/schema.ts
  - convex/subscriptions/actions.ts
  - convex/workpool.ts
  - lib/ai/client/executor.ts
  - lib/ai/client/router.ts
  - lib/ai/core/batch-types.ts
  - lib/ai/core/batch.ts
  - lib/ai/core/configs.ts
  - lib/ai/core/prompts.ts
  - lib/ai/core/schemas.ts
  - lib/ai/core/types.ts
  - lib/store.ts
  - lib/toast/error-resolver.ts
  - lib/types/index.ts
  - lib/types/search.types.ts
  - messages/en-GB.json
  - messages/en-US.json
  - messages/fr.json
  - messages/hi.json
  - messages/ja.json
  - messages/zh.json
  - tests/ai-prompts.test.ts
  - tests/ai-schemas.test.ts
  - tests/live-billing/support.ts
  - tests/openalex-email.test.ts
  - tests/toast-action-routing.test.ts
  - tests/toast-error-resolver.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 88: Code Review Report

**Reviewed:** 2026-04-14T12:00:00Z
**Depth:** standard
**Files Reviewed:** 38
**Status:** issues_found

## Summary

This review examines 38 files that had extraction-specific code surgically removed during the Phase 88 teardown. The core removal was clean: AI core modules (types, schemas, prompts, configs, batch processors), Convex backend modules (schema, actions, feature flags, maintenance), billing infrastructure, and UI components show no dangling extraction imports, no broken module references, and no empty blocks left behind.

Three issues were found:

1. A dead route reference to `/ai-enhancement` in the sidebar navigation code -- the route directory was deleted but the path-matching logic was not updated.
2. An unused `DataExtractionQuestion` type alias still defined in `lib/types/screening.types.ts` with zero consumers anywhere in the codebase.
3. Test fixture strings in `tests/toast-error-resolver.test.ts` reference a deleted Convex action path (`ai/actions:generateExtractionQuestions`), which is not a correctness problem today but will cause confusion during future maintenance.

All other files -- including Convex schema, AI core modules, batch processors, billing actions, subscription management, feature flag infrastructure, maintenance crons, localization files, and remaining test suites -- are structurally clean after the teardown.

## Warnings

### WR-01: Dead route reference to deleted /ai-enhancement page

**File:** `components/app-sidebar.tsx:432`
**Issue:** The `getCurrentPage()` function checks `pathname.includes("/ai-enhancement")` and returns `"ai-enhancement"`, but no route directory exists at `app/**/ai-enhancement/`. The `/ai-enhancement` route was presumably removed as part of extraction teardown. This is dead code that will never match (harmless today), but it creates confusion about whether the route should exist and pollutes the navigation logic.
**Fix:**
```tsx
// Remove lines 432-432. The function should go from:
const getCurrentPage = () => {
  if (!pathname) return null;
  if (pathname === "/") return "home";
  if (pathname.includes("/bookmarks")) return "bookmarks";
  if (pathname.includes("/library")) return "library";
  if (pathname.includes("/history")) return "history";
  if (pathname.includes("/ai-enhancement")) return "ai-enhancement"; // DELETE THIS LINE
  return null;
};
```

### WR-02: Unused DataExtractionQuestion type alias with zero consumers

**File:** `lib/types/screening.types.ts:23-26`
**Issue:** `DataExtractionQuestion` is a type alias for `ScreeningQuestion` that was part of the extraction feature. It is defined but never imported or used anywhere in the codebase (confirmed by grep across all `.ts`/`.tsx` files). The `lib/types/index.ts` re-export was already removed in a prior step, but the definition itself was left behind. Per the teardown's goals, this is leftover extraction-era dead code.
**Fix:**
```ts
// Remove lines 22-26 from lib/types/screening.types.ts:
// /**
//  * Data extraction question - alias for ScreeningQuestion
//  * (Same structure, different semantic meaning)
//  */
// export type DataExtractionQuestion = ScreeningQuestion;
```

### WR-03: Unused variable `result` in handleKeepCurrentPlan

**File:** `components/Pricing.tsx:242`
**Issue:** The `const result = await changePlan(...)` assignment captures a return value that is never read. The function immediately moves on to `getSubscriptionDetails` without using `result`. While this is not a regression from the teardown (it appears to pre-date it), it is a code quality issue that creates the misleading impression that the result matters.
**Fix:**
```tsx
// Change line 242 from:
const result = await changePlan({ targetPriceId: subscriptionDetails.currentPriceId });
// To:
await changePlan({ targetPriceId: subscriptionDetails.currentPriceId });
```

## Info

### IN-01: Test fixtures reference deleted Convex action path

**File:** `tests/toast-error-resolver.test.ts:12,24`
**Issue:** Two test cases use the string `"ai/actions:generateExtractionQuestions"` as fixture data inside mock Convex error messages. This action was deleted during the teardown. The tests still pass because the error resolver extracts error codes from the message text (it does not validate the action path). However, the fixture strings are misleading -- they reference a function that no longer exists.
**Fix:** Update the fixture strings to reference a current action, e.g., `"ai/actions:generateScreeningQuestions"`. This is cosmetic but improves test clarity.

### IN-02: Hardcoded English strings in Pricing component button labels

**File:** `components/Pricing.tsx:468-549`
**Issue:** Several button labels in `getButtonConfig` are hardcoded English strings instead of using the `t()` / `tc()` translation functions: "Payment pending" (line 470), "Complete payment in billing portal" (line 477), "Cancel scheduled downgrade" (line 496), "Scheduled" (line 512), "Manage in Billing Portal" (line 522), and "Downgrade to ..." (line 550). This is not a teardown regression -- it pre-dates the teardown -- but it means these labels will not be translated for non-English users.
**Fix:** Add corresponding keys to the `pricing` or `common` translation namespaces in all `messages/*.json` files and replace the hardcoded strings with `t("keyName")` or `tc("keyName")` calls.

### IN-03: Duplicate `Settings` import in app-sidebar.tsx is unused

**File:** `components/app-sidebar.tsx:47`
**Issue:** The `Settings` icon is imported from `lucide-react` but never used in the component. It was likely part of a settings navigation item that was removed.
**Fix:**
```tsx
// Remove Settings from the import on line 47:
import {
  Home,
  BookOpen,
  Library,
  ListChecks,
  Clock,
  PanelLeft,
  ChevronLeft,
  ChevronRight,
  // Settings, <-- remove
} from "lucide-react";
```

---

_Reviewed: 2026-04-14T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
