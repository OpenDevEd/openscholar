// Openscholar Reports' own live reports, which the Already published check searches before anywhere else: one went
// live here minutes before is in none of the other places yet (OpenAlex takes days to read a new DOI from Crossref).
import { v } from "convex/values";
import { internalQuery } from "../lib/functions";
import { detailsOf } from "./flow";
import { reportSettings } from "./settings";

/** The most live reports a title search gives the check to compare. */
const ALIKE = 5;
/** The most words a Convex text search takes (docs.convex.dev/search/text-search#limits): a longer title is searched by its first. */
const SEARCH_TERMS = 16;

/** Live reports whose titles are closest to `title`, never the report being checked, with what each says of itself. */
export const alike = internalQuery({
  args: { reportId: v.id("reports"), title: v.string() },
  returns: v.array(v.object({ title: v.string(), abstract: v.string(), url: v.string(), where: v.string(), year: v.string(), text: v.union(v.id("_storage"), v.null()) })),
  handler: async (ctx, { reportId, title }) => {
    if (!title.trim()) return [];
    const { series } = await reportSettings(ctx);
    // The very same title first, which a search can miss: a title written without spaces, as in Chinese or Japanese, is
    // one word too long for the search to keep.
    const same = await ctx.db.query("reports").withIndex("by_status_and_title", (q) => q.eq("status", "live").eq("title", title.trim())).take(ALIKE + 1);
    const words = title.split(/\s+/).filter(Boolean).slice(0, SEARCH_TERMS).join(" ");
    const found = await ctx.db.query("reports").withSearchIndex("search_title", (q) => q.search("title", words).eq("status", "live")).take(ALIKE + 1);
    const others = [...same, ...found].filter((report, i, all) => report._id !== reportId && all.findIndex((other) => other._id === report._id) === i).slice(0, ALIKE);
    return await Promise.all(
      others.map(async (report) => {
        const { metadata } = await detailsOf(ctx, report._id);
        return {
          title: metadata?.title ?? report.title ?? "",
          abstract: metadata?.abstract ?? "",
          url: `/papers/${report.key}`,
          where: series.name,
          year: metadata?.date.slice(0, 4) ?? "",
          // A report with no abstract is compared by the opening of its PDF's text, which the check reads.
          text: report.pdf?.text ?? null,
        };
      }),
    );
  },
});
