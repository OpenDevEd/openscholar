import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * TEST-03: Rate limiter consume mutation argument validation.
 *
 * The `consume` internal mutation must reject names that are not one of
 * the defined rate limit keys ("start-extraction", "api-key-save",
 * "checkout-session"). After the fix, the `name` argument uses
 * `v.union(v.literal(...))` instead of `v.string()`, so Convex will
 * reject invalid names at argument validation time.
 *
 * These tests verify the validator shape in the source code.
 * Full runtime argument rejection is enforced by Convex's validator layer.
 */
describe("rate limiter consume mutation", () => {
  const rateLimitSource = fs.readFileSync(
    path.resolve(process.cwd(), "convex/lib/rateLimit.ts"),
    "utf-8"
  );

  it("rejects invalid rate limit name at argument validation level", () => {
    // The consume mutation should NOT use v.string() for the name argument
    // It should use v.union(v.literal(...)) to restrict to known rate limit names

    // Extract the consume mutation's args section
    const consumeStart = rateLimitSource.indexOf("export const consume");
    expect(consumeStart).toBeGreaterThan(-1);

    const consumeSection = rateLimitSource.slice(consumeStart, consumeStart + 500);

    // Should use v.union for the name field (not v.string())
    expect(consumeSection).toContain("v.union(");
    expect(consumeSection).toContain('v.literal("start-extraction")');
    expect(consumeSection).toContain('v.literal("api-key-save")');
    expect(consumeSection).toContain('v.literal("checkout-session")');

    // Should NOT use plain v.string() for the name arg
    // (it should use the union of literals instead)
    expect(consumeSection).not.toMatch(/name:\s*v\.string\(\)/);
  });

  it("has no as-any casts in the consume handler", () => {
    // After the fix, `args.name` should pass directly to rateLimit()
    // without needing an `as any` cast
    const consumeStart = rateLimitSource.indexOf("export const consume");
    const consumeSection = rateLimitSource.slice(consumeStart, consumeStart + 500);

    expect(consumeSection).not.toContain("as any");
  });

  it("defines all three rate limit names matching defineRateLimits keys", () => {
    // The union literals in consume.args.name must match the keys in defineRateLimits
    const expectedNames = ["start-extraction", "api-key-save", "checkout-session"];

    // Check defineRateLimits keys
    for (const name of expectedNames) {
      expect(rateLimitSource).toContain(`"${name}"`);
    }

    // Verify the consume mutation uses all three as literals
    const consumeStart = rateLimitSource.indexOf("export const consume");
    const consumeSection = rateLimitSource.slice(consumeStart, consumeStart + 500);

    for (const name of expectedNames) {
      expect(consumeSection).toContain(`v.literal("${name}")`);
    }
  });
});
