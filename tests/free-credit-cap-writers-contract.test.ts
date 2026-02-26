import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("free credit cap writer contract", () => {
  it("routes grantMonthlyCredits and addCredits free path through shared cap helper", () => {
    const source = readSource("convex/credits/internal.ts");

    expect(source).toMatch(/applyTierFreeCreditCap/);
    expect(source).not.toMatch(/FREE_CREDIT_CAP/);

    const grantBlock = source.match(
      /export const grantMonthlyCredits[\s\S]*?export const grantPurchasedCreditsFromPaymentIntent/,
    )?.[0];
    expect(grantBlock).toBeDefined();
    expect(grantBlock).toMatch(/applyTierFreeCreditCap/);

    const addBlock = source.match(/export const addCredits[\s\S]*$/)?.[0];
    expect(addBlock).toBeDefined();
    expect(addBlock).toMatch(/applyTierFreeCreditCap/);
    expect(addBlock).toMatch(/resolveEffectivePlan/);
  });

  it("routes signup grant through shared cap helper", () => {
    const source = readSource("convex/lib/userCreation.ts");

    expect(source).toMatch(/applyTierFreeCreditCap/);
    expect(source).toMatch(/FREE_SIGNUP_CREDIT_GRANT/);
  });
});
