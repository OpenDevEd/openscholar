"use client";
import { useTranslations } from "next-intl";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { PageWrapper } from "@/components/PageWrapper";
import { readAuthorPublications } from "@/app/actions/author-publications";
import { useAction, useConvexAuth, useQuery, type Preloaded } from "convex/react";
import { preloadedQueryResult } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readProfileAuthor, readProfileAuthorWorks, searchProfileAuthors } from "@/app/actions/authors";
import { useSearchSource } from "@/lib/search/use-search-source";
import type { AuthorCard } from "@/app/actions/author-card";
import AuthorPage from "./author-page";
import { LinkedRecords } from "./linked-records";
import { ProfileAccess } from "./profile-access";
import type { AuthorProfile } from "./types";
import { useWorkspace } from "@/lib/workspaces/url";
import { readConvexErrorData } from "@/convex/lib/errors";
import { OpenAlexLimitedError, unlessLimited } from "@/lib/openalex/limited";

type ProfileRecord = FunctionReturnType<typeof api.authors.profiles.get>;
type ProfileReferences = FunctionReturnType<typeof api.authors.publications.list>;

export function AuthorProfileView({profileId, configuration = false}: {profileId: Id<"authorProfiles">; configuration?: boolean}) {
  const record = useQuery(api.authors.profiles.get, {profileId});
  const references = useQuery(api.authors.publications.list, {profileId});
  return <AuthorProfileBody profileId={profileId} record={record} references={references} configuration={configuration} />;
}

/** The public profile, drawn from queries the server already ran so it renders with the page. */
export function PreloadedAuthorProfile({profileId, preloadedRecord, preloadedReferences, card, links}: {
  profileId: Id<"authorProfiles">;
  preloadedRecord: Preloaded<typeof api.authors.profiles.get>;
  preloadedReferences: Preloaded<typeof api.authors.publications.list>;
  /** The linked author's record, read with the page, so what it fills in is there from the first frame. */
  card: AuthorCard | null;
  /** The author IDs linked beside the main one. */
  links: string[];
}) {
  // Until the browser's sign-in reaches Convex, a live query would run signed
  // out and briefly drop the viewer's role, so the server's result stands in.
  const { isLoading: authLoading } = useConvexAuth();
  const record = useQuery(api.authors.profiles.get, authLoading ? "skip" : {profileId}) ?? preloadedQueryResult(preloadedRecord);
  const references = useQuery(api.authors.publications.list, authLoading ? "skip" : {profileId}) ?? preloadedQueryResult(preloadedReferences);
  return <AuthorProfileBody profileId={profileId} record={record} references={references} card={card} links={links} />;
}

function AuthorProfileBody({profileId, record, references, configuration = false, card, links = []}: {
  profileId: Id<"authorProfiles">;
  record: ProfileRecord | undefined;
  references: ProfileReferences | undefined;
  configuration?: boolean;
  card?: AuthorCard | null;
  links?: string[];
}) {
  const tLabels = useTranslations("authorPages");
  const t = useTranslations("authorPages");
  const { isLoading: authLoading } = useConvexAuth();
  const workspaceId = useWorkspace();
  const publications = useSWR(references ? ["author-publications", profileId, JSON.stringify(references)] : null, () => readAuthorPublications(profileId), {refreshInterval: data => data?.unavailableCount ? 15000 : 0});
  const save = useAction(api.authors.photos.save);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const source = useSearchSource();
  // In settings the search starts from the profile's name, to offer its other records.
  const query = debouncedSearch || (configuration ? record?.name ?? "" : "");
  const authors = useSWR(query ? ["author-profile-search", query, source] : null, ([, value, reading]) => unlessLimited(searchProfileAuthors(value, reading)));
  const match = useSWR(record?.openalex ? ["author-profile-match", record.openalex, source] : null, ([, id, reading]) => unlessLimited(readProfileAuthor(id, reading)));
  const ids = [...new Set([record?.openalex, ...links].filter((id): id is string => Boolean(id)))];
  const works = useSWRInfinite((page, previous) => {
    if (!record?.openalex || (previous && previous.results.length < 10)) return null;
    return ["author-profile-works", ids.join("|"), page + 1, source] as const;
  }, ([, id, page, reading]) => unlessLimited(readProfileAuthorWorks(id, page, reading)));
  if ((configuration && authLoading) || record === undefined || references === undefined) return <PageWrapper><AuthStatePanel variant="loading" layout="fullscreen" title={t("loadingAuthorProfile")} /></PageWrapper>;
  if (!record) return <p className="p-6">{t("authorProfileNotFound")}</p>;
  if (configuration && !record.role) return <PageWrapper><AuthStatePanel layout="fullscreen" variant="no_access" /></PageWrapper>;
  const profile: AuthorProfile = {
    ...record,
    // What the profile leaves empty, its linked record fills in.
    affiliation: record.affiliation || (configuration ? "" : card?.institution?.name ?? ""),
    orcid: record.orcid || (configuration ? "" : card?.orcid ?? ""),
    id: record._id, photo: record.photo ?? undefined, featured: (references ?? []).filter(reference => reference.rank !== undefined).sort((a, b) => a.rank! - b.rank!).map(reference => reference.id),
    match: match.data ?? (record.openalex ? {id: record.openalex, name: record.name, affiliation: "", topics: "", works: []} : undefined),
  };
  return <AuthorPage key={`${record._id}:${configuration}`} profile={profile} configuration={configuration}
    card={card ?? undefined} searchIds={ids}
    linkedRecords={<LinkedRecords profileId={record._id} main={record.openalex} suggestions={authors.data && !("limited" in authors.data) ? authors.data : []} />}
    canEdit={Boolean(record.role)} member={record.member} atHome={record.workspaceId !== undefined && record.workspaceId === workspaceId} moveFrom={record.role === "owner" ? record.workspaceId : undefined} accessSection={configuration && record.role === "owner" && record.workspaceId ? <ProfileAccess profileId={profileId} workspaceId={record.workspaceId} /> : null}
    papers={publications.data?.papers ?? []} loadingPublications={publications.isLoading} loadingAuthors={authors.isValidating || search !== debouncedSearch} publicationStatus={publications.error ? tLabels("publicationsCouldNotBeLoadedTry") : publications.data?.unavailableCount ? tLabels("somePublicationsCouldNotBeLoaded") : null} openAlexAuthors={authors.data ?? []} openAlexPapers={works.data?.flatMap(page => page.results) ?? []}
    openAlexError={[authors.error, match.error, works.error].find((error) => error instanceof OpenAlexLimitedError)?.message ?? (authors.error || match.error || works.error ? tLabels("openalexIsUnavailableTryAgain") : null)}
    onSearchAuthors={value => { setSearch(value); if (value === search) void authors.mutate(); }}
    hasMoreWorks={(works.data?.flatMap(page => page.results).length ?? 0) < (works.data?.[0]?.meta.count ?? 0)}
    workCount={works.data?.[0]?.meta.count ?? 0} loadingWorks={works.isLoading || works.isValidating}
    onLoadMoreWorks={() => { void works.setSize(works.size + 1); }}
    onSave={async (next, previous) => {
      const {name, headline, affiliation, bio, website, linkedin, orcid, openalex} = next;
      try {
        const saved = await save({profileId, featured: next.featured as Id<"authorPublications">[], expectedRevision: next.revision, content: {name, headline, affiliation, bio, website, linkedin, orcid, openalex}, ...(next.photo !== previous.photo ? {photo: next.photo ?? ""} : {})});
        return {...next, ...saved, photo: saved.photo ?? undefined};
      } catch (error) {
        throw new Error(readConvexErrorData(error)?.message ?? "Could not save this profile. Try again.");
      }
    }} />;
}
