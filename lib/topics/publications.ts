import type { FunctionReturnType } from "convex/server";
import type { AuthorPublication } from "@/components/authors/types";
import type { api } from "@/convex/_generated/api";
import type { PublicationCard } from "../evidence-libraries/publication-cards";
import { publicationOf } from "../evidence-libraries/publication-cards";
export type TopicPublication = AuthorPublication & {locations: {name: string; url: string}[]; metadataLocation: {libraryId: string; itemKey: string}};
export type TopicPublicationPage = {papers: TopicPublication[]; nextCursor: string | null; unavailableCount: number; updating: boolean; complete: boolean};

/** Copies of one publication a page lists: the most `topics/publications:listLocations` reads at once. */
export const MAX_LOCATIONS = 100;

/** What a page of a topic's publications is read with: the app's pages through Next, the assistant through Convex. */
export type TopicPublicationReads = {
  groups: (topicId: string, cursor: string | null) => Promise<FunctionReturnType<typeof api.topics.publications.listGroups>>;
  locations: (groupKey: string) => Promise<FunctionReturnType<typeof api.topics.publications.listLocations>>;
  card: (libraryId: string, itemKey: string, baseUrl: string) => Promise<PublicationCard | null>;
};

/** A page of a topic's publications, ten groups of copies at a time, searched by `query` in their titles, authors and abstracts. */
export async function readTopicPublicationsWith(reads: TopicPublicationReads, topicId: string, query: string, cursor: string | null): Promise<TopicPublicationPage> {
  const result = await reads.groups(topicId, cursor);
  let unavailableCount = 0;
  const rows = await Promise.all(result.page.map(async group => {
    try {
      // ponytail: a publication's first 100 copies. One with more is counted as not fully loaded, so the page says so
      // instead of calling itself complete; its links need reading a page at a time, when asked for.
      const read = await reads.locations(group.key);
      if (!read.isDone) {
        unavailableCount++;
        console.error("Topic publication has more copies than one page lists", {topicId, group: group.key, listed: MAX_LOCATIONS});
      }
      // Communities with Topics off keep their copies off topic pages.
      const locations = read.page.filter(location => location.library.topics);
      const cards = await Promise.allSettled(locations.map(async location => ({location, card: await reads.card(location.library.id, location.itemKey, location.library.url)})));
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
        id: group.key, ...publicationOf(card, location.itemKey, location.library.url), library: location.library,
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
