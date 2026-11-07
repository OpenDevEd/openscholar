import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { api } from "@/convex/_generated/api";

/** Communities open in every workspace; whether the person may create one here arrives with the page, so New community is there from the first frame. */
export default async function EvidenceLibrariesPage({ params }: { params: Promise<{ slug?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const workspaceId = token ? (slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token })) : null;
  const opens = workspaceId ? await preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }) : undefined;
  return <LibraryList preloadedOpens={opens} />;
}
