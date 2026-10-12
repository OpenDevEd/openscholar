"use server";
import { readPublicationCard } from "@/lib/evidence-libraries/publication-card";
import { authorPublicationsFrom } from "@/lib/authors/publications";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AuthorPublication } from "@/components/authors/types";

export async function readAuthorPublications(profileId: Id<"authorProfiles">): Promise<{papers: AuthorPublication[]; unavailableCount: number}> {
  return authorPublicationsFrom(await fetchQuery(api.authors.publications.list, {profileId}), readPublicationCard, profileId);
}
