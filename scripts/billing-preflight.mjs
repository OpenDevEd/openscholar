#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createClerkClient } from "@clerk/backend";
import Stripe from "stripe";
import fs from "node:fs";
import path from "node:path";
import { cleanupStaleBillingClerkUsers } from "./clerk-test-organization.mjs";

const execFileAsync = promisify(execFile);

function loadEnvironmentFromFiles() {
  const loadEnvFile = process.loadEnvFile;
  if (typeof loadEnvFile !== "function") {
    return;
  }

  for (const envFile of [".env.local", ".env"]) {
    const absolutePath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(absolutePath)) continue;
    loadEnvFile(absolutePath);
  }
}

const REQUIRED_WEBHOOK_EVENTS = [
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
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "charge.refunded",
];

const DEFAULT_CREDITS_PER_USD = 10_000;
const DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS = 50;
const DEFAULT_BILLING_TEST_TOPUP_CREDITS = 1_000;
const BILLING_TEST_ORGANIZATION_MEMBERSHIP_LIMIT = 20;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInteger(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function validateLiveTopupChargeConfig() {
  const creditsPerUsd = parsePositiveInteger(
    process.env.CREDITS_PER_USD,
    DEFAULT_CREDITS_PER_USD,
  );
  const minChargeCents = parsePositiveInteger(
    process.env.BILLING_TEST_MIN_CHARGE_CENTS,
    DEFAULT_BILLING_TEST_MIN_CHARGE_CENTS,
  );
  const requestedTopupCredits = parsePositiveInteger(
    process.env.BILLING_TEST_TOPUP_CREDITS,
    DEFAULT_BILLING_TEST_TOPUP_CREDITS,
  );
  const minimumCreditsForCharge = Math.ceil(
    (minChargeCents * creditsPerUsd) / 100,
  );
  const requestedAmountCents = Math.ceil(
    (requestedTopupCredits * 100) / creditsPerUsd,
  );
  const effectiveTopupCredits = Math.max(
    requestedTopupCredits,
    minimumCreditsForCharge,
  );
  const effectiveAmountCents = Math.ceil(
    (effectiveTopupCredits * 100) / creditsPerUsd,
  );

  if (
    process.env.BILLING_TEST_TOPUP_CREDITS &&
    requestedAmountCents < minChargeCents
  ) {
    throw new Error(
      `BILLING_TEST_TOPUP_CREDITS=${requestedTopupCredits} resolves to ${requestedAmountCents} cents, below BILLING_TEST_MIN_CHARGE_CENTS=${minChargeCents}.`,
    );
  }

  console.log(
    `[preflight] topup config: creditsPerUsd=${creditsPerUsd}, minChargeCents=${minChargeCents}, requestedTopupCredits=${requestedTopupCredits}, effectiveTopupCredits=${effectiveTopupCredits}, effectiveAmountCents=${effectiveAmountCents}`,
  );
}

function getConvexSiteUrl() {
  const explicitSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!explicitSiteUrl && !convexUrl) {
    throw new Error(
      "Missing NEXT_PUBLIC_CONVEX_SITE_URL or NEXT_PUBLIC_CONVEX_URL for billing preflight.",
    );
  }

  if (explicitSiteUrl) {
    return new URL(explicitSiteUrl).origin;
  }

  const parsed = new URL(convexUrl);
  let host = parsed.host;
  if (host.endsWith(".convex.cloud")) {
    host = host.replace(".convex.cloud", ".convex.site");
  }

  return `${parsed.protocol}//${host}`;
}

function normalizeUrl(value) {
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  return trimmed.toLowerCase();
}

async function runConvexReachabilityCheck({ shouldPush }) {
  const identity = {
    subject:
      process.env.BILLING_TEST_USER_SUBJECT ?? "billing_live_test_subject",
    email:
      process.env.BILLING_TEST_USER_EMAIL ?? "billing-live-test@example.com",
    givenName: process.env.BILLING_TEST_USER_FIRST_NAME ?? "Billing",
    familyName: process.env.BILLING_TEST_USER_LAST_NAME ?? "Live",
  };

  const args = [
    "convex",
    "run",
    "subscriptions/queries:getTier",
    "{}",
    "--identity",
    JSON.stringify(identity),
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ];

  if (shouldPush) {
    args.push("--push");
  }

  if (process.env.CONVEX_DEPLOYMENT_NAME) {
    args.push("--deployment-name", process.env.CONVEX_DEPLOYMENT_NAME);
  }

  const { stdout, stderr } = await execFileAsync("npx", args, {
    env: process.env,
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });

  if (stderr.trim().length > 0) {
    console.log(
      `[preflight] convex stderr: ${stderr.trim().split("\n").join(" | ")}`,
    );
  }

  const output = stdout.trim();
  if (output.length === 0) {
    throw new Error("Convex reachability check returned empty output.");
  }

  console.log(
    `[preflight] convex run reachable (subscriptions/queries:getTier => ${output})`,
  );
}

async function ensureClerkTestOrganizationCapacity() {
  const workerCount = parsePositiveInteger(process.env.PLAYWRIGHT_WORKERS, 1);
  const organizationId = requireEnv("E2E_CLERK_ORGANIZATION_ID");
  const clerkClient = createClerkClient({
    secretKey: requireEnv("CLERK_SECRET_KEY"),
  });
  const removedUserCount = await cleanupStaleBillingClerkUsers(
    clerkClient,
    organizationId,
  );
  if (removedUserCount > 0) {
    console.log(
      `[preflight] removed ${removedUserCount} abandoned billing test users`,
    );
  }
  const organization = await clerkClient.organizations.getOrganization({
    organizationId,
    includeMembersCount: true,
  });
  const memberCount = organization.membersCount ?? 0;
  let membershipLimit = organization.maxAllowedMemberships;

  if (
    membershipLimit !== 0 &&
    membershipLimit < BILLING_TEST_ORGANIZATION_MEMBERSHIP_LIMIT
  ) {
    await clerkClient.organizations.updateOrganization(organizationId, {
      maxAllowedMemberships: BILLING_TEST_ORGANIZATION_MEMBERSHIP_LIMIT,
    });
    membershipLimit = BILLING_TEST_ORGANIZATION_MEMBERSHIP_LIMIT;
  }

  if (membershipLimit !== 0 && memberCount + workerCount > membershipLimit) {
    throw new Error(
      `Clerk test organization ${organizationId} has ${memberCount} members and cannot reserve ${workerCount} disposable test memberships within its ${membershipLimit}-member limit.`,
    );
  }

  console.log(
    `[preflight] Clerk organization has room for ${workerCount} parallel billing workers`,
  );
}

async function verifyStripeWebhookEndpoint({ stripe, convexSiteUrl }) {
  const expectedUrl = `${convexSiteUrl}/webhooks/stripe`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });

  const endpoint = endpoints.data.find(
    (candidate) => normalizeUrl(candidate.url) === normalizeUrl(expectedUrl),
  );

  if (!endpoint) {
    throw new Error(
      `Stripe webhook endpoint not found for ${expectedUrl}. Configure this endpoint in Stripe sandbox.`,
    );
  }

  if (endpoint.status !== "enabled") {
    throw new Error(
      `Stripe webhook endpoint ${endpoint.id} is not enabled (status=${endpoint.status}).`,
    );
  }

  const enabled = new Set(endpoint.enabled_events);
  const missing = REQUIRED_WEBHOOK_EVENTS.filter(
    (eventType) => !enabled.has("*") && !enabled.has(eventType),
  );

  if (missing.length > 0) {
    throw new Error(
      `Stripe webhook endpoint ${endpoint.id} is missing required events: ${missing.join(", ")}`,
    );
  }

  console.log(
    `[preflight] stripe endpoint ${endpoint.id} configured for ${expectedUrl} with required events`,
  );
}

async function main() {
  loadEnvironmentFromFiles();

  const shouldPush = process.argv.includes("--push-convex");

  requireEnv("STRIPE_SECRET_KEY");
  requireEnv("STRIPE_GO_PRICE_ID");

  if (
    process.env.CI &&
    !process.env.CONVEX_DEPLOYMENT &&
    !process.env.CONVEX_DEPLOYMENT_NAME
  ) {
    throw new Error(
      "CI billing preflight requires CONVEX_DEPLOYMENT or CONVEX_DEPLOYMENT_NAME to target the shared dev deployment.",
    );
  }

  const convexSiteUrl = getConvexSiteUrl();
  console.log(`[preflight] convex site resolved to ${convexSiteUrl}`);

  validateLiveTopupChargeConfig();

  if (process.env.PLAYWRIGHT_WORKERS) {
    await ensureClerkTestOrganizationCapacity();
  }

  await runConvexReachabilityCheck({ shouldPush });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-01-28.clover",
  });

  await verifyStripeWebhookEndpoint({ stripe, convexSiteUrl });

  console.log("[preflight] billing live preflight checks passed");
}

main().catch((error) => {
  console.error(
    `[preflight] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
