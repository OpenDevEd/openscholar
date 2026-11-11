import { paperPageId } from "@/lib/papers/page-address";
import { readReport } from "@/lib/reports/paper-data";

/** What the file's own address answers that a reader's browser needs passed on: the PDF, and the part of it asked for. */
const PASSED = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * A live report's PDF, at an address that stays the same: saved papers, citations and communities keep this one. It
 * answers with the file only while the report is live, asked every time, so a withdrawn report's PDF is gone from here
 * at once (and the file's own address stops working with it: convex/reports/files.ts).
 *
 * The file is passed through, not redirected to: its own address names it by an identifier, which is what a download
 * was called. Here it carries the report's key as its name. A request for part of it (a PDF viewer reading
 * a long report page by page) is asked of the file the same way.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = paperPageId((await params).id) ?? "";
  const report = await readReport(key);
  // Not kept either: Cloudflare caches a 404 on a .pdf address, which would outlast a reinstatement by minutes.
  if (report?.state !== "live" || !report.pdfUrl) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const range = request.headers.get("range");
  const file = await fetch(report.pdfUrl, { headers: range ? { Range: range } : {}, cache: "no-store" }).catch((error: unknown) => {
    console.error(JSON.stringify({ event: "report-pdf-unreachable", key, error: String(error).slice(0, 300) }));
    return null;
  });
  // The report is live, so its file not answering is the file store's trouble, not a missing page: said as such, and
  // logged with what the store answered, so an outage isn't read as a withdrawn report.
  if (!file?.ok || !file.body) {
    if (file) console.error(JSON.stringify({ event: "report-pdf-refused", key, status: file.status }));
    return new Response("The file can't be read right now", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const name of PASSED) {
    const value = file.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Shown in the browser as before; saved, it is named by the report's key.
  headers.set("Content-Disposition", `inline; filename="${key}.pdf"`);
  return new Response(file.body, { status: file.status, headers });
}
