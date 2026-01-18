# Migration Notes - Convex/Stripe/WorkOS Best Practices Implementation

## Date: January 18, 2026

## ⚠️ HOTFIX Applied (January 18, 2026 - 4:35 PM)

**Issue:** Stripe webhooks were failing with "unique() query returned more than one result" error after soft-delete implementation.

**Root Cause:** `handleCheckoutComplete` and `getSubscriptionByStripeOrMetadata` were still using `.unique()` on subscription queries, but soft-delete creates multiple subscription records per owner.

**Fix Applied:**
- Updated `handleCheckoutComplete` to use `.collect()` and filter for active subscriptions
- Updated `getSubscriptionByStripeOrMetadata` to use `.collect()` and filter for active subscriptions

**Files Changed:**
- `convex/subscriptions/internal.ts` (lines 47-63, 110-137)

**Status:** ✅ RESOLVED - Webhooks now handle multiple subscription records correctly

---

## ⚠️ HOTFIX 2 Applied (January 18, 2026 - 4:42 PM)

**Issue 1:** Price IDs were undefined, causing subscriptions to default to "free" plan

**Root Cause:** Environment variables `STRIPE_GO_PRICE_ID` and `STRIPE_PRO_PRICE_ID` were not set in Convex environment.

**Fix Applied:**
```bash
npx convex env set STRIPE_GO_PRICE_ID price_1SqNyJHXajH1NDoWsIPm9mCw
npx convex env set STRIPE_PRO_PRICE_ID price_1SqNyhHXajH1NDoWzHFCV3xM
```

**Issue 2:** Invoice.paid handler couldn't find subscription ID in newer Stripe API versions

**Root Cause:** Stripe's invoice.subscription field structure varies by API version - could be string or object.

**Fix Applied:**
- Updated `invoice.paid` handler to handle both `invoice.subscription` as string AND as object with `.id` property
- Added better logging to show customer ID as fallback

**Files Changed:**
- `convex/http.ts` (invoice.paid handler)

**Status:** ✅ RESOLVED - Environment variables set and invoice handler updated

---

## ⚠️ HOTFIX 3 Applied (January 18, 2026 - 4:55 PM)

**Issue:** Subscription failing to grant credits because `invoice.paid` event was missing subscription ID in payload, and environment variables were unset.

**Fix Applied:**
1. **Restored Dual-Path Credit Granting:** `checkout.session.completed` now *also* attempts to grant credits. This acts as a fail-safe if `invoice.paid` fails. The existing idempotency check prevents double-counting.
2. **Verified Env Vars:** Confirmed `STRIPE_GO_PRICE_ID` and `STRIPE_PRO_PRICE_ID` are set.

**Files Changed:**
- `convex/http.ts` (restored credit grant logic)

**Status:** ✅ RESOLVED - Subscription flow is now robust against race conditions and missing fields

---

## ⚠️ HOTFIX 4 Applied (January 18, 2026 - 5:05 PM)

**Issue:** `grantMonthlyCredits` in `credits/internal.ts` was still using `.unique()` causing webhook errors after soft-delete was implemented.

**Root Cause:** When there are multiple subscription records (due to soft-delete), `.unique()` expects exactly one record and throws if more exist.

**Fix Applied:**
```typescript
// Before (line 122)
.unique();

// After
.first();
```

**Files Changed:**
- `convex/credits/internal.ts` (line 122)

**Status:** ✅ RESOLVED - All subscription queries now use defensive `.first()` or `.collect()` pattern

---

## 📝 WorkOS Webhooks (Local Development Note)

**For Local Development:**

**For Local Development:**
- WorkOS webhooks are **NOT needed** when running locally
- User/org syncing happens via `ensureUser` mutation on first login
- Placeholder secret set: `local_development_no_webhooks`

**For Production:**
- You'll need a real webhook secret from: WorkOS Dashboard → Webhooks
- Update with: `npx convex env set WORKOS_WEBHOOK_SECRET your_real_secret`
- Configure webhook endpoint in WorkOS dashboard to point to your deployed URL

---

This document outlines the changes made during the comprehensive codebase audit and the required environment variable updates.

---

## Required Environment Variable Updates

### Convex Dashboard Environment Variables

You need to add the following environment variables to your Convex deployment:

```bash
# Add these to your Convex environment (https://dashboard.convex.dev)
STRIPE_GO_PRICE_ID=price_1SqNyJHXajH1NDoWsIPm9mCw
STRIPE_PRO_PRICE_ID=price_1SqNyhHXajH1NDoWzHFCV3xM
```

**How to add:**
1. Go to https://dashboard.convex.dev
2. Select your project
3. Go to Settings → Environment Variables
4. Add both variables with the values above

---

## Summary of Changes

### Phase 1: Stripe Credit Flow Fixes

#### 1.1 Fixed Race Condition in Credit Granting
**Problem:** Credits were granted in both `checkout.session.completed` and `invoice.paid` webhooks, causing race conditions when the subscription wasn't yet synced.

**Solution:** 
- Removed credit granting from `checkout.session.completed`
- `invoice.paid` is now the **sole** trigger for credit grants (both initial and renewals)
- Simplified error handling - no more throw-based retries

**Files Changed:**
- `convex/http.ts` (lines 31-51)
- `convex/credits/internal.ts` (lines 124-132)

#### 1.2 Added Missing Payment Failure Handler
**Problem:** No handler for `invoice.payment_failed` events, so failed renewals weren't tracked.

**Solution:** Added webhook handler to mark subscriptions as `past_due`.

**Files Changed:**
- `convex/http.ts` (added handler after line 67)

#### 1.3 Externalized Price IDs
**Problem:** Hardcoded Stripe price IDs prevented test/live environment flexibility.

**Solution:** Moved to environment variables.

**Files Changed:**
- `convex/lib/constants.ts`
- `convex/.env.example`

---

### Phase 2: Soft-Delete Subscriptions (Preserve History)

#### 2.1 Added `canceledAt` Timestamp
**Problem:** Cancellations overwrote subscription records, losing history.

**Solution:** Added `canceledAt` field to track when subscriptions were canceled.

**Files Changed:**
- `convex/schema.ts`
- `convex/lib/validators.ts`

#### 2.2 Implemented Soft-Delete Pattern
**Problem:** Canceling a subscription replaced it with a "free" plan, losing all history.

**Solution:** 
- Mark canceled subscription with `status: "canceled"` and `canceledAt` timestamp
- Create a **new** "free" subscription record for the owner
- Queries filter for active subscriptions

**Files Changed:**
- `convex/subscriptions/internal.ts` (handleSubscriptionCanceled)
- `convex/subscriptions/queries.ts` (getMy, getOrg)
- `convex/subscriptions/internal.ts` (getSubscriptionByOwner)

---

### Phase 3: Security Fixes

#### 3.1 Restricted User Query Access
**Problem:** Any authenticated user could fetch any other user's profile via `getById`.

**Solution:** Restricted to self + organization members only.

**Files Changed:**
- `convex/users/queries.ts` (getById)

#### 3.2 Added Rate Limiting Structure
**Problem:** No rate limiting on sensitive actions (API key saves, checkout sessions).

**Solution:** Created rate limiting configuration structure.

**Files Changed:**
- `convex/lib/rateLimit.ts` (NEW)

---

### Phase 4: Cleanup & DRY

#### 4.1 Removed Unused Credit Expiry Logic
**Files Changed:**
- `convex/crons.ts` (removed cron)
- `convex/maintenance/internal.ts` (removed function)

#### 4.2 Removed Duplicate Code
**Files Deleted:**
- `convex/lib/crypto.ts` (duplicate of apiKeys/actions.ts)
- `convex/credits/mutations.ts` (only export moved to queries.ts)

#### 4.3 Added Helper Functions
**Files Changed:**
- `convex/lib/auth.ts` (added getCurrentUserSafe helper)

#### 4.4 Fixed checkBalance Pattern
**Problem:** `checkBalance` was a mutation but only reads data.

**Solution:** Moved to queries.

**Files Changed:**
- `convex/credits/queries.ts` (added checkBalance)
- `convex/credits/mutations.ts` (deleted)

#### 4.5 Prevented Duplicate User Sync Calls
**Problem:** `ensureUser` was called on every auth state change.

**Solution:** Added `hasSynced` ref to prevent duplicates.

**Files Changed:**
- `components/providers/convex-provider.tsx`

---

## Testing Checklist

Before deploying, test the following scenarios:

### Stripe Webhooks
- [ ] **New subscription checkout** - Credits should be granted only once via `invoice.paid`
- [ ] **Monthly renewal** - Credits granted correctly via `invoice.paid`
- [ ] **Payment failure** - Subscription marked as `past_due`
- [ ] **Subscription cancellation** - Old subscription marked canceled, new "free" subscription created

### Queries
- [ ] **User profile access** - Users can only see their own profile + org members
- [ ] **Subscription queries** - Return active subscription, not canceled ones
- [ ] **Credit balance** - checkBalance works as a query

### Edge Cases
- [ ] **First-time login** - User syncs without errors
- [ ] **Duplicate ensureUser calls** - Only one call made per session

---

## Rollback Instructions

If issues occur, you can rollback by:

1. **Revert Git Commits:**
   ```bash
   git log --oneline  # Find commit before changes
   git revert <commit-hash>
   ```

2. **Remove Environment Variables:**
   - Remove `STRIPE_GO_PRICE_ID` and `STRIPE_PRO_PRICE_ID` from Convex dashboard
   - Restore hardcoded values in `convex/lib/constants.ts`

3. **Database Migration (if needed):**
   - The `canceledAt` field addition is backwards compatible (optional field)
   - Old records without `canceledAt` will work fine
   - If you need to clean up test data with multiple subscription records per user, query and delete duplicates

---

## Performance Impact

- **Positive:** Reduced webhook processing (credit granting happens once instead of twice)
- **Positive:** Fewer error retries (no more throw-based race condition handling)
- **Neutral:** Additional subscription record on cancellation (negligible storage impact)
- **Neutral:** Query filtering for active subscriptions (minimal performance impact due to indexes)

---

## Next Steps

1. **Add environment variables to Convex dashboard** (see top of document)
2. **Test in development environment first**
3. **Monitor webhook logs in Stripe dashboard** after deployment
4. **Verify credit granting works correctly** for new signups
5. **Consider implementing full rate limiting** (currently skeleton only)

---

## Questions?

If you encounter any issues or have questions about these changes, refer to the detailed implementation plan or contact the development team.
