// Mock (mock/ai-overview): writes an overview of the search on screen with the Cheap preset's chat
// model, live. It streams one JSON line per event: each tool step, each count or paper list the
// model read (the charts draw those, never numbers the model typed), and the text as it comes.
// The real feature runs in Convex on the assistant's loop and tools, with plan limits and credits.

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import type { PaperResult, SearchFilters } from "@/lib/types";
import { countBy, GROUPINGS, listPapers, type Grouping, type Paper } from "@/lib/ai-overview-mock/openalex";

/** The Cheap preset's chat model on shared dev (aiModelConfig `preset.cheap.chat`, 2026-10-29). */
const MODEL = "anthropic/claude-haiku-5.5";

export type OverviewEvent =
  | { t: "step"; label: string }
  | { t: "count"; id: string; by: Grouping; total: number; groups: Array<{ key: string; name: string; count: number }>; years?: { from?: number; to?: number } }
  | { t: "papers"; id: string; papers: Array<Paper & { work: PaperResult }> }
  | { t: "text"; text: string }
  | { t: "done" }
  | { t: "error"; message: string };

const LABELS: Record<Grouping, string> = {
  year: "year",
  country: "country",
  type: "type",
  field: "field",
  topic: "topic",
  openAccess: "open access",
  journal: "journal",
  institution: "institution",
  funder: "funder",
  language: "language",
  sdg: "SDG",
};

const years = z.object({ from: z.number().int().optional(), to: z.number().int().optional() }).optional().describe("Only papers published in these years, both included.");

export async function POST(request: Request) {
  const { query, filters, lens } = (await request.json()) as { query: string; filters: SearchFilters; lens: { name: string; instruction: string } };
  const encoder = new TextEncoder();
  let charts = 0;
  let lists = 0;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: OverviewEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const startedAt = Date.now();
      try {
        const result = streamText({
          model: createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY }).chat(MODEL, { usage: { include: true } }),
          abortSignal: request.signal,
          stopWhen: isStepCount(6),
          system: SYSTEM(new Date().getFullYear()),
          prompt: `Search: ${query.trim() ? `"${query}"` : "every paper"}${filters.searchField && filters.searchField !== "title_and_abstract" ? ` in ${filters.searchField}` : ""}.\nLens: ${lens.name}\nWhat the person wants to know: ${lens.instruction}`,
          tools: {
            count: tool({
              description: `How many of the search's papers fall in each group, and the total: by ${Object.keys(GROUPINGS).join(", ")}. By year it returns up to the latest 30 years in order; otherwise the largest 15 groups. One call per grouping; use years to compare periods.`,
              inputSchema: z.object({ by: z.enum(Object.keys(GROUPINGS) as [Grouping, ...Grouping[]]), years }),
              execute: async ({ by, years: span }) => {
                send({ t: "step", label: `Counting papers by ${LABELS[by]}${span ? ` in ${span.from ?? ""}–${span.to ?? ""}` : ""}` });
                const { total, groups } = await countBy(query, filters, by, span);
                const id = `c${++charts}`;
                send({ t: "count", id, by, total, groups, years: span });
                return { chart: id, total, groups: groups.map(({ name, count }) => ({ name, count })) };
              },
            }),
            papers: tool({
              description: "Up to 10 of the search's papers, with title, year, citations and the start of the abstract: the most cited, the newest, or the most relevant.",
              inputSchema: z.object({ sort: z.enum(["cited", "newest", "relevance"]), count: z.number().int().min(1).max(10), years }),
              execute: async ({ sort, count, years: span }) => {
                send({ t: "step", label: sort === "cited" ? "Reading the most cited papers" : sort === "newest" ? "Reading the newest papers" : "Reading the closest matches" });
                const papers = await listPapers(query, filters, sort, count, span);
                const id = `p${++lists}`;
                send({ t: "papers", id, papers: papers.map(({ read: { abstract: _abstract, ...paper }, work }) => ({ ...paper, work })) });
                return { list: id, papers: papers.map(({ read }) => read) };
              },
            }),
          },
          onError: ({ error }) => console.error("[overview-mock] model error", error),
        });
        let writing = false;
        let cost = 0;
        for await (const part of result.stream) {
          if (part.type === "text-delta" && part.text) {
            if (!writing) send({ t: "step", label: "Writing" });
            writing = true;
            send({ t: "text", text: part.text });
          } else if (part.type === "start-step") writing = false;
          else if (part.type === "finish-step") {
            // On our own provider key OpenRouter charges nothing and reports what the provider charged as upstreamInferenceCost.
            const usage = (part.providerMetadata as { openrouter?: { usage?: { cost?: number; costDetails?: { upstreamInferenceCost?: number } } } } | undefined)?.openrouter?.usage;
            cost += usage?.cost || usage?.costDetails?.upstreamInferenceCost || 0;
          }
          else if (part.type === "tool-error") console.error("[overview-mock] tool failed", part.toolName, part.error);
          else if (part.type === "error") throw part.error;
        }
        const usage = await result.totalUsage;
        console.info(`[overview-mock] ${lens.name}: ${usage.inputTokens} in, ${usage.outputTokens} out, $${cost.toFixed(5)}, ${Date.now() - startedAt} ms`);
        send({ t: "done" });
      } catch (error) {
        if (request.signal.aborted) return controller.close();
        console.error("[overview-mock] run failed", error);
        send({ t: "error", message: error instanceof Error ? error.message : String(error) });
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

const SYSTEM = (year: number) => `You write the short AI overview shown above a list of research papers in OpenScholar. It reads the whole search the person ran in OpenAlex, through the lens they picked, and answers what the lens asks.

Get every number from the tools: count for how papers divide (by year, country, type and more), papers for the papers themselves. Never state a number a tool didn't give you. Make one to four tool calls, then write.

Write two to four short paragraphs of plain prose, under 150 words in all. Name only the few numbers that carry the point; a chart shows the rest. No headings, lists, bold, italics or other Markdown. Open with the finding itself.

Place a chart by writing its marker alone on its own line, after the paragraph it supports: [chart:ID] for a count, [chart:ID:change] for a count by year drawn as the change on the year before. Use at most two, and only IDs the tools returned. The papers you cite are listed under the overview on their own, so there's no need to list them.

Every paper you mention is a citation: [a few words of its title](paper:ID), with the ID a papers result gave, such as [Intelligent tutoring systems](paper:W2016011122). Never name a paper in quotes or by its title alone; a person opens a cited paper from its link.

${year} isn't over, so leave it out of comparisons between years or say it's partial. A paper with authors in several countries counts once for each.`;
