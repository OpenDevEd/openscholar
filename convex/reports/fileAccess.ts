// The day an embargo ends: the report's file opens to everyone (its licence is an open one, as an embargo needs).
// Zenodo lifts its own embargo that day; here the report is opened for good, which moves its `updatedAt`, so its page,
// the search index, its saved copies and the communities that hold it take the file as it now stands.
import { v } from "convex/values";
import { internalMutation } from "../lib/functions";
import { keptAccess, utcDay } from "../../lib/reports/report";
import { changedAt } from "./flow";
import { register } from "./registering";

/** How many reports one run opens: the rest wait for the next, an hour on. */
const OPENED_PER_RUN = 100;

export const openEmbargoes = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    // `gt("")` leaves out the reports with no day, which sort before every one.
    const due = await ctx.db.query("reports").withIndex("by_fileOpensOn", (q) => q.gt("fileOpensOn", "").lte("fileOpensOn", utcDay())).take(OPENED_PER_RUN);
    for (const report of due) {
      await ctx.db.patch("reports", report._id, { ...keptAccess({ mode: "open" }), updatedAt: changedAt(report) });
      // Crossref takes its full-text address again; Zenodo has lifted its embargo, and the saved copies follow (./registering.ts).
      if (report.status === "live") await register(ctx, report);
    }
    return due.length;
  },
});
