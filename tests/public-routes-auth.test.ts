import { readdirSync } from "node:fs";
import { join } from "node:path";
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

  it("makes author profiles and their directory readable without making their configuration public", () => {
    expect(isPublicPath("/authors")).toBe(true);
    expect(isPublicPath("/authors/profile-id")).toBe(true);
    expect(isPublicPath("/authors/profile-id/configuration")).toBe(false);
  });

  it("makes topic browsing public while keeping library configuration protected", () => {
    expect(isPublicPath("/topics")).toBe(true);
    expect(isPublicPath("/topics/T12260")).toBe(true);
    expect(isPublicPath("/evidence-communities/library-id/configuration")).toBe(false);
  });

  it("normalizes trailing slashes and hash/query segments", () => {
    expect(isPublicPath("/sign-in/")).toBe(true);
    expect(isPublicPath("/sign-up/?return_url=%2Fsettings")).toBe(true);
    expect(isPublicPath("/sign-in#hash")).toBe(true);
  });

  it("keeps API routes signed in", () => {
    expect(isPublicPath("/api/openalex/search")).toBe(false);
    expect(isPublicPath("/api/private")).toBe(false);
  });

  it("sends an address that names no page to the not-found page, not sign-in", () => {
    expect(isPublicPath("/this-does-not-exist")).toBe(true);
    expect(isPublicPath("/sitemap.xml")).toBe(true);
    expect(isPublicPath("/robots.txt")).toBe(true);
  });

  // The gate names private pages, so a new page is open until it's named: this makes that a choice.
  it("opens exactly these pages to someone signed out", () => {
    const pages: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const part = /^\[+\.*(.*?)\]+$/.test(entry.name) ? "x" : entry.name;
          walk(join(dir, entry.name), `${route}/${part}`);
        } else if (/^(page|route)\.tsx?$/.test(entry.name)) pages.push(route || "/");
      }
    };
    walk(join(__dirname, "../app"), "");
    expect(pages.filter(isPublicPath).sort()).toEqual([
      "/",
      "/authors",
      "/authors/x",
      "/bookmarks",
      "/connect",
      "/cookie-policy",
      "/credits",
      "/history",
      "/pricing",
      "/privacy",
      "/results",
      "/results/x",
      "/settings/ai",
      "/sign-in/x",
      "/sign-up/x",
      "/topics",
      "/topics/x",
    ]);
  });
});
