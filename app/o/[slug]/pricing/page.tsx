import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import PricingPage from "@/app/pricing/page";

export { metadata } from "@/app/pricing/page";

/**
 * An organization's plans (#652). An admin back from saving its card for Team has the
 * organization's account re-read first, so the page shows the plan Autumn has moved it to.
 */
export default async function OrganizationPricingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ team?: string }> }) {
  if ((await searchParams).team === "success") {
    const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
    const workspaceId = token ? await fetchQuery(api.workspaces.queries.bySlug, { slug: (await params).slug }, { token }) : null;
    if (workspaceId) {
      await fetchAction(api.billing.accounts.refreshMine, { workspaceId }, { token }).catch((error) => {
        console.error("[billing] couldn't refresh the organization's account from Autumn", error);
      });
    }
  }
  return <PricingPage />;
}
