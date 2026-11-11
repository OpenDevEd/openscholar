import { describe, expect, it } from "vitest";
import { carries, squeezed } from "./checks";

// The byline check passes without a model only when the PDF's text carries the line whole (#1261).
describe("finding the byline in a PDF's text", () => {
  const byline = squeezed("This publication is an Openscholar Report, ISSN {pending}, https://doi.org/10.53832/openscholar-r.r100268");
  it("finds it however the PDF wrapped it", () => {
    expect(carries(squeezed("Cover\nThis publication is an Openscholar\nReport, ISSN {pending}, https://doi.org/10.53832/openscholar-\nr.r100268\n\nAbstract"), byline)).toBe(true);
  });
  it("doesn't take a DOI that runs on into more digits for it", () => {
    expect(carries(squeezed("This publication is an Openscholar Report, ISSN {pending}, https://doi.org/10.53832/openscholar-r.r1002689"), byline)).toBe(false);
  });
});
