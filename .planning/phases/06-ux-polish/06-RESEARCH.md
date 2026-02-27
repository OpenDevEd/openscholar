# Phase 6: UX Polish - Research

**Researched:** 2026-02-27
**Domain:** Frontend dialog UX, Stripe payment data display, Radix UI dialog behavior
**Confidence:** HIGH

## Summary

Phase 6 adds three cosmetic improvements to the upgrade confirmation dialog: displaying the user's payment method (card brand + last 4 digits), showing a proration line-item breakdown (credit for unused time + charge for new plan), and preventing dialog dismissal while an upgrade is processing.

All three requirements are achievable with minimal changes. The payment method data (cardBrand, cardLast4) is already fetched by `getSubscriptionDetails` via Stripe's `expand: ["default_payment_method"]` but is not yet available in the upgrade preview flow or passed to the dialog. The proration line items are available from Stripe's `invoices.createPreview` response in `preview.lines.data` but the current `getUpgradePreview` action only returns `preview.total` and `preview.amount_due` -- it needs to extract and return individual line items. The dialog dismissal prevention uses standard Radix UI Dialog props (`onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`) with `event.preventDefault()`, plus hiding the close button conditionally.

**Primary recommendation:** Extend `getUpgradePreview` to return proration line items and payment method data from Stripe, then consume them in the existing `UpgradeConfirmationDialog` component while conditionally blocking dismissal during the confirming state.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UXPL-01 | User sees payment method (card brand + last 4 digits) in upgrade confirmation dialog | Payment method data is already fetched by `getSubscriptionDetails` (expands `default_payment_method`). The `getUpgradePreview` action needs the same expand, or the data can be passed from the already-fetched `subscriptionDetails` state in `Pricing.tsx`. |
| UXPL-02 | User sees proration line item breakdown (credit for unused time + charge for new plan) in confirmation dialog | Stripe `invoices.createPreview` returns `lines.data` array with individual line items containing `amount`, `description`, and proration info. Currently `getUpgradePreview` discards this data -- needs to extract and return it. |
| UXPL-03 | User cannot dismiss confirmation dialog via Escape key or click-outside while upgrade is processing | Radix UI Dialog.Content supports `onEscapeKeyDown`, `onPointerDownOutside`, and `onInteractOutside` props. Call `event.preventDefault()` on these when `isConfirming` is true. Also hide the X close button conditionally using the existing `showCloseButton` prop. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| radix-ui | 1.4.3 | Dialog primitive with dismissal control | Already used; provides `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside` on Dialog.Content |
| stripe | 20.3.0+ (Node SDK) | Invoice preview with line items | Already used; `invoices.createPreview` returns `lines.data` with proration breakdown |
| next-intl | (existing) | i18n for new dialog labels | Already used for all UI text |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | (existing) | CreditCard icon for payment method display | Already imported in dialog |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending getUpgradePreview for payment method | Pass subscriptionDetails from parent | Simpler but creates coupling; preview action is the right place since it already hits Stripe |
| AlertDialog (blocks Escape by default) | Dialog with manual dismissal control | AlertDialog semantics are wrong here -- this is a confirmation, not a destructive alert |

## Architecture Patterns

### Pattern 1: Extending the Stripe Preview Response
**What:** Add `lines.data` extraction and `default_payment_method` expansion to the existing `getUpgradePreview` Convex action.
**When to use:** When the backend action already makes the Stripe API call and just needs to return more data.
**Example:**
```typescript
// In getUpgradePreview handler, after creating preview:
const preview = await stripe.invoices.createPreview({
  customer: customerId,
  subscription: stripeSub.id,
  subscription_details: {
    items: [{ id: item.id, price: args.targetPriceId }],
    proration_behavior: "always_invoice",
    proration_date: prorationDate,
  },
});

// Extract line items for display
const lineItems = (preview.lines?.data ?? []).map((line) => ({
  description: line.description ?? "",
  amountCents: line.amount,
  currency: line.currency,
}));

// For payment method, expand default_payment_method on subscription retrieve:
const stripeSub = await stripe.subscriptions.retrieve(
  subscription.stripeSubscriptionId,
  { expand: ["default_payment_method"] }
);
const pm = stripeSub.default_payment_method as Stripe.PaymentMethod | null;
```
Source: https://docs.stripe.com/api/invoices/create_preview, https://docs.stripe.com/api/invoice-line-item/object

### Pattern 2: Conditional Dialog Dismissal Prevention
**What:** Pass Radix event handler props to `DialogContent` that call `preventDefault()` when the dialog is in a processing state.
**When to use:** When you need to lock a dialog during async operations.
**Example:**
```typescript
// In upgrade-confirmation-dialog.tsx:
<DialogContent
  onEscapeKeyDown={(e) => {
    if (isConfirming) e.preventDefault();
  }}
  onPointerDownOutside={(e) => {
    if (isConfirming) e.preventDefault();
  }}
  onInteractOutside={(e) => {
    if (isConfirming) e.preventDefault();
  }}
  showCloseButton={!isConfirming}
>
```
Source: https://www.radix-ui.com/primitives/docs/components/dialog

### Pattern 3: Passing Payment Method from Parent State
**What:** Alternative to extending getUpgradePreview -- reuse the `subscriptionDetails` already fetched in `Pricing.tsx` which contains `cardBrand` and `cardLast4`.
**When to use:** When the data is already available in the parent component and adding another Stripe API call is wasteful.
**Example:**
```typescript
// In Pricing.tsx, pass subscriptionDetails to dialog:
<UpgradeConfirmationDialog
  open={isUpgradeDialogOpen}
  onOpenChange={...}
  onConfirm={handleConfirmUpgrade}
  isConfirming={isConfirmingUpgrade}
  preview={upgradePreview}
  cardBrand={subscriptionDetails?.cardBrand}
  cardLast4={subscriptionDetails?.cardLast4}
/>
```

### Anti-Patterns to Avoid
- **Fetching payment method separately on dialog open:** Adds latency and a second Stripe call when the data is already available from `getSubscriptionDetails` or could be added to `getUpgradePreview`.
- **Disabling the onOpenChange callback entirely during confirming:** The current code already handles this (`if (!isConfirmingUpgrade) { setIsUpgradeDialogOpen(open); }`), but this alone doesn't prevent Escape/click-outside since Radix fires those before `onOpenChange`.
- **Using AlertDialog instead of Dialog for dismissal blocking:** AlertDialog has different accessibility semantics (announces as a destructive action) and doesn't have a close button -- changing the component type for a behavioral tweak is overkill.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proration line item calculation | Manual credit/charge math | Stripe `invoices.createPreview` `lines.data` | Stripe handles tax, rounding, currency, partial periods -- manual calculation will diverge |
| Dialog escape key prevention | Custom keydown event listener | Radix `onEscapeKeyDown` prop | Radix handles focus management, layering, and event ordering correctly |
| Payment method formatting | Manual card brand normalization | Display `cardBrand` as-is from Stripe (capitalize) + `cardLast4` | Stripe normalizes brand names consistently (visa, mastercard, amex, etc.) |

**Key insight:** All three requirements are extensions of existing infrastructure -- the proration preview action, the dialog component, and the subscription details data. No new libraries or patterns needed.

## Common Pitfalls

### Pitfall 1: Stripe Line Items May Have Negative Amounts
**What goes wrong:** Displaying line items without handling negative amounts (credits) leads to confusing UI where "-$5.00" appears raw.
**Why it happens:** Proration invoices have both a negative line (credit for unused time on old plan) and a positive line (charge for new plan). The negative line represents the credit.
**How to avoid:** Format negative amounts explicitly as credits (e.g., "Credit for unused Go plan: -$5.00" or "Unused time credit: $5.00"). Use the `description` field from Stripe which already says "Unused time on Go plan" or similar.
**Warning signs:** Total charge doesn't match sum of displayed line items.

### Pitfall 2: Dialog Still Closes Despite onOpenChange Guard
**What goes wrong:** User presses Escape during upgrade processing and the dialog closes.
**Why it happens:** The current code guards `onOpenChange` (`if (!isConfirmingUpgrade) { ... }`), but Radix Dialog fires escape/overlay handlers BEFORE `onOpenChange`. If those handlers aren't intercepted, the dialog's internal state changes.
**How to avoid:** Must add `onEscapeKeyDown`, `onPointerDownOutside`, and `onInteractOutside` with `preventDefault()` on the `DialogContent` component itself, not just guard `onOpenChange`.
**Warning signs:** Dialog dismisses on Escape even though `onOpenChange` has a guard.

### Pitfall 3: Payment Method May Be Null
**What goes wrong:** Dialog shows empty payment method area or crashes.
**Why it happens:** Some subscriptions don't have a `default_payment_method` set (e.g., invoice-based billing, bank transfers). The Stripe expand returns null.
**How to avoid:** Conditionally render the payment method section only when `cardBrand` and `cardLast4` are available (same pattern already used in `billing/page.tsx` line 550: `{details.cardLast4 && (...)}`).
**Warning signs:** Empty card display area with just the icon.

### Pitfall 4: Preview Line Items May Be Empty or Have Unexpected Count
**What goes wrong:** UI shows empty proration breakdown.
**Why it happens:** If the proration amount is zero (e.g., upgrading on the exact renewal date), `lines.data` may be empty or contain only one item.
**How to avoid:** Gracefully handle 0 or 1 line items. Fall back to showing just the total charge if no meaningful line items exist.
**Warning signs:** Empty breakdown section in the dialog.

### Pitfall 5: Convex Validators Must Match Extended Return Shape
**What goes wrong:** Runtime error from Convex when `getUpgradePreview` returns line items that don't match the declared `returns` validator.
**Why it happens:** Convex enforces return type validators strictly. Adding new fields (line items array, payment method) requires updating the `returns` validator.
**How to avoid:** Update the `v.object({...})` in the `returns` field to include the new fields with proper validators.
**Warning signs:** Convex action throws "Validator error" at runtime.

## Code Examples

### Extending getUpgradePreview Return Type
```typescript
// Source: convex/subscriptions/actions.ts (existing action, needs modification)
returns: v.object({
  prorationAmountCents: v.number(),
  currency: v.string(),
  immediateChargeCents: v.number(),
  currentPlan: planValidator,
  targetPlan: planValidator,
  proRataCredits: v.number(),
  currentPlanCreditsPerMonth: v.number(),
  targetPlanCreditsPerMonth: v.number(),
  remainingDays: v.number(),
  prorationDate: v.number(),
  // NEW: proration line items for UXPL-02
  lineItems: v.array(v.object({
    description: v.string(),
    amountCents: v.number(),
    currency: v.string(),
  })),
  // NEW: payment method for UXPL-01
  cardBrand: v.optional(v.string()),
  cardLast4: v.optional(v.string()),
}),
```

### Extracting Line Items from Stripe Preview
```typescript
// Source: Stripe API docs - invoices.createPreview response
// preview.lines.data contains InvoiceLineItem objects
const lineItems = (preview.lines?.data ?? []).map((line: any) => ({
  description: line.description ?? "Line item",
  amountCents: line.amount,
  currency: line.currency,
}));
```

### Conditional Dismissal Prevention in Dialog
```typescript
// Source: Radix UI Dialog docs
<DialogContent
  onEscapeKeyDown={(e) => { if (isConfirming) e.preventDefault(); }}
  onPointerDownOutside={(e) => { if (isConfirming) e.preventDefault(); }}
  onInteractOutside={(e) => { if (isConfirming) e.preventDefault(); }}
  showCloseButton={!isConfirming}
>
```

### Payment Method Display Pattern (from billing/page.tsx)
```typescript
// Source: app/settings/billing/page.tsx lines 550-559
{cardLast4 && (
  <div className="flex items-center gap-2">
    <CreditCard className="w-4 h-4 text-muted-foreground" />
    <span className="capitalize text-muted-foreground">
      {cardBrand}
    </span>
    <span className="font-medium">
      •••• {cardLast4}
    </span>
  </div>
)}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stripe.invoices.retrieveUpcoming()` | `stripe.invoices.createPreview()` | 2025-03-31 (Stripe API basil) | Project already uses createPreview -- no migration needed |
| `@radix-ui/react-dialog` (separate package) | `radix-ui` (unified package) | 2024+ | Project uses unified `radix-ui` v1.4.3 -- same API, different import path |

**Deprecated/outdated:**
- `retrieveUpcoming`: Replaced by `createPreview` in Stripe API version 2025-04-30.basil. This project already uses `createPreview`.

## Open Questions

1. **Stripe line item descriptions language**
   - What we know: Stripe generates descriptions like "Unused time on Go plan after 27 Feb 2026" automatically based on the price nickname and period.
   - What's unclear: Whether these descriptions are always in English or respect the customer's locale.
   - Recommendation: Display Stripe's description as-is. If localization is needed later, map line item types to i18n keys -- but this is out of scope for v1.1.

2. **Whether to extend getUpgradePreview or pass subscriptionDetails for payment method**
   - What we know: `getSubscriptionDetails` already fetches card info. `getUpgradePreview` does not.
   - What's unclear: Whether adding `expand: ["default_payment_method"]` to `getUpgradePreview`'s subscription retrieve is preferable to passing from parent.
   - Recommendation: Pass from parent (`subscriptionDetails.cardBrand`, `subscriptionDetails.cardLast4`) since it avoids an extra Stripe API expansion and the data is already available in `Pricing.tsx` state. If `subscriptionDetails` is null (race condition), fall back gracefully by not showing the section.

## Sources

### Primary (HIGH confidence)
- Stripe API Reference: Invoice Line Item object - https://docs.stripe.com/api/invoice-line-item/object - confirmed fields: description, amount, currency, period, proration
- Stripe API Reference: Create Preview Invoice - https://docs.stripe.com/api/invoices/create_preview - confirmed lines.data structure
- Radix UI Dialog docs - https://www.radix-ui.com/primitives/docs/components/dialog - confirmed onEscapeKeyDown, onPointerDownOutside, onInteractOutside props

### Secondary (MEDIUM confidence)
- Radix UI GitHub discussions on preventing dialog close - https://github.com/radix-ui/primitives/discussions/1434 - confirmed event.preventDefault() pattern
- shadcn/ui GitHub issue on preventing outside click close - https://github.com/shadcn-ui/ui/issues/1712 - confirmed approach works with shadcn wrapper

### Codebase (HIGH confidence)
- `convex/subscriptions/actions.ts` - existing `getUpgradePreview` and `getSubscriptionDetails` actions, payment method expand pattern
- `components/billing/upgrade-confirmation-dialog.tsx` - existing dialog component to extend
- `components/ui/dialog.tsx` - Dialog wrapper using `radix-ui` with `showCloseButton` prop
- `components/Pricing.tsx` - parent component managing upgrade flow state, already has `subscriptionDetails` with card info
- `app/settings/billing/page.tsx` - existing card display pattern (lines 550-559)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - extending existing patterns, all code paths verified in codebase
- Pitfalls: HIGH - verified against actual Stripe API behavior and Radix UI docs

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable -- no fast-moving dependencies)
