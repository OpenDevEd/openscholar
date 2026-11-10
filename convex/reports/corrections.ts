// Changes to a live report's details (plans/publish-reports). Its author corrects them and the checks run again; a
// reviewer may edit them directly. Either way the report stays live as it was until the changes are its details.
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../lib/functions";
import { providersOf, type CheckResult, type Metadata } from "../../lib/reports/report";

type Kept = CheckResult & { model: string };

/**
 * Makes checked changes a live report's details, and queues its registrations again, in the order it first
 * registered in, so Crossref and Zenodo come to hold them too.
 */
export async function applyChanges(ctx: MutationCtx, report: Doc<"reports">, details: Doc<"reportDetails">, changes: { metadata: Metadata; results: Kept[]; checksVersion: number }) {
  const registers = providersOf(report.registration);
  // Later than the report's last change and the last time its details were set, so a form opened before this is told from one opened after.
  const now = Math.max(Date.now(), report.updatedAt + 1, (liveSince(report) ?? 0) + 1);
  await ctx.db.patch("reportDetails", details._id, { metadata: changes.metadata, results: changes.results, correction: undefined });
  await ctx.db.patch("reports", report._id, {
    title: changes.metadata.title.trim() || undefined,
    checksVersion: changes.checksVersion,
    flagged: changes.results.some((result) => !result.pass) || undefined,
    changes: undefined,
    correctedAt: now,
    // Its registrars take the record again: Crossref the corrected deposit under the same DOI, Zenodo an edit of its record.
    deposit: registers.includes("crossref") ? "queued" : "none",
    archive: registers.includes("zenodo") ? "queued" : "none",
    registrationError: undefined,
    registrationTries: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.reports.registrar.register, { reportId: report._id });
}

/** When a live report's details were last set: what a form of changes started from. */
export const liveSince = (report: Pick<Doc<"reports">, "activatedAt" | "correctedAt">) => report.correctedAt ?? report.activatedAt;

/** What a check that passed on the report and failed on its changes tells the author: it read the same PDF. */
export const SAME_PDF_ADVICE = "This check read the same PDF as when your report passed it, and answered differently this time. Send the changes again, or request a human review.";
