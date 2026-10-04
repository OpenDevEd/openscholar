import { describe, expect, it } from "vitest";
import { isPublicPath } from "../lib/auth/public-routes";

describe("public routes legal policy access", () => {
  it("allows privacy and cookie policy while signed out", () => {
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/cookie-policy")).toBe(true);
  });

  // The licences credited there require the credit to be visible to anyone the work is shown to.
  it("allows the credits page while signed out", () => {
    expect(isPublicPath("/credits")).toBe(true);
  });
});
