// The rail's cookie (#651): it's the person's to change, sent with every request, and shared by
// whoever signs in on the browser.
import { describe, expect, it } from "vitest";
import { lookCookieIn, readCache, writeCache, type CachedLook } from "./look-cache";

const lab = (n: number): CachedLook => ({ kind: "organization", workspaceId: `w${n}`, name: `Lab ${n}`, colour: "#16a34a", extract: true, publish: true });
const own: CachedLook = { kind: "personal", workspaceId: "w0", name: "Ada" };
const ada = { name: "Ada", imageUrl: "https://img.clerk.com/ada" };

describe("the rail's cookie", () => {
  it("reads back what it keeps, for the account it was kept for only", () => {
    const cookie = writeCache({ looks: {} }, "user_ada", "lab-1", lab(1), ada)!;
    expect(readCache(cookie, "user_ada")).toEqual({ me: ada, looks: { "lab-1": lab(1) } });
    expect(readCache(cookie, "user_bob")).toEqual({ looks: {} });
    expect(readCache(cookie, null)).toEqual({ looks: {} });
    expect(readCache(lookCookieIn(`theme=dark; workspace-looks=${cookie}; other=1`), "user_ada").looks).toEqual({ "lab-1": lab(1) });
  });

  it("drops a colour, photo or section that isn't one, and anything that isn't a look", () => {
    const raw = JSON.stringify({
      user: "user_ada",
      // `features` is what a cookie written before sections were each workspace's own still holds.
      me: { name: "Ada", imageUrl: "javascript:alert(1)", features: { authors: true } },
      looks: { a: { ...lab(1), colour: "red;background:url(x)", imageUrl: "http://plain", publish: "yes", admin: true }, b: { name: "no kind" } },
    });
    expect(readCache(raw, "user_ada")).toEqual({ me: { name: "Ada" }, looks: { a: { kind: "organization", workspaceId: "w1", name: "Lab 1", extract: true } } });
    expect(readCache("not json", "user_ada")).toEqual({ looks: {} });
  });

  it("keeps the person's own workspace and the latest few organizations, so the cookie stays small", () => {
    let cache = readCache(writeCache({ looks: {} }, "user_ada", "~", own, ada)!, "user_ada");
    for (let n = 1; n <= 9; n++) cache = readCache(writeCache(cache, "user_ada", `lab-${n}`, lab(n), undefined)!, "user_ada");
    expect(Object.keys(cache.looks)).toEqual(["~", "lab-4", "lab-5", "lab-6", "lab-7", "lab-8", "lab-9"]);
    expect(cache.me).toEqual(ada);
  });

  it("drops the oldest organizations until it fits under browsers' 4,096 bytes", () => {
    // Clerk's logo addresses run to several hundred characters.
    const logo = (n: number): CachedLook => ({ ...lab(n), imageUrl: `https://img.clerk.com/${"x".repeat(600)}${n}` });
    let cache = readCache(writeCache({ looks: {} }, "user_ada", "~", own, ada)!, "user_ada");
    for (let n = 1; n <= 7; n++) {
      const value = writeCache(cache, "user_ada", `lab-${n}`, logo(n), undefined)!;
      expect(value.length).toBeLessThanOrEqual(3_800);
      cache = readCache(value, "user_ada");
    }
    expect(cache.looks["lab-7"]).toEqual(logo(7));
    expect(Object.keys(cache.looks).length).toBeLessThan(7);
  });
});
