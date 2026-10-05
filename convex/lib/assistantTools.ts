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

/** A tool's name: its action's path, in the characters a tool name takes. */
export const toolName = (path: string) => path.replace(/[/:]/g, "_");

const retryKeyOf = (entry: UserAction) => (entry.kind === "query" ? undefined : entry.retryKey);

/**
 * A page to read, as the model gives it: how many, and where to carry on from. Convex's own
 * page options also hold limits on what one page reads. A model that fills in every argument
 * set those to 0, and the read failed; they're left out here, and dropped when sent anyway.
 */
const PAGE = z.object({ numItems: z.number(), cursor: z.string().nullable() });

/** What the model fills in to call an action: its arguments but the retry key, with IDs as strings. */
export function inputSchema(entry: UserAction) {
  const retryKey = retryKeyOf(entry);
  const fields = Object.fromEntries(Object.entries(entry.args as PropertyValidators).filter(([name]) => name !== retryKey));
  return z.object({ ...convexToZodFields(fieldsWithStringIds(fields)), ...("paginationOpts" in fields ? { paginationOpts: PAGE } : {}) });
}

/**
 * Runs an action as `userId`. `callKey` names this call and fills the action's retry key, so
 * the same call tried again applies once. A change given `stepId` ends that step itself, in
 * its own transaction. `approved`: the person was asked about this call and said yes.
 * `credits`: the most they let a call that spends credits hold, which goes with it.
 */
export function runAction(ctx: ActionCtx, userId: Id<"users">, entry: UserAction, input: Record<string, unknown>, callKey: string, stepId?: Id<"assistantSteps">, approved = false, credits?: number): Promise<unknown> {
  const retryKey = retryKeyOf(entry);
  const args = { ...input, ...(retryKey ? { [retryKey]: callKey } : {}), userId, ...(credits === undefined || entry.kind === "query" ? {} : { approvedCredits: credits }) };
  const ref = assistantPath(entry.path);
  if (entry.kind === "query") return ctx.runQuery(makeFunctionReference<"query">(ref), args);
  const change = { ...args, ...(stepId ? { stepId } : {}), ...(approved ? { approved } : {}) };
  if (entry.kind === "mutation") return ctx.runMutation(makeFunctionReference<"mutation">(ref), change);
  return ctx.runAction(makeFunctionReference<"action">(ref), entry.changes ? change : args);
}

/** One call of an action by the model. */
export type ToolCall = { entry: UserAction; input: Record<string, unknown>; toolCallId: string };
/** Makes a call in the caller's own way; what it returns is what the model reads. */
export type Around = (call: ToolCall) => Promise<unknown>;

/**
 * The assistant's tools for these actions, acting as `userId`. Each tool's input is its
 * action's arguments, minus the retry key, which the tool fills from its call's ID.
 */
export function assistantTools(
  ctx: ActionCtx,
  userId: Id<"users">,
  entries: readonly UserAction[],
  around: Around = ({ entry, input, toolCallId }) => runAction(ctx, userId, entry, input, toolCallId),
): Record<string, Tool> {
  return Object.fromEntries(
    entries.map((entry) => [
      toolName(entry.path),
      tool({
        description: entry.description,
        inputSchema: inputSchema(entry),
        execute: async (input: Record<string, unknown>, { toolCallId }) => around({ entry, input, toolCallId }),
      }),
    ]),
  );
}
