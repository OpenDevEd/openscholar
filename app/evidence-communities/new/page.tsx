import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { NewLibraryForm } from "@/components/evidence-libraries/new-library-form";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";

/** Whether the person may create a community in this workspace arrives with the page, so the form, or why it isn't there, shows from the first frame. */
export default async function NewEvidenceLibraryPage({ params }: { params: Promise<{ slug?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const workspaceId = token ? (slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token })) : null;
  const opens = workspaceId ? await preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }) : undefined;
  return (
    <PageWrapper>
      <NewLibraryForm preloadedOpens={opens} />
    </PageWrapper>
  );
}
