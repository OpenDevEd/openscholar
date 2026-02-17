import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTTP_FILE = "convex/http.ts";

const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_succeeded",
];

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("stripe webhook contract", () => {
  it("registers required subscription webhook events", () => {
    const source = readSource(HTTP_FILE);
    const matches = Array.from(
      source.matchAll(/"([a-z_.]+)"\s*:\s*async\s*\(ctx,\s*event\)/g),
    );
    const configuredEvents = new Set(matches.map((m) => m[1]));

    for (const event of REQUIRED_EVENTS) {
      expect(configuredEvents.has(event), `Missing webhook event ${event}`).toBe(
        true,
      );
    }
  });

  it("does not contain one-time payment checkout handling", () => {
    const source = readSource(HTTP_FILE);
    expect(source).not.toMatch(/session\.mode\s*===\s*["']payment["']/);
    expect(source).not.toMatch(/handleCreditPurchase/);
  });

  it("routes invoice events through hydrated invoice processing action", () => {
    const source = readSource(HTTP_FILE);

    expect(source).toMatch(/processInvoiceForGrantNonBlocking/);
    expect(source).toMatch(/internalApi\.credits\.actions\.processInvoiceForGrant/);
    expect(source).not.toMatch(/internalApi\.credits\.internal\.grantMonthlyCredits/);
  });
});
