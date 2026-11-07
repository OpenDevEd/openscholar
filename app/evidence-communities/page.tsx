import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";

/** MOCK: Communities opens in every workspace; what you may create is the only thing a switch decides. */
export default async function EvidenceLibrariesPage({ params }: { params: Promise<{ slug?: string }> }) {
  // Whether the viewer may create a library arrives with the page, so New library is there from the first frame.
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const [organizations, workspaceId] = await Promise.all([
    preloadQuery(api.organizationFeatures.listLibraryOrganizations, {}, { token }),
    token && slug ? fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : null,
  ]);
  const here = workspaceId ? await fetchQuery(api.organizations.queries.workspace, { workspaceId }, { token }) : null;
  return <PageWrapper><LibraryList preloadedOrganizations={organizations} organizationHere={here?.organizationId} /></PageWrapper>;
}
