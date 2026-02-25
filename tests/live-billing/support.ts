import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { DEFAULT_CREDITS_PER_USD } from "../../convex/lib/creditTopups";

const execFileAsync = promisify(execFile);

function loadEnvironmentFromFiles(): void {
  const loadEnvFile = (process as typeof process & {
    loadEnvFile?: (file?: string) => void;
  }).loadEnvFile;

  if (typeof loadEnvFile !== "function") {
    return;
  }

  for (const envFile of [".env.local", ".env"]) {
    const absolutePath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(absolutePath)) continue;
    loadEnvFile(absolutePath);
  }
}

loadEnvironmentFromFiles();

export const BILLING_REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.created",
  "customer.updated",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
  "charge.refunded",
] as const;

export type BillingLiveEnv = {
  stripeSecretKey: string;
  stripeGoPriceId: string;
  stripeProPriceId?: string;
  creditsPerUsd: number;
  billingTestMinChargeCents: number;
  testTopupCredits: number;
  convexSiteUrl: string;
  testUserSubject: string;
  testUserEmail: string;
  testUserFirstName: string;
  testUserLastName: string;
  webhookWaitTimeoutMs: number;
  shouldPushConvexCode: boolean;
};

export type BillingIdentity = {
  subject: string;
  email: string;
  givenName: string;
  familyName: string;
};

export type BillingSnapshot = {
  user: {
    _id: string;
    clerkId: string;
    email: string;
    state: string;
  } | null;
  objectIds: {
    stripeCustomerIds: string[];
    stripeSubscriptionIds: string[];
    stripeInvoiceIds: string[];
    stripePaymentIntentIds: string[];
    stripeChargeIds: string[];
  };
  credits: Array<{
    _id: string;
    freeBalance: number;
    paidBalance: number;
    lifetimeUsed: number;
    lastUpdatedAt: number;
  }>;
  subscriptions: Array<{
    _id: string;
    plan: string;
    status: string;
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    creditsPerMonth?: number;
    currentPeriodStart?: number;
    currentPeriodEnd?: number;
    updatedAt: number;
  }>;
  billingCustomers: Array<{
    _id: string;
    stripeCustomerId: string;
    linkedFrom: string;
    updatedAt: number;
  }>;
  creditTransactions: Array<{
    _id: string;
    type: string;
    creditType: string;
    amount: number;
    balanceAfter: number;
    description?: string;
    stripeInvoiceId?: string;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
    metadata?: Record<string, string>;
    createdAt: number;
  }>;
  stripeEventLogs: Array<{
    _id: string;
    stripeEventId: string;
    eventType: string;
    stripeObjectId?: string;
    status: string;
    classification?: string;
    attemptCount: number;
    lastError?: string;
    nextRetryAt?: number;
    updatedAt: number;
  }>;
};

export function getConvexSiteUrlFromEnv(): string {
  const explicitSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!explicitSiteUrl && !convexUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL for billing live tests.",
    );
  }

  if (explicitSiteUrl) {
    return new URL(explicitSiteUrl).origin;
  }

  const url = new URL(convexUrl!);
  let host = url.host;

  if (host.endsWith(".convex.cloud")) {
    host = host.replace(".convex.cloud", ".convex.site");
  }

  return `${url.protocol}//${host}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS = 50;
const DEFAULT_BILLING_TEST_TOPUP_CREDITS = 1_000;

function calculateMinimumCreditsForCharge(args: {
  creditsPerUsd: number;
  minChargeCents: number;
}): number {
  return Math.ceil((args.minChargeCents * args.creditsPerUsd) / 100);
}

export function loadBillingLiveEnv(): BillingLiveEnv {
  const creditsPerUsd = parsePositiveInt(
    process.env.CREDITS_PER_USD,
    DEFAULT_CREDITS_PER_USD,
  );
  const billingTestMinChargeCents = parsePositiveInt(
    process.env.BILLING_TEST_MIN_CHARGE_CENTS,
    DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS,
  );
  const requestedTopupCredits = parsePositiveInt(
    process.env.BILLING_TEST_TOPUP_CREDITS,
    DEFAULT_BILLING_TEST_TOPUP_CREDITS,
  );
  const minimumTopupCredits = calculateMinimumCreditsForCharge({
    creditsPerUsd,
    minChargeCents: billingTestMinChargeCents,
  });
  const testTopupCredits = Math.max(requestedTopupCredits, minimumTopupCredits);

  return {
    stripeSecretKey: requireEnv("STRIPE_SECRET_KEY"),
    stripeGoPriceId: requireEnv("STRIPE_GO_PRICE_ID"),
    stripeProPriceId: process.env.STRIPE_PRO_PRICE_ID,
    creditsPerUsd,
    billingTestMinChargeCents,
    testTopupCredits,
    convexSiteUrl: getConvexSiteUrlFromEnv(),
    testUserSubject:
      process.env.BILLING_TEST_USER_SUBJECT ?? "billing_live_test_subject",
    testUserEmail:
      process.env.BILLING_TEST_USER_EMAIL ?? "billing-live-test@example.com",
    testUserFirstName:
      process.env.BILLING_TEST_USER_FIRST_NAME ?? "Billing",
    testUserLastName:
      process.env.BILLING_TEST_USER_LAST_NAME ?? "Live",
    webhookWaitTimeoutMs: parsePositiveInt(
      process.env.BILLING_LIVE_WEBHOOK_TIMEOUT_MS,
      180_000,
    ),
    shouldPushConvexCode: process.env.BILLING_LIVE_PUSH_CONVEX === "true",
  };
}

export function buildBillingIdentity(env: BillingLiveEnv): BillingIdentity {
  return {
    subject: env.testUserSubject,
    email: env.testUserEmail,
    givenName: env.testUserFirstName,
    familyName: env.testUserLastName,
  };
}

export function createStripeClient(env: BillingLiveEnv): Stripe {
  return new Stripe(env.stripeSecretKey, {
    apiVersion: "2026-01-28.clover",
  });
}

function parseConvexStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const attempts = [trimmed, trimmed.split("\n").at(-1)?.trim() ?? ""];

  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      // Continue trying fallbacks.
    }

    if (/^-?\d+(?:\.\d+)?$/.test(attempt)) {
      return Number(attempt);
    }
    if (attempt === "true") return true;
    if (attempt === "false") return false;
    if (attempt === "null") return null;
  }

  return trimmed;
}

export async function runConvexFunction<T>(args: {
  functionPath: string;
  payload?: Record<string, unknown>;
  identity?: BillingIdentity;
  push?: boolean;
  timeoutMs?: number;
}): Promise<T> {
  const cliArgs = [
    "convex",
    "run",
    args.functionPath,
    JSON.stringify(args.payload ?? {}),
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ];

  if (args.identity) {
    cliArgs.push("--identity", JSON.stringify(args.identity));
  }

  if (args.push) {
    cliArgs.push("--push");
  }

  if (process.env.CONVEX_DEPLOYMENT_NAME) {
    cliArgs.push("--deployment-name", process.env.CONVEX_DEPLOYMENT_NAME);
  }

  try {
    const { stdout, stderr } = await execFileAsync("npx", cliArgs, {
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
      timeout: args.timeoutMs ?? 120_000,
    });

    if (stderr.trim().length > 0) {
      // Keep stderr available in CI artifacts, but do not fail just for warnings.
      appendBillingArtifactLog(
        `[convex stderr] ${stderr.trim().split("\n").join(" | ")}`,
      );
    }

    return parseConvexStdout(stdout) as T;
  } catch (error) {
    const details =
      error instanceof Error ? error.message : `Unknown convex CLI error: ${String(error)}`;
    throw new Error(
      `Failed to run convex function ${args.functionPath}: ${details}`,
    );
  }
}

export async function waitForCondition<T>(args: {
  description: string;
  timeoutMs: number;
  intervalMs?: number;
  check: () => Promise<T | null | undefined>;
}): Promise<T> {
  const startedAt = Date.now();
  const intervalMs = args.intervalMs ?? 2_500;
  let lastError: string | null = null;

  while (Date.now() - startedAt <= args.timeoutMs) {
    try {
      const value = await args.check();
      if (value !== null && value !== undefined) {
        return value;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const suffix = lastError ? ` Last observed error: ${lastError}` : "";
  throw new Error(
    `Timed out waiting for ${args.description} after ${args.timeoutMs}ms.${suffix}`,
  );
}

export async function waitForTestClockReady(args: {
  stripe: Stripe;
  clockId: string;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<Stripe.TestHelpers.TestClock> {
  return await waitForCondition({
    description: `test clock ${args.clockId} to become ready`,
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
    check: async () => {
      const clock = await args.stripe.testHelpers.testClocks.retrieve(args.clockId);
      return clock.status === "ready" ? clock : null;
    },
  });
}

export async function advanceTestClockAndWaitReady(args: {
  stripe: Stripe;
  clockId: string;
  frozenTimeSec: number;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<Stripe.TestHelpers.TestClock> {
  await args.stripe.testHelpers.testClocks.advance(args.clockId, {
    frozen_time: args.frozenTimeSec,
  });

  return await waitForTestClockReady({
    stripe: args.stripe,
    clockId: args.clockId,
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
  });
}

export async function waitForSubscriptionInvoiceByBillingReason(args: {
  stripe: Stripe;
  subscriptionId: string;
  billingReason: string;
  timeoutMs: number;
  excludeInvoiceIds?: string[];
  requirePaid?: boolean;
}): Promise<Stripe.Invoice> {
  const excludedInvoiceIds = new Set(args.excludeInvoiceIds ?? []);

  return await waitForCondition({
    description: `invoice for ${args.subscriptionId} with billing_reason=${args.billingReason}`,
    timeoutMs: args.timeoutMs,
    check: async () => {
      const invoices = await args.stripe.invoices.list({
        subscription: args.subscriptionId,
        limit: 30,
      });

      for (const invoice of invoices.data) {
        if (excludedInvoiceIds.has(invoice.id)) continue;
        if (invoice.billing_reason !== args.billingReason) continue;
        if (args.requirePaid && invoice.status !== "paid") continue;
        return invoice;
      }

      return null;
    },
  });
}

export async function waitForStripeInvoiceStatus(args: {
  stripe: Stripe;
  invoiceId: string;
  status: string;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<Stripe.Invoice> {
  return await waitForCondition({
    description: `invoice ${args.invoiceId} status=${args.status}`,
    timeoutMs: args.timeoutMs,
    intervalMs: args.intervalMs,
    check: async () => {
      const invoice = await args.stripe.invoices.retrieve(args.invoiceId);
      return invoice.status === args.status ? invoice : null;
    },
  });
}

const BILLING_ARTIFACT_DIR = path.resolve(
  process.cwd(),
  "test-results",
  "billing-live",
);
const BILLING_LOG_PATH = path.join(BILLING_ARTIFACT_DIR, "live.log");
const BILLING_OBJECTS_PATH = path.join(BILLING_ARTIFACT_DIR, "stripe-objects.json");

function ensureBillingArtifactDir(): void {
  fs.mkdirSync(BILLING_ARTIFACT_DIR, { recursive: true });
}

export function resetBillingArtifacts(): void {
  ensureBillingArtifactDir();
  fs.writeFileSync(BILLING_LOG_PATH, "", "utf8");
  fs.writeFileSync(BILLING_OBJECTS_PATH, "[]\n", "utf8");
}

export function appendBillingArtifactLog(message: string): void {
  ensureBillingArtifactDir();
  if (!fs.existsSync(BILLING_LOG_PATH)) {
    fs.writeFileSync(BILLING_LOG_PATH, "", "utf8");
  }
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(BILLING_LOG_PATH, line, "utf8");
}

export function appendStripeArtifactObject(value: Record<string, unknown>): void {
  ensureBillingArtifactDir();
  if (!fs.existsSync(BILLING_OBJECTS_PATH)) {
    fs.writeFileSync(BILLING_OBJECTS_PATH, "[]\n", "utf8");
  }
  const raw = fs.readFileSync(BILLING_OBJECTS_PATH, "utf8").trim();
  const current = raw.length > 0 ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
  current.push(value);
  fs.writeFileSync(BILLING_OBJECTS_PATH, JSON.stringify(current, null, 2), "utf8");
}

export function writeBillingArtifactJson(fileName: string, value: unknown): void {
  ensureBillingArtifactDir();
  const targetPath = path.join(BILLING_ARTIFACT_DIR, fileName);
  fs.writeFileSync(targetPath, JSON.stringify(value, null, 2), "utf8");
}

export async function ensureBillingTestUser(args: {
  env: BillingLiveEnv;
  push?: boolean;
}): Promise<{ userId: string; identity: BillingIdentity }> {
  const identity = buildBillingIdentity(args.env);

  const userId = await runConvexFunction<string>({
    functionPath: "users/mutations:ensureUser",
    payload: {},
    identity,
    push: args.push,
  });

  if (!userId || typeof userId !== "string") {
    throw new Error("Failed to ensure billing test user in Convex.");
  }

  return { userId, identity };
}

export async function getBillingSnapshotForUser(userId: string): Promise<BillingSnapshot> {
  return await runConvexFunction<BillingSnapshot>({
    functionPath: "testing/billing:getBillingSnapshotForUser",
    payload: { userId },
  });
}

export async function resetBillingStateForUser(userId: string): Promise<{
  creditsDeleted: number;
  creditTransactionsDeleted: number;
  subscriptionsDeleted: number;
  billingCustomersDeleted: number;
  stripeEventLogsDeleted: number;
  stripeObjectIdsSeen: number;
}> {
  return await runConvexFunction({
    functionPath: "testing/billing:resetBillingStateForUser",
    payload: { userId },
  });
}

export async function cleanupStripeForTestUser(args: {
  stripe: Stripe;
  testUserEmail: string;
  subjectMarker: string;
}): Promise<void> {
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const customers = await args.stripe.customers.list({
      email: args.testUserEmail,
      limit: 100,
      starting_after: startingAfter,
    });

    for (const customer of customers.data) {
      if (customer.deleted) continue;
      const marker = customer.metadata?.billingTestSubject;
      if (marker && marker !== args.subjectMarker) {
        continue;
      }

      const testClockId =
        typeof customer.test_clock === "string"
          ? customer.test_clock
          : customer.test_clock?.id;

      appendStripeArtifactObject({
        phase: "cleanup",
        customerId: customer.id,
        testClockId,
      });

      const subscriptions = await args.stripe.subscriptions.list({
        customer: customer.id,
        status: "all",
        limit: 100,
      });

      for (const subscription of subscriptions.data) {
        if (subscription.status !== "canceled") {
          try {
            await args.stripe.subscriptions.cancel(subscription.id);
          } catch (error) {
            appendBillingArtifactLog(
              `subscription cancel skipped id=${subscription.id} error=${String(error)}`,
            );
          }
        }
      }

      try {
        await args.stripe.customers.del(customer.id);
      } catch (error) {
        appendBillingArtifactLog(
          `customer delete skipped id=${customer.id} error=${String(error)}`,
        );
      }

      if (testClockId) {
        try {
          await args.stripe.testHelpers.testClocks.del(testClockId);
        } catch (error) {
          appendBillingArtifactLog(
            `test clock delete skipped id=${testClockId} error=${String(error)}`,
          );
        }
      }
    }

    hasMore = customers.has_more;
    startingAfter = customers.data.at(-1)?.id;
  }
}

export async function createClockedCustomer(args: {
  stripe: Stripe;
  testUserEmail: string;
  userId: string;
  subjectMarker: string;
}): Promise<{
  clockId: string;
  customerId: string;
}> {
  const nowSec = Math.floor(Date.now() / 1000);
  const clock = await args.stripe.testHelpers.testClocks.create({
    frozen_time: nowSec,
    name: `billing-live-${Date.now()}`,
  });

  const customer = await args.stripe.customers.create({
    email: args.testUserEmail,
    test_clock: clock.id,
    metadata: {
      userId: args.userId,
      billingTestSubject: args.subjectMarker,
    },
  });

  appendStripeArtifactObject({
    phase: "create",
    objectType: "test_clock",
    id: clock.id,
  });
  appendStripeArtifactObject({
    phase: "create",
    objectType: "customer",
    id: customer.id,
    userId: args.userId,
  });

  return {
    clockId: clock.id,
    customerId: customer.id,
  };
}

async function attachDefaultCardPaymentMethod(args: {
  stripe: Stripe;
  customerId: string;
  cardToken: string;
}): Promise<string> {
  const paymentMethod = await args.stripe.paymentMethods.create({
    type: "card",
    card: {
      token: args.cardToken,
    },
  });

  await args.stripe.paymentMethods.attach(paymentMethod.id, {
    customer: args.customerId,
  });

  await args.stripe.customers.update(args.customerId, {
    invoice_settings: {
      default_payment_method: paymentMethod.id,
    },
  });

  return paymentMethod.id;
}

export async function attachDefaultVisaPaymentMethod(args: {
  stripe: Stripe;
  customerId: string;
}): Promise<string> {
  return await attachDefaultCardPaymentMethod({
    stripe: args.stripe,
    customerId: args.customerId,
    cardToken: "tok_visa",
  });
}

export async function attachDefaultFailingPaymentMethod(args: {
  stripe: Stripe;
  customerId: string;
}): Promise<string> {
  return await attachDefaultCardPaymentMethod({
    stripe: args.stripe,
    customerId: args.customerId,
    cardToken: "tok_chargeCustomerFail",
  });
}

export async function createGoSubscription(args: {
  stripe: Stripe;
  customerId: string;
  goPriceId: string;
  userId: string;
  subjectMarker: string;
  defaultPaymentMethodId?: string;
}): Promise<{
  subscriptionId: string;
  invoiceId: string;
}> {
  const subscription = await args.stripe.subscriptions.create({
    customer: args.customerId,
    items: [{ price: args.goPriceId }],
    payment_behavior: "error_if_incomplete",
    metadata: {
      userId: args.userId,
      billingTestSubject: args.subjectMarker,
    },
    default_payment_method: args.defaultPaymentMethodId,
    expand: ["latest_invoice.payment_intent"],
  });

  const invoiceId =
    typeof subscription.latest_invoice === "string"
      ? subscription.latest_invoice
      : subscription.latest_invoice?.id;

  if (!invoiceId) {
    throw new Error(
      `Stripe subscription ${subscription.id} did not include a latest invoice id.`,
    );
  }

  appendStripeArtifactObject({
    phase: "create",
    objectType: "subscription",
    id: subscription.id,
    invoiceId,
  });

  return {
    subscriptionId: subscription.id,
    invoiceId,
  };
}

export async function createCreditTopupPaymentIntent(args: {
  stripe: Stripe;
  customerId: string;
  userId: string;
  creditsPerUsd: number;
  subjectMarker: string;
  paymentMethodId: string;
  credits?: number;
}): Promise<{
  paymentIntentId: string;
  chargeId: string;
  amountCents: number;
  credits: number;
}> {
  const requestedCredits = args.credits ?? DEFAULT_BILLING_TEST_TOPUP_CREDITS;
  const minChargeCents = parsePositiveInt(
    process.env.BILLING_TEST_MIN_CHARGE_CENTS,
    DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS,
  );
  const minimumTopupCredits = calculateMinimumCreditsForCharge({
    creditsPerUsd: args.creditsPerUsd,
    minChargeCents,
  });
  const credits = Math.max(requestedCredits, minimumTopupCredits);
  const amountCents = Math.ceil((credits * 100) / args.creditsPerUsd);

  if (credits !== requestedCredits) {
    appendBillingArtifactLog(
      `[billing topup] requested ${requestedCredits} credits resolves below ${minChargeCents} cents; adjusted to ${credits} credits (${amountCents} cents).`,
    );
  }

  const paymentIntent = await args.stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    customer: args.customerId,
    payment_method: args.paymentMethodId,
    confirm: true,
    off_session: true,
    metadata: {
      billingType: "credit_topup",
      userId: args.userId,
      credits: String(credits),
      requestedCredits: String(requestedCredits),
      amountCents: String(amountCents),
      creditsPerUsd: String(args.creditsPerUsd),
      billingTestSubject: args.subjectMarker,
    },
  });

  const chargeId =
    typeof paymentIntent.latest_charge === "string"
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id;

  if (!chargeId) {
    throw new Error(
      `Stripe payment intent ${paymentIntent.id} did not include a latest charge id.`,
    );
  }

  appendStripeArtifactObject({
    phase: "create",
    objectType: "payment_intent",
    id: paymentIntent.id,
    chargeId,
    amountCents,
  });

  return {
    paymentIntentId: paymentIntent.id,
    chargeId,
    amountCents,
    credits,
  };
}

export function countGrantTransactionsByInvoice(
  snapshot: BillingSnapshot,
  stripeInvoiceId: string,
): number {
  return snapshot.creditTransactions.filter(
    (transaction) =>
      transaction.type === "grant" && transaction.stripeInvoiceId === stripeInvoiceId,
  ).length;
}

export function listGrantTransactions(
  snapshot: BillingSnapshot,
): BillingSnapshot["creditTransactions"] {
  return snapshot.creditTransactions.filter(
    (transaction) => transaction.type === "grant",
  );
}

export function countPurchaseTransactionsByPaymentIntent(
  snapshot: BillingSnapshot,
  stripePaymentIntentId: string,
): number {
  return snapshot.creditTransactions.filter(
    (transaction) =>
      transaction.type === "purchase" &&
      transaction.stripePaymentIntentId === stripePaymentIntentId,
  ).length;
}

export function listRefundTransactionsByPaymentIntent(
  snapshot: BillingSnapshot,
  stripePaymentIntentId: string,
): BillingSnapshot["creditTransactions"] {
  return snapshot.creditTransactions.filter(
    (transaction) =>
      transaction.type === "refund" &&
      transaction.stripePaymentIntentId === stripePaymentIntentId,
  );
}
