import { creditsForUsage } from "./convert";

/** A model's price in USD per million tokens. */
export type Pricing = { input: number; output: number };
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
  /** Indexing one PDF's text for its questions to search, at the embedding model's price: a paper of about 60 pages. */
  pdfIndex: { input: 50_000, output: 0 },
  /** One search, translation or question-writing helper, or one paper's title and abstract translated: at most 1,960 in and 1,433 out. */
  helper: { input: 2_000, output: 1_500 },
  /** What a chat reply's first request reads and writes: a conversation of some length. */
  chatMessage: { input: 20_000, output: 1_000 },
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
 * questions in one call to Jev when it has one, and indexing the paper's PDF when it reads one.
 */
export function extractionPaperCredits(pricing: ExtractionPricing, questions: ReadonlyArray<{ type: string }>, pdf: boolean): number {
  const yesNo = pricing.decision ? questions.filter((asked) => asked.type === "boolean").length : 0;
  return (
    estimateCredits(pricing.model, pdf ? CALL_TOKENS.pdfQuestion : CALL_TOKENS.paper, questions.length - yesNo) +
    (yesNo && pricing.decision ? estimateCredits(pricing.decision, CALL_TOKENS.paper) : 0) +
    (pdf ? estimateCredits(EMBEDDING_PRICING, CALL_TOKENS.pdfIndex) : 0)
  );
}

/** What asking `count` of an extraction's questions again costs at most: each on the job's model, its PDF already indexed. */
export function extractionRetryCredits(pricing: ExtractionPricing, count: number, pdf: boolean): number {
  return estimateCredits(pricing.model, pdf ? CALL_TOKENS.pdfQuestion : CALL_TOKENS.paper, count);
}

/** What screening one paper costs at most on a model: one call about its abstract, every question answered in it. */
export function screeningPaperCredits(pricing: Pricing): number {
  return estimateCredits(pricing, CALL_TOKENS.paper);
}

/** Tokens a text takes at most: Claude counts about two characters a token, the fewest of the models measured. */
export function tokensIn(text: string): number {
  return Math.ceil(text.length / 2);
}
