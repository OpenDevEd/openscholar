// An item's Activity (#656): what changed on it and who changed it, newest first, a page at a time.

import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../lib/people";
import { defineUserQuery, userQuery, assistantQuery } from "../lib/userActions";
import { findSearch } from "../research/records";
import { makersIn, makerValidator } from "../workspaces/makers";
import { activityKindValidator, itemKey, itemKindValidator, type ItemKind } from "./validators";

const rowValidator = v.object({
  _id: v.id("activity"),
  at: v.number(),
  by: v.object({ name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean() }),
  happened: activityKindValidator,
  count: v.optional(v.number()),
  detail: v.optional(v.string()),
  viaAssistant: v.optional(v.literal(true)),
});

/** The item, when the workspace has it; a search goes by the ID its page shows. An author profile nobody owns is in no workspace. */
export async function itemIn(ctx: QueryCtx, workspaceId: Id<"workspaces">, kind: ItemKind, id: string): Promise<{ createdBy: Id<"users"> } | null> {
  if (kind === "search") return await findSearch(ctx, workspaceId, id);
  const table = ({ collection: "collections", screening: "screeningJobs", extraction: "extractionJobs", author: "authorProfiles" } as const)[kind];
  const rowId = ctx.db.normalizeId(table, id);
  const row = rowId ? await ctx.db.get(rowId) : null;
  return row?.workspaceId === workspaceId && row.createdBy ? { createdBy: row.createdBy } : null;
}


export const listAction = defineUserQuery({
  path: "activity/queries:list",
  description:
    "Lists what changed on one item of the workspace, newest first, a page at a time: each change with who made it, whether the assistant made it for them, what happened, how many papers it took in, and a word about it such as a name or a query. " +
    "`kind` is the item's kind and `id` its ID; a search's is the ID its page shows. An item the workspace doesn't have, or doesn't have yet, lists nothing.",
  args: { kind: itemKindValidator, id: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(rowValidator),
  run: async (ctx, { userId, workspaceId }, { kind, id, paginationOpts }) => {
    // Nothing for an item elsewhere, or a new search the server hasn't saved yet.
    if (!(await itemIn(ctx, workspaceId, kind, id))) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db.query("activity").withIndex("by_workspace_and_item", (q) => q.eq("workspaceId", workspaceId).eq("item", itemKey(kind, id))).order("desc").paginate(paginationOpts);
    // Each person read once a page.
    const people = new Map<Id<"users">, Promise<{ name: string; imageUrl?: string; you: boolean }>>();
    const person = (by: Id<"users">) => {
      if (!people.has(by)) people.set(by, ctx.db.get("users", by).then((user) => ({ name: user ? personName(user) || user.email : "", ...(user?.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: by === userId })));
      return people.get(by)!;
    };
    return {
      ...page,
      page: await Promise.all(page.page.map(async (row) => ({
        _id: row._id,
        at: row._creationTime,
        by: await person(row.by),
        happened: row.happened,
        ...(row.count === undefined ? {} : { count: row.count }),
        ...(row.detail ? { detail: row.detail } : {}),
        ...(row.viaAssistant ? { viaAssistant: true as const } : {}),
      }))),
    };
  },
});
export const list = userQuery(listAction);
export const listForAssistant = assistantQuery(listAction);

export const startedByAction = defineUserQuery({
  path: "activity/queries:startedBy",
  description: "Says who started one item of an organization's workspace, as its page names them: their name, photo, and whether it's the person. In the person's own workspace everything is theirs, so it names no one. `kind` is the item's kind and `id` its ID; a search's is the ID its page shows.",
  args: { kind: itemKindValidator, id: v.string() },
  returns: v.union(makerValidator, v.null()),
  run: async (ctx, { userId, workspaceId }, { kind, id }) => {
    const item = await itemIn(ctx, workspaceId, kind, id);
    return item ? ((await (await makersIn(ctx, workspaceId, userId))(item.createdBy)) ?? null) : null;
  },
});
export const startedBy = userQuery(startedByAction);
export const startedByForAssistant = assistantQuery(startedByAction);
