# Phase 11: Tech Debt Cleanup - Research

**Researched:** 2026-02-28
**Domain:** Code consistency and CI reliability (tech debt from v1.2 milestone audit)
**Confidence:** HIGH

## Summary

Phase 11 addresses three tech debt items identified by the v1.2 milestone audit. All three are straightforward, isolated fixes with no architectural implications. The changes touch three files across three different directories (test spec, UI component, CI config), with no cross-file dependencies between the fixes.

The items are: (1) replacing bracket notation private field access with the existing public getter in `upgrade.spec.ts`, (2) deduplicating a `data-testid` attribute in `upgrade-confirmation-dialog.tsx` where two branches of a ternary both declare the same testid, and (3) adding a CI guard to ensure `NEXT_PUBLIC_CREDITS_ENABLED` is never set to `"false"` when billing E2E tests run.

**Primary recommendation:** Fix all three items in a single plan. Each is a one-line or few-line change with zero risk of regression.

## Standard Stack

No new libraries are needed. This phase modifies existing files only.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Playwright | (existing) | E2E test framework | Already configured in project |
| React/Next.js | (existing) | UI framework | Already configured in project |
| GitHub Actions | (existing) | CI/CD | Already configured in project |

### Alternatives Considered
None -- all fixes use existing patterns already established in the codebase.

## Architecture Patterns

### Pattern 1: Public Getter Access on WebhookWaiter

**What:** The `WebhookWaiter` class exposes a public `userId` getter (line 59 of `webhook-waiter.ts`) to access the private `convexUserId` field. All specs except `upgrade.spec.ts` already use `webhookWaiter.userId`.

**When to use:** Always -- when passing the Convex user ID to helper functions like `createSubscriptionBypass`.

**Current state in upgrade.spec.ts (line 21):**
```typescript
// BAD: bracket notation accesses private field directly
userId: webhookWaiter["convexUserId"],
```

**Correct pattern (used by all other specs):**
```typescript
// GOOD: uses public getter
userId: webhookWaiter.userId,
```

**Evidence:** All 8 other usages across `credits.spec.ts`, `downgrade.spec.ts`, `cancel.spec.ts`, and `subscribe.spec.ts` use `webhookWaiter.userId`.

### Pattern 2: Unique data-testid Per Rendered Element

**What:** Each `data-testid` attribute should uniquely identify a single rendered DOM element to avoid multi-match locator failures in Playwright.

**Current state in upgrade-confirmation-dialog.tsx:**
```tsx
// Lines 118-145: Ternary renders one of two branches
{(preview.lineItems ?? []).length > 0 ? (
  <>
    {/* ... line items ... */}
    <div className="border-t pt-2 flex items-center justify-between">
      <span className="text-sm font-medium">{t("totalCharge")}</span>
      <span data-testid="upgrade-total-charge" className="text-lg font-semibold">{formattedCharge}</span>
    </div>
  </>
) : (
  <div className="flex items-center justify-between">
    <span className="text-sm text-muted-foreground">{t("prorationCharge")}</span>
    <span data-testid="upgrade-total-charge" className="text-lg font-semibold">{formattedCharge}</span>
  </div>
)}
```

**Why it is safe despite duplication:** Only one branch renders at a time (ternary), so at runtime exactly one DOM element has this testid. However, if a future test uses `page.locator('[data-testid="upgrade-total-charge"]')` and both branches somehow render (e.g., during a refactor to show both), it would cause a strict mode locator error.

**Fix approach:** Both branches display the same `formattedCharge` value in the same styling. The testid should remain on both branches since both represent the same semantic element ("total charge display"), and only one renders at a time. However, the success criteria requires "a single `data-testid='upgrade-total-charge'` element (no duplicates)".

**Recommended approach:** Extract the charge display into a shared element rendered outside the ternary, OR keep the testid on both since React ternaries are mutually exclusive (functionally equivalent). The simplest fix that satisfies the success criteria: move the total charge line outside the ternary so it renders once regardless of branch.

### Pattern 3: CI Environment Variable Guard

**What:** Add a validation step in CI to ensure `NEXT_PUBLIC_CREDITS_ENABLED` is not set to `"false"`.

**Current CI state:**
- `.github/workflows/ci.yml` has 4 jobs: `unit-and-build`, `e2e-auth`, `billing-live`, `billing-live-extended`
- `.github/workflows/billing-nightly.yml` has 1 job: `billing-live-extended-nightly`
- Neither workflow sets `NEXT_PUBLIC_CREDITS_ENABLED` at all (confirmed by scanning both files)
- The `.env.local` file has `NEXT_PUBLIC_CREDITS_ENABLED=false` commented out (line 76: `# NEXT_PUBLIC_CREDITS_ENABLED=false`)
- The Playwright config loads `.env.local` via `process.loadEnvFile`, but since the line is commented out, it is not loaded

**Risk assessment:** Currently LOW risk -- the variable is not set in CI, and the comment in `.env.local` means it won't be loaded. But a future developer could uncomment line 76 in `.env.local` or add it to CI secrets, silently breaking CRED-05.

**Guard options:**
1. **CI workflow guard (recommended):** Add a validation step in the `billing-live` job that fails if `NEXT_PUBLIC_CREDITS_ENABLED` equals `"false"`. This matches the existing pattern of `required_vars` validation already present in `billing-live` and `billing-nightly` jobs.
2. **Test-level guard:** Add a `test.skip` or `test.beforeAll` check in `credits.spec.ts` that skips CRED-05 if the env var is `"false"`, with a warning message.
3. **Both:** CI guard to prevent running with wrong config + test guard to provide a clear error message.

**Recommended:** Option 1 (CI workflow guard). It matches the existing pattern in both `ci.yml` and `billing-nightly.yml` and catches the problem before any tests run.

### Anti-Patterns to Avoid
- **Bracket notation for TypeScript private fields:** TypeScript's `private` modifier is enforced at compile time only. Bracket notation (`obj["privateField"]`) bypasses type checking but works at runtime. This creates a maintenance trap: if the field is renamed, bracket access silently breaks at runtime instead of failing at compile time.
- **Duplicate data-testid values:** Even when only one renders at a time, duplicate testids in source code confuse maintainers and tooling. Keep testids unique per component file.

## Don't Hand-Roll

Not applicable -- all three fixes are simple edits to existing code, not new implementations.

## Common Pitfalls

### Pitfall 1: Extracting Charge Display Breaks Layout
**What goes wrong:** When deduplicating the testid by moving the charge display outside the ternary, the surrounding layout context changes and visual appearance may differ between the line-items branch and the no-line-items branch.
**Why it happens:** The two branches have slightly different container structures -- one has `border-t pt-2` (separator line above), the other does not.
**How to avoid:** Keep the testid on both branches since React ternaries guarantee mutual exclusivity. Only one element with this testid will ever exist in the DOM at render time. Alternatively, wrap the extracted element carefully to preserve both visual variants.
**Warning signs:** The two branches have different parent `className` values and different label text (`totalCharge` vs `prorationCharge`).

### Pitfall 2: CI Guard Blocks Unrelated Jobs
**What goes wrong:** Adding the env guard to the wrong CI job (e.g., `unit-and-build`) causes failures in contexts where the variable is irrelevant.
**Why it happens:** `NEXT_PUBLIC_CREDITS_ENABLED` only matters for E2E billing tests that exercise the credit cap banner.
**How to avoid:** Add the guard only to `billing-live` and `billing-live-extended` jobs in `ci.yml`, and to `billing-nightly.yml`. These are the only jobs that run billing E2E specs.
**Warning signs:** The `unit-and-build` job uses placeholder secrets and has no billing test context.

### Pitfall 3: Env Guard Fails When Variable is Absent
**What goes wrong:** A naive guard like `if [ "$NEXT_PUBLIC_CREDITS_ENABLED" = "false" ]` would pass when the variable is unset (correct behavior), but a guard like `if [ -z "$NEXT_PUBLIC_CREDITS_ENABLED" ]` would incorrectly fail.
**Why it happens:** The desired state is: variable is absent OR set to anything except `"false"`. The feature flag code treats absent as enabled: `process.env.NEXT_PUBLIC_CREDITS_ENABLED !== "false"`.
**How to avoid:** Guard should only fail when the value is explicitly `"false"`: `if [ "$NEXT_PUBLIC_CREDITS_ENABLED" = "false" ]; then echo "::error::..." && exit 1; fi`.

## Code Examples

### Fix 1: Replace bracket notation in upgrade.spec.ts

**File:** `e2e/billing/specs/upgrade.spec.ts`, line 21
```typescript
// Before:
userId: webhookWaiter["convexUserId"],

// After:
userId: webhookWaiter.userId,
```

### Fix 2: Deduplicate data-testid in upgrade-confirmation-dialog.tsx

**File:** `components/billing/upgrade-confirmation-dialog.tsx`, lines 136 and 142

**Option A (minimal, keeps ternary structure):** Since only one branch renders at a time, the "duplicate" is not a runtime issue. To satisfy the success criteria literally, restructure so the charge amount is rendered once outside the ternary:

```tsx
{/* Proration breakdown */}
<div className="rounded-lg border p-3 space-y-2">
  {(preview.lineItems ?? []).length > 0 && (
    <>
      {preview.lineItems.map((item, index) => (
        <div key={index} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground truncate mr-2">
            {item.description}
          </span>
          <span className={item.amountCents < 0 ? "text-green-600" : ""}>
            {format.number(item.amountCents / 100, {
              style: "currency",
              currency: item.currency,
              minimumFractionDigits: 2,
            })}
          </span>
        </div>
      ))}
    </>
  )}
  <div className={(preview.lineItems ?? []).length > 0 ? "border-t pt-2 flex items-center justify-between" : "flex items-center justify-between"}>
    <span className={(preview.lineItems ?? []).length > 0 ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
      {(preview.lineItems ?? []).length > 0 ? t("totalCharge") : t("prorationCharge")}
    </span>
    <span data-testid="upgrade-total-charge" className="text-lg font-semibold">{formattedCharge}</span>
  </div>
</div>
```

**Option B (simpler, keep both testids since ternary guarantees single render):** Accept that both branches have the same testid and document with a comment. This does NOT satisfy the success criteria literally ("a single element, no duplicates").

**Recommendation:** Use Option A or a simplified variant. The key insight: `formattedCharge` and the `data-testid` span are identical in both branches. Only the label text and container styling differ.

### Fix 3: Add CI env guard for NEXT_PUBLIC_CREDITS_ENABLED

**File:** `.github/workflows/ci.yml`, in `billing-live` job validation step

```yaml
- name: Validate billing environment
  run: |
    if [ "$NEXT_PUBLIC_CREDITS_ENABLED" = "false" ]; then
      echo "::error::NEXT_PUBLIC_CREDITS_ENABLED is set to 'false' — credit cap banner tests will fail"
      exit 1
    fi
```

This should be added to:
1. `billing-live` job in `.github/workflows/ci.yml` (alongside existing `Validate required billing-live secrets` step)
2. `billing-live-extended` job in `.github/workflows/ci.yml` (same location)
3. `billing-live-extended-nightly` job in `.github/workflows/billing-nightly.yml` (alongside existing validation)

Alternatively, fold it into the existing validation step as an additional check.

## State of the Art

Not applicable -- these are maintenance fixes, not technology choices.

## Open Questions

1. **Duplicate testid deduplication approach**
   - What we know: Both branches of the ternary display the same `formattedCharge` in the same `<span>` styling. Only the label text and container borders differ.
   - What's unclear: Whether the planner should restructure the JSX (Option A) or just accept both testids as safe (Option B). The success criteria says "a single element (no duplicates)" which points to Option A.
   - Recommendation: Use Option A -- extract the shared charge display outside the ternary. This definitively satisfies the success criteria and is a cleaner pattern.

2. **Which CI jobs need the env guard**
   - What we know: `billing-live` and `billing-live-extended` in `ci.yml`, plus `billing-live-extended-nightly` in `billing-nightly.yml` are the only jobs running billing E2E tests. The `e2e-auth` job does NOT set this variable and runs different tests.
   - What's unclear: Whether the `e2e-auth` job might eventually run billing E2E tests.
   - Recommendation: Add the guard only to the three billing jobs. If `e2e-auth` scope changes, it can be added then.

## Sources

### Primary (HIGH confidence)
- **`e2e/billing/webhook-waiter.ts`** -- Confirmed `userId` public getter exists (line 59), `convexUserId` is `private` (line 53)
- **`e2e/billing/specs/upgrade.spec.ts`** -- Confirmed bracket notation `webhookWaiter["convexUserId"]` on line 21
- **All other spec files** -- Confirmed 8 usages of `webhookWaiter.userId` across `credits.spec.ts`, `subscribe.spec.ts`, `downgrade.spec.ts`, `cancel.spec.ts`
- **`components/billing/upgrade-confirmation-dialog.tsx`** -- Confirmed duplicate `data-testid="upgrade-total-charge"` on lines 136 and 142
- **`.github/workflows/ci.yml`** -- Confirmed no `NEXT_PUBLIC_CREDITS_ENABLED` set in any job
- **`.github/workflows/billing-nightly.yml`** -- Confirmed no `NEXT_PUBLIC_CREDITS_ENABLED` set
- **`lib/credits/feature-flags.ts`** -- Confirmed flag logic: `process.env.NEXT_PUBLIC_CREDITS_ENABLED !== "false"`
- **`.env.local`** -- Confirmed line 76 is commented out: `# NEXT_PUBLIC_CREDITS_ENABLED=false`
- **`.planning/v1.2-MILESTONE-AUDIT.md`** -- Source of all three tech debt items

## Metadata

**Confidence breakdown:**
- Bracket notation fix: HIGH -- single line change, verified against 8 correct usages
- Duplicate testid fix: HIGH -- both lines identified, rendering logic understood
- CI env guard: HIGH -- all CI files scanned, existing validation pattern confirmed

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable codebase, no external dependencies)
