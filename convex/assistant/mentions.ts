/**
 * What @ in the assistant's composer can point at (#327): the person's saved searches,
 * collections and saved papers, by name. Pointing gives no access: the assistant already
 * reaches everything its sender can. The message carries the pick as `@[name](kind:id)`
 * (lib/assistant/mentions.ts).
 */
import { v } from "convex/values";
import { requireFeature } from "../featureFlags/guard";
import { SEARCH_TERMS_MAX } from "../library/collections";
import { readLibraryPage } from "../library/queries";
import { listedSearchesAction } from "../research/records";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { MENTIONS_EACH as EACH, mentionablesValidator } from "./validators";

const FLAG = "assistant.enabled";
const first = { cursor: null, numItems: EACH };

export const findAction = defineUserQuery({
  path: "assistant/mentions:find",
  description:
    `Finds records in the person's account by name: saved searches by their query or questions, collections by name, saved papers by title, abstract or author, at most ${EACH} of each. ` +
    "With no `text`, the newest searches, collections by name and the latest saved papers. Each comes with the ID its own tools take.",
  args: { text: v.optional(v.string()) },
  returns: mentionablesValidator,
  run: async (ctx, userId, { text }) => {
    await requireFeature(ctx, FLAG, userId);
    const needle = text?.trim() || undefined;
    // A function gets one paginated read, which the library's takes: searches by text read
    // through a stream, and the rest take their first few.
    const [searches, collections, papers] = await Promise.all([
      needle
        ? // ponytail: matches among the newest searches the list's one read reaches (1,000 rows), so a match older than that isn't offered. Carry on from its cursor if people with that many searches miss one.
          listedSearchesAction.run(ctx, userId, { paginationOpts: first, sort: "recent", text: needle }).then(({ page }) => page)
        : ctx.db.query("searches").withIndex("by_user_and_createdAt", (q) => q.eq("userId", userId)).order("desc").take(EACH).then((rows) => rows.map(({ data }) => data)),
      (needle
        ? ctx.db.query("collections").withSearchIndex("search_name", (q) => q.search("name", needle.split(/\s+/).slice(0, SEARCH_TERMS_MAX).join(" ")).eq("userId", userId))
        : ctx.db.query("collections").withIndex("by_user_sortName", (q) => q.eq("userId", userId))
      ).take(EACH),
      readLibraryPage(ctx, userId, { ...(needle ? { searchText: needle } : {}), sortBy: "savedAt", sortOrder: "desc" }, first),
    ]);
    const groups = [
      // A search found by its filters alone has no query: it's named by its question, or left out when it has neither.
      searches.slice(0, EACH).map((search) => ({ kind: "search" as const, id: search.id, label: search.query.trim() || (search.questionText ?? "").trim(), count: search.count })),
      collections.map((collection) => ({ kind: "collection" as const, id: collection._id, label: collection.name, count: collection.itemCount ?? 0 })),
      papers.page.slice(0, EACH).map((item) => ({ kind: "paper" as const, id: item.openalexId, label: item.title })),
    ].map((group) => group.filter((record) => record.label.trim()));
    // A kind at a time, round and round, so the picker's first few hold every kind that matched.
    return Array.from({ length: EACH }, (_, at) => groups.flatMap((group) => group[at] ?? [])).flat();
  },
});
export const find = userQuery(findAction);
export const findForAssistant = assistantQuery(findAction);
