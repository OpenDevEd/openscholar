import { creditsForUsage } from "./convert";
import { PAPER_PDF_CREDITS } from "./paper-pdf";

/** What a model charges once a prompt is long, where it charges more: every token of a call whose prompt has `from` tokens or more, in USD per million. */
export type LongPrompt = { from: number; input: number; output: number };
/** A model's price in USD per million tokens. */
export type Pricing = { input: number; output: number; long?: LongPrompt };
/**
 * A catalog model's prices as every estimate takes them, on the server and on a page. Output is priced at the
 * model's reasoning rate where that is higher, since the output an estimate holds may all be reasoning.
 * ponytail: a page's model carries no reasoning rate, and no catalog model's is above its output price (checked
 * 2026-11-26). Send it with the model (components/settings/model-map.tsx) once one is.
 */
export const pricingOf = (model: { inputPricePerMillion: number; outputPricePerMillion: number; reasoningPricePerMillion?: number; longPrompt?: LongPrompt }): Pricing => ({ input: model.inputPricePerMillion, output: Math.max(model.outputPricePerMillion, model.reasoningPricePerMillion ?? 0), ...(model.longPrompt ? { long: model.longPrompt } : {}) });
export type CallTokens = { input: number; output: number };

/**
 * The most tokens each kind of model call OpenScholar makes takes. Measured on 2026-10-06 with the
 * real prompts on GPT-6 Luna at medium effort and Claude Sonnet 5.5 at high: Claude counts about
 * two characters a token where Luna counts nearly four, and Luna's reasoning is counted as output.
 */
export const CALL_TOKENS = {
  /** One question about a paper's abstract, one paper screened, or Jev's yes/no answers for a paper: at most 3,049 in and 497 out. */
  paper: { input: 3_500, output: 600 },
  /** One question answered from a PDF: the abstract prompt with up to 16 passages of 900 characters. */
  pdfQuestion: { input: 11_000, output: 600 },
  /** Jev's yes/no answers for a paper read from its full text: up to the 28,000 tokens a decision request takes (lib/ai/decisions.ts). */
  pdfDecision: { input: 28_000, output: 600 },
  /** Indexing one PDF's text for its questions to search, at the embedding model's price: a paper of about 60 pages. */
  pdfIndex: { input: 50_000, output: 0 },
  /** One search, translation or question-writing helper, or one paper's title and abstract translated: at most 1,960 in and 1,433 out. */
  helper: { input: 2_000, output: 1_500 },
  /** What a chat reply's first request reads and writes: a conversation of some length. */
  chatMessage: { input: 20_000, output: 1_000 },
  /** One AI overview of a search (#967), all its steps: measured on 2026-10-29 on Claude Haiku 5.5 at medium effort at most 13,887 in and 1,504 out. */
  overview: { input: 16_000, output: 1_800 },
  /** The most one request of a chat reply reads, the conversation before it's summarized (convex/assistant/context.ts `COMPACT_AT_TOKENS`), and writes. */
  chatRequest: { input: 50_000, output: 4_000 },
} as const satisfies Record<string, CallTokens>;

/** The embedding model PDFs are indexed with (OpenAI text-embedding-3-small). */
export const EMBEDDING_PRICING: Pricing = { input: 0.02, output: 0 };

/**
 * What `calls` calls of these tokens cost on a model: the tokens at its price, converted to credits
 * as a charge is (./convert.ts). Every estimate, hold and balance check goes through it, as
 * OpenRouter holds a request's tokens at the model's price before it runs, and Firecrawl and
 * LiteLLM price a call from a per-model price table.
 */
export function estimateCredits(pricing: Pricing, tokens: CallTokens, calls = 1, markup?: number): number {
  if (calls <= 0) return 0;
  const credits = creditsForUsage({ inputTokens: tokens.input, outputTokens: tokens.output }, pricing, markup);
  return credits * calls;
}

/** The models an extraction sends its questions to: its own, and Jev for yes/no questions when the person screens with it. */
export type ExtractionPricing = { model: Pricing; decision?: Pricing };

/**
 * What one paper of an extraction costs at most: each question on the job's model, its yes/no
 * questions in one call to Jev when it has one, and getting and indexing the paper's PDF when it reads
 * one and hasn't yet (a retry asks again of a paper already read): a copy from the store or OpenAlex costs
 * PAPER_PDF_CREDITS.
 */
export function extractionPaperCredits(pricing: ExtractionPricing, questions: ReadonlyArray<{ type: string }>, pdf: boolean, index = pdf): number {
  const yesNo = pricing.decision ? questions.filter((asked) => asked.type === "boolean").length : 0;
  return (
    estimateCredits(pricing.model, pdf ? CALL_TOKENS.pdfQuestion : CALL_TOKENS.paper, questions.length - yesNo) +
    (yesNo && pricing.decision ? estimateCredits(pricing.decision, pdf ? CALL_TOKENS.pdfDecision : CALL_TOKENS.paper) : 0) +
    (index ? estimateCredits(EMBEDDING_PRICING, CALL_TOKENS.pdfIndex) + PAPER_PDF_CREDITS : 0)
  );
}

/**
 * The most asking `count` of an extraction's failed questions again costs, before they're read,
 * the PDF already indexed. Which questions failed isn't counted, so as many as can be are taken
 * to be ones the job's model answers, at most `textPerPaper` a paper of `papers`; the rest are
 * yes/no questions, each at most one call to Jev. Each paper then holds its own questions exactly
 * (`extractionPaperCredits`), which is never more.
 */
export function extractionRetryCredits(pricing: ExtractionPricing, count: number, pdf: boolean, { textPerPaper, papers }: { textPerPaper: number; papers: number }): number {
  const text = pricing.decision ? Math.min(count, textPerPaper * papers) : count;
  return (
    estimateCredits(pricing.model, pdf ? CALL_TOKENS.pdfQuestion : CALL_TOKENS.paper, text) +
    (pricing.decision ? estimateCredits(pricing.decision, pdf ? CALL_TOKENS.pdfDecision : CALL_TOKENS.paper, count - text) : 0)
  );
}

/** What screening one paper costs at most on a model: one call about its abstract, every question answered in it. */
export function screeningPaperCredits(pricing: Pricing): number {
  return estimateCredits(pricing, CALL_TOKENS.paper);
}

/**
 * Tokens one page of a PDF takes when a model is sent the file, and what the criteria and its answers add to a
 * paper read that way. Measured on a 76-page report sent whole: 3,155 a page on Haiku 5.5, 3,998 on GPT-6 Luna.
 */
export const SCREENING_PDF_TOKENS = { page: 4_000, asked: 2_000, answer: 800 };
/** The tokens a paper screened as its PDF takes at most: every page of it, with the criteria. */
export const screeningPdfTokens = (pages: number) => pages * SCREENING_PDF_TOKENS.page + SCREENING_PDF_TOKENS.asked;
/** Whether a model can be given a paper that is only its PDF: it takes a file, and every page of this one fits what one call to it holds. */
export const readsPdfOf = (model: { files: boolean; room?: number } | undefined, pages: number) => Boolean(model?.files) && (model!.room === undefined || screeningPdfTokens(pages) <= model!.room);
/** What screening one paper as its PDF costs at most on a model: one call with its whole file, at the model's long-prompt price where that many pages reach it. */
export const screeningPdfCredits = (pricing: Pricing, pages: number) => estimateCredits(pricing, { input: screeningPdfTokens(pages), output: SCREENING_PDF_TOKENS.answer });

/**
 * A screening's papers read as their PDFs, by length: how many, their pages, and the same for the ones in each
 * band of PDF_BAND pages (band 0 holds papers of 1 to 8 pages, band 1 of 9 to 16). The bands are what lets a
 * model that charges more for a long prompt, or that holds only so many pages, be priced without reading every
 * paper again. A band says how long its longest paper is (`most`), so a paper past what a model holds is never
 * taken for one it reads. A paper whose pages nobody counted is in no band.
 */
export type Pdfs = { papers: number; pages: number; spread?: Record<string, { papers: number; pages: number; most?: number }> };
export const PDF_BAND = 8;
/** How many bands there are: the last one holds every paper longer than it starts at, 1,017 pages. */
export const PDF_BANDS = 128;
export const pdfBand = (pages: number) => Math.min(PDF_BANDS - 1, Math.max(0, Math.ceil(pages / PDF_BAND) - 1));
const bandsOf = (pdfs: Pdfs) => Object.entries(pdfs.spread ?? {}).map(([band, held]) => ({ band, held, fewest: Number(band) * PDF_BAND + 1, most: (Number(band) + 1) * PDF_BAND }));

/**
 * What screening those papers costs at most on a model: one call a paper with its whole file. A band is taken
 * at the long-prompt price when its longest paper would be (`screeningPdfCredits`), so the sum is never under
 * what the papers cost one by one.
 */
export function screeningPdfsCredits(pricing: Pricing, pdfs: Pdfs): number {
  const { long } = pricing;
  const dear = long ? bandsOf(pdfs).filter(({ most }) => screeningPdfTokens(most) >= long.from) : [];
  const [longPapers, longPages] = [dear.reduce((sum, { held }) => sum + held.papers, 0), dear.reduce((sum, { held }) => sum + held.pages, 0)];
  const part = (price: { input: number; output: number }, papers: number, pages: number) =>
    estimateCredits({ input: price.input, output: price.output }, { input: pages * SCREENING_PDF_TOKENS.page + papers * SCREENING_PDF_TOKENS.asked, output: papers * SCREENING_PDF_TOKENS.answer });
  return part(pricing, Math.max(0, pdfs.papers - longPapers), Math.max(0, pdfs.pages - longPages)) + (long ? part(long, longPapers, longPages) : 0);
}

/**
 * Of those papers, the ones a model is given (`readsPdfOf`): none where it takes no file, and none of a band that
 * is more than one call to it holds. A cost keeps a band whose shortest paper fits, so it is never under what is
 * charged. A warning (`sure`) keeps only a band whose longest paper fits, so a paper nobody can read is never
 * passed over: it may count the shorter papers of that one band with it.
 */
export function pdfsFor(model: { files: boolean; room?: number } | undefined, pdfs: Pdfs, sure = false): Pdfs {
  if (!model?.files) return { papers: 0, pages: 0 };
  const past = bandsOf(pdfs).filter(({ fewest, most, held }) => !readsPdfOf(model, sure ? held.most ?? most : fewest));
  if (!past.length) return pdfs;
  const gone = new Set(past.map(({ band }) => band));
  return { papers: pdfs.papers - past.reduce((sum, { held }) => sum + held.papers, 0), pages: pdfs.pages - past.reduce((sum, { held }) => sum + held.pages, 0), spread: Object.fromEntries(Object.entries(pdfs.spread ?? {}).filter(([band]) => !gone.has(band))) };
}

/** The `count` longest of those papers, a band at a time from the longest: the most that many papers still to read can hold. */
export function longestPdfs(pdfs: Pdfs, count: number): Pdfs {
  if (count >= pdfs.papers) return pdfs;
  const spread: NonNullable<Pdfs["spread"]> = {};
  let [papers, pages] = [0, 0];
  for (const { band, held, most } of bandsOf(pdfs).sort((a, b) => b.most - a.most)) {
    const take = Math.min(held.papers, count - papers);
    if (take <= 0) break;
    // Part of a band is taken as its longest papers.
    spread[band] = { papers: take, pages: take === held.papers ? held.pages : Math.min(held.pages, take * most) };
    papers += take;
    pages += spread[band]!.pages;
  }
  return { papers: Math.max(0, count), pages, spread };
}

/** The pages a paper prints its title, its authors and its DOI on: what the first reading of a PDF handed to a screening is sent. */
export const PDF_LOOK_PAGES = 2;
/** What that first reading costs at most on a model: those pages as a file, and the few lines it copies from them. */
export const pdfLookCredits = (pricing: Pricing) => estimateCredits(pricing, { input: PDF_LOOK_PAGES * SCREENING_PDF_TOKENS.page + 500, output: 400 });

/** Tokens a text takes at most: Claude counts about two characters a token, the fewest of the models measured. */
export function tokensIn(text: string): number {
  return Math.ceil(text.length / 2);
}
