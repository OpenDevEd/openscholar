import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PUBLIC_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";

/** Communities open in every workspace; whether the person may create one here arrives with the page, so New community is there from the first frame. */
export default async function EvidenceLibrariesPage({ params }: { params: Promise<{ slug?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const { slug } = await params;
  const workspaceId = token ? (slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token })) : null;
  // MOCK: the directory's first page too, so its cards are there from the first frame instead of arriving after it.
  const [opens, firstPublic] = workspaceId
    ? await Promise.all([
        preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }),
        preloadQuery(api.evidenceLibraries.directory.listPublic, { workspaceId, sort: "newest", paginationOpts: { numItems: PUBLIC_PER_PAGE, cursor: null } }, { token }),
      ])
    : [undefined, undefined];
  return <LibraryList preloadedOpens={opens} preloadedPublic={firstPublic} />;
}
