import { describe, expect, it } from "vitest";
import { citationFile } from "./files";
import { formatCitation } from "./formatter";
import { paperToCitationData } from "./paper-data";
import type { PaperResult } from "@/lib/types/search.types";

// A citation file must import as the record is: reference managers join RIS continuation lines with a space.
describe("a citation file", () => {
  const report = {
    id: "R100018",
    "citation-key": "Testauthor2026",
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
  it("names a report's series from its paper, as the page's Cite downloads and the file routes build it", () => {
    const paper = { id: "R100018", title: "Rainwater", type: "report", authorships: [], primary_location: { source: { display_name: "Openscholar Reports", type: "repository" } } } as unknown as PaperResult;
    const data = paperToCitationData(paper)!;
    expect(citationFile(data, "ris").text).toContain("T2  - Openscholar Reports");
    expect(citationFile(data, "bibtex").text).toMatch(/series = \{Openscholar \{?Reports\}?\}/);
    // Its number in the series, which BibTeX reads only from its own field.
    expect(citationFile(data, "bibtex").text).toContain("number = {R100018}");
  });

  it("cites a dissertation with its first author's university, or as a report without one, as Zenodo files it", () => {
    const paper = (institutions: { display_name: string }[]) => ({ id: "R100108", title: "Soil", type: "dissertation", authorships: [{ author: { display_name: "A B" }, institutions }], primary_location: { source: { display_name: "Openscholar Reports", type: "repository" } } }) as unknown as PaperResult;
    expect(citationFile(paperToCitationData(paper([{ display_name: "University of Oxford" }]))!, "bibtex").text).toContain("school = {University of Oxford}");
    expect(paperToCitationData(paper([]))).toMatchObject({ type: "report", publisher: "Openscholar" });
  });

  it("copies BibTeX with a report's number, as its file has it", () => {
    expect(formatCitation({ ...report, "collection-number": "R100018" }, "en", "bibtex").text).toContain("number = {R100018}");
  });

  it("names a report's series in both formats", () => {
    expect(citationFile(report, "ris").text).toContain("T2  - Openscholar Reports");
    expect(citationFile(report, "bibtex").text).toMatch(/series = \{Openscholar \{?Reports\}?\}/);
  });
});
