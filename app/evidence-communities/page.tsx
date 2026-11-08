import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PUBLIC_PER_PAGE, SIDEBAR_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";

/**
 * Communities open in every workspace, and to anyone signed out, who sees the public ones (#1090). Whether the person may
 * create one here arrives with the page, so New community is there from the first frame.
 */
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
  // The directory is everyone's: signed out, it's the page.
  const [firstPublic, opens, firstSidebar, invitations] = await Promise.all([
    preloadQuery(api.evidenceLibraries.directory.directory, { sort: "newest", paginationOpts: { numItems: PUBLIC_PER_PAGE, cursor: null } }, token ? { token } : {}),
    workspaceId ? preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }) : undefined,
    workspaceId && filter ? preloadQuery(api.evidenceLibraries.queries.listLibraries, sidebarArgs, { token }) : undefined,
    workspaceId && !slug && (filter === "all" || filter === "shared") ? preloadQuery(api.evidenceLibraries.invitations.listInvitations, {}, { token }) : undefined,
  ]);
  return <LibraryList signedIn={Boolean(token)} preloadedOpens={opens} preloadedPublic={firstPublic} preloadedSidebar={filter && firstSidebar ? { filter, list: firstSidebar, ...(invitations ? { invitations } : {}) } : undefined} />;
}
