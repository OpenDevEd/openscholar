// MOCK (mock/publish-reports): a live report as the paper page reads a paper. The real build reads it from Convex.
import type { PaperResult } from "@/lib/types/search.types";
import { reportPaper } from "./report-paper";
import { coverUrlOf } from "./types";
import { readState } from "./store";

/** A live report's details and its cover, for what the paper page shows beyond a paper's record. */
export async function readReportMetadata(key: string) {
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "live");
  return report?.metadata ? { m: report.metadata, cover: coverUrlOf(report) } : null;
}

/** A live report by its key (R…), shaped like a record of our index; null for any other key or a report not live. */
export async function readReportPaper(key: string): Promise<PaperResult | null> {
  if (!/^R\d+$/.test(key)) return null;
  const state = await readState();
  const report = state.submissions.find((s) => s.id === key && s.status === "live");
  return report?.metadata ? reportPaper(report, report.metadata, state.settings.series) : null;
}
