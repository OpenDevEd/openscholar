import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PLAN_CONFIG } from "../../convex/lib/constants";
import {
  advanceTestClockAndWaitReady,
  appendBillingArtifactLog,
  createClockedCustomer,
  createGoSubscription,
  createStripeClient,
  ensureBillingTestUser,
  getBillingSnapshotForUser,
  loadBillingLiveEnv,
  resetBillingArtifacts,
  resetBillingStateForUser,
  runConvexFunction,
  waitForCondition,
  waitForStripeInvoiceStatus,
  waitForSubscriptionInvoiceByBillingReason,
  writeBillingArtifactJson,
  cleanupStripeForTestUser,
  attachDefaultFailingPaymentMethod,
  attachDefaultVisaPaymentMethod,
  countGrantTransactionsByInvoice,
  listInvoiceGrantTransactions,
  type BillingIdentity,
} from "./support";

/** Shape returned by subscriptions/queries:getMy in test assertions. */
interface TestSubscription {
  _id: string;
  plan: string;
  status: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  creditsPerMonth?: number;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
}

const env = loadBillingLiveEnv();
const stripe = createStripeClient(env);

describe.sequential("live billing extended regressions", () => {
  let userId: string;
  let identity: BillingIdentity;

  beforeAll(async () => {
    resetBillingArtifacts();

    const ensured = await ensureBillingTestUser({
      env,
      push: env.shouldPushConvexCode,
    });

    userId = ensured.userId;
    identity = ensured.identity;
  });

  beforeEach(async () => {
    await cleanupStripeForTestUser({
      stripe,
      testUserEmail: env.testUserEmail,
      subjectMarker: env.testUserSubject,
    });
    await resetBillingStateForUser(userId);
  });

  it("payment failure transitions subscription to a non-entitled state", async () => {
    const { customerId } = await createClockedCustomer({
      stripe,
      testUserEmail: env.testUserEmail,
      userId,
      subjectMarker: env.testUserSubject,
    });

    const failingPaymentMethodId = await attachDefaultFailingPaymentMethod({
      stripe,
      customerId,
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: env.stripeGoPriceId }],
      payment_behavior: "default_incomplete",
      metadata: {
        userId,
        billingTestSubject: env.testUserSubject,
      },
      default_payment_method: failingPaymentMethodId,
    });

    const synced = await waitForCondition({
      description: `non-entitled status for ${subscription.id}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await runConvexFunction<TestSubscription | null>({
          functionPath: "subscriptions/queries:getMy",
          payload: {},
          identity,
        });

        if (
          current &&
          current.stripeSubscriptionId === subscription.id &&
          (current.status === "past_due" ||
            current.status === "incomplete" ||
            current.status === "unpaid" ||
            current.status === "incomplete_expired")
        ) {
          return current;
        }

        return null;
      },
    });

    expect(
      ["past_due", "incomplete", "unpaid", "incomplete_expired"].includes(
        synced.status,
      ),
    ).toBe(true);

    if (synced.status !== "past_due") {
      appendBillingArtifactLog(
        `payment failure scenario resolved to ${synced.status} instead of past_due`,
      );
    }

    writeBillingArtifactJson("extended-payment-failure-past-due.json", {
      userId,
      customerId,
      stripeSubscriptionId: subscription.id,
      synced,
    });
  });

  it("upgrade applies immediately and next cycle grants upgraded credits once up to the free cap", async () => {
    if (!env.stripeProPriceId) {
      appendBillingArtifactLog(
        "Skipping upgrade cycle-credit test because STRIPE_PRO_PRICE_ID is not configured.",
      );
      return;
    }

    const { clockId, customerId } = await createClockedCustomer({
      stripe,
      testUserEmail: env.testUserEmail,
      userId,
      subjectMarker: env.testUserSubject,
    });

    const paymentMethodId = await attachDefaultVisaPaymentMethod({
      stripe,
      customerId,
    });

    const { subscriptionId, invoiceId } = await createGoSubscription({
      stripe,
      customerId,
      goPriceId: env.stripeGoPriceId,
      userId,
      subjectMarker: env.testUserSubject,
      defaultPaymentMethodId: paymentMethodId,
    });

    await waitForCondition({
      description: `initial grant for ${invoiceId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countGrantTransactionsByInvoice(current, invoiceId) === 1
          ? current
          : null;
      },
    });

    const upgraded = await runConvexFunction<{
      success: boolean;
      mode: "updated" | "scheduled";
      changeType:
        | "upgraded_immediately"
        | "downgrade_scheduled"
        | "pending_change_cleared"
        | "no_change";
      message: string;
      effectiveDate?: number;
    }>({
      functionPath: "subscriptions/actions:changePlan",
      payload: {
        targetPriceId: env.stripeProPriceId,
      },
      identity,
    });

    expect(upgraded.success).toBe(true);
    expect(upgraded.mode).toBe("updated");
    expect(upgraded.changeType).toBe("upgraded_immediately");

    await waitForCondition({
      description: `upgraded local subscription sync for ${subscriptionId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await runConvexFunction<TestSubscription | null>({
          functionPath: "subscriptions/queries:getMy",
          payload: {},
          identity,
        });
        if (
          current &&
          current.stripeSubscriptionId === subscriptionId &&
          current.plan === "pro"
        ) {
          return current;
        }
        return null;
      },
    });

    const beforeAdvanceSnapshot = await getBillingSnapshotForUser(userId);
    expect(listInvoiceGrantTransactions(beforeAdvanceSnapshot)).toHaveLength(1);
    const [beforeRenewalCredits] = beforeAdvanceSnapshot.credits;
    if (!beforeRenewalCredits) {
      throw new Error(`Missing credits row before renewal for ${userId}`);
    }

    const stripeSubscription =
      await stripe.subscriptions.retrieve(subscriptionId);
    const periodEndSec = stripeSubscription.items.data[0]?.current_period_end;
    if (!periodEndSec) {
      throw new Error(
        `Unable to resolve current_period_end for ${subscriptionId}`,
      );
    }

    await advanceTestClockAndWaitReady({
      stripe,
      clockId,
      frozenTimeSec: periodEndSec + 120,
      timeoutMs: env.webhookWaitTimeoutMs,
    });

    let renewalInvoice = await waitForSubscriptionInvoiceByBillingReason({
      stripe,
      subscriptionId,
      billingReason: "subscription_cycle",
      timeoutMs: env.webhookWaitTimeoutMs,
      excludeInvoiceIds: [invoiceId],
    });

    if (renewalInvoice.status !== "paid") {
      await advanceTestClockAndWaitReady({
        stripe,
        clockId,
        frozenTimeSec: renewalInvoice.created + 4_000,
        timeoutMs: env.webhookWaitTimeoutMs,
      });

      renewalInvoice = await waitForStripeInvoiceStatus({
        stripe,
        invoiceId: renewalInvoice.id,
        status: "paid",
        timeoutMs: env.webhookWaitTimeoutMs,
      });
    }

    const postRenewalSnapshot = await waitForCondition({
      description: `single renewal grant after upgrade for ${renewalInvoice.id}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        const renewalGrantCount = countGrantTransactionsByInvoice(
          current,
          renewalInvoice.id,
        );
        const totalGrantCount = listInvoiceGrantTransactions(current).length;
        if (renewalGrantCount === 1 && totalGrantCount === 2) {
          return current;
        }
        return null;
      },
    });

    const renewalGrant = postRenewalSnapshot.creditTransactions.find(
      (transaction) =>
        transaction.type === "grant" &&
        transaction.stripeInvoiceId === renewalInvoice.id,
    );

    const syncedSubscription = postRenewalSnapshot.subscriptions.find(
      (subscription) => subscription.stripeSubscriptionId === subscriptionId,
    );
    const expectedRenewalCredits = syncedSubscription?.creditsPerMonth ?? null;
    expect(expectedRenewalCredits).not.toBeNull();
    const remainingFreeCreditCap = Math.max(
      0,
      PLAN_CONFIG.pro.freeCreditCap - beforeRenewalCredits.free,
    );
    const expectedCappedRenewalGrant = Math.min(
      expectedRenewalCredits ?? 0,
      remainingFreeCreditCap,
    );
    expect(renewalGrant?.amount).toBe(expectedCappedRenewalGrant);
    expect(postRenewalSnapshot.credits).toHaveLength(1);
    expect(postRenewalSnapshot.credits[0]?.free).toBe(
      PLAN_CONFIG.pro.freeCreditCap,
    );

    const invoices = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: 30,
    });
    const updateInvoices = invoices.data.filter(
      (invoice) => invoice.billing_reason === "subscription_update",
    );
    for (const updateInvoice of updateInvoices) {
      expect(
        countGrantTransactionsByInvoice(postRenewalSnapshot, updateInvoice.id),
      ).toBe(0);
    }

    writeBillingArtifactJson("extended-upgrade-cycle-credit.json", {
      userId,
      customerId,
      clockId,
      subscriptionId,
      initialInvoiceId: invoiceId,
      upgraded,
      renewalInvoiceId: renewalInvoice.id,
      renewalInvoiceBillingReason: renewalInvoice.billing_reason,
      updateInvoiceIds: updateInvoices.map((invoice) => invoice.id),
      renewalGrant,
      snapshot: postRenewalSnapshot,
    });
  });

  it("scheduled downgrade applies at period boundary using test clock", async () => {
    if (!env.stripeProPriceId) {
      appendBillingArtifactLog(
        "Skipping downgrade boundary test because STRIPE_PRO_PRICE_ID is not configured.",
      );
      return;
    }

    const { clockId, customerId } = await createClockedCustomer({
      stripe,
      testUserEmail: env.testUserEmail,
      userId,
      subjectMarker: env.testUserSubject,
    });

    const paymentMethodId = await attachDefaultVisaPaymentMethod({
      stripe,
      customerId,
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: env.stripeProPriceId }],
      payment_behavior: "error_if_incomplete",
      metadata: {
        userId,
        billingTestSubject: env.testUserSubject,
      },
      default_payment_method: paymentMethodId,
    });

    await waitForCondition({
      description: `pro subscription sync for ${subscription.id}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await runConvexFunction<TestSubscription | null>({
          functionPath: "subscriptions/queries:getMy",
          payload: {},
          identity,
        });

        if (
          current &&
          current.stripeSubscriptionId === subscription.id &&
          current.plan === "pro"
        ) {
          return current;
        }

        return null;
      },
    });

    const scheduled = await runConvexFunction<{
      success: boolean;
      mode: "updated" | "scheduled";
      changeType:
        | "upgraded_immediately"
        | "downgrade_scheduled"
        | "pending_change_cleared"
        | "no_change";
      message: string;
      effectiveDate?: number;
    }>({
      functionPath: "subscriptions/actions:changePlan",
      payload: {
        targetPriceId: env.stripeGoPriceId,
      },
      identity,
    });

    expect(scheduled.success).toBe(true);
    expect(scheduled.changeType).toBe("downgrade_scheduled");
    expect(scheduled.mode).toBe("scheduled");
    expect(typeof scheduled.effectiveDate).toBe("number");

    const stillProBeforeBoundary =
      await runConvexFunction<TestSubscription | null>({
        functionPath: "subscriptions/queries:getMy",
        payload: {},
        identity,
      });
    expect(stillProBeforeBoundary?.plan).toBe("pro");

    const effectiveDateSec = Math.floor((scheduled.effectiveDate ?? 0) / 1000);
    await advanceTestClockAndWaitReady({
      stripe,
      clockId,
      frozenTimeSec: effectiveDateSec + 120,
      timeoutMs: env.webhookWaitTimeoutMs,
    });

    const downgraded = await waitForCondition({
      description: `downgraded plan sync for subscription ${subscription.id}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await runConvexFunction<TestSubscription | null>({
          functionPath: "subscriptions/queries:getMy",
          payload: {},
          identity,
        });

        if (
          current &&
          current.stripeSubscriptionId === subscription.id &&
          current.plan === "go"
        ) {
          return current;
        }

        return null;
      },
    });

    expect(downgraded.plan).toBe("go");

    writeBillingArtifactJson("extended-downgrade-boundary.json", {
      userId,
      customerId,
      clockId,
      stripeSubscriptionId: subscription.id,
      scheduled,
      downgraded,
    });
  });

  it("out-of-order/retry stress path preserves single grant per invoice", async () => {
    const { customerId } = await createClockedCustomer({
      stripe,
      testUserEmail: env.testUserEmail,
      userId,
      subjectMarker: env.testUserSubject,
    });

    const paymentMethodId = await attachDefaultVisaPaymentMethod({
      stripe,
      customerId,
    });

    const { invoiceId } = await createGoSubscription({
      stripe,
      customerId,
      goPriceId: env.stripeGoPriceId,
      userId,
      subjectMarker: env.testUserSubject,
      defaultPaymentMethodId: paymentMethodId,
    });

    // Race-like replay path: invoke processing manually before/around webhook delivery.
    await runConvexFunction({
      functionPath: "credits/actions:processInvoiceForGrant",
      payload: {
        stripeInvoiceId: invoiceId,
        stripeEventId: `invoice.stress.manual.1:${invoiceId}`,
        stripeEventType: "invoice.paid",
        trigger: "billing_live_out_of_order_stress",
        retryCount: 0,
      },
    });

    await runConvexFunction({
      functionPath: "credits/actions:processInvoiceForGrant",
      payload: {
        stripeInvoiceId: invoiceId,
        stripeEventId: `invoice.stress.manual.2:${invoiceId}`,
        stripeEventType: "invoice.paid",
        trigger: "billing_live_out_of_order_stress",
        retryCount: 0,
      },
    });

    const snapshot = await waitForCondition({
      description: `single grant settlement for invoice ${invoiceId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countGrantTransactionsByInvoice(current, invoiceId) === 1
          ? current
          : null;
      },
    });

    expect(countGrantTransactionsByInvoice(snapshot, invoiceId)).toBe(1);

    writeBillingArtifactJson("extended-out-of-order-stress.json", {
      userId,
      customerId,
      invoiceId,
      snapshot,
    });
  });
});
