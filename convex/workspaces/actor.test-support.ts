import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { actingAs, type Acting, type Author } from "../lib/userActions";
import { personalWorkspaceOf } from "./actor";

/** `userId` acting in their own workspace, for a test or bench that runs an action's core itself. */
export async function ownActor(ctx: QueryCtx, userId: Id<"users">, author: Author = "user"): Promise<Acting> {
  return actingAs(ctx, userId, await personalWorkspaceOf(ctx, userId), author);
}

/** `userId`'s own workspace with them as its maker, for a test seeding a row there. */
export async function madeBy(ctx: QueryCtx, userId: Id<"users">) {
  return { workspaceId: await personalWorkspaceOf(ctx, userId), createdBy: userId };
}
