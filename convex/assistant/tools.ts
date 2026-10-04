/**
 * The tools the assistant works with (#327). The list is fixed (#326): the same tools, in the
 * same order, for every chat and person, so the start of each request stays cached. The
 * actions most chats use are tools of their own. Two more reach every other registered
 * action: one finds it, one runs it. Only actions import this file, since it loads the AI SDK.
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { assistantTools, inputSchema, runAction, type Around } from "../lib/assistantTools";
import { readConvexErrorData } from "../lib/errors";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import type { UserAction } from "../lib/userActions";
import { STEP_INPUT_MAX, STEP_RESULT_MAX } from "./steps";

/** Steps one reply may take: each is one request to the model. */
export const MAX_STEPS = 12;
/** Characters of an action's result the model reads, about 2,000 tokens (#326). The step keeps the rest. */
const MODEL_READS = 8_000;
/** Actions one search returns. */
const FOUND_MAX = 6;

/**
 * The actions that are tools of their own, in this order. Changing the list resets every
 * chat's cache once, so it changes on purpose, in a pull request of its own.
 */
const CORE_PATHS = [
  "research/records:listedSearches",
  "research/records:getSearch",
  "research/records:searchHistory",
  "research/records:listedShortcuts",
  "research/records:ratingsOf",
  "library/queries:savedPaper",
  "library/mutations:saveToLibrary",
  "library/mutations:setPaperInCollection",
  "screening/papers:list",
  "screening/papers:get",
  "extraction/queries:listJobs",
] as const;

/**
 * Whether the assistant runs an action without asking: it only reads, or its change can be
 * undone, stays inside the account and costs nothing. The rest ask the person first
 * (decisions 8 and 12), which a chat can't do yet, so for now they don't run.
 */
export const runsWithoutAsking = (entry: UserAction) => entry.kind === "query" || (!entry.spendsCredits && !entry.outsideEffect && entry.undoable);

const entryAt = (path: string) => USER_ACTIONS.find((entry) => entry.path === path);
const CORE = CORE_PATHS.map((path) => {
  const entry = entryAt(path);
  if (!entry || !runsWithoutAsking(entry)) throw new Error(`${path} can't be a tool of its own: it isn't registered, or it asks first.`);
  return entry;
});

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** What the model reads of a result: all of it when it's short, its start and how much was left out when it isn't. */
function forModel(result: unknown) {
  const text = JSON.stringify(result ?? null);
  return text.length <= MODEL_READS ? (result ?? null) : `${text.slice(0, MODEL_READS)}… (cut: ${(text.length - MODEL_READS).toLocaleString("en")} more characters. Ask for less at a time.)`;
}

/** The command that reverses a change, when its result carries one (#342). */
function undoOf(result: unknown) {
  const undo = result && typeof result === "object" && "undo" in result ? (result as { undo?: { path?: unknown; args?: unknown } }).undo : undefined;
  return undo && typeof undo.path === "string" ? { path: undo.path, args: JSON.stringify(undo.args ?? {}) } : undefined;
}

/** An error as the model should read it: the action's own message, without the runtime's wrapping. */
const messageOf = (error: unknown) => readConvexErrorData(error)?.message ?? (error instanceof Error ? error.message : String(error));

/**
 * Keeps each call as a step of the chat's reply, from when it starts to how it ended. The
 * model reads the short form of the result, and an action's failure as its message, so it
 * can say what went wrong or try something else.
 */
const recorded =
  (ctx: ActionCtx, threadId: Id<"assistantThreads">, order: number): Around =>
  async ({ entry, input, toolCallId }, run) => {
    await ctx.runMutation(internal.assistant.steps.begin, { threadId, order, toolCallId, path: entry.path, input: cut(JSON.stringify(input), STEP_INPUT_MAX) });
    try {
      const result = await run();
      const undo = undoOf(result);
      await ctx.runMutation(internal.assistant.steps.end, { threadId, toolCallId, result: cut(JSON.stringify(result ?? null), STEP_RESULT_MAX), ...(undo ? { undo } : {}) });
      return forModel(result);
    } catch (error) {
      const message = messageOf(error);
      await ctx.runMutation(internal.assistant.steps.end, { threadId, toolCallId, error: cut(message, STEP_INPUT_MAX) });
      return { error: message };
    }
  };

/** An action as a search returns it: its name, what it does, the arguments it takes, and whether it would ask first. */
const described = (entry: UserAction) => ({
  name: entry.path,
  does: entry.description,
  arguments: z.toJSONSchema(inputSchema(entry)),
  ...(runsWithoutAsking(entry) ? {} : { asksFirst: true }),
});

/** The actions whose name or description hold the most of these words, best first, as many as the model can read at once. */
export function found(keywords: string) {
  const words = keywords.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const matches = USER_ACTIONS.map((entry) => {
    const text = `${entry.path} ${entry.description}`.toLowerCase();
    return { entry, score: words.filter((word) => text.includes(word)).length };
  })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, FOUND_MAX);
  const actions: ReturnType<typeof described>[] = [];
  let size = 0;
  for (const { entry } of matches) {
    const action = described(entry);
    size += JSON.stringify(action).length;
    // The best match is always returned whole, however long its arguments are.
    if (actions.length && size > MODEL_READS) break;
    actions.push(action);
  }
  return { actions };
}

/** The assistant's tools for one reply: `userId` is who it acts as, and each call is kept as a step of exchange `order`. */
export function toolsFor(ctx: ActionCtx, { userId, threadId, order }: { userId: Id<"users">; threadId: Id<"assistantThreads">; order: number }): ToolSet {
  const around = recorded(ctx, threadId, order);
  return {
    ...assistantTools(ctx, userId, CORE, around),
    find_action: tool({
      description:
        "Finds what else you can do in the person's account: every action that has no tool of its own, by keywords from what you want to do, such as \"rename collection\" or \"extraction results\". " +
        "Returns each match's name, what it does and the arguments it takes. Run one with run_action.",
      inputSchema: z.object({ keywords: z.string() }),
      execute: async ({ keywords }) => found(keywords),
    }),
    run_action: tool({
      description: "Runs an action find_action returned, by its name, with its arguments. An undo in the result is run the same way: the action it names, with its arguments.",
      inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async ({ name, arguments: given }, { toolCallId }) => {
        const entry = entryAt(name);
        if (!entry) return { error: `No action is named ${name}. Look one up with find_action.` };
        if (!runsWithoutAsking(entry)) return { error: "This action asks the person first, and a chat can't ask yet. Tell them what you would have done, so they can do it themselves." };
        const parsed = inputSchema(entry).safeParse(given);
        // The arguments it takes come back with the refusal, for one more try.
        if (!parsed.success) return { error: `These arguments don't fit: ${z.prettifyError(parsed.error)}`, arguments: z.toJSONSchema(inputSchema(entry)) };
        const input = parsed.data as Record<string, unknown>;
        return around({ entry, input, toolCallId }, () => runAction(ctx, userId, entry, input, toolCallId));
      },
    }),
  };
}
