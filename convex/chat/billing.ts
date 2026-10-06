import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { settle, settleArgs } from "../billing/openRouter";

/**
 * Settlement retries scheduled before settling moved to ../billing/openRouter.ts (#325) arrive
 * here, for up to its 2.5 minutes of retries after the deploy. Goes with the chat's schema.
 */
export const settleFromOpenRouter = internalAction({
  args: settleArgs,
  returns: v.null(),
  handler: (ctx, args) => settle(ctx, args),
});
