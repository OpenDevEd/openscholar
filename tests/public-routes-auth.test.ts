import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicFile, isPublicPath } from "../lib/auth/public-routes";

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

  it("opens the Communities page's public communities to anyone, and nothing under it (#1090)", () => {
    expect(isPublicPath("/evidence-communities")).toBe(true);
    expect(isPublicPath("/evidence-communities/")).toBe(true);
    expect(isPublicPath("/evidence-communities/new")).toBe(false);
    expect(isPublicPath("/evidence-communities/library-id")).toBe(false);
    expect(isPublicPath("/evidence-communities/library-id/setup")).toBe(false);
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
    const pages = appRoutes().map(({ path }) => path);
    expect(pages.filter(isPublicPath).sort()).toEqual([
      "/",
      // The contact form on openscholar.ai, which proves its visitors are people with Turnstile.
      "/api/contact",
      "/api/contact/institutions",
      // A signed-out visitor's AI overview (#1070), which checks for itself who's asking.
      "/api/overviews",
      // A report's file before its readers may have it, which asks for itself who is signed in, and says the PDF is private to anyone else.
      "/api/reports/files/x",
      "/authors",
      "/authors/x",
      "/bookmarks",
      // The short address people guess for the public communities, which sends them there.
      "/communities",
      "/connect",
      "/cookie-policy",
      "/credits",
      // The public communities, for anyone (#1090).
      "/evidence-communities",
      "/history",
      // A paper's page, which search engines read signed out.
      // A paper's citation files, for reference managers and tools that follow a paper page's links.
      // A paper's page by its DOI, for lists that know only the DOI.
      "/papers/doi/x",
      "/papers/x/cite.bib",
      "/papers/x/cite.ris",
      // The paper's picture, for link previews and search engines.
      "/papers/x/cover.png",
      // A live report's PDF, for anyone who reads its page: it leads nowhere once the report is withdrawn.
      "/papers/x/report.pdf",
      "/papers/x/x",
      "/pricing",
      "/privacy",
      // Publish shows what publishing a report takes to someone signed out, and asks for sign-in to start one.
      "/publish",
      // Where that file sends someone it won't open: the PDF is private, and its owner may sign in.
      "/publish/private-file",
      // The question stage's planet script and its first-paint hold, loaded by a visitor arriving signed out from the home page.
      "/question-stage/earth.js",
      "/question-stage/hold",
      "/results",
      "/results/x",
      "/settings/ai",
      "/sign-in/x",
      // Where a community sends its reader to sign out of Openscholar too; someone already signed out goes straight back.
      "/sign-out",
      "/sign-up/x",
      "/terms",
      "/topics",
      "/topics/x",
    ]);
  });

  // The proxy hands these to no one: a route outside /api that isn't on the list meets Clerk, whose handshake loops on a
  // `.pdf` address Cloudflare caches; a page on it can't call auth() and fails instead of rendering.
  it("keeps Clerk off every file and redirect a route serves outside /api, and only those", () => {
    const routes = appRoutes();
    const files = [...routes.filter(({ kind, path }) => kind === "route" && !path.startsWith("/api/")).map(({ path }) => path), "/robots.txt", "/sitemap.xml", "/papers/sitemap/0.xml"];
    // The IndexNow key, which a search engine fetches with no cookies to check a list of addresses is ours.
    files.push(...readdirSync(join(__dirname, "../public")).filter((name) => name.endsWith(".txt")).map((name) => `/${name}`));
    expect(files.filter((path) => !isPublicFile(path))).toEqual([]);
    const pages = [...routes.filter(({ kind }) => kind === "page").map(({ path }) => path), "/papers/sitemap.xml", "/papers/W1/a-title", "/wp-login.php", "/00000000000000000000000000000000.txt", "/papers/doi", "/question-stage/missing.php"];
    expect(pages.filter(isPublicFile)).toEqual([]);
  });
});

/** Every page and route under app/, with each dynamic segment as `x`. */
function appRoutes() {
  const found: { kind: "page" | "route"; path: string }[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const part = /^\[+\.*(.*?)\]+$/.test(entry.name) ? "x" : entry.name;
        walk(join(dir, entry.name), `${route}/${part}`);
      } else if (/^(page|route)\.tsx?$/.test(entry.name)) found.push({ kind: entry.name.startsWith("page") ? "page" : "route", path: route || "/" });
    }
  };
  walk(join(__dirname, "../app"), "");
  return found;
}
