import { describe, expect, it } from "vitest";
import { countryCodeOf } from "./region-names";

describe("a country from what a service gives", () => {
  it("takes a code in either case or an English name, and nothing else", () => {
    expect(countryCodeOf("gb")).toBe("GB");
    expect(countryCodeOf("Kenya")).toBe("KE");
    expect(countryCodeOf("Turkey")).toBe("TR");
    expect(countryCodeOf("Tanzania")).toBe("TZ");
    expect(countryCodeOf("eastern_africa")).toBeNull();
    expect(countryCodeOf("ZZ")).toBeNull();
  });
});
