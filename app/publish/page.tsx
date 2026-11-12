import type { Metadata } from "next";
import { after } from "next/server";
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
 * Opening it settles its workspace's payments first (#1261): a report whose payment has been made since, on Stripe's
 * page or at the bank, goes live, and when Stripe sent the person back (`back`), the workspace's account is read
 * again after. Otherwise the workspace's publication balance is read again behind the page, the list as much as a
 * report: one given in Autumn's dashboard reaches the page no other way. The page still renders if Autumn is slow or
 * down; the webhooks catch up.
 */
export default async function PublishPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ report?: string; back?: string }> }) {
  const [{ slug }, { report, back }] = await Promise.all([params, searchParams]);
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  if (token) {
    const settle = async () => {
      const workspaceId = slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token });
      if (!workspaceId) return;
      await fetchAction(api.reports.activation.settle, { workspaceId, card: back !== undefined }, { token });
    };
    const settled = () =>
      settle().catch((error) => {
        console.error("[publish] couldn't settle the workspace's payments", error);
      });
    // A report waits for it, so its bill opens as things stand. The list doesn't: it is settled behind the response.
    if (report || back) await settled();
    else after(settled);
  }
  return <PublishFlow />;
}
