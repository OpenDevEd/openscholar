import { paperPageId } from "@/lib/papers/page-address";
import { readReport } from "@/lib/reports/paper-data";

/**
 * A live report's PDF, at an address that stays the same: saved papers, citations and communities keep this one. It
 * leads to the file only while the report is live, asked every time, so a withdrawn report's PDF is gone from here at
 * once (and the file's own address stops working with it: convex/reports/files.ts).
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const report = await readReport(paperPageId((await params).id) ?? "");
  // Not kept either: Cloudflare caches a 404 on a .pdf address, which would outlast a reinstatement by minutes.
  if (report?.state !== "live" || !report.pdfUrl) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 302, headers: { Location: report.pdfUrl, "Cache-Control": "no-store" } });
}
