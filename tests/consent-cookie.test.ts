import { describe, expect, it } from "vitest";
import { consentCookieDomain } from "@/lib/consent-cookie";

describe("consent cookie domain", () => {
  it("shares one answer between openscholar.ai and the sites under it", () => {
    expect(consentCookieDomain("openscholar.ai")).toBe("openscholar.ai");
    expect(consentCookieDomain("discover.openscholar.ai")).toBe("openscholar.ai");
  });

  it("keeps it on its own host anywhere else, so a look-alike domain can't read or set it", () => {
    expect(consentCookieDomain("notopenscholar.ai")).toBeUndefined();
    expect(consentCookieDomain("openscholar.ai.example.com")).toBeUndefined();
    expect(consentCookieDomain("home.localhost")).toBeUndefined();
  });
});
