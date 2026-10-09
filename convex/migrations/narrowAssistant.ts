import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Clears the person an assistant chat belonged to before workspaces (#650, slice 8): a chat is
 * its workspace's, made by `createdBy`. A step, and a reply waiting to be answered, from before
 * replies named their workspace get the one they ran in: their person's own. Nothing reads
 * `ownerId` any more; once this reports 0 on every deployment, it goes from the schema and a
 * step's and a waiting reply's workspace become required. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowAssistant:run
 *   npx convex run migrations/narrowAssistant:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const own = (ctx: MutationCtx, userId: Id<"users">) => ensureWorkspace(ctx, { kind: "personal", userId });

// A chat keeps its summary and its reply's state: five at a time.
export const threads = migrations.define({
  table: "assistantThreads",
  batchSize: 5,
  migrateOne: async (ctx, thread) => {
    const patch = {
      ...(thread.ownerId === undefined ? {} : { ownerId: undefined }),
      ...(thread.asking && !thread.asking.workspaceId ? { asking: { ...thread.asking, workspaceId: await own(ctx, thread.asking.senderId) } } : {}),
    };
    return Object.keys(patch).length ? patch : undefined;
  },
});

// A step keeps what its call was given and what came of it, with no byte cap of their own: five at a time.
export const steps = migrations.define({
  table: "assistantSteps",
  batchSize: 5,
  migrateOne: async (ctx, step) => (step.workspaceId ? undefined : { workspaceId: await own(ctx, step.userId) }),
});

export const run = migrations.runner([internal.migrations.narrowAssistant.threads, internal.migrations.narrowAssistant.steps]);

/** Chats on one page that still name a person or have a waiting reply with no workspace, or steps with none. */
export const verifyPage = internalQuery({
  args: { table: v.union(v.literal("assistantThreads"), v.literal("assistantSteps")), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "assistantThreads") {
      const page = await ctx.db.query("assistantThreads").paginate(opts);
      return { missing: page.page.filter((thread) => thread.ownerId !== undefined || (thread.asking && !thread.asking.workspaceId)).length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("assistantSteps").paginate(opts);
    return { missing: page.page.filter((step) => !step.workspaceId).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many chats and steps are left; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["assistantThreads", "assistantSteps"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowAssistant.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
