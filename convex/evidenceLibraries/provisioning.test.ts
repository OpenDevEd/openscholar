import { describe, expect, it } from "vitest";
import {
  requireNonBlankProvisioningValue,
  validateTargetBaseUrl,
} from "./provisioning";

describe("Evidence Library provisioning values", () => {
  it("normalizes an origin and rejects a URL with a path", () => {
    expect(validateTargetBaseUrl("https://library.example.org")).toBe(
      "https://library.example.org",
    );
    expect(() =>
      validateTargetBaseUrl("https://library.example.org/lib"),
    ).toThrow(/origin-only/);
  });

  it("rejects a blank required platform value", () => {
    expect(() =>
      requireNonBlankProvisioningValue("applicationId", "  "),
    ).toThrow(/applicationId must not be blank/);
  });
});
