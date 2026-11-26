import { generateText, isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import type { resolveOpenRouterModel } from "../ai/provider";
import { groupSearch, readSearchWorks, type SearchRequest } from "../paperSets/openalex";
import { callOptions, type Effort } from "../../lib/ai/core/call-options";
import { calculateCostInDollars, usageOf } from "../../lib/ai/core/cost";
import { pickProviderCostUsd } from "../../lib/ai/pick-provider-cost";
import { GROUPINGS, type Grouping } from "./searchValidators";
import { GROUPS_KEPT, PAPERS_KEPT } from "./overviewValidators";
import { plainAbstract } from "../../lib/papers/abstract-text";

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
  return plainAbstract(words.join(" ")).slice(0, ABSTRACT_READ);
};

/** What a run tells its page as it goes: a step, a count or a paper list it read, or the whole lines written so far. */
export type OverviewProgress = { step?: string; text?: string; count?: object; list?: object };

/**
 * Writes an AI overview of a search through a lens (#967): it counts the search and reads its papers with two tools,
 * and hands each step, count, paper list and whole line to `progress` as it comes, so a page shows each paragraph as
 * it ends. A signed-in person's run keeps them (./overviewsAction.ts); a signed-out visitor's goes straight to their
 * browser (./signedOutOverviews.ts). `spend` counts OpenAlex requests against whoever asked.
 */
export async function writeOverview(
  { request, instruction, locale, resolved, effort, spend, progress, logId }: {
    request: SearchRequest;
    instruction: string;
    locale: string;
    /** The model it runs on, as resolveOpenRouterModel gives it. */
    resolved: Awaited<ReturnType<typeof resolveOpenRouterModel>>;
    effort?: Effort;
    spend: (pages: number) => Promise<boolean>;
    progress: (update: OverviewProgress) => Promise<unknown>;
    /** What its logs name it by. */
    logId: string;
  },
) {
  const { model, pricing } = resolved;
  const language = new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? "English";
  let counts = 0;
  let lists = 0;
  const years = z.object({ from: z.number().int().optional(), to: z.number().int().optional() }).optional().describe("Only papers published in these years, both included.");
  const result = streamText({
    model,
    system: SYSTEM(new Date().getUTCFullYear(), language),
    // The language is said again last: the lens, the tools' results and the papers' titles are often in another one, and a model said once at the top drifted into English under a French page.
    prompt: `What the person wants to know about this search: ${instruction}\n\nWrite the overview in ${language}.`,
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
          // The closest matches are by relevance, whatever the results page is sorted by; a search with no words has none.
          const text = Boolean(request.search) || /\.search(\.exact)?:/.test(request.filter ?? "");
          const sorted = { ...within(request, span), sort: sort === "relevance" ? (text ? "relevance_score:desc" : SORTS.cited) : SORTS[sort] };
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
  let usd = 0;
  // OpenRouter's cost for every step, or tokens at the model's price when a step didn't report one.
  let reported = true;
  let writing = false;
  // Where the step being read began: what a step says before it calls a tool is it planning, not the overview.
  let stepFrom = 0;
  for await (const part of result.stream) {
    if (part.type === "text-delta" && part.text) {
      if (!writing) await progress({ step: "writing" });
      writing = true;
      text += part.text;
    } else if (part.type === "start-step") {
      // A step that writes after a tool call starts a paragraph of its own.
      if (text && !text.endsWith("\n")) text += "\n";
      stepFrom = text.length;
      writing = false;
    } else if (part.type === "finish-step") {
      // Shown when its step ends, once it's known not to be planning, so nothing shown is ever taken back.
      if (part.finishReason === "tool-calls") text = text.slice(0, stepFrom);
      else if (text) await progress({ text });
      const cost = pickProviderCostUsd(part.providerMetadata);
      if (cost === null) reported = false;
      else usd += cost;
    } else if (part.type === "tool-error") {
      console.error(JSON.stringify({ event: "search-overview-tool-failed", overview: logId, tool: part.toolName, error: String(part.error) }));
    } else if (part.type === "error") throw part.error;
  }
  // An overview read nothing of the search when every count and paper read failed (OpenAlex refused, say): what the
  // model wrote then rests on nothing, so it isn't kept or charged.
  if (!text.trim() || counts + lists === 0) throw new Error(`Nothing read or written: ${counts} counts, ${lists} lists, ${text.length} characters`);
  const usage = usageOf({ usage: await result.totalUsage });
  if (!reported) usd = calculateCostInDollars({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, pricing);
  let written = text.trim();
  // Told twice to write in the page's language, a model can still answer in English when everything it read was English (a French page got an English overview on 2026-11-26): it rewrites what it wrote once, in that language.
  if (!locale.startsWith("en") && looksEnglish(written)) {
    const again = await generateText({ model, system: rewriteIn(language), prompt: written, maxRetries: 1, providerOptions: callOptions(model, { effort }) });
    if (again.text.trim()) {
      written = again.text.trim();
      await progress({ text: written });
    }
    const spent = usageOf({ usage: again.usage });
    usd += pickProviderCostUsd(again.providerMetadata) ?? calculateCostInDollars({ inputTokens: spent.inputTokens, outputTokens: spent.outputTokens }, pricing);
  }
  return { text: written, usd, usage, counts, lists };
}

/** Words that make up much of any English prose and little of other languages': where they are over an eighth of a text's words, it is English. */
const ENGLISH = new Set(["the", "and", "of", "is", "are", "with", "from", "this", "that", "which", "were", "was", "most", "papers", "between", "their"]);
export const looksEnglish = (text: string) => {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.length > 0 && words.filter((word) => ENGLISH.has(word)).length / words.length > 0.125;
};
const rewriteIn = (language: string) => `Rewrite the overview you are given in ${language}. Keep every line that is only a chart marker, such as [chart:c1] or [chart:c1:change], exactly as it is. Keep every paper link, such as [a few words](paper:W2016011122), with its target exactly as it is, and write the words inside its brackets in ${language}. Keep every number. Add nothing, leave nothing out, and add no heading or Markdown.`;

const SYSTEM = (year: number, language: string) => `You write the short AI overview shown above a list of research papers in Openscholar. It reads the whole search the person ran in OpenAlex, through the lens they picked, and answers what the lens asks.

Get every number from the tools: count for how papers divide (by year, country, type and more), papers for the papers themselves. Never state a number a tool didn't give you. Make one to four tool calls, then write. Write nothing before your last tool call: no plan, no saying what you'll do next. The first thing you write is the overview.

Write in ${language}: two to four short paragraphs of plain prose, under 150 words in all. Name only the few numbers that carry the point; a chart shows the rest. No headings, lists, bold, italics or other Markdown. Open with the finding itself. Keep the chart markers and paper links exactly as described below, in any language.

Every claim must hold for every figure it covers. Check it against the counts before you write it: "more than 100 a year since 2015" is true only if every one of those years is above 100, so name the range or the exception instead. Say how much something changed with its two figures ("from 56 to 80"), never with a word for a ratio ("doubled") unless the figures are that ratio.

Place a chart by writing its marker alone on its own line, after the paragraph it supports: [chart:ID] for a count, [chart:ID:change] for a count by year drawn as the change on the year before. Use at most two, and only IDs the tools returned. The papers you cite are listed under the overview on their own, so there's no need to list them.

Every paper you mention is a citation: [a few words of its title](paper:ID), with the ID a papers result gave, such as [Intelligent tutoring systems](paper:W2016011122). Never name a paper in quotes or by its title alone; a person opens a cited paper from its link.

${year} isn't over, so leave it out of comparisons between years or say it's partial. A paper with authors in several countries counts once for each.`;
