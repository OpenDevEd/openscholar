import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { PageWrapper } from "@/components/PageWrapper";
import { Pricing } from "@/components/Pricing";

export { generateMetadata } from "@/app/pricing/page";

/**
 * An organization's plans (#652), drawn from the organization as the server reads it, so its cards
 * don't wait for the browser to. An admin back from saving its card for Team has its account
 * re-read first, so the page shows the plan Autumn has moved it to.
 */
export default async function OrganizationPricingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ team?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const workspaceId = token ? await fetchQuery(api.workspaces.queries.bySlug, { slug: (await params).slug }, { token }) : null;
  if (workspaceId && (await searchParams).team === "success") {
    await fetchAction(api.billing.accounts.refreshMine, { workspaceId }, { token }).catch((error) => {
      console.error("[billing] couldn't refresh the organization's account from Autumn", error);
    });
  }
  const [organization, opens] = workspaceId ? await Promise.all([fetchQuery(api.organizations.queries.workspace, { workspaceId }, { token }), fetchQuery(api.organizationFeatures.opens, { workspaceId }, { token })]) : [null, null];
  return (
    <PageWrapper>
      <Pricing organization={organization ?? undefined} libraries={opens?.evidenceLibraries} />
    </PageWrapper>
  );
}
