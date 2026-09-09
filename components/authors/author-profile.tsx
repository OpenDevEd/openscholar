"use client";
import { useOrganizationFeatures } from "@/lib/auth/use-organization-features";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { PageWrapper } from "@/components/PageWrapper";
import { readAuthorPublications } from "@/app/actions/author-publications";
import { useAction, useQuery, useConvex } from "convex/react";
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

export function AuthorProfileView({profileId, configuration = false}: {profileId: Id<"authorProfiles">; configuration?: boolean}) {
  const convex = useConvex();
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
  if (record === undefined || references === undefined) return <p className="p-6 text-sm text-muted-foreground">Loading author profile…</p>;
  if (!record) return <p className="p-6">Author profile not found.</p>;
  if (configuration && !record.role) return <PageWrapper><AuthStatePanel layout="fullscreen" variant="no_access" /></PageWrapper>;
  const profile: AuthorProfile = {
    ...record, id: record._id, photo: record.photo ?? undefined, featured: (references ?? []).filter(reference => reference.rank !== undefined).sort((a, b) => a.rank! - b.rank!).map(reference => reference.id),
    match: match.data ?? (record.openalex ? {id: record.openalex, name: record.name, affiliation: "", topics: "", works: []} : undefined),
  };
  return <AuthorPage key={`${record._id}:${configuration}`} profile={profile} configuration={configuration}
    canBrowseAuthors={features?.authors === true} canEdit={Boolean(record.role && features?.authors)} accessSection={configuration && record.role === "owner" ? <ProfileAccess profileId={profileId} /> : null}
    papers={publications.data?.papers ?? []} publicationStatus={publications.error ? "Publications could not be loaded. Try again shortly." : publications.isLoading ? "Loading publications…" : publications.data?.unavailableCount ? "Some publications could not be loaded. Try again shortly." : null} openAlexAuthors={authors.data ?? []} openAlexPapers={works.data?.flatMap(page => page.results) ?? []}
    openAlexError={authors.error || match.error || works.error ? "OpenAlex is unavailable. Try again." : null}
    onSearchAuthors={value => { setSearch(value); if (value === search) void authors.mutate(); }}
    hasMoreWorks={(works.data?.flatMap(page => page.results).length ?? 0) < (works.data?.[0]?.meta.count ?? 0)}
    workCount={works.data?.[0]?.meta.count ?? 0} loadingWorks={works.isLoading || works.isValidating}
    onLoadMoreWorks={() => { void works.setSize(works.size + 1); }}
    onSave={async next => {
      const {name, headline, affiliation, bio, website, linkedin, orcid, openalex} = next;
      await save({profileId, featured: next.featured as Id<"authorPublications">[], expectedRevision: record.revision, content: {name, headline, affiliation, bio, website, linkedin, orcid, openalex}, ...(next.photo !== profile.photo ? {photo: next.photo ?? ""} : {})});
      const saved = await convex.query(api.authors.profiles.get, {profileId});
      if (!saved) throw new Error("Author profile not found");
      return {...next, ...saved, id: saved._id, photo: saved.photo ?? undefined};
    }} />;
}
