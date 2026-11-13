import { describe, expect, it } from "vitest";
import { pdfAmong } from "./publications";

// A topic's list shows a cover, a title page or "No PDF" by what its copies' communities last said of the record's PDF.
describe("a publication's PDF among its copies", () => {
  const held = { url: "https://library.example/lib/ABCD1234/download/EFGH5678", cover: "https://files.example/cover.jpg" };
  const linked = { url: "https://publisher.example/paper.pdf", cover: null };
  it("is the first copy's with a picture of its first page, else the first copy's that has one", () => {
    // A copy that only links to the PDF never hides the picture another community made.
    expect(pdfAmong([null, linked, held])).toBe(held);
    expect(pdfAmong([undefined, linked, null])).toBe(linked);
  });
  it("is none only when every copy says it has none", () => {
    expect(pdfAmong([null, null])).toBeNull();
    // A community on a version that doesn't say may hold one: the list then claims nothing.
    expect(pdfAmong([null, undefined])).toBeUndefined();
    expect(pdfAmong([])).toBeUndefined();
  });
});
