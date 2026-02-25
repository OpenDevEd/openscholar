import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTTP_FILE = "convex/http.ts";

const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "charge.refunded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.created",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
];

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

function getEventHandlerBlocks(source: string): Map<string, string> {
  const matches = Array.from(
    source.matchAll(/"([a-z_.]+)"\s*:\s*async\s*\(ctx,\s*event\)\s*=>\s*\{/g),
  );
  const blocks = new Map<string, string>();

  for (let index = 0; index < matches.length; index += 1) {
    const eventType = matches[index]?.[1];
    const start = matches[index]?.index ?? 0;
    const end = matches[index + 1]?.index ?? source.length;
    if (!eventType) continue;
    blocks.set(eventType, source.slice(start, end));
  }

  return blocks;
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

  it("includes top-up payment intent and refund handling", () => {
    const source = readSource(HTTP_FILE);
    expect(source).toMatch(/grantPurchasedCreditsFromPaymentIntent/);
    expect(source).toMatch(/reversePurchasedCreditsFromRefund/);
    expect(source).toMatch(/"payment_intent\.succeeded"/);
    expect(source).toMatch(/"charge\.refunded"/);
  });

  it("routes only invoice.paid through hydrated invoice processing action", () => {
    const source = readSource(HTTP_FILE);
    const handlerBlocks = getEventHandlerBlocks(source);
    const monthlyGrantTriggers = Array.from(handlerBlocks.entries())
      .filter(([, block]) => block.includes("processInvoiceForGrantNonBlocking"))
      .map(([eventType]) => eventType);

    expect(source).toMatch(/processInvoiceForGrantNonBlocking/);
    expect(source).toMatch(/internalApi\.credits\.actions\.processInvoiceForGrant/);
    expect(source).not.toMatch(/internalApi\.credits\.internal\.grantMonthlyCredits/);
    expect(monthlyGrantTriggers).toEqual(["invoice.paid"]);
  });
});
