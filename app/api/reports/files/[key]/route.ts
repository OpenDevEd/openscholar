import { auth } from "@clerk/nextjs/server";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { isReportKey } from "@/lib/reports/report";
import { passFile } from "@/lib/reports/pass-file";
import { readReport } from "@/lib/reports/paper-data";

/**
 * A report's PDF (or, with `?part=cover`, the picture of its first page) for those who see it before its readers may:
 * its workspace and Openscholar's reviewers (lib/reports/report.ts `keptFileAddress`). Under /api, so Clerk reads who
 * is signed in (lib/auth/public-routes.ts); Convex is asked as them every time and sends the file itself
 * (convex/reports/files.ts `kept`), so a link copied from the owner's page opens for nobody else. Anyone it won't
 * open it for is told the PDF is private (app/files/private), not met by a sign-in page that says nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  const part = new URL(request.url).searchParams.get("part") === "cover" ? "cover" : "pdf";
  const token = isReportKey(key) ? await (await auth()).getToken({ template: "convex" }) : null;
  const site = getConvexSiteUrl();
  // Said on a page of its own, by a relative address: behind the proxy, the request's own host isn't the site's.
  const asked = new URL(request.url);
  // A link copied while the file was kept, followed once it is out for everyone, goes to the file's lasting address.
  const refused = async () => {
    const read = part === "pdf" && isReportKey(key) ? await readReport(key) : null;
    const out = read?.state === "live" && !!read.pdfUrl;
    return new Response(null, { status: 303, headers: { Location: out ? `/papers/${key}/report.pdf` : `/files/private?file=${encodeURIComponent(asked.pathname + asked.search)}`, "Cache-Control": "no-store" } });
  };
  if (!token || !site) return refused();
  const answer = await passFile(request, `${site}/reports/file?key=${key}&part=${part}`, { key, token, name: part === "pdf" ? `${key}.pdf` : `${key}-page-1.jpg` });
  return answer.status === 404 ? refused() : answer;
}
