import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { redirect } from "next/navigation";
import { EvidenceLibrariesGate } from "@/components/auth/evidence-libraries-gate";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";
import { workspaceHref } from "@/lib/workspaces/paths";

export default async function EvidenceLibrariesPage({ params }: { params: Promise<{ slug?: string }> }) {
  // Whether the viewer may create a library arrives with the page, so New library is there from the first frame.
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const [organizations, workspaceId] = await Promise.all([
    preloadQuery(api.organizationFeatures.listLibraryOrganizations, {}, { token }),
    token ? (slug ? fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : fetchQuery(api.workspaces.queries.personal, {}, { token })) : null,
  ]);
  // A workspace without them goes straight to where they're asked for, before any of this page is drawn. The gate says the same for a page already open.
  const opens = workspaceId ? await fetchQuery(api.organizationFeatures.opens, { workspaceId }, { token }) : null;
  if (opens && !opens.evidenceLibraries) redirect(workspaceHref(slug, "/pricing?audience=org"));
  return (
    <EvidenceLibrariesGate fallback={<PageWrapper><LibraryList pending preloadedOrganizations={organizations} /></PageWrapper>}>
      <PageWrapper><LibraryList preloadedOrganizations={organizations} /></PageWrapper>
    </EvidenceLibrariesGate>
  );
}
