/**
 * The research areas the search page's filter offers, found by name: OpenAlex's domains,
 * fields, subfields and topics, from the catalog the app carries (lib/topics). In a file of
 * its own, reached by name, so only a lookup loads the catalog.
 */
import { v } from "convex/values";
import { internalQuery } from "../lib/functions";
import { searchTopicCatalog, topicName } from "../../lib/topics/search";
import { LOOKUP_MAX, lookupValidator, namesValidator } from "./searchValidators";

export const search = internalQuery({
  args: { text: v.string() },
  returns: lookupValidator,
  handler: async (_ctx, { text }) => ({
    // A match says what kind of area it is and what it sits under, so two areas of one name can be told apart.
    matches: searchTopicCatalog(text, LOOKUP_MAX).map((area) => ({ id: area.id, name: area.name, detail: [area.level, ...area.path].join(", ") })),
  }),
});

/** The names of research areas by their IDs, such as T10011 or fields/33. One the catalog doesn't have is left out. */
export const names = internalQuery({
  args: { ids: v.array(v.string()) },
  returns: namesValidator,
  handler: async (_ctx, { ids }) => ids.flatMap((id) => {
    const name = topicName(id);
    return name ? [{ id, name }] : [];
  }),
});
