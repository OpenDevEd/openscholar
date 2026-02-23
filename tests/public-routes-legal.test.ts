import { describe, expect, it } from "vitest";
import { isPublicPath } from "../lib/auth/public-routes";

describe("public routes legal policy access", () => {
  it("allows privacy and cookie policy while signed out", () => {
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/cookie-policy")).toBe(true);
  });
});
