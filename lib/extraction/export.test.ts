import { describe, expect, it } from "vitest";
import { ExtractionExportError, readExtractionExport } from "./export";

const papers = Array.from({ length: 5 }, (_, i) => ({ _id: `p${i}` }));
const onePage = async () => ({ page: papers, isDone: true, continueCursor: "" });
const metadata = async () => ({ questions: [] });

describe("readExtractionExport", () => {
  it("exports a view whose count stopped short, checked by its revision", async () => {
    const result = await readExtractionExport(onePage, async () => ({ matching: 3, atLeast: true, revision: 7 }), metadata);
    expect(result.papers).toHaveLength(5);
  });

  it("refuses a search that matched more papers than it returns", async () => {
    await expect(readExtractionExport(onePage, async () => ({ matching: 1_024, atLeast: true, searchCapped: true, revision: 7 }), metadata)).rejects.toEqual(new ExtractionExportError("searchTooBroad"));
  });
});
