import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PublishFlow } from "@/components/reports/publish-flow";

export const metadata: Metadata = { title: "Publish | Openscholar" };

/**
 * Publish to Openscholar Reports (plans/publish-reports). It is a workspace's section, like the library: under
 * /o/<slug> it shows that organisation's reports, and outside it the person's own. Which report it shows is in the
 * address (`report`), so a link from an email, a reload and the back button all land on the same report.
 *
 * Stripe's pages come back here with `back` (#1261): before the page renders, the workspace's card is read again and
 * an activation the bank has since confirmed goes live, so the page opens on where things now stand. The page still
 * renders if Autumn is slow or down; the webhooks catch up.
 */
export default async function PublishPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ back?: string }> }) {
  const [{ slug }, { back }] = await Promise.all([params, searchParams]);
  if (back) {
    const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
    if (token) {
      const settle = async () => {
        const workspaceId = slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token });
        if (!workspaceId) return;
        await fetchAction(api.reports.activation.settle, { workspaceId }, { token });
      };
      await settle().catch((error) => {
        console.error("[publish] couldn't settle the workspace's payment on return from Stripe", error);
      });
    }
  }
  return <PublishFlow />;
}
