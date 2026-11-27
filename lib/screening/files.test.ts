// The records a file gives a screening (plans/screening-reviewers).
import { describe, expect, it } from "vitest";
import { itemRecords, readTable, tableRecords } from "./files";

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
