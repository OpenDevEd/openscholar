import { describe, it, expect } from "vitest";
import { parseSearchParamsFromUrl, DEFAULT_SEARCH_PARAMS } from "./parsers";

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

  it("returns empty arrays for absent reg/focus", () => {
    const p = parse("q=x");
    expect(p.reg).toEqual([]);
    expect(p.focus).toEqual([]);
  });
});
