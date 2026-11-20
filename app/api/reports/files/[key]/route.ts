import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { isReportKey } from "@/lib/reports/report";
import { notFound, passFile } from "@/lib/reports/pass-file";

/**
 * A report's PDF (or, with `?part=cover`, the picture of its first page) for those who see it before its readers may:
 * its workspace and Openscholar's reviewers (lib/reports/report.ts `keptFileAddress`). Signed in, asked every time, so
 * a link copied from the owner's page opens for nobody else. Under /api, so Clerk reads who is asking (lib/auth/public-routes.ts).
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const key = (await params).key.toUpperCase();
  const part = new URL(request.url).searchParams.get("part") === "cover" ? "cover" : "pdf";
  const token = isReportKey(key) ? await (await auth()).getToken({ template: "convex" }) : null;
  const url = token ? await fetchQuery(api.reports.paper.keptFile, { key, part }, { token }) : null;
  if (!url) return notFound();
  return passFile(request, url, { key, name: part === "pdf" ? `${key}.pdf` : `${key}-page-1.jpg` });
}
