"use client";
import { useOrganizationFeatures } from "@/lib/auth/use-organization-features";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { PageWrapper } from "@/components/PageWrapper";
import { readAuthorPublications } from "@/app/actions/author-publications";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { readProfileAuthor, readProfileAuthorWorks, searchProfileAuthors } from "@/app/actions/authors";
import AuthorPage from "./author-page";
import { ProfileAccess } from "./profile-access";
import type { AuthorProfile } from "./types";
import { readConvexErrorData } from "@/convex/lib/errors";

export function AuthorProfileView({profileId, configuration = false}: {profileId: Id<"authorProfiles">; configuration?: boolean}) {
  const { isLoading: authLoading } = useConvexAuth();
  const { data: features } = useOrganizationFeatures();
  const record = useQuery(api.authors.profiles.get, {profileId});
  const references = useQuery(api.authors.publications.list, {profileId});
  const publications = useSWR(references ? ["author-publications", profileId, JSON.stringify(references)] : null, () => readAuthorPublications(profileId), {refreshInterval: data => data?.unavailableCount ? 15000 : 0});
  const save = useAction(api.authors.photos.save);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const authors = useSWR(debouncedSearch ? ["author-profile-search", debouncedSearch] : null, ([, value]) => searchProfileAuthors(value));
  const match = useSWR(record?.openalex ? ["author-profile-match", record.openalex] : null, ([, id]) => readProfileAuthor(id));
  const works = useSWRInfinite((page, previous) => {
    if (!record?.openalex || (previous && previous.results.length < 10)) return null;
    return ["author-profile-works", record.openalex, page + 1] as const;
  }, ([, id, page]) => readProfileAuthorWorks(id, page));
  if ((configuration && authLoading) || record === undefined || references === undefined) return <PageWrapper><AuthStatePanel variant="loading" layout="fullscreen" title="Loading author profile" /></PageWrapper>;
  if (!record) return <p className="p-6">Author profile not found.</p>;
  if (configuration && !record.role) return <PageWrapper><AuthStatePanel layout="fullscreen" variant="no_access" /></PageWrapper>;
  const profile: AuthorProfile = {
    ...record, id: record._id, photo: record.photo ?? undefined, featured: (references ?? []).filter(reference => reference.rank !== undefined).sort((a, b) => a.rank! - b.rank!).map(reference => reference.id),
    match: match.data ?? (record.openalex ? {id: record.openalex, name: record.name, affiliation: "", topics: "", works: []} : undefined),
  };
  return <AuthorPage key={`${record._id}:${configuration}`} profile={profile} configuration={configuration}
    canBrowseAuthors={features?.authors === true} canEdit={Boolean(record.role)} accessSection={configuration && record.role === "owner" ? <ProfileAccess profileId={profileId} /> : null}
    papers={publications.data?.papers ?? []} loadingPublications={publications.isLoading} loadingAuthors={authors.isValidating || search !== debouncedSearch} publicationStatus={publications.error ? "Publications could not be loaded. Try again shortly." : publications.data?.unavailableCount ? "Some publications could not be loaded. Try again shortly." : null} openAlexAuthors={authors.data ?? []} openAlexPapers={works.data?.flatMap(page => page.results) ?? []}
    openAlexError={authors.error || match.error || works.error ? "OpenAlex is unavailable. Try again." : null}
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
