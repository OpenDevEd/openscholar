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
import { assistantTools, inputSchema, runAction } from "../lib/assistantTools";
import { readConvexErrorData } from "../lib/errors";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import type { UserAction } from "../lib/userActions";
import { STEP_RESULT_MAX, STEP_TEXT_MAX } from "./steps";

/** Requests to the model one reply may make. The last is kept for its answer (./turn.ts). */
export const MAX_STEPS = 12;
/** Characters of anything a tool hands the model, about 2,000 tokens (#326). A step keeps the rest of a result. */
const MODEL_READS = 8_000;
/** Characters of an action's description and arguments, about 1,000 tokens (#326). A longer one has no tool. */
export const DEFINITION_MAX = 4_000;
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
  "library/mutations:setLibraryRating",
  "library/mutations:setPaperInCollection",
  "library/collections:listCollections",
  "library/collections:createCollection",
  "screening/papers:list",
  "screening/papers:get",
  "extraction/queries:listJobs",
] as const;

const ASKS = "This asks the person first, and a chat can't ask yet. Tell them what you would have done, so they can do it themselves.";

/**
 * Whether the assistant runs an action without asking: it only reads, or its change can be
 * undone, stays inside the account and costs nothing. The rest ask the person first
 * (decisions 8 and 12), which a chat can't do yet, so for now they don't run. One call of
 * an action that passes here can still ask first (`asksFirst` on its entry).
 */
export const runsWithoutAsking = (entry: UserAction) => entry.kind === "query" || (!entry.spendsCredits && !entry.outsideEffect && entry.undoable);

/** An action's description and arguments, as the model is sent them. */
export const definition = (entry: UserAction) => ({ does: entry.description, arguments: z.toJSONSchema(inputSchema(entry)) });
const sizes = new Map<string, number>();
/** Whether an action is short enough to be a tool at all (#326). One that isn't waits to be split into smaller actions. */
function fits(entry: UserAction) {
  if (!sizes.has(entry.path)) sizes.set(entry.path, JSON.stringify(definition(entry)).length);
  return sizes.get(entry.path)! <= DEFINITION_MAX;
}
/** The actions the assistant can reach: every registered one that fits. */
const reachable = () => USER_ACTIONS.filter(fits);
const entryAt = (path: string) => reachable().find((entry) => entry.path === path);

/** The core actions, as registered. */
export function core() {
  return CORE_PATHS.map((path) => {
    const entry = entryAt(path);
    if (!entry || !runsWithoutAsking(entry)) throw new Error(`${path} can't be a tool of its own: it isn't registered, it's too long, or it asks first.`);
    return entry;
  });
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** What the model reads of anything a tool returns: all of it when it's short, its start and how much was left out when it isn't. */
function forModel(value: unknown) {
  const text = JSON.stringify(value ?? null);
  return text.length <= MODEL_READS ? (value ?? null) : `${text.slice(0, MODEL_READS)}… (cut: ${(text.length - MODEL_READS).toLocaleString("en")} more characters. Ask for less at a time.)`;
}

/** The command that reverses a change, when its result carries one (#342) short enough to keep. */
function undoOf(result: unknown) {
  const undo = result && typeof result === "object" && "undo" in result ? (result as { undo?: { path?: unknown; args?: unknown } }).undo : undefined;
  if (!undo || typeof undo.path !== "string") return undefined;
  const args = JSON.stringify(undo.args ?? {});
  return args.length <= STEP_TEXT_MAX ? { path: undo.path, args } : undefined;
}

/** What a call is about, for its step's card: a title, a name or a query among its arguments. */
function subjectOf(input: Record<string, unknown>) {
  const paper = input.paper && typeof input.paper === "object" ? (input.paper as Record<string, unknown>) : {};
  const named = [input.title, paper.title, input.name, input.query, input.search].find((value) => typeof value === "string" && value.trim() !== "");
  return typeof named === "string" ? cut(named.trim(), 200) : undefined;
}

/** How many things a result lists: its page's rows, or its own when it's a list. */
function countOf(result: unknown) {
  if (Array.isArray(result)) return result.length;
  const page = result && typeof result === "object" ? (result as { page?: unknown }).page : undefined;
  return Array.isArray(page) ? page.length : undefined;
}

/** An error as the model should read it: the action's own message, without the runtime's wrapping. */
const messageOf = (error: unknown) => cut(readConvexErrorData(error)?.message ?? (error instanceof Error ? error.message : String(error)), MODEL_READS / 4);

/**
 * The actions whose name or description hold the most of these words, best first; an action
 * named outright comes first. As many are returned whole as the model can read at once, and
 * the rest by name alone, to be searched for by that name.
 */
export function found(keywords: string) {
  const asked = keywords.toLowerCase();
  const words = asked.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const matches = reachable()
    .map((entry) => {
      const text = `${entry.path} ${entry.description}`.toLowerCase();
      return { entry, score: words.filter((word) => text.includes(word)).length + (asked.includes(entry.path.toLowerCase()) ? words.length : 0) };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, FOUND_MAX);
  const actions: Array<{ name: string; does?: string; arguments?: unknown; asksFirst?: true }> = [];
  let size = 0;
  for (const { entry } of matches) {
    const whole = { name: entry.path, ...definition(entry), ...(runsWithoutAsking(entry) ? {} : { asksFirst: true as const }) };
    const length = JSON.stringify(whole).length;
    if (size + length <= MODEL_READS) {
      actions.push(whole);
      size += length;
    } else actions.push({ name: entry.path });
  }
  return { actions };
}

/**
 * The assistant's tools for one reply. `userId` is who it acts as, and each action it runs
 * is kept as a step of exchange `order`. `attemptId` names this run of the reply: with a
 * count of its calls it makes each call's own key, since models reuse their call IDs.
 */
export function toolsFor(ctx: ActionCtx, { userId, threadId, order, attemptId }: { userId: Id<"users">; threadId: Id<"assistantThreads">; order: number; attemptId: string }): ToolSet {
  let calls = 0;
  /**
   * Runs one call: unless it asks first, it's kept as a step from when it starts to how it
   * ended. The model reads the short form of the result, and an action's failure as its
   * message, so it can say what went wrong or try something else.
   */
  const call = async (entry: UserAction, input: Record<string, unknown>, toolCallId: string) => {
    if (await ctx.runQuery(internal.assistant.asking.first, { userId, path: entry.path, input: JSON.stringify(input) })) return { error: ASKS };
    const key = `${attemptId}:${calls++}`;
    const subject = subjectOf(input);
    const stepId = await ctx.runMutation(internal.assistant.steps.begin, { threadId, order, userId, toolCallId, path: entry.path, input: cut(JSON.stringify(input), STEP_TEXT_MAX), ...(subject ? { subject } : {}) });
    try {
      const result = await runAction(ctx, userId, entry, input, key);
      const [undo, count] = [undoOf(result), countOf(result)];
      await ctx.runMutation(internal.assistant.steps.end, { stepId, result: cut(JSON.stringify(result ?? null), STEP_RESULT_MAX), ...(count === undefined ? {} : { count }), ...(undo ? { undo } : {}) });
      return forModel(result);
    } catch (error) {
      const message = messageOf(error);
      await ctx.runMutation(internal.assistant.steps.end, { stepId, error: message });
      return { error: message };
    }
  };
  return {
    ...assistantTools(ctx, userId, core(), ({ entry, input, toolCallId }) => call(entry, input, toolCallId)),
    find_action: tool({
      description:
        "Finds what else you can do in the person's account: every action that has no tool of its own, by keywords from what you want to do, such as \"rename collection\" or \"extraction results\". " +
        "Returns each match's name, what it does and the arguments it takes. Run one with run_action.",
      inputSchema: z.object({ keywords: z.string() }),
      execute: async ({ keywords }) => forModel(found(keywords)),
    }),
    run_action: tool({
      description: "Runs an action find_action returned, by its name, with its arguments. An undo in a result is run the same way: the action it names, with its arguments.",
      inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async ({ name, arguments: given }, { toolCallId }) => {
        const entry = entryAt(name);
        if (!entry) return { error: `No action is named ${cut(name, 200)}. Look one up with find_action.` };
        if (!runsWithoutAsking(entry)) return { error: ASKS };
        const parsed = inputSchema(entry).safeParse(given);
        // The arguments it takes come back with the refusal, for one more try.
        if (!parsed.success) return forModel({ error: `These arguments don't fit: ${cut(z.prettifyError(parsed.error), 1_000)}`, arguments: definition(entry).arguments });
        return call(entry, parsed.data as Record<string, unknown>, toolCallId);
      },
    }),
  };
}
