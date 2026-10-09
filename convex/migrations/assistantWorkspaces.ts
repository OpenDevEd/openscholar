import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";
import { RECENT_REPLIES } from "../assistant/validators";

/**
 * Puts every assistant chat from before workspaces (#650, slice 5) in its owner's own
 * workspace, as theirs, and each person's record with the assistant there too. A reply that
 * ran across the deploy acts in its sender's own, and counts there. New ones carry their
 * workspace from the start, and running this again changes nothing.
 *
 *   npx convex run migrations/assistantWorkspaces:run
 *   npx convex run migrations/assistantWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const own = (ctx: MutationCtx, userId: Id<"users">) => ensureWorkspace(ctx, { kind: "personal", userId });

// A chat keeps its summary and its reply's state: ten at a time.
export const threads = migrations.define({
  table: "assistantThreads",
  batchSize: 10,
  migrateOne: async (ctx, thread) => {
    const patch = {
      ...(thread.workspaceId ? {} : { workspaceId: await own(ctx, thread.ownerId), createdBy: thread.ownerId }),
      ...(thread.reply && !thread.reply.workspaceId ? { reply: { ...thread.reply, workspaceId: await own(ctx, thread.reply.senderId) } } : {}),
    };
    return Object.keys(patch).length ? patch : undefined;
  },
});

export const spenders = migrations.define({
  table: "assistantSpenders",
  migrateOne: async (ctx, spender) => {
    if (spender.workspaceId) return;
    const workspaceId = await own(ctx, spender.userId);
    const scoped = await ctx.db.query("assistantSpenders").withIndex("by_workspace_and_user", (q) => q.eq("workspaceId", workspaceId).eq("userId", spender.userId)).unique();
    if (!scoped) return { workspaceId };
    // One written there between the deploy and this keeps its own settings, and takes this one's costs in, a reply's added up.
    const recent = [...spender.recent];
    for (const entry of scoped.recent) {
      const at = recent.findIndex((kept) => kept.reply === entry.reply);
      if (at === -1) recent.push(entry);
      else recent[at] = { reply: entry.reply, credits: recent[at].credits + entry.credits };
    }
    await ctx.db.patch("assistantSpenders", scoped._id, { recent: recent.slice(-RECENT_REPLIES), ...(scoped.newChats === undefined && spender.newChats !== undefined ? { newChats: spender.newChats } : {}) });
    await ctx.db.delete("assistantSpenders", spender._id);
  },
});

export const run = migrations.runner([internal.migrations.assistantWorkspaces.threads, internal.migrations.assistantWorkspaces.spenders]);

/** Rows on one page of `table` with no workspace yet, or a chat with no maker or a reply with no workspace. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("assistantThreads"), v.literal("assistantSpenders")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "assistantThreads") {
      const page = await ctx.db.query(table).paginate(opts);
      return { missing: page.page.filter((thread) => !thread.workspaceId || !thread.createdBy || (thread.reply && !thread.reply.workspaceId)).length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query(table).paginate(opts);
    return { missing: page.page.filter((spender) => !spender.workspaceId).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many chats and records have no workspace; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["assistantThreads", "assistantSpenders"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.assistantWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
