/**
 * The person's own Zotero library, as the assistant reads it (#328): their groups, their
 * collections and the items in one, through the Zotero account they connected (./actions.ts),
 * so it can find a collection there to screen or extract. The account is the person's,
 * whichever workspace they act in. A key or a group in the wrong form is refused before
 * anything is asked of Zotero.
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { ZOTERO_ITEMS_MAX, ZOTERO_LIST_PAGE, zoteroCollectionsValidator, zoteroGroupsValidator, zoteroItemsValidator } from "./libraryValidators";

/** Characters of an item's abstract one read gives. */
const ABSTRACT_SHOWN = 600;
const reads = { spendsCredits: false, outsideEffect: false, undoable: true } as const;

export const groupsAction = defineUserAction({
  path: "zotero/library:groups",
  description:
    `Lists the Zotero groups the person is in, through the Zotero account they connected, up to ${ZOTERO_LIST_PAGE} from \`start\` (0 first): each group's ID, name, type and how many items it has; \`next\` is where the next \`start\` is, when there are more. ` +
    "A group's collections are zotero/library:collections with its `groupId`. Refused when they haven't connected Zotero in their settings.",
  args: { start: v.optional(v.union(v.number(), v.null())) },
  returns: zoteroGroupsValidator,
  ...reads,
  run: async (ctx, { userId }, { start }): Promise<Infer<typeof zoteroGroupsValidator>> => {
    const read: { page: Array<{ id: string; name: string; type: string; numItems: number }>; next?: number } = await ctx.runAction(internal.zotero.actions.groupsOf, { userId, start: Math.max(0, Math.floor(start ?? 0)) });
    return { groups: read.page.slice(0, ZOTERO_LIST_PAGE).map(({ id, name, type, numItems }) => ({ id, name, type, items: numItems })), ...(read.next === undefined ? {} : { next: read.next }) };
  },
});
export const groups = userAction(groupsAction);
export const groupsForAssistant = assistantAction(groupsAction);

export const collectionsAction = defineUserAction({
  path: "zotero/library:collections",
  description:
    `Lists the collections of the person's own Zotero library, or with \`groupId\` of one of their groups, every level, up to ${ZOTERO_LIST_PAGE} from \`start\` (0 first): each one's key, name, the key of the collection it sits in, how many items it holds and how many collections; \`next\` is where the next \`start\` is, when there are more. ` +
    'Screen or extract a collection\'s papers with the set { kind: "zotero", collectionKey, groupId }; its items one page at a time are zotero/library:items.',
  args: { groupId: v.optional(v.union(v.string(), v.null())), start: v.optional(v.union(v.number(), v.null())) },
  returns: zoteroCollectionsValidator,
  ...reads,
  run: async (ctx, { userId }, { groupId, start }): Promise<Infer<typeof zoteroCollectionsValidator>> => {
    const read: { page: Array<{ key: string; name: string; parentCollection: string | null; numItems: number; numCollections: number }>; next?: number } = await ctx.runAction(internal.zotero.actions.collectionsOf, { userId, ...(groupId != null ? { groupId } : {}), start: Math.max(0, Math.floor(start ?? 0)) });
    const collections = read.page.slice(0, ZOTERO_LIST_PAGE).map((one) => ({ key: one.key, name: one.name, ...(one.parentCollection ? { parent: one.parentCollection } : {}), items: one.numItems, subcollections: one.numCollections }));
    return { collections, ...(read.next === undefined ? {} : { next: read.next }) };
  },
});
export const collections = userAction(collectionsAction);
export const collectionsForAssistant = assistantAction(collectionsAction);

export const itemsAction = defineUserAction({
  path: "zotero/library:items",
  description:
    `Reads a page of the items in the person's own Zotero library, or one collection of it (\`collectionKey\`, not its sub-collections), or a group's (\`groupId\`): up to ${ZOTERO_ITEMS_MAX} a page from \`start\` (0 first). ` +
    "Each item's key, title, first authors, year, DOI, venue, type, the start of its abstract, and whether it has a PDF; `next` is where the next page starts, missing on the last.",
  args: { collectionKey: v.optional(v.union(v.string(), v.null())), groupId: v.optional(v.union(v.string(), v.null())), start: v.optional(v.union(v.number(), v.null())), limit: v.optional(v.union(v.number(), v.null())) },
  returns: zoteroItemsValidator,
  ...reads,
  run: async (ctx, { userId }, { collectionKey, groupId, start, limit }): Promise<Infer<typeof zoteroItemsValidator>> => {
    const read: { items: Array<{ key: string; title: string; abstract?: string; authors: string[]; year?: number; doi?: string; itemType: string; venueName?: string; hasPdfChild: boolean }>; nextCursor?: number } = await ctx.runAction(internal.zotero.actions.itemsOf, {
      userId,
      // An empty one is refused as a key in the wrong form, never read as the whole library.
      ...(collectionKey != null ? { collectionKey } : {}),
      ...(groupId != null ? { groupId } : {}),
      start: start ?? 0,
      limit: Math.min(Math.max(1, Math.floor(limit ?? 10)), ZOTERO_ITEMS_MAX),
    });
    return {
      items: read.items.slice(0, ZOTERO_ITEMS_MAX).map((item) => ({
        key: item.key,
        title: item.title,
        authors: item.authors.slice(0, 5),
        ...(item.authors.length > 5 ? { moreAuthors: item.authors.length - 5 } : {}),
        ...(item.year === undefined ? {} : { year: item.year }),
        ...(item.doi ? { doi: item.doi } : {}),
        ...(item.venueName ? { venue: item.venueName } : {}),
        type: item.itemType,
        ...(item.abstract ? { abstract: item.abstract.length > ABSTRACT_SHOWN ? `${item.abstract.slice(0, ABSTRACT_SHOWN)}…` : item.abstract } : {}),
        pdf: item.hasPdfChild,
      })),
      ...(read.nextCursor === undefined ? {} : { next: read.nextCursor }),
    };
  },
});
export const items = userAction(itemsAction);
export const itemsForAssistant = assistantAction(itemsAction);
