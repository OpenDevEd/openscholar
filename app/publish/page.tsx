import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PublishFlow } from "@/components/reports/publish-flow";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publishReports.meta");
  return { title: t("publish") };
}

/**
 * Publish to Openscholar Reports (plans/publish-reports). It is a workspace's section, like the library: under
 * /o/<slug> it shows that organisation's reports, and outside it the person's own. Which report it shows is in the
 * address (`report`), so a link from an email, a reload and the back button all land on the same report.
 *
 * Opening a report settles its workspace's payments first (#1261): an activation whose charge the bank has since
 * confirmed goes live, and when Stripe sent the person back (`back`), the workspace's card is read again. The page still
 * renders if Autumn is slow or down; the webhooks catch up.
 */
export default async function PublishPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ report?: string; back?: string }> }) {
  const [{ slug }, { report, back }] = await Promise.all([params, searchParams]);
  if (report || back) {
    const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
    if (token) {
      const settle = async () => {
        const workspaceId = slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token });
        if (!workspaceId) return;
        await fetchAction(api.reports.activation.settle, { workspaceId, card: back !== undefined }, { token });
      };
      await settle().catch((error) => {
        console.error("[publish] couldn't settle the workspace's payments", error);
      });
    }
  }
  return <PublishFlow />;
}
