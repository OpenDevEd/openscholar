import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_EXTRACTION_PDF_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

async function loadExtractionContent() {
  vi.resetModules();
  return import("../convex/extraction/content");
}

async function loadExtractionFeatureFlags() {
  vi.resetModules();
  return import("../lib/extraction/feature-flags");
}

afterEach(() => {
  if (ORIGINAL_EXTRACTION_PDF_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_EXTRACTION_PDF_FLAG;
  }
});

describe("extraction PDF feature flag", () => {
  it("defaults to enabled when env var is unset", async () => {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

    const content = await loadExtractionContent();
    const clientFlags = await loadExtractionFeatureFlags();

    expect(content.isPdfExtractionEnabled()).toBe(true);
    expect(clientFlags.extractionFeatureFlags.pdf).toBe(true);
  });

  it("disables PDF processing when env var is false", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";

    const content = await loadExtractionContent();
    const clientFlags = await loadExtractionFeatureFlags();

    expect(content.isPdfExtractionEnabled()).toBe(false);
    expect(clientFlags.extractionFeatureFlags.pdf).toBe(false);
  });

  it("treats PDF-only papers as non-processable when PDF extraction is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";

    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: undefined,
      })
    ).toEqual({
      hasPdfUrl: false,
      hasAbstract: false,
      processable: false,
    });
  });

  it("keeps abstract-only papers processable when PDF extraction is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";

    const content = await loadExtractionContent();

    expect(
      content.getProcessableFlags({
        pdfUrl: "https://example.org/paper.pdf",
        abstract: "a".repeat(80),
      })
    ).toEqual({
      hasPdfUrl: false,
      hasAbstract: true,
      processable: true,
    });
  });

  it("allows overriding pdfEnabled to true even when env disables PDF extraction", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";

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

  it("allows overriding pdfEnabled to false even when env enables PDF extraction", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";

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
