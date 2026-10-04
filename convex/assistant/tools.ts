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
import { DONE, MAX_ASKS, MODEL_READS, STEP_TEXT_MAX, forModel } from "./steps";

/**
 * Requests in a row whose actions all failed, after which a reply's next request is its
 * answer (./turn.ts). Nothing else holds a reply to a number of requests or of actions:
 * its work decides that, and the person's credits pay for it. This stops one that goes
 * round in circles, as Cline ends a run at six mistakes in a row.
 */
export const MAX_FAILED_ROUNDS = 6;
/**
 * Characters of the description and arguments of an action that is a tool of its own,
 * about 1,000 tokens (#326): every request carries them. A longer action is reached
 * through find_action, which returns its definition whole.
 */
export const DEFINITION_MAX = 4_000;
/** Actions one search returns. As many are returned whole as the model reads at once (./steps.ts). */
const FOUND_MAX = 12;

/**
 * Why a reply's tools have stopped, as the model is told when it calls one: it then knows
 * to answer with what it has, where a model simply kept from calling tools can say nothing.
 */
/**
 * Whether a reply is going round in circles: its last three requests made the same calls
 * and got the same results, or two requests have taken turns three times over. Each request
 * is told apart by a digest of what it called and what came back (./turn.ts), so a read
 * whose result changes, such as a job's progress, is never one. The OpenHands stuck
 * detector reads both patterns, and opencode stops at three identical calls.
 */
export function circling(recent: readonly string[]) {
  const [a, b, c, d, e, f] = recent.slice(-6).reverse();
  if (a !== undefined && a === b && b === c) return true;
  return recent.length >= 6 && a === c && c === e && b === d && d === f;
}
/** Requests whose digests a reply carries along to tell. */
export const RECENT_REQUESTS = 6;
export const CIRCLING = "Your last requests made the same calls and got the same results. Don't call another action. Tell the person what you found, and what you couldn't get past, so they can decide what to do.";
export const TOO_MANY_FAILED = `Every action in your last ${MAX_FAILED_ROUNDS} requests failed. Don't call another action. Tell the person what you tried, what went wrong, and what's left, so they can decide what to do.`;

/**
 * The actions that are tools of their own, in this order. Changing the list resets every
 * chat's cache once, so it changes on purpose, in a pull request of its own.
 */
const CORE_PATHS = [
  "research/papers:search",
  "research/papers:count",
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
  "library/papers:save",
  "library/mutations:setLibraryRating",
  "library/papers:collect",
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
/** The actions the assistant can reach: every registered one, however long its description. */
const entryAt = (path: string) => USER_ACTIONS.find((entry) => entry.path === path);

/** The core actions, as registered. */
export function core() {
  return CORE_PATHS.map((path) => {
    const entry = entryAt(path);
    if (!entry || !runsWithoutAsking(entry)) throw new Error(`${path} can't be a tool of its own: it isn't registered, or it asks first.`);
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

/** Times a call whose write lost a race is tried. */
const WRITE_TRIES = 5;
/**
 * Runs a call, again when its write collided with another's. A model makes several calls in
 * one step, and they run together: ten saves write the same count of the library, and the
 * ones that kept losing the race failed. A write that failed this way changed nothing, so
 * it's safe to make again, a moment later.
 */
export async function written<T>(run: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await run();
    } catch (error) {
      if (tries >= WRITE_TRIES || !/changed while this mutation was being run/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 300 * tries));
    }
  }
}

/** What a call is about, for its step's card: a title, a name or a query among its arguments, or the query a change gives a search. */
function subjectOf(input: Record<string, unknown>) {
  const paper = input.paper && typeof input.paper === "object" ? (input.paper as Record<string, unknown>) : {};
  const requeried = Array.isArray(input.changes) ? input.changes.find((change) => change?.setting === "query")?.value : undefined;
  const named = [input.title, paper.title, input.name, input.query, input.search, requeried].find((value) => typeof value === "string" && value.trim() !== "");
  return typeof named === "string" ? cut(named.trim(), 200) : undefined;
}

/**
 * An error as the model should read it, and as the step shows it to the person: the action's
 * own message. One the action didn't write (a crash, a limit of the runtime) is cut to its
 * first line, without the runtime's prefix and the trace of where it was thrown.
 */
const messageOf = (error: unknown) => {
  const told = readConvexErrorData(error)?.message;
  if (told) return cut(told, MODEL_READS / 4);
  console.error("[assistant] an action failed with an error it didn't write", error);
  return cut((error instanceof Error ? error.message : String(error)).split("\n")[0].replace(/^(?:\[Request ID: \w+\] Server Error\s*)?(?:Uncaught \w*Error: )?/, ""), 300);
};

/**
 * The actions whose name or description hold the most of these words, best first; an action
 * named outright comes first. As many are returned whole as the model can read at once, and
 * the rest by name alone, to be searched for by that name.
 */
export function found(keywords: string) {
  const asked = keywords.toLowerCase();
  const words = asked.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const matches = USER_ACTIONS
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
 * calls the reply had made in its requests before this one: each call's key counts on from there.
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
      // One that asks first only gets here allowed. The rest is refused: an action that spends credits, or a call nothing asked about.
      if (!runsWithoutAsking(entry)) return { error: ASKS_FIRST };
    }
    // A call the person allowed was counted when it was asked about.
    const key = allowed ? `${attemptId}:${allowed}` : `${attemptId}:${calls++}`;
    const subject = subjectOf(input);
    const stepId = allowed ?? (await ctx.runMutation(internal.assistant.steps.begin, { threadId, order, userId, toolCallId, path: entry.path, input: cut(JSON.stringify(input), STEP_TEXT_MAX), ...(subject ? { subject } : {}) }));
    try {
      // A change ends its step in its own transaction, so the two are saved together: a mutation, or an action whose write does. A read's step is ended here.
      const change = entry.kind === "mutation" || (entry.kind === "action" && entry.changes === true);
      const result = await written(() => runAction(ctx, userId, entry, input, key, change ? stepId : undefined, allowed !== undefined));
      if (!change) await ctx.runMutation(internal.assistant.steps.read, { stepId, result: JSON.stringify(result ?? null) });
      // A change that returns nothing says it was made. A read that returns nothing found nothing.
      return forModel(change ? (result ?? DONE) : result);
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
    if (stopped()) return undefined;
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
