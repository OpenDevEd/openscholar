// Openscholar Reports' own live reports, which the Already published check searches before anywhere else: one went
// live here minutes before is in none of the other places yet (OpenAlex takes days to read a new DOI from Crossref).
import { v } from "convex/values";
import { internalQuery } from "../lib/functions";
import { detailsOf } from "./flow";
import { reportSettings } from "./settings";

/** The most live reports a title search gives the check to compare. */
const ALIKE = 5;

/** Live reports whose titles are closest to `title`, never the report being checked, with what each says of itself. */
export const alike = internalQuery({
  args: { reportId: v.id("reports"), title: v.string() },
  returns: v.array(v.object({ title: v.string(), abstract: v.string(), url: v.string(), where: v.string(), year: v.string(), text: v.union(v.id("_storage"), v.null()) })),
  handler: async (ctx, { reportId, title }) => {
    if (!title.trim()) return [];
    const { series } = await reportSettings(ctx);
    const found = await ctx.db.query("reports").withSearchIndex("search_title", (q) => q.search("title", title.slice(0, 500)).eq("status", "live")).take(ALIKE + 1);
    const others = found.filter((report) => report._id !== reportId).slice(0, ALIKE);
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
