import { auth } from "@clerk/nextjs/server";
import { fetchQuery, preloadQuery } from "convex/nextjs";
import { ConfigurationWorkspace } from "@/components/evidence-libraries/configuration/configuration-workspace";
import type { ConfigurationPreloads } from "@/components/evidence-libraries/configuration/preloads";
import { VERSIONS_PAGE_SIZE } from "@/lib/evidence-libraries/versions";
import { APPLICATIONS_PAGE } from "@/lib/evidence-libraries/applications";
import { PageWrapper } from "@/components/PageWrapper";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export default async function EvidenceLibraryConfigurationPage({
  params,
}: {
  params: Promise<{ libraryId: string; slug?: string }>;
}) {
  const { libraryId, slug } = await params;
  const token = (await (await auth()).getToken({ template: "convex" })) ?? undefined;
  return (
    <PageWrapper>
      <ConfigurationWorkspace libraryId={libraryId} preloads={token ? await readWithPage(libraryId, token, slug) : {}} />
    </PageWrapper>
  );
}

/**
 * The draft and what the cards below the settings read, read together with the page so each card is its full height
 * on the first frame. One the person may not read (an owner's cards, for a viewer), or an ID that isn't a community,
 * is left out: its card reads it in the browser as before, and says so.
 */
async function readWithPage(libraryId: string, token: string, slug: string | undefined): Promise<ConfigurationPreloads> {
  const id = libraryId as Id<"evidenceLibraries">;
  const read = <T,>(promise: Promise<T>) => promise.catch(() => undefined);
  const el = api.evidenceLibraries;
  // The workspace the page is open in, which the applications' reads, as the person's own actions, are made in.
  const workspaceId = await read(slug ? fetchQuery(api.workspaces.queries.bySlug, { slug }, { token }) : fetchQuery(api.workspaces.queries.personal, {}, { token }));
  const inWorkspace = <T,>(reading: (workspaceId: Id<"workspaces">) => Promise<T>) => (workspaceId ? read(reading(workspaceId)) : undefined);
  const [draft, credentials, publication, domains, versions, versionCount, addressNotice, team, sourceStatus, lastCheck, applications, applicationsWaiting] = await Promise.all([
    read(preloadQuery(el.queries.getDraft, { libraryId }, { token })),
    read(preloadQuery(el.credentials.listCredentials, { libraryId: id }, { token })),
    read(preloadQuery(el.publicationProviders.get, { libraryId: id }, { token })),
    read(preloadQuery(el.domains.listDomains, { libraryId: id }, { token })),
    read(preloadQuery(el.versions.listVersionRows, { libraryId: id, paginationOpts: { numItems: VERSIONS_PAGE_SIZE, cursor: null } }, { token })),
    read(preloadQuery(el.versions.countVersions, { libraryId: id }, { token })),
    read(preloadQuery(el.updates.getAddressNotice, { libraryId: id }, { token })),
    read(preloadQuery(el.queries.listTeam, { libraryId: id }, { token })),
    read(preloadQuery(el.sourceStatus.listForLibrary, { libraryId: id }, { token })),
    read(preloadQuery(el.updates.lastCheck, { libraryId: id }, { token })),
    inWorkspace((workspaceId) => preloadQuery(el.applications.waiting, { workspaceId, libraryId: id, paginationOpts: { numItems: APPLICATIONS_PAGE, cursor: null } }, { token })),
    inWorkspace((workspaceId) => preloadQuery(el.applications.waitingCounts, { workspaceId, libraryIds: [id] }, { token })),
  ]);
  return Object.fromEntries(Object.entries({ draft, credentials, publication, domains, versions, versionCount, addressNotice, team, sourceStatus, lastCheck, applications, applicationsWaiting }).filter(([, value]) => value !== undefined));
}
