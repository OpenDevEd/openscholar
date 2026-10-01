import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldProtectPath } from "../lib/auth/proxy-policy";

describe("proxy auth policy", () => {
  it("uses Clerk-recommended matcher semantics for API/TRPC coverage", () => {
    const proxySource = readFileSync(
      path.resolve(process.cwd(), "proxy.ts"),
      "utf8",
    );
    expect(proxySource).toContain('"/(api|trpc)(.*)"');
    expect(proxySource).toContain("_next");
    expect(proxySource).toContain("webmanifest");
  });

  it("protects protected routes", () => {
    expect(shouldProtectPath("/settings")).toBe(true);
    expect(shouldProtectPath("/settings/billing")).toBe(true);
    expect(shouldProtectPath("/api/private")).toBe(true);
  });

  it("bypasses protection for explicit public routes", () => {
    expect(shouldProtectPath("/")).toBe(false);
    expect(shouldProtectPath("/sign-in")).toBe(false);
    expect(shouldProtectPath("/sign-up/foo")).toBe(false);
  });
});
