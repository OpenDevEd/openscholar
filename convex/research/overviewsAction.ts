"use node";

import { v } from "convex/values";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { resolveOpenRouterModel } from "../ai/provider";
import { releaseCredits, reserveCredits, settleCredits, tokenDetails } from "../billing/charge";
import { groupSearch, readSearchWorks, type SearchRequest } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { callOptions } from "../../lib/ai/core/call-options";
import { calculateCostInDollars, usageOf } from "../../lib/ai/core/cost";
import { pickProviderCostUsd } from "../../lib/ai/pick-provider-cost";
import { convertUsdToCredits } from "../../lib/pricing";
import { CALL_TOKENS, estimateCredits } from "../../lib/pricing/estimate";
import { GROUPINGS, type Grouping } from "./searchValidators";
import { GROUPS_KEPT, PAPERS_KEPT } from "./overviewValidators";
import { runArgs } from "./overviews";

/** Model steps one overview may take: a few counts and paper reads, then the writing. */
const STEPS = 6;
/** Groups the model reads of a count, other than by year: the largest. */
const GROUPS_READ = 15;
/** Characters of an abstract the model reads. */
const ABSTRACT_READ = 700;

type Years = { from?: number; to?: number };

/** The search narrowed to a span of years, both included. */
function within(request: SearchRequest, years?: Years): SearchRequest {
  if (!years?.from && !years?.to) return request;
  const span = years.from && years.to ? `${years.from}-${years.to}` : years.from ? `>${years.from - 1}` : `<${(years.to ?? 0) + 1}`;
  return { ...request, filter: [request.filter, `publication_year:${span}`].filter(Boolean).join(",") };
}

const SORTS = { cited: "cited_by_count:desc", newest: "publication_date:desc" } as const;

type Work = { id: string; display_name?: string; publication_year?: number; cited_by_count?: number; abstract_inverted_index?: Record<string, number[]> | null };
const abstractOf = (index: Work["abstract_inverted_index"]) => {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, places] of Object.entries(index)) for (const place of places) words[place] = word;
  return words.join(" ").slice(0, ABSTRACT_READ);
};

/**
 * Writes an AI overview of a search through a lens (#967) on the Cheap preset's chat model: it counts the search and
 * reads its papers with two tools, and its whole lines are stored as they're written, so the page shows each
 * paragraph as it ends. A paid one holds its estimate first and is charged what it cost. ./overviews.ts decides
 * whether it runs.
 */
export const run = internalAction({
  args: runArgs,
  returns: v.null(),
  handler: async (ctx, { overviewId, startedAt, request, instruction, modelId, effort }) => {
    const start = await ctx.runMutation(internal.research.overviews.startRun, { overviewId, startedAt });
    if (!start) return null;
    const { userId, workspaceId, paid } = start;
    const chargeId = `overview:${overviewId}:${Date.now()}`;
    const began = Date.now();
    let held = false;
    let settled = false;
    const progress = (update: { step?: string; text?: string; count?: object; list?: object }) => ctx.runMutation(internal.research.overviews.progress, { overviewId, startedAt, ...update } as never);
    try {
      const { model, modelSlug, pricing } = await resolveOpenRouterModel(ctx, modelId);
      if (paid) {
        held = await reserveCredits(ctx, { userId, workspaceId, chargeId, credits: estimateCredits(pricing, CALL_TOKENS.overview) });
        if (!held) throw new Error("Not enough credits for an overview");
      }
      const spend = spender(ctx, start.clerkId);
      let counts = 0;
      let lists = 0;
      const years = z.object({ from: z.number().int().optional(), to: z.number().int().optional() }).optional().describe("Only papers published in these years, both included.");
      const result = streamText({
        model,
        system: SYSTEM(new Date().getUTCFullYear()),
        prompt: `What the person wants to know about this search: ${instruction}`,
        stopWhen: isStepCount(STEPS),
        maxRetries: 1,
        providerOptions: callOptions(model, { effort }),
        tools: {
          count: tool({
            description: `How many of the search's papers fall in each group, and the total: by ${Object.keys(GROUPINGS).join(", ")}. By year it returns up to the latest ${GROUPS_KEPT} years in order; otherwise the largest ${GROUPS_READ} groups. One call per grouping; use years to compare periods.`,
            inputSchema: z.object({ by: z.enum(Object.keys(GROUPINGS) as [Grouping, ...Grouping[]]), years }),
            execute: async ({ by, years: span }) => {
              await progress({ step: `count:${by}:${span?.from ?? ""}:${span?.to ?? ""}` });
              const { total, groups: all } = await groupSearch(within(request, span), GROUPINGS[by], spend);
              const named = all.map(({ key, name, count }) => ({ key: key.split("/").at(-1)!, name, count })).filter((group) => group.key !== "unknown");
              const groups = by === "year" ? named.sort((a, b) => Number(a.key) - Number(b.key)).slice(-GROUPS_KEPT) : named.slice(0, GROUPS_READ);
              const id = `c${++counts}`;
              await progress({ count: { id, by, total, groups, ...(span ? { years: span } : {}) } });
              return { chart: id, total, groups: groups.map(({ name, count }) => ({ name, count })) };
            },
          }),
          papers: tool({
            description: `Up to ${PAPERS_KEPT} of the search's papers, with title, year, citations and the start of the abstract: the most cited, the newest, or the most relevant.`,
            inputSchema: z.object({ sort: z.enum(["cited", "newest", "relevance"]), count: z.number().int().min(1).max(PAPERS_KEPT), years }),
            execute: async ({ sort, count, years: span }) => {
              await progress({ step: `papers:${sort}` });
              const sorted = sort === "relevance" ? within(request, span) : { ...within(request, span), sort: SORTS[sort] };
              const works = await readSearchWorks<Work>(sorted, { first: 1, last: count, select: "id,display_name,publication_year,cited_by_count,abstract_inverted_index" }, spend);
              const papers = works.map((work) => ({ id: work.id.split("/").at(-1)!, title: work.display_name ?? "", ...(work.publication_year ? { year: work.publication_year } : {}), cited: work.cited_by_count ?? 0 }));
              const id = `p${++lists}`;
              await progress({ list: { id, papers } });
              return { list: id, papers: papers.map((paper, i) => ({ ...paper, abstract: abstractOf(works[i].abstract_inverted_index) })) };
            },
          }),
        },
      });
      let text = "";
      let stored = 0;
      let usd = 0;
      let writing = false;
      for await (const part of result.stream) {
        if (part.type === "text-delta" && part.text) {
          if (!writing) await progress({ step: "writing" });
          writing = true;
          text += part.text;
          // Whole lines only, so a paragraph shows once and never grows in place.
          const end = text.lastIndexOf("\n") + 1;
          if (end > stored) {
            stored = end;
            await progress({ text: text.slice(0, end) });
          }
        } else if (part.type === "start-step") {
          // A step that writes after a tool call starts a paragraph of its own.
          if (text && !text.endsWith("\n")) text += "\n";
          writing = false;
        } else if (part.type === "finish-step") {
          usd += pickProviderCostUsd(part.providerMetadata) ?? 0;
        } else if (part.type === "tool-error") {
          console.error(JSON.stringify({ event: "search-overview-tool-failed", overviewId, tool: part.toolName, error: String(part.error) }));
        } else if (part.type === "error") throw part.error;
      }
      // An overview read nothing of the search when every count and paper read failed (OpenAlex refused, say): what the
      // model wrote then rests on nothing, so it isn't kept or charged, and the person gets the overview back.
      if (!text.trim() || counts + lists === 0) throw new Error(`Nothing read or written: ${counts} counts, ${lists} lists, ${text.length} characters`);
      const usage = usageOf({ usage: await result.totalUsage });
      // On our own provider key OpenRouter reports what it charges, nothing, not what the call cost: then it's the tokens at the model's price.
      if (!usd) usd = calculateCostInDollars({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, pricing);
      const credits = paid ? convertUsdToCredits({ usd }) || 1 : 0;
      // Charged only when this run is still the one writing the overview: one a newer run replaced is released instead.
      const kept = await ctx.runMutation(internal.research.overviews.finishRun, { overviewId, startedAt, text: text.trim() });
      if (paid && kept) {
        await settleCredits(ctx, { userId, workspaceId, chargeId, credits, usage: { kind: "search", description: "AI overview", model: modelSlug, ...tokenDetails(usage), costUsd: usd } });
        settled = true;
      }
      console.log(JSON.stringify({ event: "search-overview", overviewId, workspaceId, userId, model: modelSlug, effort: effort ?? null, paid, credits, usd, counts, lists, chars: text.length, ms: Date.now() - began, usage }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({ event: "search-overview-failed", overviewId, workspaceId, userId, paid, ms: Date.now() - began, error: error instanceof Error ? `${error.name}: ${message}` : message }));
      await ctx.runMutation(internal.research.overviews.finishRun, { overviewId, startedAt, error: held || !paid ? "failed" : "credits" });
    } finally {
      if (held && !settled) await releaseCredits(ctx, { chargeId }).catch(() => {});
    }
    return null;
  },
});

const SYSTEM = (year: number) => `You write the short AI overview shown above a list of research papers in OpenScholar. It reads the whole search the person ran in OpenAlex, through the lens they picked, and answers what the lens asks.

Get every number from the tools: count for how papers divide (by year, country, type and more), papers for the papers themselves. Never state a number a tool didn't give you. Make one to four tool calls, then write.

Write two to four short paragraphs of plain prose, under 150 words in all. Name only the few numbers that carry the point; a chart shows the rest. No headings, lists, bold, italics or other Markdown. Open with the finding itself.

Place a chart by writing its marker alone on its own line, after the paragraph it supports: [chart:ID] for a count, [chart:ID:change] for a count by year drawn as the change on the year before. Use at most two, and only IDs the tools returned. The papers you cite are listed under the overview on their own, so there's no need to list them.

Every paper you mention is a citation: [a few words of its title](paper:ID), with the ID a papers result gave, such as [Intelligent tutoring systems](paper:W2016011122). Never name a paper in quotes or by its title alone; a person opens a cited paper from its link.

${year} isn't over, so leave it out of comparisons between years or say it's partial. A paper with authors in several countries counts once for each.`;
