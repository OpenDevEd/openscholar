"use node";

/**
 * Reading the PDFs a person hands a screening (./held.ts), which needs Node. A PDF is the paper the index holds
 * where it prints that paper's DOI and its title. Otherwise a model copies the title and the abstract its first
 * pages print. One with no abstract, a scan with no text and a file that doesn't open are left out, with why.
 */
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { executeAIOperation } from "../../lib/ai/core/execute";
import { paperKey } from "../../lib/papers/paper-ref";
import { estimateCredits } from "../../lib/pricing";
import { doisIn } from "../../lib/screening/files";
import { withUserCredits } from "../ai/helpers";
import { openRouterModel } from "../ai/provider";
import { extractPdfJsTextPages } from "../extraction/pdfjs_extract";
import { spender, type SearchPaper } from "../paperSets/search";
import { byDois, type LeftOut } from "./held";
import { leftOutWhyValidator, screeningPaperInputValidator } from "./validators";

/** The pages a paper prints its title, its DOI and its abstract on, and the least text a page with words on it has. */
const PAGES = 2;
const SCAN_BELOW = 200;
/** DOIs a file prints that are asked of the index: its own is among the first. */
const DOIS_TRIED = 5;
/** What one reading of two pages takes at most, for its estimate. */
const READ_TOKENS = { input: 6_000, output: 800 };

const plain = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
const printed = z.object({
  title: z.string().describe("The document's title, copied as printed. Empty if none is printed."),
  abstract: z.string().nullable().describe("The abstract or summary the document prints, copied word for word. Null if it prints none: never write one."),
});

export const read = internalAction({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces"), files: v.array(v.object({ file: v.id("_storage"), name: v.string() })) },
  returns: v.object({ papers: v.array(screeningPaperInputValidator), left: v.array(v.object({ name: v.string(), why: leftOutWhyValidator, key: v.optional(v.string()) })) }),
  handler: async (ctx, { userId, workspaceId, files }): Promise<{ papers: SearchPaper[]; left: LeftOut[] }> => {
    const who = await ctx.runQuery(internal.screening.held.reader, { userId, workspaceId });
    if (!who) return { papers: [], left: files.map(({ name }) => ({ name, why: "broken" as const })) };
    const spend = spender(ctx, who.clerkId);
    const papers: SearchPaper[] = [];
    const left: LeftOut[] = [];
    for (const { file, name } of files) {
      const key = paperKey({ source: "upload", file });
      const out = (why: LeftOut["why"], called = name) => void left.push({ name: called, why, key });
      const blob = await ctx.storage.get(file);
      let text = "";
      try {
        if (!blob) throw new Error("No such file");
        text = (await extractPdfJsTextPages(await blob.arrayBuffer())).pages.slice(0, PAGES).map((page) => page.text).join("\n");
      } catch {
        out("broken");
        continue;
      }
      if (text.replace(/\s/g, "").length < SCAN_BELOW) { out("scan"); continue; }
      // The index's paper, where the file prints its DOI and the title the index has for it: a DOI alone may be a cited paper's.
      const known = await byDois(doisIn(text).dois.slice(0, DOIS_TRIED), spend).catch(() => new Map<string, SearchPaper>());
      const match = [...known.values()].find((paper) => paper.title.length > 12 && plain(text).includes(plain(paper.title)));
      if (match?.abstract) { papers.push(match); continue; }
      if (!who.model) { out("abstract", match?.title ?? name); continue; }
      const pricing = { input: who.model.input, output: who.model.output };
      try {
        const { result } = await withUserCredits<z.infer<typeof printed>>(
          ctx,
          { userId, workspaceId, chargeId: `screening-pdf:${file}:${crypto.randomUUID()}`, estimate: estimateCredits(pricing, READ_TOKENS), hold: false, balance: who.balance, clerkId: who.clerkId, kind: "screening", description: "Reading a PDF for a screening", model: who.model.slug },
          pricing,
          async () => {
            const { output, usage } = await executeAIOperation({
              model: await openRouterModel(who.model!.slug),
              schema: printed,
              input: text.slice(0, 20_000),
              buildPrompts: (pages) => ({ system: "You are given the first pages of a document. Return its title and its abstract exactly as printed. Copy, never summarise or write: if the pages print no abstract or summary, return null for it.", prompt: pages }),
              repairStrategy: { type: "full-json" },
              temperature: 0,
            });
            return { result: output, totalUsage: usage };
          },
        );
        const title = match?.title ?? (result.title.trim() || name);
        // An abstract the pages don't hold is one the model wrote, and is not taken.
        const abstract = result.abstract?.trim();
        const copied = abstract && plain(text).includes(plain(abstract).slice(0, 80));
        if (!abstract || !copied) { out("abstract", title); continue; }
        papers.push(match ? { ...match, abstract } : { paper: key, title, abstract });
      } catch (error) {
        console.error("[screening] A PDF's first pages couldn't be read by the model", error);
        out("abstract", match?.title ?? name);
      }
    }
    return { papers, left };
  },
});
