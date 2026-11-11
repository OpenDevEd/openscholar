import { describe, expect, it } from "vitest";
import { countryOfPlace } from "./places";

describe("the country a place names", () => {
  it("reads a country's name, and the short forms OpenAlex's lookup writes", () => {
    expect(countryOfPlace("Tema, Ghana")).toBe("GH");
    expect(countryOfPlace("Cambridge, United Kingdom")).toBe("GB");
    expect(countryOfPlace("Cambridge, UK")).toBe("GB");
    expect(countryOfPlace("Boston, USA")).toBe("US");
  });

  it("is none for a place that names no country", () => {
    expect(countryOfPlace("Somewhere")).toBe("");
    expect(countryOfPlace(undefined)).toBe("");
  });
});
