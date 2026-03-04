import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  advanceTestClockAndWaitReady,
  appendBillingArtifactLog,
  appendStripeArtifactObject,
  countGrantTransactionsByInvoice,
  countPurchaseTransactionsByPaymentIntent,
  createClockedCustomer,
  createCreditTopupPaymentIntent,
  createGoSubscription,
  createStripeClient,
  ensureBillingTestUser,
  getBillingSnapshotForUser,
  listRefundTransactionsByPaymentIntent,
  listGrantTransactions,
  loadBillingLiveEnv,
  resetBillingArtifacts,
  resetBillingStateForUser,
  runConvexFunction,
  waitForCondition,
  waitForStripeInvoiceStatus,
  waitForSubscriptionInvoiceByBillingReason,
  writeBillingArtifactJson,
  cleanupStripeForTestUser,
  attachDefaultVisaPaymentMethod,
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

describe.sequential("live billing required regressions", () => {
  let userId: string;
  let identity: BillingIdentity;

  beforeAll(async () => {
    resetBillingArtifacts();
    appendBillingArtifactLog("Starting required live billing regression suite");

    const ensured = await ensureBillingTestUser({
      env,
      push: env.shouldPushConvexCode,
    });

    userId = ensured.userId;
    identity = ensured.identity;

    appendBillingArtifactLog(`Using billing test user ${userId}`);
  });

  beforeEach(async () => {
    appendBillingArtifactLog("Running pre-test Stripe cleanup for billing test user");
    await cleanupStripeForTestUser({
      stripe,
      testUserEmail: env.testUserEmail,
      subjectMarker: env.testUserSubject,
    });

    appendBillingArtifactLog("Resetting Convex billing state for test user");
    await resetBillingStateForUser(userId);
  });

  afterAll(async () => {
    appendBillingArtifactLog("Running final cleanup and snapshot capture");

    const finalSnapshot = await getBillingSnapshotForUser(userId);
    writeBillingArtifactJson("final-snapshot.json", finalSnapshot);

    await cleanupStripeForTestUser({
      stripe,
      testUserEmail: env.testUserEmail,
      subjectMarker: env.testUserSubject,
    });
    await resetBillingStateForUser(userId);
  });

  it("subscription happy path grants monthly credits exactly once", async () => {
    const { clockId, customerId } = await createClockedCustomer({
      stripe,
      testUserEmail: env.testUserEmail,
      userId,
      subjectMarker: env.testUserSubject,
    });
    appendStripeArtifactObject({ scenario: "subscription_happy_path", clockId, customerId });

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

    const snapshot = await waitForCondition({
      description: `subscription sync + invoice grant for ${subscriptionId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        const hasSubscription = current.subscriptions.some(
          (subscription) => subscription.stripeSubscriptionId === subscriptionId,
        );
        const grantCount = countGrantTransactionsByInvoice(current, invoiceId);

        if (hasSubscription && grantCount === 1) {
          return current;
        }
        return null;
      },
    });

    const mySubscription = await runConvexFunction<TestSubscription | null>({
      functionPath: "subscriptions/queries:getMy",
      payload: {},
      identity,
    });

    expect(mySubscription).toBeTruthy();
    expect(mySubscription.plan).toBe("go");
    expect(mySubscription.stripeSubscriptionId).toBe(subscriptionId);

    expect(countGrantTransactionsByInvoice(snapshot, invoiceId)).toBe(1);

    writeBillingArtifactJson("scenario-1-subscription-happy-path.json", {
      userId,
      customerId,
      subscriptionId,
      invoiceId,
      snapshot,
      mySubscription,
    });
  });

  it("subscription recurrence grants cycle credits at period boundary exactly once", async () => {
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

    const initialSnapshot = await waitForCondition({
      description: `initial subscription_create grant for ${invoiceId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countGrantTransactionsByInvoice(current, invoiceId) === 1 ? current : null;
      },
    });

    expect(listGrantTransactions(initialSnapshot)).toHaveLength(1);

    const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
    const periodEndSec = stripeSubscription.items.data[0]?.current_period_end;

    if (!periodEndSec) {
      throw new Error(`Unable to resolve current_period_end for ${subscriptionId}`);
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

    const renewalSnapshot = await waitForCondition({
      description: `single renewal grant for invoice ${renewalInvoice.id}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        const renewalGrantCount = countGrantTransactionsByInvoice(
          current,
          renewalInvoice.id,
        );
        const totalGrantCount = listGrantTransactions(current).length;
        if (renewalGrantCount === 1 && totalGrantCount === 2) {
          return current;
        }
        return null;
      },
    });

    expect(countGrantTransactionsByInvoice(renewalSnapshot, renewalInvoice.id)).toBe(1);
    expect(listGrantTransactions(renewalSnapshot)).toHaveLength(2);

    const replayResult = await runConvexFunction<{
      outcome: string;
      message: string;
      usedFallbackSubscription: boolean;
    }>({
      functionPath: "credits/actions:processInvoiceForGrant",
      payload: {
        stripeInvoiceId: renewalInvoice.id,
        stripeEventId: `invoice.replay.cycle:${renewalInvoice.id}`,
        stripeEventType: "invoice.paid",
        trigger: "billing_live_cycle_replay_test",
        retryCount: 0,
      },
    });

    expect(replayResult.outcome).toBe("already_granted");

    const finalSnapshot = await getBillingSnapshotForUser(userId);
    expect(countGrantTransactionsByInvoice(finalSnapshot, renewalInvoice.id)).toBe(1);

    writeBillingArtifactJson("scenario-1b-subscription-recurrence.json", {
      userId,
      customerId,
      clockId,
      subscriptionId,
      initialInvoiceId: invoiceId,
      renewalInvoiceId: renewalInvoice.id,
      renewalInvoiceBillingReason: renewalInvoice.billing_reason,
      replayResult,
      snapshot: finalSnapshot,
    });
  });

  it("invoice replay remains idempotent for monthly grant", async () => {
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

    await waitForCondition({
      description: `initial invoice grant for ${invoiceId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countGrantTransactionsByInvoice(current, invoiceId) === 1 ? current : null;
      },
    });

    const replayEventId = `invoice.replay.live:${invoiceId}`;

    const replayOne = await runConvexFunction<{
      outcome: string;
      message: string;
      usedFallbackSubscription: boolean;
    }>({
      functionPath: "credits/actions:processInvoiceForGrant",
      payload: {
        stripeInvoiceId: invoiceId,
        stripeEventId: replayEventId,
        stripeEventType: "invoice.paid",
        trigger: "billing_live_replay_test",
        retryCount: 0,
      },
    });

    const replayTwo = await runConvexFunction<{
      outcome: string;
      message: string;
      usedFallbackSubscription: boolean;
    }>({
      functionPath: "credits/actions:processInvoiceForGrant",
      payload: {
        stripeInvoiceId: invoiceId,
        stripeEventId: replayEventId,
        stripeEventType: "invoice.paid",
        trigger: "billing_live_replay_test",
        retryCount: 0,
      },
    });

    expect(replayOne.outcome).toBe("already_granted");
    expect(replayTwo.outcome).toBe("already_granted");

    const snapshot = await getBillingSnapshotForUser(userId);
    expect(countGrantTransactionsByInvoice(snapshot, invoiceId)).toBe(1);

    writeBillingArtifactJson("scenario-2-invoice-replay-idempotency.json", {
      userId,
      invoiceId,
      replayEventId,
      replayOne,
      replayTwo,
      snapshot,
    });
  });

  it("credit top-up grant remains idempotent by payment intent", async () => {
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

    const payment = await createCreditTopupPaymentIntent({
      stripe,
      customerId,
      userId,
      creditsPerUsd: env.creditsPerUsd,
      subjectMarker: env.testUserSubject,
      paymentMethodId,
      credits: env.testTopupCredits,
    });

    await waitForCondition({
      description: `purchase credit grant for payment intent ${payment.paymentIntentId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countPurchaseTransactionsByPaymentIntent(current, payment.paymentIntentId) === 1
          ? current
          : null;
      },
    });

    const duplicateResult = await runConvexFunction<{
      outcome: string;
      grantedCredits: number;
      userId?: string;
    }>({
      functionPath: "credits/internal:grantPurchasedCreditsFromPaymentIntent",
      payload: {
        stripePaymentIntentId: payment.paymentIntentId,
        stripeCustomerId: customerId,
        stripeChargeId: payment.chargeId,
        amountReceived: payment.amountCents,
        currency: "usd",
        metadata: {
          billingType: "credit_topup",
          userId,
          credits: String(payment.credits),
          amountCents: String(payment.amountCents),
          creditsPerUsd: String(env.creditsPerUsd),
          billingTestSubject: env.testUserSubject,
        },
      },
    });

    expect(duplicateResult.outcome).toBe("already_granted");
    expect(duplicateResult.grantedCredits).toBe(0);

    const snapshot = await getBillingSnapshotForUser(userId);
    expect(
      countPurchaseTransactionsByPaymentIntent(snapshot, payment.paymentIntentId),
    ).toBe(1);

    writeBillingArtifactJson("scenario-3-topup-idempotency.json", {
      userId,
      customerId,
      payment,
      duplicateResult,
      snapshot,
    });
  });

  it("refund reversals remain replay-safe and proportional", async () => {
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

    const payment = await createCreditTopupPaymentIntent({
      stripe,
      customerId,
      userId,
      creditsPerUsd: env.creditsPerUsd,
      subjectMarker: env.testUserSubject,
      paymentMethodId,
      credits: env.testTopupCredits,
    });

    await waitForCondition({
      description: `purchase grant before refunds for ${payment.paymentIntentId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        return countPurchaseTransactionsByPaymentIntent(current, payment.paymentIntentId) === 1
          ? current
          : null;
      },
    });

    const partialRefundAmount = Math.floor(payment.amountCents / 2);
    const remainingRefundAmount = payment.amountCents - partialRefundAmount;

    await stripe.refunds.create({
      charge: payment.chargeId,
      amount: partialRefundAmount,
    });

    await waitForCondition({
      description: `partial refund reversal for ${payment.paymentIntentId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        const refunds = listRefundTransactionsByPaymentIntent(current, payment.paymentIntentId);
        if (refunds.length < 1) return null;

        const reversed = refunds.reduce((sum, row) =>
          row.amount < 0 ? sum + Math.abs(row.amount) : sum,
        0);

        return reversed >= Math.floor(payment.credits / 2) ? current : null;
      },
    });

    await stripe.refunds.create({
      charge: payment.chargeId,
      amount: remainingRefundAmount,
    });

    await waitForCondition({
      description: `full refund reversal for ${payment.paymentIntentId}`,
      timeoutMs: env.webhookWaitTimeoutMs,
      check: async () => {
        const current = await getBillingSnapshotForUser(userId);
        const refunds = listRefundTransactionsByPaymentIntent(current, payment.paymentIntentId);
        const reversed = refunds.reduce(
          (sum, row) => (row.amount < 0 ? sum + Math.abs(row.amount) : sum),
          0,
        );
        return reversed >= payment.credits ? current : null;
      },
    });

    const replayResult = await runConvexFunction<{
      outcome: string;
      reversedCredits: number;
    }>({
      functionPath: "credits/internal:reversePurchasedCreditsFromRefund",
      payload: {
        stripeChargeId: payment.chargeId,
        stripePaymentIntentId: payment.paymentIntentId,
        amountRefunded: payment.amountCents,
        chargeAmount: payment.amountCents,
      },
    });

    expect(replayResult.outcome).toBe("already_reversed");
    expect(replayResult.reversedCredits).toBe(0);

    const snapshot = await getBillingSnapshotForUser(userId);
    const refunds = listRefundTransactionsByPaymentIntent(snapshot, payment.paymentIntentId);
    const reversed = refunds.reduce(
      (sum, row) => (row.amount < 0 ? sum + Math.abs(row.amount) : sum),
      0,
    );

    expect(reversed).toBe(payment.credits);

    writeBillingArtifactJson("scenario-4-refund-replay-safety.json", {
      userId,
      customerId,
      payment,
      replayResult,
      refunds,
      reversed,
      snapshot,
    });
  });
});
