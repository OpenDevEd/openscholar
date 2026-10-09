import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Puts every assistant chat from before workspaces (#650, slice 5) in its owner's own
 * workspace, as theirs, and each person's record with the assistant there too. New ones carry
 * their workspace from the start, and running this again changes nothing.
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
  migrateOne: async (ctx, thread) => (thread.workspaceId ? undefined : { workspaceId: await own(ctx, thread.ownerId), createdBy: thread.ownerId }),
});

export const spenders = migrations.define({
  table: "assistantSpenders",
  migrateOne: async (ctx, spender) => (spender.workspaceId ? undefined : { workspaceId: await own(ctx, spender.userId) }),
});

export const run = migrations.runner([internal.migrations.assistantWorkspaces.threads, internal.migrations.assistantWorkspaces.spenders]);

/** Rows on one page of `table` with no workspace yet, or a chat with no maker. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("assistantThreads"), v.literal("assistantSpenders")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "assistantThreads") {
      const page = await ctx.db.query(table).paginate(opts);
      return { missing: page.page.filter((thread) => !thread.workspaceId || !thread.createdBy).length, isDone: page.isDone, continueCursor: page.continueCursor };
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
