import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { usageAgg } from "../billing/usageLog";
import { readConvexErrorData } from "../lib/errors";

/**
 * Forgets the charge counts kept per person before workspaces paid (#650): `user:<id>` and
 * `spend:<user id>:<kind>` in the usage aggregate. Charges have counted under the workspace that
 * paid since then, and nothing reads these. A count already at zero is left alone: clearing makes
 * it again under a new ID, which a later page would meet and clear without end.
 *
 *   npx convex run migrations/forgetPersonCounts:run   # how many it forgot; 0 once done
 */
export const page = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ forgot: v.number(), isDone: v.boolean(), cursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const read = await usageAgg.paginateNamespaces(ctx, cursor, 100);
    const person = read.page.filter((namespace): namespace is string => {
      if (!namespace) return false;
      const [kind, id] = namespace.split(":");
      return kind === "user" || (kind === "spend" && ctx.db.normalizeId("users", id ?? "") !== null);
    });
    const counts = await usageAgg.countBatch(ctx, person.map((namespace) => ({ namespace })));
    const kept = person.filter((_, at) => counts[at] > 0);
    for (const namespace of kept) await usageAgg.clear(ctx, { namespace });
    return { forgot: kept.length, isDone: read.isDone, cursor: read.cursor };
  },
});

/** The aggregate refuses these reads while charges wait in its queue: a page waits for it, a minute at most. */
const QUEUE_WAIT_MS = 2_000;
const QUEUE_WAITS = 30;

export const run = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let forgot = 0;
    for (let cursor: string | undefined; ;) {
      let read: { forgot: number; isDone: boolean; cursor: string } | undefined;
      for (let waits = 0; !read; waits++) {
        try {
          read = await ctx.runMutation(internal.migrations.forgetPersonCounts.page, { cursor });
        } catch (error) {
          if (waits >= QUEUE_WAITS || readConvexErrorData(error)?.code !== "PENDING_OPERATIONS") throw error;
          await new Promise((resolve) => setTimeout(resolve, QUEUE_WAIT_MS));
        }
      }
      forgot += read.forgot;
      if (read.isDone) return forgot;
      cursor = read.cursor;
    }
  },
});
