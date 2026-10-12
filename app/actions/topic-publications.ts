"use server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { readPublicationCard } from "@/lib/evidence-libraries/publication-card";
import { topicIdSchema } from "@/lib/topics/contract";
import { MAX_LOCATIONS, readTopicPublicationsWith, type TopicPublicationPage } from "@/lib/topics/publications";

export async function readTopicPublications(topicId: string, query: string, cursor: string | null): Promise<TopicPublicationPage> {
  topicIdSchema.parse(topicId);
  if (query.length > 200 || (cursor?.length ?? 0) > 8192) throw new Error("Invalid publication search");
  return readTopicPublicationsWith({
    groups: (topicId, cursor) => fetchQuery(api.topics.publications.listGroups, {topicId, paginationOpts: {cursor, numItems: 10}}),
    locations: groupKey => fetchQuery(api.topics.publications.listLocations, {groupKey, paginationOpts: {cursor: null, numItems: MAX_LOCATIONS}}),
    card: readPublicationCard,
  }, topicId, query, cursor);
}
