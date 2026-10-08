import { describe, expect, it } from "vitest";
import { shouldProtectPath } from "../lib/auth/proxy-policy";

describe("proxy auth policy", () => {

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
