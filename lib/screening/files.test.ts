// The records a file gives a screening (plans/screening-reviewers).
import { describe, expect, it } from "vitest";
import { degrees, PDFDocument } from "@cantoo/pdf-lib";
import { itemRecords, pageShapeOf, readTable, tableRecords } from "./files";

describe("the records of a file", () => {
  it("keeps a reference with no title as a record with an empty one, and takes an item with nothing in it for no record", () => {
    // Ovid ends each record with a line of its own, which the importer gives back as an item with nothing in it.
    const records = itemRecords([
      { itemType: "journalArticle", title: "School meals and learning", abstractNote: "A trial.", creators: [{ firstName: "Ada", lastName: "Obi" }], date: "2019//", DOI: "http://dx.doi.org/10.1002/cpp.2398" },
      { itemType: "journalArticle", creators: [] },
      { itemType: "journalArticle", creators: [{ name: "World Bank" }], date: "2021" },
      { itemType: "note", title: "A note" },
    ]);
    expect(records).toEqual([
      { title: "School meals and learning", abstract: "A trial.", authors: ["Ada Obi"], publicationYear: 2019, doi: "10.1002/cpp.2398", workType: "journalArticle" },
      { title: "", authors: ["World Bank"], publicationYear: 2021, workType: "journalArticle" },
    ]);
  });

  it("keeps a table's row with no title as a record with an empty one", () => {
    const table = readTable("Title,Abstract\nSchool meals,A trial.\n,An abstract with no title\n")!;
    expect(tableRecords(table, table.picked)).toEqual([{ title: "School meals", abstract: "A trial." }, { title: "", abstract: "An abstract with no title" }]);
  });
});

describe("pageShapeOf", () => {
  // A PDF's pages hold their room at their own shape before the file is read: a page turned a quarter is as tall as it was wide.
  it("is the first page's height for its width, as the page shows", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([842, 595]);
    expect(pageShapeOf(pdf)).toBe(0.707);
    pdf.getPage(0).setRotation(degrees(90));
    expect(pageShapeOf(pdf)).toBe(1.415);
    // A file that cuts its page smaller shows the cut.
    pdf.getPage(0).setRotation(degrees(0));
    pdf.getPage(0).setCropBox(0, 0, 400, 400);
    expect(pageShapeOf(pdf)).toBe(1);
  });
});
