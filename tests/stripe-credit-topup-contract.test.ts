import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_FILE = "convex/credits/actions.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("stripe credit topup checkout contract", () => {
  it("exposes createTopupCheckoutSession action", () => {
    const source = readSource(ACTIONS_FILE);
    expect(source).toMatch(/export const createTopupCheckoutSession = action/);
  });

  it("creates checkout session in payment mode with inline price_data", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/mode:\s*["']payment["']/);
    expect(source).toMatch(/line_items:\s*\[/);
    expect(source).toMatch(/price_data:\s*\{/);
    expect(source).toMatch(/unit_amount:\s*bundle\.amountCents/);
    expect(source).toMatch(/product:\s*creditsProductId/);
  });

  it("stamps top-up metadata on session and payment intent", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/billingType:\s*["']credit_topup["']/);
    expect(source).toMatch(/bundleKey:\s*bundle\.key/);
    expect(source).toMatch(/credits:\s*String\(bundle\.credits\)/);
    expect(source).toMatch(/payment_intent_data:\s*\{\s*metadata/s);
    expect(source).toMatch(/automatic_tax:\s*\{\s*enabled:\s*true/s);
    expect(source).toMatch(/customer_update:\s*\{\s*address:\s*["']auto["']/s);
  });
});
