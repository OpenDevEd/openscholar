/**
 * Public bucket queries exposed to the client.
 *
 *  - `getMyPaperLimit`         — total ready-items cap across the bucket.
 *  - `getMyPaperPullCap`       — max papers pullable per history entry.
 *  - `getMyPaperPullDefault`   — initial stepper value (≤ cap).
 */
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../../lib/auth";
import {
  getPaperLimit,
  getPaperPullCap,
  getPaperPullDefault,
} from "./limits";

export const getMyPaperLimit = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await getPaperLimit(ctx, user._id);
  },
});

export const getMyPaperPullCap = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await getPaperPullCap(ctx, user._id);
  },
});

export const getMyPaperPullDefault = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAuth(ctx);
    return await getPaperPullDefault(ctx, user._id);
  },
});
