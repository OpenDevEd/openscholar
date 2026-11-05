"use client";
import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { readProfileAuthorWorks } from "@/app/actions/authors";
import type { AuthorCard } from "@/app/actions/author-card";
import { UserPlus } from "@/components/icons";
import { BAR_ACTION, BAR_LABEL } from "@/components/evidence-libraries/configuration/panel-header";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OpenAlexLimitedError, unlessLimited } from "@/lib/openalex/limited";
import { useSearchSource } from "@/lib/search/use-search-source";
import { useAppToast } from "@/lib/toast";
import { useWorkspaceRouter } from "@/lib/workspaces/href";
import { useWorkspaceMutation } from "@/lib/workspaces/url";
import { useWorkspaceFeatures } from "@/lib/workspaces/use-workspace-features";
import AuthorPage from "./author-page";
import type { AuthorProfile } from "./types";

/** Makes this author a hand-made profile, for whoever can make one, and opens its settings with the record linked. */
function ClaimAuthor({ card }: { card: AuthorCard }) {
  const create = useWorkspaceMutation(api.authors.profiles.create);
  const router = useWorkspaceRouter();
  const toast = useAppToast();
  const [claiming, setClaiming] = useState(false);
  if (!useWorkspaceFeatures().data?.authors) return null;
  return (
    <Button
      size="sm"
      className={BAR_ACTION}
      disabled={claiming}
      onClick={async () => {
        setClaiming(true);
        try {
          const id = await create({ name: card.name });
          router.push(`/authors/${id}/configuration?link=${card.paired ?? card.id}`);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Couldn't make this profile");
          setClaiming(false);
        }
      }}
    >
      <UserPlus />
      <span className={BAR_LABEL}>Claim this author</span>
    </Button>
  );
}

/** The page of any author in the index with no profile yet: the profile's own page, drawn from their record. */
export function AutomaticAuthor({ card }: { card: AuthorCard }) {
  const source = useSearchSource();
  const works = useSWRInfinite((page, previous: { results: unknown[] } | null) => {
    if (previous && previous.results.length < 10) return null;
    return ["author-profile-works", card.id, page + 1, source] as const;
  }, ([, id, page, reading]) => unlessLimited(readProfileAuthorWorks(id, page, reading)));
  const profile: AuthorProfile = {
    id: card.id as Id<"authorProfiles">,
    revision: 0,
    name: card.name,
    headline: "",
    affiliation: card.institution?.name ?? "",
    bio: "",
    website: "",
    linkedin: "",
    orcid: card.orcid ?? "",
    openalex: card.paired ?? card.id,
    featured: [],
    match: { id: card.id, name: card.name, affiliation: card.institution?.name ?? "", topics: "", works: [] },
  };
  const results = works.data?.flatMap((page) => page.results) ?? [];
  return (
    <AuthorPage
      profile={profile}
      configuration={false}
      canEdit={false}
      onSave={async (next) => next}
      accessSection={null}
      papers={[]}
      publicationStatus={null}
      loadingPublications={false}
      loadingAuthors={false}
      openAlexAuthors={[]}
      openAlexPapers={results as never}
      onSearchAuthors={() => {}}
      openAlexError={works.error instanceof OpenAlexLimitedError ? works.error.message : works.error ? "Couldn't read this author's papers." : null}
      hasMoreWorks={results.length < (works.data?.[0]?.meta.count ?? 0)}
      workCount={works.data?.[0]?.meta.count ?? 0}
      loadingWorks={works.isLoading || works.isValidating}
      onLoadMoreWorks={() => void works.setSize(works.size + 1)}
      card={card}
      automatic
      extraActions={<ClaimAuthor card={card} />}
    />
  );
}
