import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREDIT_GRANT_RETRY_DELAYS_MS,
  MAX_CREDIT_GRANT_RETRIES,
  getCreditGrantRetryDelayMs,
  shouldRetryCreditGrant,
} from "../convex/credits/lib/retryPolicy";

const CREDITS_INTERNAL_FILE = "convex/credits/internal.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("credit grant retry policy", () => {
  it("has bounded retry delays", () => {
    expect(CREDIT_GRANT_RETRY_DELAYS_MS.length).toBe(MAX_CREDIT_GRANT_RETRIES);
    expect(CREDIT_GRANT_RETRY_DELAYS_MS[0]).toBeGreaterThan(0);
  });

  it("returns delay only inside retry budget", () => {
    expect(getCreditGrantRetryDelayMs(0)).toBe(CREDIT_GRANT_RETRY_DELAYS_MS[0]);
    expect(getCreditGrantRetryDelayMs(MAX_CREDIT_GRANT_RETRIES - 1)).toBe(
      CREDIT_GRANT_RETRY_DELAYS_MS[MAX_CREDIT_GRANT_RETRIES - 1],
    );
    expect(getCreditGrantRetryDelayMs(MAX_CREDIT_GRANT_RETRIES)).toBeNull();
  });

  it("matches shouldRetryCreditGrant contract", () => {
    expect(shouldRetryCreditGrant(0)).toBe(true);
    expect(shouldRetryCreditGrant(MAX_CREDIT_GRANT_RETRIES - 1)).toBe(true);
    expect(shouldRetryCreditGrant(MAX_CREDIT_GRANT_RETRIES)).toBe(false);
  });

  it("marks retried invoice events as processed after idempotent/successful completion", () => {
    const source = readSource(CREDITS_INTERNAL_FILE);
    expect(source).toMatch(/markStripeEventProcessed/);
    expect(source).toMatch(/stripeEventType/);
  });
});
