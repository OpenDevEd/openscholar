import { v } from "convex/values";
import { query } from "../lib/functions";
import { getCurrentUser } from "../lib/auth";
import { personalWorkspaceOf } from "./actor";

/** The signed-in person's own workspace, which the browser's calls name until pages carry theirs (#651); null when signed out. */
export const personal = query({
  args: {},
  returns: v.union(v.id("workspaces"), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await personalWorkspaceOf(ctx, user._id) : null;
  },
});
