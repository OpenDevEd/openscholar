/**
 * A person's Zotero as the form that starts a screening shows it (plans/screening-reviewers), a page at a time: the
 * groups they are in beside their own library, and the collections at one level of a library, to add all of it or
 * any collection of it. Reading the papers themselves is the check's (./gathering.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workspaceAction } from "../lib/userActions";
import { zoteroCollectionsValidator, zoteroGroupsValidator } from "./validators";

/** Lists one page of the Zotero groups the person is in, each with how many items it holds, and where the next page starts. Their own library is theirs without asking. */
export const groups = workspaceAction({
  args: { start: v.optional(v.number()) },
  returns: zoteroGroupsValidator,
  handler: async (ctx, { userId }, { start = 0 }) => {
    const read: { page: Array<{ id: string; name: string; numItems: number }>; next?: number } = await ctx.runAction(internal.zotero.actions.groupsOf, { userId, start });
    return { page: read.page.map(({ id, name, numItems }) => ({ id, name, papers: numItems })), ...(read.next === undefined ? {} : { next: read.next }) };
  },
});

/**
 * Lists one page of the collections at one level of the person's own Zotero library, or of one of their groups: the
 * top level, or the ones inside `parent`. Each with how many items it holds itself and how many collections sit in it.
 */
export const collections = workspaceAction({
  args: { groupId: v.optional(v.string()), parent: v.optional(v.string()), start: v.optional(v.number()) },
  returns: zoteroCollectionsValidator,
  handler: async (ctx, { userId }, { groupId, parent, start = 0 }) => {
    const read: { page: Array<{ key: string; name: string; numItems: number; numCollections: number }>; next?: number } = await ctx.runAction(internal.zotero.actions.collectionsOf, { userId, ...(groupId ? { groupId } : {}), start, under: parent ?? "top" });
    return { page: read.page.map(({ key, name, numItems, numCollections }) => ({ key, name, papers: numItems, inside: numCollections })), ...(read.next === undefined ? {} : { next: read.next }) };
  },
});
