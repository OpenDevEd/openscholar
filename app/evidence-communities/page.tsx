import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PUBLIC_PER_PAGE, SIDEBAR_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CommunityFilter } from "@/components/evidence-libraries/your-communities";

/**
 * Communities open in every workspace, and to anyone signed out, who sees the public ones (#1090). Whether the person may
 * create one here arrives with the page, so New community is there from the first frame.
 */
export default async function EvidenceLibrariesPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ from?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const [{ slug }, { from }] = await Promise.all([params, searchParams]);
  const workspaceId = token ? (slug ? await fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : await fetchQuery(api.workspaces.queries.personal, {}, { token })) : null;
  const organization = slug && workspaceId ? (await fetchQuery(api.organizations.queries.workspace, { workspaceId }, { token })).organizationId : undefined;
  // The sidebar's filter as its address names it: "all", an organization's own ("here"), "own", "shared", or a workspace.
  const filter = (from || "all") as CommunityFilter;
  // "All" and "here" read the same list as the sidebar does; any other names where from.
  const sidebarArgs = { ...(organization ? { organization } : {}), ...(filter === "all" || filter === "here" ? {} : { from: filter as "own" | "shared" | Id<"workspaces"> }), paginationOpts: { numItems: SIDEBAR_PER_PAGE, cursor: null } };
  // The directory's and the sidebar's first pages too, so their rows are there from the first frame instead of arriving after it.
  // The directory is everyone's: signed out, it's the page.
  const [firstPublic, opens, firstSidebar, invitations] = await Promise.all([
    preloadQuery(api.evidenceLibraries.directory.directory, { sort: "newest", paginationOpts: { numItems: PUBLIC_PER_PAGE, cursor: null } }, token ? { token } : {}),
    workspaceId ? preloadQuery(api.organizationFeatures.opens, { workspaceId }, { token }) : undefined,
    // An address naming no workspace of theirs reads nothing here: the sidebar reads it in the browser and says so.
    workspaceId ? preloadQuery(api.evidenceLibraries.queries.listLibraries, sidebarArgs, { token }).catch(() => undefined) : undefined,
    workspaceId && !slug && (filter === "all" || filter === "shared") ? preloadQuery(api.evidenceLibraries.invitations.listInvitations, {}, { token }) : undefined,
  ]);
  return <LibraryList signedIn={Boolean(token)} preloadedOpens={opens} preloadedPublic={firstPublic} preloadedSidebar={filter && firstSidebar ? { filter, list: firstSidebar, ...(invitations ? { invitations } : {}) } : undefined} />;
}
