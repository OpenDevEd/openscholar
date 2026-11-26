"use node";

/**
 * One model's reading of one paper, as work in the pool (plans/screening-reviewers). It asks the model every
 * criterion in one call, charges the screening's workspace for it, and returns the answers for the pool's
 * callback to keep (./readings.ts `done`). The paper's call is the one Screen all always made
 * (lib/ai/core/batch.ts): what made that fast still holds, and nothing here reads more than one query.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { processScreeningBatch } from "../../lib/ai/core/batch";
import type { ScreeningReadData } from "../../lib/ai/core/batch-types";
import { answerOf } from "../../lib/screening/setup";
import { screeningPaperCredits } from "../../lib/pricing";
import type { AITrackingEntry } from "../../lib/posthog-ai-shared";
import { withUserCredits } from "../ai/helpers";
import { openRouterModel } from "../ai/provider";
import { createError } from "../lib/errors";
import { MODEL_UNAVAILABLE_MESSAGE } from "../models/catalog";
import { readingValidator } from "./readings";

/** A criterion as the model is asked it: the question, with the guidance its organiser wrote for whoever answers. */
const asked = (criterion: { text: string; note?: string }) => (criterion.note?.trim() ? `${criterion.text} (Guidance: ${criterion.note.trim()})` : criterion.text);

const outOfCredits = (error: unknown) => error instanceof Error && (error.message.includes("AI_INSUFFICIENT_CREDITS") || (error as { data?: { code?: string } }).data?.code === "AI_INSUFFICIENT_CREDITS");

export const readPaper = internalAction({
  args: { voteId: v.id("screeningVotes") },
  returns: readingValidator,
  handler: async (ctx, { voteId }): Promise<typeof readingValidator.type> => {
    const context = await ctx.runQuery(internal.screening.readings.context, { voteId });
    if (!context?.go) return { read: false, why: "held" };
    if (!context.model.available) throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
    const pricing = { input: context.model.input, output: context.model.output };
    const questions = context.criteria.map(asked);
    try {
      const { result, credits } = await withUserCredits<ScreeningReadData>(
        ctx,
        { userId: context.userId, workspaceId: context.workspaceId, chargeId: `screening:${voteId}:${crypto.randomUUID()}`, estimate: screeningPaperCredits(pricing), hold: false, balance: context.balance, clerkId: context.clerkId, kind: "screening", description: "Screening", model: context.model.slug },
        pricing,
        async () => {
          const batch = await processScreeningBatch({ model: await openRouterModel(context.model.slug), effort: context.effort, decisionsKey: process.env.OPENROUTER_API_KEY, sessionId: String(context.jobId), papers: [{ id: voteId, title: context.paper.title, abstract: context.paper.abstract ?? "" }], questions });
          const totalUsage = batch.usages[0] ?? { inputTokens: 0, outputTokens: 0 };
          const tracking = batch.trackingByItemId[voteId];
          const trackingEntries: AITrackingEntry[] = tracking ? [{ feature: "workpool_screening", usage: { inputTokens: totalUsage.inputTokens ?? totalUsage.promptTokens ?? 0, outputTokens: totalUsage.outputTokens ?? totalUsage.completionTokens ?? 0 }, latencyMs: tracking.latencyMs, temperature: tracking.temperature }] : [];
          const read = batch.results[voteId];
          // The model's own error is why the reading failed, where it gave one.
          if (!read) throw new Error(batch.errors[0]?.error ?? "The model returned nothing for this paper.");
          return { result: read, totalUsage, trackingEntries };
        },
      );
      // By criterion, in the order they were asked.
      const answers = Object.fromEntries(context.criteria.map((criterion, i) => [criterion.key, answerOf(result.responses[questions[i]!] ?? null)]));
      const confidences = Object.fromEntries(context.criteria.flatMap((criterion, i) => (result.confidences[questions[i]!] === undefined ? [] : [[criterion.key, result.confidences[questions[i]!]!]])));
      const passages = result.passages ? Object.fromEntries(context.criteria.flatMap((criterion, i) => (typeof result.passages![questions[i]!] === "number" ? [[criterion.key, result.passages![questions[i]!]!]] : []))) : undefined;
      return { read: true, answers, confidences, ...(passages && Object.keys(passages).length ? { passages } : {}), credits };
    } catch (error) {
      // The workspace can't pay for this paper: its screening's models stop where they are until it can.
      if (outOfCredits(error)) return { read: false, why: "credits" };
      throw error;
    }
  },
});
