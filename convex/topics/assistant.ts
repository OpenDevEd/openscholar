/**
 * A research area's publications as the assistant reads them (#323): the groups of copies
 * Evidence Libraries hold on a topic, each read from its library, as the topic's page lists them
 * (../../lib/topics/publications.ts).
 */
import { v, type Infer } from "convex/values";
import { api } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { topicIdSchema } from "../../lib/topics/contract";
import { MAX_LOCATIONS, readTopicPublicationsWith } from "../../lib/topics/publications";
import { fetchPublicationCard } from "../../lib/evidence-libraries/publication-cards";
import { TOPIC_PUBLICATIONS_PAGE, topicPublicationsReadValidator } from "./validators";

export const publicationsAction = defineUserAction({
  path: "topics/assistant:publications",
  description:
    `Reads the publications Evidence Communities hold on a research area, by its topic ID such as T10044, ${TOPIC_PUBLICATIONS_PAGE} at a time from \`cursor\`, searched by \`query\` in their titles, authors and abstracts. ` +
    "Each one's title, type, year, authors, its page, the community it's in and how many communities hold a copy; `next` is the next page's `cursor`, null on the last. `updating`: the list is being regrouped and may change. The area itself is research/topics:get.",
  args: { topicId: v.string(), query: v.optional(v.union(v.string(), v.null())), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: topicPublicationsReadValidator,
  spendsCredits: false,
  outsideEffect: false,
  undoable: true,
  run: async (ctx, _actor, { topicId, query, cursor }): Promise<Infer<typeof topicPublicationsReadValidator>> => {
    const id = topicId.trim().toUpperCase();
    if (!topicIdSchema.safeParse(id).success) throw createError("VALIDATION_ERROR", "A research area is named by its topic ID, such as T10044.");
    if ((query?.length ?? 0) > 200 || (cursor?.length ?? 0) > 8192) throw createError("VALIDATION_ERROR", "Search a research area's publications with up to 200 characters.");
    const page = await readTopicPublicationsWith({
      groups: (topicId, cursor) => ctx.runQuery(api.topics.publications.listGroups, { topicId, paginationOpts: { cursor, numItems: TOPIC_PUBLICATIONS_PAGE } }),
      locations: (groupKey) => ctx.runQuery(api.topics.publications.listLocations, { groupKey, paginationOpts: { cursor: null, numItems: MAX_LOCATIONS } }),
      card: fetchPublicationCard,
    }, id, query ?? "", cursor ?? null);
    return {
      publications: page.papers.map(({ title, type, year, authors, url, library, locations }) => ({ title, type, year, authors, url, library: library.name, copies: new Set(locations.map((copy) => new URL(copy.url).origin)).size })),
      next: page.nextCursor,
      unavailable: page.unavailableCount,
      updating: page.updating,
    };
  },
});
export const publications = userAction(publicationsAction);
export const publicationsForAssistant = assistantAction(publicationsAction);
