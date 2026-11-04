import { describe, it, expect } from "vitest";
import { MIN_YEAR } from "../constants";
import { paramsToSearchResult } from "./converters";
import { parseSearchParamsFromUrl, searchParamsParsers, DEFAULT_SEARCH_PARAMS } from "./parsers";

const parse = (qs: string) => parseSearchParamsFromUrl(new URLSearchParams(qs));

describe("parseSearchParamsFromUrl", () => {
  it("returns the defaults for an empty query string", () => {
    expect(parse("")).toEqual(DEFAULT_SEARCH_PARAMS);
  });

  it("reads valid string and integer params", () => {
    const p = parse("q=machine+learning&page=3&field=title");
    expect(p.q).toBe("machine learning");
    expect(p.page).toBe(3);
    expect(p.field).toBe("title");
  });

  it("falls back to the default page (not NaN) when page is non-numeric", () => {
    const p = parse("page=abc");
    expect(p.page).toBe(DEFAULT_SEARCH_PARAMS.page);
    expect(Number.isNaN(p.page)).toBe(false);
  });

  it("keeps an author as OpenAlex's bare id whatever form the address gives, and one without a record as its name", () => {
    const p = parse("author=https%3A%2F%2Fopenalex.org%2FA5075388625,a5023888391,Open+Development+%26+Education,%22%7C");
    expect(p.author).toEqual(["A5075388625", "A5023888391", "Open Development & Education"]);
  });

  it("falls back to null for a non-numeric yf/yt", () => {
    const p = parse("yf=foo&yt=bar");
    expect(p.yf).toBeNull();
    expect(p.yt).toBeNull();
  });

  it("parses valid year bounds", () => {
    const p = parse("yf=2010&yt=2020");
    expect(p.yf).toBe(2010);
    expect(p.yt).toBe(2020);
  });

  it("falls back to default rating bounds when rmin/rmax are junk", () => {
    const p = parse("rmin=xx&rmax=yy");
    expect(p.rmin).toBe(DEFAULT_SEARCH_PARAMS.rmin);
    expect(p.rmax).toBe(DEFAULT_SEARCH_PARAMS.rmax);
  });

  it("parses boolean flags", () => {
    expect(parse("rated=true&review=true").rated).toBe(true);
    expect(parse("rated=true&review=true").review).toBe(true);
    expect(parse("").rated).toBe(false);
    expect(parse("").review).toBe(false);
  });

  it("ignores unknown query params and still parses the known ones", () => {
    const p = parse("q=hello&utm_source=twitter&foo=bar");
    expect(p.q).toBe("hello");
    expect(p).not.toHaveProperty("utm_source");
    expect(p).not.toHaveProperty("foo");
  });

  describe("an address is anyone's to type, and the server refuses a search it can't hold", () => {
    const thisYear = new Date().getFullYear();

    it.each([
      ["yf=2030", [thisYear, thisYear]],
      ["yf=999999", [thisYear, thisYear]],
      ["yt=1800", [MIN_YEAR, MIN_YEAR]],
      ["yf=-5", [MIN_YEAR, thisYear]],
      ["yf=2025&yt=2020", [2020, 2025]],
      ["yf=2030&yt=2020", [2020, thisYear]],
      ["yf=2010&yt=2020", [2010, 2020]],
    ])("%s is a year range in order, within the years a search can name", (address, range) => {
      expect(paramsToSearchResult(parse(address)).yearRange).toEqual(range);
    });

    it("puts a rating range in order", () => {
      expect(paramsToSearchResult(parse("rmin=5&rmax=1")).ratingRange).toEqual([1, 5]);
    });

    it("drops a field or filter type no search can have", () => {
      expect(parse("field=garbage").field).toBe(DEFAULT_SEARCH_PARAMS.field);
      expect(parse("ft=garbage").ft).toBe(DEFAULT_SEARCH_PARAMS.ft);
      expect(parse("field=oql&ft=date")).toMatchObject({ field: "oql", ft: "date" });
    });

    it("drops a date that isn't one, which would otherwise crash the page when formatted", () => {
      expect(parse("df=garbage&dt=2020-13-45")).toMatchObject({ df: null, dt: null });
      expect(parse("df=2020-01-02&dt=2021-03-04")).toMatchObject({ df: "2020-01-02", dt: "2021-03-04" });
      // The results page reads the address through nuqs, before a redirect to the canonical one lands.
      expect(searchParamsParsers.df.parse("garbage")).toBeNull();
      expect(searchParamsParsers.dt.parse("2021-03-04")).toBe("2021-03-04");
    });
  });

  it("returns empty arrays for absent reg/focus", () => {
    const p = parse("q=x");
    expect(p.reg).toEqual([]);
    expect(p.focus).toEqual([]);
  });
});
