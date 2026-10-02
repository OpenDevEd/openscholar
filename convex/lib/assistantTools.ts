/**
 * The assistant's tools, built from the action registry. Only actions import this, so
 * the AI SDK and zod never end up in query or mutation bundles.
 */
import { makeFunctionReference } from "convex/server";
import { v, type GenericValidator, type PropertyValidators } from "convex/values";
import { convexToZodFields } from "convex-helpers/server/zod4";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assistantPath, type UserAction } from "./userActions";

/**
 * The validator with every Convex ID as a plain string. Zod's ID type has no JSON
 * Schema form, so the model sees a string; the function still checks it is an ID.
 */
function idsAsStrings(validator: GenericValidator): GenericValidator {
  const keepOptional = (converted: GenericValidator) =>
    validator.isOptional === "optional" ? v.optional(converted) : converted;
  switch (validator.kind) {
    case "id":
      return keepOptional(v.string());
    case "object":
      return keepOptional(v.object(fieldsWithStringIds(validator.fields)));
    case "array":
      return keepOptional(v.array(idsAsStrings(validator.element)));
    case "union":
      return keepOptional(v.union(...validator.members.map(idsAsStrings)));
    case "record":
      return keepOptional(v.record(idsAsStrings(validator.key) as never, idsAsStrings(validator.value)));
    default:
      return validator;
  }
}

function fieldsWithStringIds(fields: PropertyValidators): PropertyValidators {
  return Object.fromEntries(Object.entries(fields).map(([name, validator]) => [name, idsAsStrings(validator)]));
}

/**
 * The assistant's tools for these actions, acting as `userId`. Each tool's input is its
 * action's arguments, minus the retry key, which the tool fills from its call's ID.
 */
export function assistantTools(ctx: ActionCtx, userId: Id<"users">, entries: readonly UserAction[]): Record<string, Tool> {
  return Object.fromEntries(
    entries.map((entry) => {
      const retryKey = entry.kind === "query" ? undefined : entry.retryKey;
      const fields = Object.fromEntries(Object.entries(entry.args as PropertyValidators).filter(([name]) => name !== retryKey));
      const ref = assistantPath(entry.path);
      return [
        entry.path.replace(/[/:]/g, "_"),
        tool({
          description: entry.description,
          inputSchema: z.object(convexToZodFields(fieldsWithStringIds(fields))),
          execute: async (input: Record<string, unknown>, { toolCallId }) => {
            const args = { ...input, ...(retryKey ? { [retryKey]: toolCallId } : {}), userId };
            if (entry.kind === "query") return ctx.runQuery(makeFunctionReference<"query">(ref), args);
            if (entry.kind === "mutation") return ctx.runMutation(makeFunctionReference<"mutation">(ref), args);
            return ctx.runAction(makeFunctionReference<"action">(ref), args);
          },
        }),
      ];
    }),
  );
}
