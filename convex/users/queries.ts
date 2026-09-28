import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { userValidator } from "../lib/validators";

export const me = query({
  args: {},
  returns: v.union(userValidator, v.null()),
  handler: async (ctx) => {
    return await getCurrentUser(ctx);
  },
});

export const getById = query({
  args: { userId: v.id("users") },
  returns: v.union(userValidator, v.null()),
  handler: async (ctx, { userId }) => {
    const currentUser = await getCurrentUser(ctx);
    if (!currentUser) return null;

    if (currentUser._id !== userId) {
      return null;
    }

    return currentUser;
  },
});
