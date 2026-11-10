// Changes to a live report's details (plans/publish-reports). Its author corrects them and the checks run again; a
// reviewer may edit them directly. Either way the report stays live as it was until the changes are its details.
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../lib/functions";
import { changesOf, type CheckResult, type Metadata } from "../../lib/reports/report";
import { register } from "./registering";

type Kept = CheckResult & { model: string };

/**
 * Makes checked changes a live report's details, and queues its registrations again, in the order it first
 * registered in, so Crossref and Zenodo come to hold them too.
 */
export async function applyChanges(ctx: MutationCtx, report: Doc<"reports">, details: Doc<"reportDetails">, changes: { metadata: Metadata; results: Kept[]; checksVersion: number }) {
  // What the change is, for the email that tells its author it is live.
  const changed = details.metadata ? changesOf(details.metadata, changes.metadata).map((change) => change.label).join(", ") : "";
  // Later than the report's last change and the last time its details were set, so a form opened before this is told from one opened after.
  const now = Math.max(Date.now(), report.updatedAt + 1, (liveSince(report) ?? 0) + 1);
  // A run still reading other changes was started over the details as they were: it ends here, so its answer can't put those over these.
  await ctx.db.patch("reportDetails", details._id, { metadata: changes.metadata, results: changes.results, correction: undefined, running: undefined, trying: undefined });
  await ctx.db.patch("reports", report._id, {
    title: changes.metadata.title.trim() || undefined,
    checksVersion: changes.checksVersion,
    flagged: changes.results.some((result) => !result.pass) || undefined,
    changes: undefined,
    run: undefined,
    correctedAt: now,
    updatedAt: now,
  });
  // Its registrars take the record again: Crossref the corrected deposit under the same DOI, Zenodo an edit of its record.
  await register(ctx, report);
  return changed;
}

/**
 * What a form of changes was opened on, by the number that tells one state from the next: the changes that wait,
 * which the form shows when there are any, else the report's details as they were last set.
 */
export const formVersion = (report: Pick<Doc<"reports">, "activatedAt" | "correctedAt">, details: Pick<Doc<"reportDetails">, "correction">) => details.correction?.at ?? liveSince(report);

/** When a live report's details were last set: what a form of changes started from. */
export const liveSince = (report: Pick<Doc<"reports">, "activatedAt" | "correctedAt">) => report.correctedAt ?? report.activatedAt;

/** What a check that passed on the report and failed on its changes tells the author: it read the same PDF. */
export const SAME_PDF_ADVICE = "Your report passed this check before, and its PDF is the same. If your changes to the title or the abstract could be why it fails now, put them right and send them again. Otherwise request a human review.";
