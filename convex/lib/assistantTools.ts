/**
 * The assistant's tools, built from the action registry. Only actions import this, so
 * the AI SDK and zod never end up in query or mutation bundles.
 */
import { makeFunctionReference } from "convex/server";
import type { PropertyValidators } from "convex/values";
import { convexToZodFields } from "convex-helpers/server/zod4";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assistantPath, type UserAction } from "./userActions";

/**
 * The assistant's tools for these actions, acting as `userId`. Each tool's input is its
 * action's arguments, minus the retry key, which the tool fills from its call's ID.
 */
export function assistantTools(ctx: ActionCtx, userId: Id<"users">, entries: readonly UserAction[]): Record<string, Tool> {
  return Object.fromEntries(
    entries.map((entry) => {
      const retryKey = entry.kind === "mutation" ? entry.retryKey : undefined;
      const fields = Object.fromEntries(Object.entries(entry.args as PropertyValidators).filter(([name]) => name !== retryKey));
      const ref = assistantPath(entry.path);
      return [
        entry.path.replace(/[/:]/g, "_"),
        tool({
          description: entry.description,
          inputSchema: z.object(convexToZodFields(fields)),
          execute: async (input: Record<string, unknown>, { toolCallId }) =>
            entry.kind === "query"
              ? ctx.runQuery(makeFunctionReference<"query">(ref), { ...input, userId })
              : ctx.runMutation(makeFunctionReference<"mutation">(ref), { ...input, ...(retryKey ? { [retryKey]: toolCallId } : {}), userId }),
        }),
      ];
    }),
  );
}
