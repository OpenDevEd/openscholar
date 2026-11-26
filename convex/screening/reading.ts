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
import { sentencesOf } from "../../lib/screening/passages";
import { answerOf } from "../../lib/screening/rules";
import { screeningPaperCredits } from "../../lib/pricing";
import { readsPdfOf, screeningPdfCredits } from "../../lib/pricing/estimate";
import type { AITrackingEntry } from "../../lib/posthog-ai-shared";
import { outOfCredits, withUserCredits } from "../ai/helpers";
import { openRouterModel } from "../ai/provider";
import { createError } from "../lib/errors";
import { MODEL_UNAVAILABLE_MESSAGE } from "../models/catalog";
import { readingValidator } from "./readings";

/** A criterion as the model is asked it: the question, with the guidance its organiser wrote for whoever answers. */
const asked = (criterion: { text: string; note?: string }) => (criterion.note?.trim() ? `${criterion.text} (Guidance: ${criterion.note.trim()})` : criterion.text);


export const readPaper = internalAction({
  args: { voteId: v.id("screeningVotes") },
  returns: readingValidator,
  handler: async (ctx, { voteId }): Promise<typeof readingValidator.type> => {
    const context = await ctx.runQuery(internal.screening.readings.context, { voteId });
    if (!context?.go) return { read: false, why: "held" };
    if (!context.model.available) throw createError("VALIDATION_ERROR", MODEL_UNAVAILABLE_MESSAGE);
    const pricing = { input: context.model.input, output: context.model.output };
    const questions = context.criteria.map(asked);
    // A paper with no abstract is read as the PDF it is, every page of it, the way the assistant gives a model a file.
    const { file, pages = 0 } = context.paper.abstract ? { file: undefined } : context.paper;
    // A model is given a paper that is only its PDF where it can read it (./dealing.ts `teamFor`): this holds for one that got here another way.
    if (file && !readsPdfOf(context.model, pages)) return { read: false, why: "unreadable", error: context.model.files ? `This PDF has ${pages.toLocaleString("en-GB")} pages, more than ${context.model.name} reads at once.` : `${context.model.name} can't read a PDF. It reads papers that have an abstract.` };
    const address = file ? await ctx.storage.getUrl(file) : null;
    if (file && !address) return { read: false, why: "unreadable", error: "This paper's PDF is gone." };
    try {
      const { result, credits } = await withUserCredits<ScreeningReadData>(
        ctx,
        { userId: context.userId, workspaceId: context.workspaceId, chargeId: `screening:${voteId}:${crypto.randomUUID()}`, estimate: file ? screeningPdfCredits(pricing, pages) : screeningPaperCredits(pricing), hold: false, balance: context.balance, clerkId: context.clerkId, kind: "screening", description: "Screening", model: context.model.slug },
        pricing,
        async () => {
          const batch = await processScreeningBatch({ model: await openRouterModel(context.model.slug), effort: context.effort, decisionsKey: process.env.OPENROUTER_API_KEY, sessionId: String(context.jobId), papers: [{ id: voteId, title: context.paper.title, abstract: context.paper.abstract ?? "", ...(address ? { file: { data: new URL(address), filename: "paper.pdf" } } : {}) }], questions, passages: true });
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
      // A sentence it named is kept where the abstract has one at that number, as the page cuts it (lib/screening/passages.ts).
      const sentences = sentencesOf(context.paper.abstract ?? "").length;
      const named = (at: number | null | undefined): at is number => typeof at === "number" && Number.isInteger(at) && at >= 0 && at < sentences;
      const passages = result.passages ? Object.fromEntries(context.criteria.flatMap((criterion, i) => (named(result.passages![questions[i]!]) ? [[criterion.key, result.passages![questions[i]!]!]] : []))) : undefined;
      return { read: true, answers, confidences, ...(passages && Object.keys(passages).length ? { passages } : {}), credits };
    } catch (error) {
      // The workspace can't pay for this paper: its screening's models stop where they are until it can.
      if (outOfCredits(error)) return { read: false, why: "credits" };
      throw error;
    }
  },
});
