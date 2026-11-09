import "server-only";
import { unstable_cache } from "next/cache";
import { readTopicPublications } from "@/app/actions/topic-publications";
import type { TopicPublicationPage } from "@/lib/topics/publications";

/**
 * A topic's first page of community records, kept 10 minutes: crawlers read many topic pages once each, and a page
 * a community couldn't answer for is thrown rather than kept, so the next request tries again.
 */
const readFirstPage = unstable_cache(
  async (topicId: string): Promise<TopicPublicationPage> => {
    const page = await readTopicPublications(topicId, "", null);
    if (page.updating || page.unavailableCount) throw new Error("A community hasn't answered for this topic yet");
    return page;
  },
  ["topic-page-publications"],
  { revalidate: 60 * 10 },
);

/** How long a topic page waits for its records before it goes out without them and the browser reads them, as before. */
const WAIT_MS = 1500;

/** The topic's first page of records for its HTML, or null when they aren't ready in time (or failed): the page then loads them itself. */
export function readTopicPublicationsForPage(topicId: string): Promise<TopicPublicationPage | null> {
  return Promise.race([
    readFirstPage(topicId).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
  ]);
}
