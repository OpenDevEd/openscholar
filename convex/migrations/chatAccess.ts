import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { grantOf } from "../sharing/items";

/**
 * Moves the people a chat was shared with onto the tables every shared item uses (#653): one who
 * read it becomes a guest who views, one who wrote in it a guest who edits, each with the chat's
 * newest message time, which their list of chats orders by. A chat's owner row is left behind: a
 * chat is its workspace's, its maker's and its admins' to manage. A chat shared with a whole
 * organization is left too, and counted by `organizations`: chats are shared with people only, and
 * what becomes of such a grant is decided by hand (shared dev holds none). Safe to run again.
 *
 *   npx convex run migrations/chatAccess:run
 *   npx convex run migrations/chatAccess:verify
 *   npx convex run migrations/chatAccess:organizations
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const people = migrations.define({
  table: "assistantThreadAccess",
  migrateOne: async (ctx, row) => {
    const [kind, id] = row.principal.split(":");
    const userId = kind === "user" ? ctx.db.normalizeId("users", id) : null;
    if (!userId || row.role === "owner") return;
    const thread = await ctx.db.get("assistantThreads", row.threadId);
    if (!thread || !(await ctx.db.get("users", userId)) || (await grantOf(ctx, thread._id, userId))) return;
    await ctx.db.insert("itemAccess", { kind: "chat", item: thread._id, name: thread.title, userId, role: row.role === "write" ? "editor" : "viewer", grantedBy: thread.createdBy, grantedAt: row.createdAt, lastMessageAt: thread.lastMessageAt });
  },
});

export const run = migrations.runner([internal.migrations.chatAccess.people]);

/** Whether the move hasn't run to the end of the table: 1, or 0 when it has. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => (await migrations.getStatus(ctx, { migrations: [internal.migrations.chatAccess.people] })).filter((status) => !status.isDone).length,
});

/** Chats shared with a whole organization, among the first page of the old rows: each needs a person to decide what becomes of it. */
export const organizations = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ found: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("assistantThreadAccess").paginate({ cursor, numItems: 1000 });
    return { found: page.page.filter((row) => row.principal.startsWith("organization:")).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
