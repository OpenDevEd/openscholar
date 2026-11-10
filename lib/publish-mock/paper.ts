// MOCK (mock/publish-reports): a live report as the paper page reads a paper. The real build reads it from Convex.
import { auth } from "@clerk/nextjs/server";
import type { PaperResult } from "@/lib/types/search.types";
import { reportPaper } from "./report-paper";
import { organizationsOf } from "./admin";
import { coverUrlOf, mayWorkOn } from "./types";
import { readState } from "./store";

/** A live report's details and its cover, for what the paper page shows beyond a paper's record, and whether the
 * person looking may correct it. */
export async function readReportMetadata(key: string) {
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "live");
  if (!report?.metadata) return null;
  const { userId } = await auth();
  // Its workspace's to correct: its author's own, or every member's of the organisation it was started in.
  const mine = userId !== null && mayWorkOn(report, userId, report.orgId ? await organizationsOf(userId) : []);
  return { m: report.metadata, cover: coverUrlOf(report), mine, waiting: !!report.correction };
}

/** A withdrawn report by its key, for the page its address and DOI keep leading to; null for any other. */
export async function readWithdrawnReport(key: string) {
  if (!/^R\d+$/.test(key)) return null;
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "declined" && s.withdrawnAt);
  const m = report?.metadata;
  if (!report || !m) return null;
  return { id: report.id, doi: report.doi, title: m.title, authors: m.authors.map((a) => a.name).filter(Boolean), year: Number(m.date.slice(0, 4)) || null, series: state.settings.series.name, withdrawnAt: report.withdrawnAt! };
}

/** A live report by its key (R…), shaped like a record of our index; null for any other key or a report not live. */
export async function readReportPaper(key: string): Promise<PaperResult | null> {
  if (!/^R\d+$/.test(key)) return null;
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "live");
  return report?.metadata ? reportPaper(report, report.metadata, state.settings.series) : null;
}
