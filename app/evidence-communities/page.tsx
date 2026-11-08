import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PUBLIC_PER_PAGE, SIDEBAR_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";

/** Communities open in every workspace; whether the person may create one here arrives with the page, so New community is there from the first frame. */
export default async function EvidenceLibrariesPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ from?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  const workspaceId = token ? (slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token })) : null;
  const organization = slug && workspaceId ? (await fetchQuery(api.organizations.queries.workspace, { workspaceId }, { token })).organizationId : undefined;
  // The sidebar's filter as its address names it; one naming a workspace is read in the browser.
  const filter = !from || from === "all" ? ("all" as const) : from === "here" ? ("here" as const) : from === "own" ? ("own" as const) : from === "shared" ? ("shared" as const) : null;
  // "All" and an organization's own ("here") read the same list as the sidebar does.
  const sidebarArgs = { ...(organization ? { organization } : {}), ...(filter === "own" || filter === "shared" ? { from: filter } : {}), paginationOpts: { numItems: SIDEBAR_PER_PAGE, cursor: null } };
  // The directory's and the sidebar's first pages too, so their rows are there from the first frame instead of arriving after it.
  const [opens, firstPublic, firstSidebar, invitations] = workspaceId
    ? await Promise.all([
        preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }),
        preloadQuery(api.evidenceLibraries.directory.listPublic, { workspaceId, sort: "newest", paginationOpts: { numItems: PUBLIC_PER_PAGE, cursor: null } }, { token }),
        filter ? preloadQuery(api.evidenceLibraries.queries.listLibraries, sidebarArgs, { token }) : undefined,
        !slug && (filter === "all" || filter === "shared") ? preloadQuery(api.evidenceLibraries.invitations.listInvitations, {}, { token }) : undefined,
      ])
    : [undefined, undefined, undefined, undefined];
  return <LibraryList preloadedOpens={opens} preloadedPublic={firstPublic} preloadedSidebar={filter && firstSidebar ? { filter, list: firstSidebar, ...(invitations ? { invitations } : {}) } : undefined} />;
}
