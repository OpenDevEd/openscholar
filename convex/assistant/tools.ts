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
import { assistantTools, inputSchema, runAction, toolName } from "../lib/assistantTools";
import { readConvexErrorData } from "../lib/errors";
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { ASKS_FIRST, type UserAction } from "../lib/userActions";
import { MAX_ASKS, MODEL_READS, STEP_TEXT_MAX, forModel } from "./steps";

/** Requests to the model one reply may make. The last is kept for its answer (./turn.ts). */
export const MAX_STEPS = 12;
/** Characters of an action's description and arguments, about 1,000 tokens (#326). A longer one has no tool. */
export const DEFINITION_MAX = 4_000;
/** Actions one search returns. */
const FOUND_MAX = 6;
/** Actions one reply may run, however many it calls at once: every one of them shows on the chat's page (./steps.ts). */
export const MAX_CALLS = 40;

/**
 * Why a reply's tools have stopped, as the model is told when it calls one: it then knows
 * to answer with what it has, where a model simply kept from calling tools can say nothing.
 */
const WRAP_UP = "Don't call another action. Tell the person what you did and what's left, so they can ask for it.";
export const OUT_OF_STEPS = `This reply has taken as many rounds of actions as one reply may. ${WRAP_UP}`;
export const OUT_OF_CREDITS = `This reply has spent the credits one reply may. ${WRAP_UP}`;

/**
 * The actions that are tools of their own, in this order. Changing the list resets every
 * chat's cache once, so it changes on purpose, in a pull request of its own.
 */
const CORE_PATHS = [
  "research/papers:search",
  "research/papers:get",
  "research/lookup:find",
  "research/records:listedSearches",
  "research/records:getSearch",
  "research/searches:create",
  "research/searches:update",
  "research/searches:results",
  "research/records:searchHistory",
  "research/records:listedShortcuts",
  "research/records:ratingsOf",
  "library/queries:papers",
  "library/queries:savedPaper",
  "library/mutations:saveToLibrary",
  "library/mutations:setLibraryRating",
  "library/mutations:setPaperInCollection",
  "library/collections:listCollections",
  "library/collections:createCollection",
  "screening/queries:listJobs",
  "screening/papers:list",
  "screening/papers:get",
  "extraction/queries:listJobs",
] as const;

/**
 * Whether the assistant runs an action without asking: it only reads, or its change can be
 * undone, stays inside the account and costs nothing. The rest ask the person first
 * (decisions 8 and 12): the reply waits for their answer (./asking.ts). One call of an
 * action that passes here can still ask first (`asksFirst` on its entry). An action that
 * spends credits isn't asked for yet, since the person is shown an estimate with it (#328).
 */
export const runsWithoutAsking = (entry: UserAction) => entry.kind === "query" || (!entry.spendsCredits && !entry.outsideEffect && entry.undoable);

/**
 * An action's description and arguments, as the model is sent them. Without the schema's
 * own "$schema" line: what a tool returns is kept with the reply, and Convex keeps no
 * field whose name starts with a dollar sign, so a result that held it ended the reply.
 */
export function definition(entry: UserAction) {
  const { $schema: _dialect, ...args } = z.toJSONSchema(inputSchema(entry));
  return { does: entry.description, arguments: args };
}
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

/** The action a tool call is for, with its arguments: the tool's own, or the one run_action names. Null when it names none, or its arguments don't fit. */
export function called(tool: string, input: unknown): { entry: UserAction; input: Record<string, unknown> } | null {
  const own = core().find((entry) => toolName(entry.path) === tool);
  if (own) return { entry: own, input: (input ?? {}) as Record<string, unknown> };
  if (tool !== RUN_ACTION || !input || typeof input !== "object") return null;
  const { name, arguments: given } = input as { name?: unknown; arguments?: unknown };
  const entry = typeof name === "string" ? entryAt(name) : undefined;
  const parsed = entry && inputSchema(entry).safeParse(given);
  return entry && parsed?.success ? { entry, input: parsed.data as Record<string, unknown> } : null;
}
const RUN_ACTION = "run_action";

/** A tool call the reply asked the person about. */
export type Asked = { toolCallId: string; toolName: string; input: unknown };
/**
 * The calls a reply asked about, as the steps that wait for the person's answer. Every one
 * becomes a step, since every one needs its result written: a call that names no action
 * any more waits under its tool's name, and fails when it's run.
 */
export function askedSteps(requests: Asked[]) {
  return requests.map(({ toolCallId, toolName: tool, input }) => {
    const call = called(tool, input);
    const subject = call && subjectOf(call.input);
    return { toolCallId, tool, path: call?.entry.path ?? tool, input: cut(JSON.stringify(call?.input ?? input ?? {}), STEP_TEXT_MAX), ...(subject ? { subject } : {}) };
  });
}

/** What a call is about, for its step's card: a title, a name or a query among its arguments, or the query a change gives a search. */
function subjectOf(input: Record<string, unknown>) {
  const paper = input.paper && typeof input.paper === "object" ? (input.paper as Record<string, unknown>) : {};
  const requeried = Array.isArray(input.changes) ? input.changes.find((change) => change?.setting === "query")?.value : undefined;
  const named = [input.title, paper.title, input.name, input.query, input.search, requeried].find((value) => typeof value === "string" && value.trim() !== "");
  return typeof named === "string" ? cut(named.trim(), 200) : undefined;
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
 * `stopped` says why the reply's actions have stopped, once they have. `made` is how many
 * calls the reply had made before it asked the person something, when it carries on from
 * their answer: one reply's calls are counted through every pause, so they all fit the chat's page.
 *
 * `approval` is the reply's rule for asking first, which pauses it at a call the person is
 * asked about. `resume` runs a step they then allowed; its outcome is written to the model
 * with the step (./steps.ts). It's false once the reply was stopped, and nothing more runs.
 */
export function toolsFor(
  ctx: ActionCtx,
  { userId, threadId, order, attemptId, stopped, made = 0 }: { userId: Id<"users">; threadId: Id<"assistantThreads">; order: number; attemptId: string; stopped: () => string | null; made?: number },
) {
  let calls = made;
  let asked = 0;
  /**
   * Runs one call, kept as a step from when it starts to how it ended. The model reads the
   * short form of the result, and an action's failure as its message, so it can say what
   * went wrong or try something else. `allowed` is the step of a call the person was asked
   * about and said yes to: it runs whatever the reply's limits are.
   */
  const call = async (entry: UserAction, input: Record<string, unknown>, toolCallId: string, allowed?: Id<"assistantSteps">) => {
    if (!allowed) {
      const why = stopped();
      if (why) return { error: why };
      if (calls >= MAX_CALLS) return { error: `A reply runs at most ${MAX_CALLS} actions, and this one has. Say what's left, so the person can ask for it.` };
      // One that asks first only gets here allowed. The rest is refused: an action that spends credits, or a call nothing asked about.
      if (!runsWithoutAsking(entry)) return { error: ASKS_FIRST };
    }
    // A call the person allowed was counted when it was asked about.
    const key = allowed ? `${attemptId}:${allowed}` : `${attemptId}:${calls++}`;
    const subject = subjectOf(input);
    const stepId = allowed ?? (await ctx.runMutation(internal.assistant.steps.begin, { threadId, order, userId, toolCallId, path: entry.path, input: cut(JSON.stringify(input), STEP_TEXT_MAX), ...(subject ? { subject } : {}) }));
    try {
      // A change ends its step in its own transaction, so the two are saved together. A read's step is ended here.
      const result = await runAction(ctx, userId, entry, input, key, entry.kind === "mutation" ? stepId : undefined, allowed !== undefined);
      if (entry.kind !== "mutation") await ctx.runMutation(internal.assistant.steps.read, { stepId, result: JSON.stringify(result ?? null) });
      return forModel(result);
    } catch (error) {
      const message = messageOf(error);
      await ctx.runMutation(internal.assistant.steps.failed, { stepId, error: message });
      return { error: message };
    }
  };
  /**
   * Whether the person is asked before a call runs (decisions 8 and 12): its action reaches
   * outside the account or can't be undone, or this call of it can't (`asksFirst`).
   */
  const asks = async (entry: UserAction, input: Record<string, unknown>) =>
    entry.kind !== "query" && !entry.spendsCredits && (!runsWithoutAsking(entry) || (await ctx.runQuery(internal.assistant.asking.first, { userId, path: entry.path, input: JSON.stringify(input) })));
  const approval = async ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
    // A call the reply's limits refuse anyway isn't worth asking about.
    if (stopped() || calls >= MAX_CALLS) return undefined;
    const call = called(toolCall.toolName, toolCall.input);
    if (!call || !(await asks(call.entry, call.input))) return undefined;
    // Its arguments wait on its step for the answer, so they have to fit there.
    if (JSON.stringify(call.input).length > STEP_TEXT_MAX) return { type: "denied" as const, reason: "Its arguments are too long to ask the person about." };
    if (asked >= MAX_ASKS) return { type: "denied" as const, reason: `A reply asks the person about at most ${MAX_ASKS} actions at a time. Ask about the rest once these are answered.` };
    asked++;
    calls++;
    return "user-approval" as const;
  };
  const resume = async (step: { stepId: Id<"assistantSteps">; toolCallId: string; path: string; input: string }) => {
    // Claimed once, for this reply: one that died after this and is tried again doesn't run it a second time, and a stopped one runs nothing more.
    if (!(await ctx.runMutation(internal.assistant.steps.resume, { stepId: step.stepId, attemptId }))) return false;
    const entry = entryAt(step.path);
    if (entry) await call(entry, JSON.parse(step.input), step.toolCallId, step.stepId);
    else await ctx.runMutation(internal.assistant.steps.failed, { stepId: step.stepId, error: "This action can't be run any more." });
    return true;
  };
  const tools: ToolSet = {
    ...assistantTools(ctx, userId, core(), ({ entry, input, toolCallId }) => call(entry, input, toolCallId)),
    find_action: tool({
      description:
        "Finds what else you can do in the person's account: every action that has no tool of its own, by keywords from what you want to do, such as \"rename collection\" or \"extraction results\". " +
        "Returns each match's name, what it does and the arguments it takes. Run one with run_action.",
      inputSchema: z.object({ keywords: z.string() }),
      // Looking for more to do is refused with the rest once the reply's actions have stopped, or it could go on asking.
      execute: async ({ keywords }) => (stopped() ? { error: stopped() } : forModel(found(keywords))),
    }),
    run_action: tool({
      description: "Runs an action find_action returned, by its name, with its arguments. An undo in a result is run the same way: the action it names, with its arguments.",
      inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async ({ name, arguments: given }, { toolCallId }) => {
        const why = stopped();
        if (why) return { error: why };
        const entry = entryAt(name);
        if (!entry) return { error: `No action is named ${cut(name, 200)}. Look one up with find_action.` };
        const parsed = inputSchema(entry).safeParse(given);
        // The arguments it takes come back with the refusal, for one more try.
        if (!parsed.success) return forModel({ error: `These arguments don't fit: ${cut(z.prettifyError(parsed.error), 1_000)}`, arguments: definition(entry).arguments });
        return call(entry, parsed.data as Record<string, unknown>, toolCallId);
      },
    }),
  };
  return { tools, approval, resume, made: () => calls };
}
