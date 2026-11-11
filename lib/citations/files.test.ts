import { describe, expect, it } from "vitest";
import { citationFile } from "./files";

// A citation file must import as the record is: reference managers join RIS continuation lines with a space.
describe("a citation file", () => {
  const report = {
    id: "R100018",
    type: "report",
    title: "Rainwater harvesting and kitchen gardens in rural Morocco: a corrected links acceptance study of twenty households",
    author: [{ literal: "Samira Testauthor" }],
    DOI: "10.53832/openscholar-reports.r100018",
    "collection-title": "Openscholar Reports",
    issued: { "date-parts": [[2026, 11, 11]] },
  };
  it("keeps a long RIS value on its tag's one line", () => {
    const ris = citationFile(report, "ris").text;
    expect(ris).toContain(`TI  - ${report.title}\n`);
    expect(ris.split("\n").every((line) => /^[A-Z][A-Z0-9] {2}-( |$)/.test(line))).toBe(true);
  });
  it("names a report's series in both formats", () => {
    expect(citationFile(report, "ris").text).toContain("T2  - Openscholar Reports");
    expect(citationFile(report, "bibtex").text).toMatch(/series = \{Openscholar \{?Reports\}?\}/);
  });
});
