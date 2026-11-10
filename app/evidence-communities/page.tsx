import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadedQueryResult, preloadQuery } from "convex/nextjs";
import { LibraryList } from "@/components/evidence-libraries/library-list";
import { PUBLIC_PER_PAGE, SIDEBAR_PER_PAGE } from "@/lib/evidence-libraries/directory";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { CommunityFilter } from "@/components/evidence-libraries/your-communities";
import { redirect } from "next/navigation";
import { APPLICATIONS_SHOWN, APPLY_PARAM, applySignInPath } from "@/lib/evidence-libraries/applications";

/**
 * Communities open in every workspace, and to anyone signed out, who sees the public ones (#1090). Whether the person may
 * create one here arrives with the page, so New community is there from the first frame.
 */
export default async function EvidenceLibrariesPage({ params, searchParams }: { params: Promise<{ slug?: string }>; searchParams: Promise<{ from?: string; [APPLY_PARAM]?: string }> }) {
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  const [{ slug }, { from, [APPLY_PARAM]: applyTo }] = await Promise.all([params, searchParams]);
  // A link to apply, as a community's own site gives: signed out, sign-in comes first and returns here with the dialog
  // open. From the server, so the page isn't drawn and then left.
  if (!token && applyTo) redirect(applySignInPath(applyTo));
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
  // Where the person stands with the first page of cards, their applications, and how many wait on the communities
  // they answer for (OS-31), so each card's corner and sidebar row is right on the first frame.
  const read = <T,>(promise: Promise<T>) => promise.catch(() => undefined);
  const cardIds = preloadedQueryResult(firstPublic).page.map((card) => card._id);
  const answered = firstSidebar ? preloadedQueryResult(firstSidebar).page.filter((library) => (library.role === "owner" || library.role === "editor") && library.status === "active").map((library) => library._id) : [];
  const mine = (state: "waiting" | "declined") => (workspaceId && !slug && (filter === "all" || filter === "shared")
    ? read(preloadQuery(api.evidenceLibraries.applications.mine, { workspaceId, state, paginationOpts: { numItems: APPLICATIONS_SHOWN, cursor: null } }, { token })) : undefined);
  const [standing, applicationsWaiting, applicationsDeclined, waitingCounts] = workspaceId ? await Promise.all([
    cardIds.length ? read(preloadQuery(api.evidenceLibraries.applications.standing, { workspaceId, libraryIds: cardIds }, { token })) : undefined,
    mine("waiting"),
    mine("declined"),
    answered.length ? read(preloadQuery(api.evidenceLibraries.applications.waitingCounts, { workspaceId, libraryIds: answered }, { token })) : undefined,
  ]) : [];
  return (
    <LibraryList
      signedIn={Boolean(token)}
      preloadedOpens={opens}
      preloadedPublic={firstPublic}
      preloadedStanding={standing}
      preloadedSidebar={filter && firstSidebar ? { filter, list: firstSidebar, ...(invitations ? { invitations } : {}), ...(applicationsWaiting ? { applicationsWaiting } : {}), ...(applicationsDeclined ? { applicationsDeclined } : {}), ...(waitingCounts ? { waitingCounts } : {}) } : undefined}
    />
  );
}
