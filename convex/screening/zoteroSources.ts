/**
 * The Zotero groups a person is in, as the form that starts a screening lists them beside their own library
 * (plans/screening-reviewers). A library's collections are kept as rows the form pages through and finds by name
 * (../zotero/tree.ts), and their papers are read by the check (./gathering.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workspaceAction } from "../lib/userActions";
import { zoteroGroupsValidator } from "./validators";

/** Lists one page of the Zotero groups the person is in, each with how many items it holds, and where the next page starts. Their own library is theirs without asking. */
export const groups = workspaceAction({
  args: { start: v.optional(v.number()) },
  returns: zoteroGroupsValidator,
  handler: async (ctx, { userId }, { start = 0 }) => {
    const read: { page: Array<{ id: string; name: string; numItems: number }>; next?: number } = await ctx.runAction(internal.zotero.actions.groupsOf, { userId, start });
    return { page: read.page.map(({ id, name, numItems }) => ({ id, name, papers: numItems })), ...(read.next === undefined ? {} : { next: read.next }) };
  },
});
