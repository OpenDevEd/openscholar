"use server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { readPublicationCard } from "@/lib/evidence-libraries/publication-card";
import { topicIdSchema } from "@/lib/topics/contract";
import type { TopicPublication, TopicPublicationPage } from "@/lib/topics/publications";

/** Copies of one publication a page lists: the most `topics/publications:listLocations` reads at once. */
const MAX_LOCATIONS = 100;

export async function readTopicPublications(topicId: string, query: string, cursor: string | null): Promise<TopicPublicationPage> {
  topicIdSchema.parse(topicId);
  if (query.length > 200 || (cursor?.length ?? 0) > 8192) throw new Error("Invalid publication search");
  const result = await fetchQuery(api.topics.publications.listGroups, {topicId, paginationOpts: {cursor, numItems: 10}});
  let unavailableCount = 0;
  const rows = await Promise.all(result.page.map(async group => {
    try {
      // ponytail: a publication's first 100 copies. One with more is counted as not fully loaded, so the page says so
      // instead of calling itself complete; its links need reading a page at a time, when asked for.
      const read = await fetchQuery(api.topics.publications.listLocations, {groupKey: group.key, paginationOpts: {cursor: null, numItems: MAX_LOCATIONS}});
      if (!read.isDone) {
        unavailableCount++;
        console.error("Topic publication has more copies than one page lists", {topicId, group: group.key, listed: MAX_LOCATIONS});
      }
      const locations = read.page;
      const cards = await Promise.allSettled(locations.map(async location => ({location, card: await readPublicationCard(location.library.id, location.itemKey, location.library.url)})));
      const available = cards.flatMap((result, index) => {
        if (result.status === "fulfilled") return result.value.card ? [{location: result.value.location, card: result.value.card}] : [];
        unavailableCount++;
        console.error("Topic publication card unavailable", {topicId, libraryId: locations[index].library.id, itemKey: locations[index].itemKey, error: result.reason});
        return [];
      });
      if (!available.some(({location}) => location.topicIds.includes(topicId))) return null;
      const search = query.trim().toLocaleLowerCase();
      if (search && !available.some(({location, card}) => `${card.title ?? ""} ${location.metadata.creators.join(" ")} ${location.metadata.abstract ?? ""}`.toLocaleLowerCase().includes(search))) return null;
      const {location, card} = available[0];
      return {
        id: group.key, title: card.title ?? "Untitled", type: card.itemType,
        year: card.date?.match(/\d{4}/)?.[0] ?? "",
        authors: (card.creators ?? []).map(creator => creator.name ?? [creator.firstName, creator.lastName].filter(Boolean).join(" ")).join(", "),
        cover: card.PDFCoverPageImage ?? undefined,
        pages: card.numPages && Number.isFinite(Number(card.numPages)) ? Number(card.numPages) : undefined,
        url: new URL(`/lib/${location.itemKey}`, location.library.url).href, library: location.library,
        locations: available.map(({location}) => ({name: location.library.name, url: new URL(`/lib/${location.itemKey}`, location.library.url).href})),
        metadataLocation: {libraryId: location.library.id, itemKey: location.itemKey},
      } satisfies TopicPublication;
    } catch (error) {
      unavailableCount++;
      console.error("Topic publication group unavailable", {topicId, group: group.key, error});
      return null;
    }
  }));
  return {papers: rows.flatMap(row => row ? [row] : []), nextCursor: result.isDone ? null : result.continueCursor, unavailableCount, updating: result.updating, complete: result.isDone && unavailableCount === 0 && !result.updating};
}
