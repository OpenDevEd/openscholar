// Asking for a report to be registered (plans/publish-reports). Apart from ./registration.ts so the mutations that
// change what the registrars hold (activating, a correction, withdrawing, reinstating) can call it without loading
// one another.
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../lib/functions";
import { providersOf } from "../../lib/reports/report";

/**
 * Sends a report to its registrars as it now stands: each of them takes it again. Every asking has its own number,
 * which the registering action carries from start to finish, so an answer about the record as it stood before is
 * never taken for the record as it stands now.
 */
export async function register(ctx: MutationCtx, report: Pick<Doc<"reports">, "_id" | "registration" | "registrationRev">) {
  const registers = providersOf(report.registration);
  const rev = (report.registrationRev ?? 0) + 1;
  await ctx.db.patch("reports", report._id, {
    deposit: registers.includes("crossref") ? "queued" : "none",
    archive: registers.includes("zenodo") ? "queued" : "none",
    registrationRev: rev,
    registrationError: undefined,
    registrationTries: undefined,
    depositSent: undefined,
  });
  await ctx.scheduler.runAfter(0, internal.reports.registrar.register, { reportId: report._id, rev });
  // Whatever changed what the registrars hold changed what a saved copy shows: its copies follow (./saved.ts).
  await ctx.scheduler.runAfter(0, internal.reports.saved.follow, { reportId: report._id });
}
