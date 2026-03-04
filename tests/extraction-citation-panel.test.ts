import { afterEach, describe, expect, it, vi } from "vitest";
import { mockId } from "./factories";

const ORIGINAL_EXTRACTION_PDF_FLAG = process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;

async function loadCitationPanelModule() {
  vi.resetModules();
  return import("../lib/extraction/citation-panel");
}

afterEach(() => {
  if (ORIGINAL_EXTRACTION_PDF_FLAG === undefined) {
    delete process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = ORIGINAL_EXTRACTION_PDF_FLAG;
  }
});

describe("citation panel payload gating", () => {
  const baseParams = {
    paperId: mockId("extractionPapers", "1"),
    paperTitle: "Sample Paper",
    citations: [
      {
        evidenceId: "ev_1",
        page: 1,
        charRange: [0, 20] as [number, number],
        text: "Sample evidence",
        validated: true as const,
        retrieval: {},
      },
    ],
    answer: "Sample answer",
    questionText: "What is the finding?",
  };

  it("returns null when PDF feature is disabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "false";
    const { buildCitationPanelPayload } = await loadCitationPanelModule();

    expect(buildCitationPanelPayload(baseParams)).toBeNull();
  });

  it("returns payload when PDF feature is enabled", async () => {
    process.env.NEXT_PUBLIC_EXTRACTION_PDF_ENABLED = "true";
    const { buildCitationPanelPayload } = await loadCitationPanelModule();

    const payload = buildCitationPanelPayload(baseParams);
    expect(payload).not.toBeNull();
    expect(payload?.paperTitle).toBe("Sample Paper");
    expect(payload?.citations).toHaveLength(1);
  });
});
