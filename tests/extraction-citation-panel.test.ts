import { describe, expect, it } from "vitest";
import { mockId } from "./factories";
import { buildCitationPanelPayload } from "../lib/extraction/citation-panel";

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

  it("returns null when PDF feature is disabled", () => {
    expect(buildCitationPanelPayload({ ...baseParams, pdfEnabled: false })).toBeNull();
  });

  it("returns payload when PDF feature is enabled", () => {
    const payload = buildCitationPanelPayload({ ...baseParams, pdfEnabled: true });
    expect(payload).not.toBeNull();
    expect(payload?.paperTitle).toBe("Sample Paper");
    expect(payload?.citations).toHaveLength(1);
  });

  it("returns payload when pdfEnabled is omitted (defaults to allowed)", () => {
    const payload = buildCitationPanelPayload(baseParams);
    expect(payload).not.toBeNull();
    expect(payload?.paperTitle).toBe("Sample Paper");
  });

  it("returns null when citations are empty regardless of pdfEnabled", () => {
    expect(buildCitationPanelPayload({ ...baseParams, citations: [] })).toBeNull();
  });
});
