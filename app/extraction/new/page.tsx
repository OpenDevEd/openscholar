import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { NewExtraction } from "@/components/extraction/new-extraction";
import { api } from "@/convex/_generated/api";
import { SubscriptionStateProvider } from "@/lib/auth/use-subscription-state";

export default async function NewExtractionPage({ params }: { params: Promise<{ slug?: string }> }) {
  // The papers the workspace's plan takes in one extraction, there on the first frame: an
  // organization's under /o/<slug>, the person's own elsewhere.
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const workspaceId = slug && token ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : null;
  // The models the job runs on read the workspace's plan, as the screening page's do.
  return (
    <SubscriptionStateProvider>
      <NewExtraction preloadedLimits={await preloadQuery(api.billing.accounts.myLimits, workspaceId ? { workspaceId } : {}, { token })} />
    </SubscriptionStateProvider>
  );
}
