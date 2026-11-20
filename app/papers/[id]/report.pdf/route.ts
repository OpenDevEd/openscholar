import { paperPageId } from "@/lib/papers/page-address";
import { readReport } from "@/lib/reports/paper-data";
import { notFound, passFile } from "@/lib/reports/pass-file";

/**
 * A live report's PDF, at an address that stays the same: saved papers, citations and communities keep this one. It
 * answers with the file only while the report is live and its readers get the file, asked every time, so a withdrawn
 * report's PDF is gone from here at once (and the file's own address stops working with it: convex/reports/files.ts).
 * Passed through as lib/reports/pass-file.ts says, named by the report's key.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = paperPageId((await params).id) ?? "";
  const report = await readReport(key);
  if (report?.state !== "live" || !report.pdfUrl) return notFound();
  return passFile(request, report.pdfUrl, { key, name: `${key}.pdf` });
}
