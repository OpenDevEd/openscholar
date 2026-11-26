import { describe, expect, it } from "vitest";
import { convertUsdToCredits, creditsForUsage } from "./convert";
import { extractionPaperCredits, extractionRetryCredits, longestPdfs, pdfBand, pdfsFor, screeningPdfCredits, screeningPdfsCredits } from "./estimate";

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

// A model that charges more once a prompt is long: Claude Haiku 5.5 on OpenRouter, five times its price from 100,000 prompt tokens.
const haiku = { input: 0.1, output: 0.5, long: { from: 100_000, input: 0.5, output: 2.5 } };

describe("screening a paper as its PDF", () => {
  // Measured on 2026-11-26: a 76-page report sent whole took 238,457 prompt tokens and cost $0.119391; 27 pages took 77,955 and $0.007822.
  it.each([{ pages: 76, usd: 0.119391 }, { pages: 27, usd: 0.007822 }])("is estimated at no less than a $pages-page paper was charged, at the long-prompt price where it reaches it", ({ pages, usd }) => {
    expect(screeningPdfCredits(haiku, pages)).toBeGreaterThanOrEqual(convertUsdToCredits({ usd }));
  });

  it("adds a screening's PDFs up to no less than they cost one by one, from their pages by length", () => {
    const papers = [2, 7, 14, 19, 24, 25, 27, 32, 47, 76, 76, 180];
    const spread: Record<string, { papers: number; pages: number }> = {};
    for (const pages of papers) spread[pdfBand(pages)] = { papers: (spread[pdfBand(pages)]?.papers ?? 0) + 1, pages: (spread[pdfBand(pages)]?.pages ?? 0) + pages };
    const pdfs = { papers: papers.length, pages: papers.reduce((sum, pages) => sum + pages, 0), spread };
    const oneByOne = papers.reduce((sum, pages) => sum + screeningPdfCredits(haiku, pages), 0);
    expect(screeningPdfsCredits(haiku, pdfs)).toBeGreaterThanOrEqual(oneByOne);
    // The excess is a band's shorter papers taken at the long price with its longest, and a credit a paper for each call's own rounding.
    expect(screeningPdfsCredits(haiku, pdfs)).toBeLessThanOrEqual(oneByOne * 1.1 + papers.length);
    // A model with one price is the sum of the tokens, and that credit a paper: each call is charged in whole credits, rounded up.
    const flat = { input: haiku.input, output: haiku.output };
    const flatOneByOne = papers.reduce((sum, pages) => sum + screeningPdfCredits(flat, pages), 0);
    expect(screeningPdfsCredits(flat, pdfs)).toBeGreaterThanOrEqual(flatOneByOne);
    expect(screeningPdfsCredits(flat, pdfs)).toBeLessThanOrEqual(flatOneByOne + papers.length);
    // Ten one-page papers at a dollar a million tokens: ten calls of 89 credits, and never the 884 their tokens come to together.
    const ten = { papers: 10, pages: 10, spread: { [pdfBand(1)]: { papers: 10, pages: 10 } } };
    expect(screeningPdfsCredits({ input: 1, output: 1 }, ten)).toBeGreaterThanOrEqual(10 * screeningPdfCredits({ input: 1, output: 1 }, 1));
  });

  it("takes the longest papers for the ones still to read, and leaves out what a model's window can't hold", () => {
    const pdfs = { papers: 5, pages: 2 + 30 + 31 + 76 + 180, spread: { [pdfBand(2)]: { papers: 1, pages: 2 }, [pdfBand(30)]: { papers: 2, pages: 61 }, [pdfBand(76)]: { papers: 1, pages: 76 }, [pdfBand(180)]: { papers: 1, pages: 180 } } };
    expect(longestPdfs(pdfs, 2)).toMatchObject({ papers: 2, pages: 256 });
    // Part of a band counts its longest papers: one of the two of about 30 pages is taken as 32.
    expect(longestPdfs(pdfs, 3)).toMatchObject({ papers: 3, pages: 288 });
    expect(longestPdfs(pdfs, 9)).toBe(pdfs);
    // A window of 200,000 tokens holds 49 pages at most: the 76- and 180-page papers are not given to it, and nothing is to one that takes no file.
    expect(pdfsFor({ files: true, room: 200_000 }, pdfs)).toMatchObject({ papers: 3, pages: 63 });
    expect(pdfsFor({ files: false }, pdfs)).toEqual({ papers: 0, pages: 0 });
    expect(pdfsFor({ files: true }, pdfs)).toBe(pdfs);
    // A model that holds 128,000 tokens reads 31 pages and not 32, and both are in the band of 25 to 32. A cost keeps the band: the 31-page paper is charged. A warning drops it where its longest paper is the one that doesn't fit, and keeps it where every paper in it does.
    const edge = (most: number) => ({ papers: 2, pages: 25 + most, spread: { "3": { papers: 2, pages: 25 + most, most } } });
    expect(pdfsFor({ files: true, room: 128_000 }, edge(32)).papers).toBe(2);
    expect(pdfsFor({ files: true, room: 128_000 }, edge(32), true).papers).toBe(0);
    expect(pdfsFor({ files: true, room: 128_000 }, edge(31), true).papers).toBe(2);
  });
});
