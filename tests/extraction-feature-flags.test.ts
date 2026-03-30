import { describe, expect, it } from "vitest";

async function loadExtractionContent() {
  return import("../convex/extraction/content");
}

describe("extraction PDF feature flag", () => {
  it("treats PDF-only papers as non-processable when pdfEnabled is false", async () => {
    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: undefined,
        pdfEnabled: false,
      })
    ).toEqual({
      hasPdfUrl: false,
      hasAbstract: false,
      processable: false,
    });
  });

  it("keeps abstract-only papers processable when pdfEnabled is false", async () => {
    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: "a".repeat(80),
        pdfEnabled: false,
      })
    ).toEqual({
      hasPdfUrl: false,
      hasAbstract: true,
      processable: true,
    });
  });

  it("allows PDF processing when pdfEnabled is true", async () => {
    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: undefined,
        pdfEnabled: true,
      })
    ).toEqual({
      hasPdfUrl: true,
      hasAbstract: false,
      processable: true,
    });
  });

  it("disables PDF processing when pdfEnabled is false", async () => {
    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: undefined,
        pdfEnabled: false,
      })
    ).toEqual({
      hasPdfUrl: false,
      hasAbstract: false,
      processable: false,
    });
  });
});
