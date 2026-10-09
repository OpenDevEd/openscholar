// Who made something in an organization (#651), as its lists show them beside it. Your own
// workspace's items are all yours, so they name no one.

import { v, type Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../assistant/access";

export const makerValidator = v.object({ name: v.string(), imageUrl: v.optional(v.string()), you: v.boolean() });
export type Maker = Infer<typeof makerValidator>;

/**
 * Names the maker of each item a page of an organization's list holds, reading each person once;
 * in your own workspace it names no one.
 */
export async function makersIn(ctx: QueryCtx, workspaceId: Id<"workspaces">, viewer: Id<"users">) {
  const organization = (await ctx.db.get("workspaces", workspaceId))?.kind === "organization";
  const read = new Map<Id<"users">, Promise<Maker | undefined>>();
  return (createdBy: Id<"users"> | undefined): Promise<Maker | undefined> => {
    if (!organization || !createdBy) return Promise.resolve(undefined);
    if (!read.has(createdBy)) {
      read.set(createdBy, ctx.db.get("users", createdBy).then((user) => (user ? { name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), you: user._id === viewer } : undefined)));
    }
    return read.get(createdBy)!;
  };
}
