import { describe, expect, it } from "vitest";
import {
  buildAdminRouteHref,
  decideAdminHandoff,
  readAdminReturnPath,
  sanitiseAdminReturnPath,
  shouldRequestAdminHandoff,
} from "./admin-handoff";

describe("sanitiseAdminReturnPath", () => {
  it.each([
    "/admin",
    "/admin/",
    "/admin/items?page=2",
    "/admin/records/abc?q=climate&sort=title",
    "/en-GB/admin",
    "/fr/admin/files",
  ])("keeps the admin path %s", (path) => {
    expect(sanitiseAdminReturnPath(path)).toBe(path);
  });

  it.each([
    ["another site", "https://evil.example/steal"],
    ["a protocol-relative address", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["an encoded newline", "/admin\n/x"],
    ["a fragment", "/admin#/../../evil"],
    ["a page outside the admin area", "/records"],
    ["a walk out of the admin area", "/admin/../records"],
    ["a bare path", "admin"],
    ["an empty value", ""],
    ["a very long value", `/admin/${"a".repeat(600)}`],
  ])("falls back to /admin for %s", (_label, path) => {
    expect(sanitiseAdminReturnPath(path)).toBe("/admin");
  });

  it("falls back to /admin when nothing was asked for", () => {
    expect(sanitiseAdminReturnPath(undefined)).toBe("/admin");
    expect(sanitiseAdminReturnPath(null)).toBe("/admin");
  });
});

describe("readAdminReturnPath", () => {
  it("forwards a path and drops anything that could leave the site", () => {
    expect(readAdminReturnPath("/admin/items")).toBe("/admin/items");
    expect(readAdminReturnPath(["/admin", "/admin/other"])).toBe("/admin");
    expect(readAdminReturnPath("https://evil.example")).toBeUndefined();
    expect(readAdminReturnPath("//evil.example")).toBeUndefined();
    expect(readAdminReturnPath(undefined)).toBeUndefined();
  });
});

describe("shouldRequestAdminHandoff", () => {
  it("asks for a code only when the library did not report a problem", () => {
    expect(shouldRequestAdminHandoff(undefined)).toBe(true);
    expect(shouldRequestAdminHandoff("")).toBe(true);
    expect(shouldRequestAdminHandoff("invalid_code")).toBe(false);
    expect(shouldRequestAdminHandoff("something_else")).toBe(false);
    expect(shouldRequestAdminHandoff(["invalid_code"])).toBe(false);
  });
});

describe("decideAdminHandoff", () => {
  it("sends an allowed person straight to the library", () => {
    expect(
      decideAdminHandoff({
        errorParam: undefined,
        result: {
          status: "allowed",
          launchUrl: "https://library.example/api/admin/session?code=elc_1",
        },
      }),
    ).toEqual({
      kind: "launch",
      launchUrl: "https://library.example/api/admin/session?code=elc_1",
    });
  });

  it("explains a refusal instead of redirecting", () => {
    expect(
      decideAdminHandoff({
        errorParam: undefined,
        result: { status: "no_access", organisationName: "Climate Team" },
      }),
    ).toEqual({ kind: "no_access", organisationName: "Climate Team" });
    expect(
      decideAdminHandoff({
        errorParam: undefined,
        result: { status: "not_ready", isOwner: true },
      }),
    ).toEqual({ kind: "not_ready", isOwner: true });
  });

  it("never redirects again after a failed exchange", () => {
    expect(
      decideAdminHandoff({
        errorParam: "invalid_code",
        result: {
          status: "allowed",
          launchUrl: "https://library.example/api/admin/session?code=elc_1",
        },
      }),
    ).toEqual({ kind: "expired_link" });
    expect(
      decideAdminHandoff({ errorParam: undefined, result: null }),
    ).toEqual({ kind: "expired_link" });
  });
});

describe("buildAdminRouteHref", () => {
  it("points back at this page without the error", () => {
    expect(buildAdminRouteHref({ libraryId: "lib_1" })).toBe(
      "/evidence-libraries/lib_1/admin",
    );
    expect(
      buildAdminRouteHref({ libraryId: "lib_1", returnPath: "/admin/items?page=2" }),
    ).toBe("/evidence-libraries/lib_1/admin?return=%2Fadmin%2Fitems%3Fpage%3D2");
  });
});
