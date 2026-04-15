"use node";

/**
 * Quality sampling action for hourly production monitoring (EVAL-04).
 *
 * Picks 1 random eligible extraction answer, re-runs the critic,
 * and writes the verdict to the qualityChecks table.
 *
 * "use node" file -- only exports internalAction (Pitfall 6).
 * DB access via ctx.runQuery / ctx.runMutation through helpers file.
 */

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import { buildCriticPrompt } from "../../lib/ai/core/prompts";

const criticOutputSchema = z.object({
  verdict: z
    .enum(["supported", "unsupported", "partial"])
    .describe(
      "Whether the evidence quote appears verbatim in the source and supports the answer"
    ),
  reason: z.string().describe("Brief explanation of the verdict"),
});

export const sampleAndCheck = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // 1. Get a random eligible result (completed, has criticVerdict, not sampled in last 7 days)
    const sample = await ctx.runQuery(
      internal.extraction.qualitySamplingHelpers.getRandomEligibleResult,
      {}
    );
    if (!sample) {
      // D-14: No eligible results -- early-return silently
      return null;
    }

    // 2. Load paper body text for critic re-run
    const paper = await ctx.runQuery(
      internal.extraction.qualitySamplingHelpers.getPaperBodyTextInternal,
      { paperId: sample.paperId }
    );
    if (!paper || !paper.bodyText) {
      console.info(
        JSON.stringify({
          event: "quality_sample_skip",
          reason: "no_body_text",
          answerId: String(sample._id),
        })
      );
      return null;
    }

    // 3. Load the question text for critic prompt
    const question = await ctx.runQuery(
      internal.extraction.qualitySamplingHelpers.getQuestionText,
      { jobId: sample.jobId, questionId: sample.questionId }
    );
    if (!question) {
      console.info(
        JSON.stringify({
          event: "quality_sample_skip",
          reason: "no_question",
          answerId: String(sample._id),
        })
      );
      return null;
    }

    // 4. Build critic prompt using existing infrastructure
    const sourceSlice = paper.bodyText.slice(
      sample.evidenceStartChar ?? 0,
      sample.evidenceEndChar ?? paper.bodyText.length
    );
    const criticPrompts = buildCriticPrompt({
      question,
      answer: sample.answer ?? "",
      evidenceQuote: sample.evidenceQuote ?? "",
      sourceSlice,
    });

    // 5. Run critic via OpenRouter (same model tier as runtime critic)
    const openrouter = createOpenRouter();
    const judgeModel = "google/gemini-2.5-flash-lite";
    const model = openrouter(judgeModel, {
      plugins: [{ id: "response-healing" }],
      provider: { allowFallbacks: true },
    });

    try {
      const { output: criticResult } = await generateText({
        model,
        output: Output.object({ schema: criticOutputSchema }),
        temperature: 0,
        system: criticPrompts.system,
        prompt: criticPrompts.prompt,
        abortSignal: AbortSignal.timeout(30_000),
      });

      const verdict = criticResult?.verdict ?? "partial";

      // 6. Determine reviewStatus per D-19
      const reviewStatus = verdict === "unsupported" ? "pending" : "reviewed";

      // 7. Write quality check via mutation
      await ctx.runMutation(
        internal.extraction.qualitySamplingHelpers.writeQualityCheck,
        {
          answerId: sample._id,
          verdict,
          judgeModel,
          timestamp: Date.now(),
          reviewStatus,
        }
      );

      console.info(
        JSON.stringify({
          event: "quality_sample_complete",
          answerId: String(sample._id),
          verdict,
          judgeModel,
          reviewStatus,
        })
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "quality_sample_error",
          answerId: String(sample._id),
          errorMessage:
            error instanceof Error ? error.message : String(error),
        })
      );
    }

    return null;
  },
});
