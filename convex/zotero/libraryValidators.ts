/** What the assistant reads of a person's Zotero library (./library.ts): each list capped. */
import { v } from "convex/values";
import { capped } from "../lib/listCaps";
import { createError } from "../lib/errors";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Zotero items one read of a job's papers takes (./actions.ts `papersOf`): one page of Zotero's. */
export const ZOTERO_PAGE = 50;
/** Characters of a Zotero paper's title, abstract, and an author's or a venue's name a job keeps. */
export const ZOTERO_TITLE_MAX = 500;
export const ZOTERO_ABSTRACT_MAX = 10_000;
export const ZOTERO_NAME_MAX = 300;
/** Groups or collections one read returns, the most Zotero gives at once, and items one read of the assistant's returns. */
export const ZOTERO_LIST_PAGE = 100;
/** Pages of Zotero's asked for at once where a library is read through: measured on a group of 172,728 papers, 8 at once read 5,000 in 41 seconds with none refused, and a group's 3,325 collections in under 7. */
export const ZOTERO_AT_ONCE = 8;
export const ZOTERO_ITEMS_MAX = 25;

export const zoteroGroupsValidator = v.object({
  groups: capped(v.array(v.object({ id: v.string(), name: v.string(), type: v.string(), items: v.number() })), ZOTERO_LIST_PAGE),
  next: v.optional(v.number()),
});
export const zoteroCollectionsValidator = v.object({
  collections: capped(v.array(v.object({ key: v.string(), name: v.string(), parent: v.optional(v.string()), items: v.number(), subcollections: v.number() })), ZOTERO_LIST_PAGE),
  next: v.optional(v.number()),
});
export const zoteroItemsValidator = v.object({
  items: capped(
    v.array(
      v.object({
        key: v.string(),
        title: v.string(),
        authors: capped(v.array(v.string()), 5),
        moreAuthors: v.optional(v.number()),
        year: v.optional(v.number()),
        doi: v.optional(v.string()),
        venue: v.optional(v.string()),
        type: v.string(),
        abstract: v.optional(v.string()),
        pdf: v.boolean(),
      }),
    ),
    ZOTERO_ITEMS_MAX,
  ),
  next: v.optional(v.number()),
});

/** A Zotero group's ID is its number, and a collection's key eight capital letters and digits: anything else would change the address it's read from. */
export function checkZoteroIds({ groupId, collectionKey, itemKey }: { groupId?: string; collectionKey?: string; itemKey?: string }) {
  if (groupId !== undefined && !/^\d{1,15}$/.test(groupId)) throw createError("VALIDATION_ERROR", "A Zotero group is named by its number, such as 4719820.");
  if (collectionKey !== undefined && !/^[A-Z0-9]{8}$/.test(collectionKey)) throw createError("VALIDATION_ERROR", "A Zotero collection is named by its key, eight capital letters and digits such as ABCD1234.");
  if (itemKey !== undefined && !/^[A-Z0-9]{8}$/.test(itemKey)) throw createError("VALIDATION_ERROR", "A Zotero item is named by its key, eight capital letters and digits such as ITEM0001.");
}

/** A Zotero set a job would read: its IDs in their form, and the person's Zotero connected, before anyone is asked to pay for it. */
export async function checkZoteroSet(ctx: QueryCtx, userId: Id<"users">, set: { groupId?: string; collectionKey?: string; itemKey?: string }) {
  checkZoteroIds(set);
  if (!(await ctx.db.query("zoteroConnections").withIndex("by_user", (q) => q.eq("userId", userId)).first())) {
    throw createError("ZOTERO_NOT_CONNECTED", "Zotero isn't connected to this account. Connect it in Settings, then try again.");
  }
}

/** A Zotero item's PDF put in a chat (./library.ts `pdf`): the chat's file for it, its name and how many pages it has. */
export const zoteroPdfValidator = v.object({ file: v.id("assistantFiles"), name: v.string(), pages: v.number() });
