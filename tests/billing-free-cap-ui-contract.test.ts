import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("billing free cap UI contract", () => {
  it("passes tier-derived free cap from billing page into credit card", () => {
    const source = readSource("app/settings/billing/page.tsx");

    expect(source).toMatch(/getFreeCreditCapForPlan/);
    expect(source).toMatch(/freeCreditCap=\{getFreeCreditCapForPlan\(effectivePlan\)\}/);
  });

  it("requires explicit freeCreditCap prop and clamps progress percentage", () => {
    const source = readSource("components/billing/credit-balance-card.tsx");

    expect(source).toMatch(/freeCreditCap:\s*number/);
    expect(source).not.toMatch(/freeCreditCap\?:/);
    expect(source).toMatch(/Math\.min\(\(freeBalance \/ freeCreditCap\) \* 100,\s*100\)/);
  });
});
