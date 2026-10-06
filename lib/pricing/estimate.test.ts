import { describe, expect, it } from "vitest";
import { creditsForUsage } from "./convert";
import { extractionPaperCredits, extractionRetryCredits } from "./estimate";

// Measured on 2026-10-06 with the real abstract extraction prompt, 16 calls a model: the dearest call and the average one.
const measured = [
  { model: "GPT-6 Luna at medium", pricing: { input: 0.1, output: 0.5 }, dearest: { inputTokens: 1_783, outputTokens: 497 }, average: { inputTokens: 1_097, outputTokens: 290 } },
  { model: "Claude Sonnet 5.5 at high", pricing: { input: 2, output: 10 }, dearest: { inputTokens: 3_049, outputTokens: 347 }, average: { inputTokens: 1_982, outputTokens: 142 } },
];
const jev = { input: 0.042, output: 0 };

describe("extractionPaperCredits", () => {
  it.each(measured)("holds an abstract question on $model for its dearest measured call, and within three times an average one", ({ pricing, dearest, average }) => {
    const held = extractionPaperCredits({ model: pricing }, [{ type: "string" }], false);
    expect(held).toBeGreaterThanOrEqual(creditsForUsage(dearest, pricing));
    expect(held).toBeLessThanOrEqual(3 * creditsForUsage(average, pricing));
  });

  it("sends a paper's yes/no questions to Jev in one call", () => {
    const sonnet = measured[1]!.pricing;
    const oneYesNo = extractionPaperCredits({ model: sonnet, decision: jev }, [{ type: "string" }, { type: "boolean" }], false);
    expect(extractionPaperCredits({ model: sonnet, decision: jev }, [{ type: "string" }, { type: "boolean" }, { type: "boolean" }], false)).toBe(oneYesNo);
    expect(oneYesNo).toBeLessThan(extractionPaperCredits({ model: sonnet }, [{ type: "string" }, { type: "boolean" }], false));
  });

  it("holds more for a paper read from its PDF than from its abstract, and less again once the PDF is indexed", () => {
    const luna = measured[0]!.pricing;
    const fromPdf = extractionPaperCredits({ model: luna }, [{ type: "string" }], true);
    expect(fromPdf).toBeGreaterThan(extractionPaperCredits({ model: luna }, [{ type: "string" }], false));
    expect(extractionPaperCredits({ model: luna }, [{ type: "string" }], true, false)).toBeLessThan(fromPdf);
  });

  it("holds a retry's yes/no failures on Jev once a paper's other questions are all counted", () => {
    const sonnet = measured[1]!.pricing;
    // One text question and four yes/no ones a paper, ten papers: of 30 failures, at most 10 can be text questions.
    const retry = extractionRetryCredits({ model: sonnet, decision: jev }, 30, false, { textPerPaper: 1, papers: 10 });
    expect(retry).toBeLessThan(extractionRetryCredits({ model: sonnet }, 30, false, { textPerPaper: 1, papers: 10 }));
    expect(retry).toBeGreaterThanOrEqual(10 * extractionPaperCredits({ model: sonnet, decision: jev }, [{ type: "string" }, { type: "boolean" }], false, false));
  });
});
