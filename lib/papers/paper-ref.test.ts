import { describe, expect, it } from "vitest";
import { crossRefsOf, legacyPaperRef, openalexWorkOf, paperKey, parsePaperKey, toPaperKey, type PaperRef } from "./paper-ref";

const refs: PaperRef[] = [
  { source: "openalex", work: "W2741809807" },
  { source: "library", libraryId: "r176jnjsjfvmda1g2jfca8638n8en9r8", key: "27BGDU89" },
  { source: "zotero", library: "group", owner: "2129771", key: "JUDM2WBF" },
  { source: "zotero", library: "user", owner: "", key: "ABCD1234" },
  { source: "upload", file: "kg2bq1wz0h7v9m7z8b5c3d4e5f6g7h8j" },
];

describe("paper keys", () => {
  it.each(refs)("a %o key reads back as the same paper", (ref) => {
    expect(parsePaperKey(paperKey(ref))).toEqual(ref);
  });

  it("refuses what is no key", () => {
    for (const text of ["", "W2741809807", "openalex:", "library:only-one-part", "zotero:team:1:K", "upload:", "nonsense:x"]) {
      expect(parsePaperKey(text)).toBeNull();
    }
  });
});

describe("IDs stored before keys", () => {
  it("names an OpenAlex work the same in every form it was stored in", () => {
    const forms = ["https://openalex.org/W2741809807", "https://openalex.org/works/W2741809807", "W2741809807", "w2741809807", "openalex:W2741809807"];
    expect(new Set(forms.map((id) => paperKey(legacyPaperRef(id)!)))).toEqual(new Set(["openalex:W2741809807"]));
  });

  it("gives a Zotero item the owner its PDF address names, and keeps it unknown without one", () => {
    expect(legacyPaperRef("zotero:group:JUDM2WBF", { pdfUrl: "zotero://select/groups/2129771/items/JUDM2WBF" })).toEqual({ source: "zotero", library: "group", owner: "2129771", key: "JUDM2WBF" });
    expect(legacyPaperRef("zotero:user:ABCD1234", { pdfUrl: "zotero://select/users/9876/items/ABCD1234" })).toEqual({ source: "zotero", library: "user", owner: "9876", key: "ABCD1234" });
    expect(legacyPaperRef("zotero:user:ABCD1234")).toEqual({ source: "zotero", library: "user", owner: "", key: "ABCD1234" });
    // Extraction once named a Zotero item by its key alone; its PDF address says whose it is.
    expect(legacyPaperRef("zotero:ABCD1234", { pdfUrl: "zotero://select/groups/55/items/ABCD1234" })).toEqual({ source: "zotero", library: "group", owner: "55", key: "ABCD1234" });
  });

  it("reads an uploaded PDF's placeholder as the upload", () => {
    expect(legacyPaperRef("upload:kg2bq1wz0h7v9m7z8b5c3d4e5f6g7h8j")).toEqual({ source: "upload", file: "kg2bq1wz0h7v9m7z8b5c3d4e5f6g7h8j" });
  });

  it("leaves what it can't place unplaced", () => {
    expect(legacyPaperRef("history:abc")).toBeNull();
    expect(legacyPaperRef("")).toBeNull();
  });
});

describe("cross-references", () => {
  it("an OpenAlex paper carries its own work, and every DOI is kept in one form", () => {
    expect(crossRefsOf({ source: "openalex", work: "W1" }, { doi: "https://doi.org/10.1000/ABC" })).toEqual({ openalexId: "W1", doi: "10.1000/abc" });
    expect(crossRefsOf({ source: "library", libraryId: "r1", key: "K1234567" }, { openalexId: "https://openalex.org/W9", doi: "10.5/X" })).toEqual({ openalexId: "W9", doi: "10.5/x" });
    expect(crossRefsOf({ source: "upload", file: "f" }, { openalexId: "not an id", doi: " " })).toEqual({});
  });
});

describe("naming a paper at a boundary", () => {
  it("takes a key or an older ID, and finds a paper's OpenAlex work wherever it is known", () => {
    expect(toPaperKey("https://openalex.org/W5")).toBe("openalex:W5");
    expect(toPaperKey("library:r1:K1234567")).toBe("library:r1:K1234567");
    expect(toPaperKey("not a paper")).toBeNull();
    expect(openalexWorkOf("https://openalex.org/W5")).toBe("W5");
    expect(openalexWorkOf("library:r1:K1234567", { openalexId: "W9" })).toBe("W9");
    expect(openalexWorkOf("upload:f")).toBeNull();
  });
});
