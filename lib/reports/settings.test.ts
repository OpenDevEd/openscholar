import { describe, expect, it } from "vitest";
import { bylineOf } from "./settings";

const DOI = "https://doi.org/10.53832/openscholar-reports.r100269";
const line = (byline: string, issn = "") => bylineOf({ name: "Openscholar Reports", issn, byline }, DOI, "CC BY 4.0");

describe("a series' byline", () => {
  it("names the ISSN once the series has one", () => {
    expect(line("Published in {series} (ISSN {issn}), {doi}, under {licence}", "2049-3630")).toBe(`Published in Openscholar Reports (ISSN 2049-3630), ${DOI}, under CC BY 4.0`);
  });

  it("leaves the ISSN out, with no stray brackets or commas, while the series has none", () => {
    expect(line("Published in {series} (ISSN {issn}), {doi}, under {licence}")).toBe(`Published in Openscholar Reports, ${DOI}, under CC BY 4.0`);
    expect(line("An Openscholar Report, ISSN {issn}, {doi}")).toBe(`An Openscholar Report, ${DOI}`);
    expect(line("{series}, {doi}, ISSN {issn}")).toBe(`Openscholar Reports, ${DOI}`);
    expect(line("ISSN {issn}, {series}: {doi}")).toBe(`Openscholar Reports: ${DOI}`);
    expect(line("{series} ISSN {issn} {doi}")).toBe(`Openscholar Reports ${DOI}`);
    expect(line("An Openscholar Report, ISSN {issn}: {doi} ({licence})")).toBe(`An Openscholar Report: ${DOI} (CC BY 4.0)`);
    expect(line("{series}; ISSN: {issn}; {doi}")).toBe(`Openscholar Reports; ${DOI}`);
    expect(line("{series}, (ISSN {issn}), {doi}")).toBe(`Openscholar Reports, ${DOI}`);
    expect(line("{series} [ISSN {issn}] {doi}")).toBe(`Openscholar Reports ${DOI}`);
    expect(line("{series} (ISSN {issn}, online) {doi}")).toBe(`Openscholar Reports (online) ${DOI}`);
  });
});
