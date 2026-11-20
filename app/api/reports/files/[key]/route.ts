import { auth } from "@clerk/nextjs/server";
import { getConvexSiteUrl } from "@/lib/convex-site";
import { isReportKey } from "@/lib/reports/report";
import { notFound, passFile } from "@/lib/reports/pass-file";

/**
 * A report's PDF (or, with `?part=cover`, the picture of its first page) for those who see it before its readers may:
 * its workspace and Openscholar's reviewers (lib/reports/report.ts `keptFileAddress`). Under /api, so Clerk reads who
 * is signed in (lib/auth/public-routes.ts); Convex is asked as them every time and sends the file itself
 * (convex/reports/files.ts `kept`), so a link copied from the owner's page opens for nobody else.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  const part = new URL(request.url).searchParams.get("part") === "cover" ? "cover" : "pdf";
  const token = isReportKey(key) ? await (await auth()).getToken({ template: "convex" }) : null;
  const site = getConvexSiteUrl();
  if (!token || !site) return notFound();
  return passFile(request, `${site}/reports/file?key=${key}&part=${part}`, { key, token, name: part === "pdf" ? `${key}.pdf` : `${key}-page-1.jpg` });
}
