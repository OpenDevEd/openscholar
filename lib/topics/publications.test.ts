import { describe, expect, it } from "vitest";
import { pdfAmong } from "./publications";

// A topic's list shows a cover, a title page or "No PDF" by what its copies' communities last said of the record's PDF.
describe("a publication's PDF among its copies", () => {
  const held = { url: "https://library.example/lib/ABCD1234/download/EFGH5678", cover: "https://files.example/cover.jpg" };
  const linked = { url: "https://publisher.example/paper.pdf", cover: null };
  it("is the first copy's that has one", () => {
    expect(pdfAmong([null, linked, held])).toBe(linked);
    expect(pdfAmong([undefined, held])).toBe(held);
  });
  it("is none only when every copy says it has none", () => {
    expect(pdfAmong([null, null])).toBeNull();
    // A community on a version that doesn't say may hold one: the list then claims nothing.
    expect(pdfAmong([null, undefined])).toBeUndefined();
    expect(pdfAmong([])).toBeUndefined();
  });
});
