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
    ["an encoded walk out of the admin area", "/admin/%2e%2e/records"],
    ["an encoded walk in capitals", "/admin/%2E%2E/records"],
    ["a double-encoded walk", "/admin/%252e%252e/records"],
    ["an encoded slash", "/admin%2Frecords"],
    ["an encoded slash in lower case", "/admin%2frecords"],
    ["an encoded backslash", "/admin%5Crecords"],
    ["an encoded protocol-relative address", "/%2F%2Fevil.example"],
    ["an encoded fragment", "/admin%23/evil"],
    ["a broken escape", "/admin/%zz"],
    ["an encoded null byte", "/admin/%00"],
    ["a locale that is really another site", "/en-GB%2F%2Fevil.example/admin"],
  ])("falls back to /admin for %s", (_label, path) => {
    expect(sanitiseAdminReturnPath(path)).toBe("/admin");
  });

  it("keeps ordinary encoding inside a segment or a query", () => {
    expect(sanitiseAdminReturnPath("/admin/items/Climate%20report")).toBe(
      "/admin/items/Climate%20report",
    );
    expect(sanitiseAdminReturnPath("/admin/items?q=a%20b%26c")).toBe(
      "/admin/items?q=a%20b%26c",
    );
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
