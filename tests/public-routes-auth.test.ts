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
      // The contact form on openscholar.ai, which proves its visitors are people with Turnstile.
      "/api/contact",
      "/api/contact/institutions",
      // A signed-out visitor's AI overview (#1070), which checks for itself who's asking.
      "/api/overviews",
      "/authors",
      "/authors/x",
      "/bookmarks",
      "/connect",
      "/cookie-policy",
      "/credits",
      "/history",
      // A paper's page, which search engines read signed out.
      "/papers/x/x",
      "/pricing",
      "/privacy",
      // The question stage's planet script and its first-paint hold, loaded by a visitor arriving signed out from the home page.
      "/question-stage/earth.js",
      "/question-stage/hold",
      "/results",
      "/results/x",
      "/settings/ai",
      "/sign-in/x",
      "/sign-up/x",
      "/terms",
      "/topics",
      "/topics/x",
    ]);
  });
});
