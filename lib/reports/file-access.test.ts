import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES, fileAccessModes, opensFurther, ownLicence, ownLicenceProblems, pickedLicence, priceOf } from "./report";

describe("a live report's file access", () => {
  it("only ever opens further: private may open, an embargo may open or end sooner, and nothing closes again", () => {
    expect(opensFurther({ mode: "private" }, { mode: "embargo", until: "2027-06-01" })).toBe(true);
    expect(opensFurther({ mode: "private" }, { mode: "readers" })).toBe(true);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "embargo", until: "2027-03-01" })).toBe(true);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "open" })).toBe(true);
    // A later day keeps it from readers longer, and private keeps it from them for good.
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "embargo", until: "2027-09-01" })).toBe(false);
    expect(opensFurther({ mode: "embargo", until: "2027-06-01" }, { mode: "private" })).toBe(false);
    expect(opensFurther({ mode: "open" }, { mode: "private" })).toBe(false);
    expect(opensFurther({ mode: "readers" }, { mode: "private" })).toBe(false);
  });
});

it("prices and offers files for an own licence by its answer before it is named, as the agreement step shows it", () => {
  const closed = pickedLicence({ name: "", url: "", open: false });
  expect(priceOf(closed, DEFAULT_PRICES)).toBe(DEFAULT_PRICES.closed);
  expect(fileAccessModes(closed)).toEqual(["readers", "private"]);
  expect(priceOf(pickedLicence({ name: "", url: "" }), DEFAULT_PRICES)).toBe(DEFAULT_PRICES.other);
});

it("says what keeps an own licence from being one, field by field, and takes it once nothing does", () => {
  expect(ownLicenceProblems("", "")).toEqual({ name: "missing", url: "missing" });
  expect(ownLicenceProblems("许可证", "example.org")).toEqual({ name: "latin", url: "invalid" });
  expect(ownLicenceProblems("cc by 4.0", "https://example.org/l")).toEqual({ name: "known" });
  expect(ownLicence("NGO Research Licence 1.0", "https://example.org/l", false)).toEqual({ name: "NGO Research Licence 1.0", url: "https://example.org/l", open: false });
});
