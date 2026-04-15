/**
 * Eval test runner for extraction quality.
 *
 * Uses vitest-evals describeEval with two scorers:
 *   1. Factuality (autoevals) - compares extracted answer to expected answer
 *   2. citationSubstringMatchScorer - verifies evidence quote matches source span
 *
 * Gated by RUN_EVALS=1 to prevent LLM calls during normal test runs.
 *
 * Aggregate thresholds:
 *   - recall-on-include >= 95%
 *   - citation-validity-rate >= 98%
 */

import { describe, it, expect } from "vitest";
import { describeEval } from "vitest-evals";
import { Factuality } from "autoevals";
import { distance } from "fastest-levenshtein";
import { SCREENING_GOLDEN_SET, type GoldenCase } from "./screening-golden";
import { extractAnswers } from "../../convex/extraction/extract";

// ---------------------------------------------------------------------------
// Custom citation-substring-match scorer
// ---------------------------------------------------------------------------

async function citationSubstringMatchScorer({
  output,
  expected,
}: {
  output: string;
  expected?: string;
}): Promise<{ score: number }> {
  if (!expected || !output) return { score: 0 };

  // Parse the expected JSON (contains expectedSourceSpan + paperBodyText)
  const meta = JSON.parse(expected) as {
    expectedSourceSpan: { startChar: number; endChar: number };
    paperBodyText: string;
  };

  const { startChar, endChar } = meta.expectedSourceSpan;
  const sourceSlice = meta.paperBodyText.slice(startChar, endChar);

  // Parse the output to get evidence_quote
  let evidenceQuote: string;
  try {
    const parsed = JSON.parse(output) as { evidenceQuote?: string };
    evidenceQuote = parsed.evidenceQuote ?? "";
  } catch {
    evidenceQuote = output;
  }

  if (!evidenceQuote || !sourceSlice) return { score: 0 };

  const maxLen = Math.max(evidenceQuote.length, sourceSlice.length);
  const similarity =
    maxLen === 0 ? 1 : 1 - distance(evidenceQuote, sourceSlice) / maxLen;

  return { score: similarity >= 0.85 ? 1.0 : 0.0 };
}

// ---------------------------------------------------------------------------
// Aggregate result tracking for threshold assertions
// ---------------------------------------------------------------------------

const results: {
  case: GoldenCase;
  answer: string | null;
  evidenceQuote?: string;
  criticVerdict?: string;
}[] = [];

// ---------------------------------------------------------------------------
// Eval suite (gated by RUN_EVALS=1)
// ---------------------------------------------------------------------------

describe.skipIf(process.env.RUN_EVALS !== "1")(
  "screening golden set evals",
  () => {
    // Per-case eval using describeEval
    describeEval("extraction quality per case", {
      data: async () =>
        SCREENING_GOLDEN_SET.map((golden) => ({
          // describeEval requires `input` as string -- encode case as JSON
          input: JSON.stringify({
            paperBodyText: golden.paperBodyText,
            question: golden.question,
          }),
          // `expected` flows to scorers
          expected: golden.expectedAnswer,
          // `name` is used as the test name
          name: `[${golden.expectedVerdict}] ${golden.paperId}: ${golden.question.slice(0, 60)}`,
        })),

      task: async (input: string) => {
        const parsed = JSON.parse(input) as {
          paperBodyText: string;
          question: string;
        };

        const results_batch = await extractAnswers(
          parsed.paperBodyText,
          [{ key: "q1", question: parsed.question }],
        );

        const result = results_batch[0];
        if (!result) return "";

        // Find the matching golden case to track for aggregate assertions
        const matchingCase = SCREENING_GOLDEN_SET.find(
          (g) => g.question === parsed.question,
        );
        if (matchingCase) {
          results.push({
            case: matchingCase,
            answer: result.answer,
            evidenceQuote: result.evidenceQuote,
            criticVerdict: result.criticVerdict,
          });
        }

        return result.answer ?? "";
      },

      scorers: [
        // Factuality scorer: compares extracted answer to expected answer
        async ({ input, output, expected }) => {
          const factualityResult = await Factuality({
            input,
            output,
            expected,
          });
          return {
            score: factualityResult.score ?? 0,
            metadata: factualityResult.metadata,
          };
        },
      ],

      // Set threshold to null -- we do aggregate assertions separately
      threshold: null,
      timeout: 120_000,
    });

    // Citation substring match eval (separate describeEval for citation scoring)
    describeEval("citation substring match per case", {
      data: async () =>
        SCREENING_GOLDEN_SET.map((golden) => ({
          input: JSON.stringify({
            paperBodyText: golden.paperBodyText,
            question: golden.question,
          }),
          // For citation scorer, expected contains source span metadata
          expected: JSON.stringify({
            expectedSourceSpan: golden.expectedSourceSpan,
            paperBodyText: golden.paperBodyText,
          }),
          name: `[citation] ${golden.paperId}: ${golden.question.slice(0, 60)}`,
        })),

      task: async (input: string) => {
        const parsed = JSON.parse(input) as {
          paperBodyText: string;
          question: string;
        };

        const results_batch = await extractAnswers(
          parsed.paperBodyText,
          [{ key: "q1", question: parsed.question }],
        );

        const result = results_batch[0];
        if (!result) return JSON.stringify({ evidenceQuote: "" });

        return JSON.stringify({ evidenceQuote: result.evidenceQuote ?? "" });
      },

      scorers: [citationSubstringMatchScorer],
      threshold: null,
      timeout: 120_000,
    });

    // Aggregate threshold assertions
    it("meets recall-on-include threshold (>= 95%)", () => {
      // Skip if no results collected (evals didn't run)
      if (results.length === 0) return;

      const includeCases = results.filter(
        (r) => r.case.expectedVerdict === "include",
      );
      const correctIncludes = includeCases.filter((r) => {
        // An include case is "recalled" if the extraction returned a non-insufficient answer
        return r.answer !== null && r.answer !== "insufficient_evidence";
      });
      const recall =
        includeCases.length > 0
          ? correctIncludes.length / includeCases.length
          : 0;
      expect(recall).toBeGreaterThanOrEqual(0.95);
    });

    it("meets citation-validity-rate threshold (>= 98%)", () => {
      // Skip if no results collected (evals didn't run)
      if (results.length === 0) return;

      const casesWithCitations = results.filter((r) => r.evidenceQuote);
      const validCitations = casesWithCitations.filter((r) => {
        const span = r.case.expectedSourceSpan;
        const sourceSlice = r.case.paperBodyText.slice(
          span.startChar,
          span.endChar,
        );
        const maxLen = Math.max(
          (r.evidenceQuote ?? "").length,
          sourceSlice.length,
        );
        const similarity =
          maxLen === 0
            ? 1
            : 1 -
              distance(r.evidenceQuote ?? "", sourceSlice) / maxLen;
        return similarity >= 0.85;
      });
      const rate =
        casesWithCitations.length > 0
          ? validCitations.length / casesWithCitations.length
          : 1;
      expect(rate).toBeGreaterThanOrEqual(0.98);
    });
  },
);
