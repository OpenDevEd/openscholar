import { describe, expect, it } from "vitest";
import { isPublicPath } from "../lib/auth/public-routes";

describe("public route auth matrix", () => {
  it("keeps clerk auth routes public", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-in/foo")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
    expect(isPublicPath("/sign-up/foo")).toBe(true);
  });

  it("keeps protected app routes non-public", () => {
    expect(isPublicPath("/settings")).toBe(false);
    expect(isPublicPath("/settings/billing")).toBe(false);
    expect(isPublicPath("/extraction/new")).toBe(false);
  });

  it("makes author profiles readable without making their configuration public", () => {
    expect(isPublicPath("/authors")).toBe(true);
    expect(isPublicPath("/authors/profile-id")).toBe(true);
    expect(isPublicPath("/authors/profile-id/configuration")).toBe(false);
  });

  it("normalizes trailing slashes and hash/query segments", () => {
    expect(isPublicPath("/sign-in/")).toBe(true);
    expect(isPublicPath("/sign-up/?return_url=%2Fsettings")).toBe(true);
    expect(isPublicPath("/sign-in#hash")).toBe(true);
  });

  it("has explicit API public allowances only where intended", () => {
    expect(isPublicPath("/api/openalex/search")).toBe(true);
    expect(isPublicPath("/api/openalex/search?foo=bar")).toBe(true);
    expect(isPublicPath("/api/private")).toBe(false);
  });
});
