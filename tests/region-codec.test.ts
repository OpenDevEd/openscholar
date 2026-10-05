import { describe, expect, it } from "vitest";
import {
  encodeRegions,
  decodeRegions,
  INTERNAL_TO_URL_CODE,
  URL_CODE_TO_INTERNAL,
} from "../lib/search-params/regions";

describe("region codec bijectivity", () => {
  const allEntries = Object.entries(INTERNAL_TO_URL_CODE);

  describe("encode then decode (decode(encode(x)) === x)", () => {
    it.each(allEntries)(
      "round-trips for internal=%s -> url=%s",
      (internal, urlCode) => {
        const encoded = encodeRegions([internal]);
        expect(encoded).toBe(urlCode);
        const decoded = decodeRegions(encoded);
        expect(decoded).toContain(internal);
      }
    );
  });

  describe("decode then encode (encode(decode(s)) === s)", () => {
    const allReverse = Object.entries(URL_CODE_TO_INTERNAL);

    it.each(allReverse)(
      "round-trips for url=%s -> internal=%s",
      (urlCode, internal) => {
        const decoded = decodeRegions(urlCode);
        expect(decoded).toContain(internal);
        const reEncoded = encodeRegions(decoded);
        expect(reEncoded).toBe(urlCode);
      }
    );
  });
});

describe("encodeRegions edge cases", () => {
  it("returns empty string for empty array", () => {
    expect(encodeRegions([])).toBe("");
  });

  it("passes through country codes (2-letter)", () => {
    expect(encodeRegions(["US"])).toBe("US");
  });

  it("encodes multiple mixed items comma-separated", () => {
    const result = encodeRegions(["africa", "US", "europe"]);
    expect(result).toBe("AF,US,EU");
  });

  it("skips unknown items", () => {
    expect(encodeRegions(["nonexistent_region"])).toBe("");
  });

  it("keeps a country whose code is a continent's link code apart from the continent", () => {
    // Afghanistan, Armenia and American Samoa came back from a link as Africa, the Americas and Asia.
    const places = ["AF", "AM", "AS", "africa", "US"];
    expect(decodeRegions(encodeRegions(places))).toEqual(places);
  });

  it("handles case insensitive internal IDs", () => {
    expect(encodeRegions(["AFRICA"])).toBe("AF");
  });
});

describe("decodeRegions edge cases", () => {
  it("returns empty array for empty string", () => {
    expect(decodeRegions("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(decodeRegions("  ")).toEqual([]);
  });

  it("passes through valid country codes", () => {
    expect(decodeRegions("US")).toEqual(["US"]);
  });

  it("decodes multiple codes", () => {
    const result = decodeRegions("AF,US,EU");
    expect(result).toContain("africa");
    expect(result).toContain("US");
    expect(result).toContain("europe");
  });

  it("ignores unknown codes", () => {
    expect(decodeRegions("XX_UNKNOWN")).toEqual([]);
  });

  it("deduplicates repeated codes", () => {
    const result = decodeRegions("AF,AF");
    expect(result).toEqual(["africa"]);
  });

  it("trims whitespace around codes", () => {
    const result = decodeRegions(" AF , EU ");
    expect(result).toContain("africa");
    expect(result).toContain("europe");
  });
});
