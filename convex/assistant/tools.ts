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
import { variantIn, viewOf } from "../../lib/assistant/actions";
import { BULK, DONE, MAX_ASKS, MODEL_READS, STEP_TEXT_MAX, forModel } from "./steps";

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
 * Whether a reply is going round in circles: its last three requests did the same thing,
 * or two requests have taken turns three times over. Each request is told apart by a
 * digest of its calls (`toolsFor`). The OpenHands stuck detector reads both patterns, and
 * opencode stops at three identical calls.
 */
export function circling(recent: readonly string[]) {
  const [a, b, c, d, e, f] = recent.slice(-6).reverse();
  if (a !== undefined && a === b && b === c) return true;
  return recent.length >= 6 && a === c && c === e && b === d && d === f;
}
export const CIRCLING = "Your last requests did the same thing over again. Don't call another action. Tell the person what you found, and what you couldn't get past, so they can decide what to do.";

/** A short digest of a text (FNV-1a), to tell two alike without keeping either. */
function fnv(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}
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
 * spends credits asks with the most it holds, unless the person allowed that much in the
 * chat (#328); one that gives no estimate can't be asked about, and isn't run.
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
const RUN_MANY = "run_many";

/** Whether an action changes something, and so ends its step in its own transaction: a mutation, or an action whose write does. */
const changesSomething = (entry: UserAction) => entry.kind === "mutation" || (entry.kind === "action" && entry.changes === true);
/** Whether many of an action's changes can go in one call: each alone would run without asking. One that asks every time is asked about one by one. */
const bulkable = (entry: UserAction) => changesSomething(entry) && runsWithoutAsking(entry);
/** What a reply is told at a change past `BULK` of its kind: the rest go in one call, which asks. */
export const BULK_FIRST = `You've made ${BULK} changes of this kind in this reply, and more than that is a bulk change the person is asked about first. Put every one that is left in a single run_many call: they're asked once, with the whole list.`;

/**
 * What a call changes, for counting a reply's changes: papers, searches, collections, chats,
 * screenings or extractions, as its card's tile says (lib/assistant/actions.ts). Broad on
 * purpose: several actions rate a paper or put a search back, and each would have its own
 * count if they were told apart any finer.
 */
export const kindOf = (entry: UserAction, input: unknown) => viewOf(entry.path, variantIn(entry.path, input)).kind;

/** Every `kind` among a call's arguments, with where it is: what tells one job of an action with several from another, however deep it sits. */
function jobs(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => (key === "kind" && typeof inner === "string" ? [`${path}:${inner}`] : jobs(inner, `${path}.${key}`)));
}
/**
 * Whether two calls of an action make the same change to different records: the same words on
 * the card, and the same job at every level of their arguments. A batch is all one such change,
 * so its card can say what it does: an edit that clears a search's answers is never asked about
 * as one of several ordinary edits.
 */
const sameChange = (entry: UserAction, a: unknown, b: unknown) =>
  viewOf(entry.path, variantIn(entry.path, a)).words === viewOf(entry.path, variantIn(entry.path, b)).words && jobs(a).sort().join() === jobs(b).sort().join();

/**
 * What a reply is told at an action that spends credits and can't say how many (#328): with
 * no figure to show the person there is nothing to ask them with, so a chat doesn't start it.
 * Said plainly, so the reply doesn't tell the person an approval went missing.
 */
export const NO_ESTIMATE =
  "This can't be started from the chat yet: it spends credits, and it has no way to say how many before it runs. Tell the person it's started on its own page in the app, and walk them through it there.";

/** The action a run_many call names: by its name, or by the name of its tool. */
const namedAs = (name: string) => entryAt(name) ?? core().find((entry) => toolName(entry.path) === name);
/**
 * The batch a run_many call is for: its action, and each change's arguments. Null when it
 * names no action, lists nothing, any arguments don't fit, or its changes aren't all the same
 * change (`sameChange`): the person is asked about a batch as one.
 */
export function batched(tool: string, input: unknown): { entry: UserAction; each: Record<string, unknown>[] } | null {
  if (tool !== RUN_MANY || !input || typeof input !== "object") return null;
  const { name, each } = input as { name?: unknown; each?: unknown };
  const entry = typeof name === "string" ? namedAs(name) : undefined;
  if (!entry || !Array.isArray(each) || !each.length) return null;
  const parsed = each.map((given) => inputSchema(entry).safeParse(given));
  if (!parsed.every((item) => item.success)) return null;
  const items = parsed.map((item) => item.data as Record<string, unknown>);
  return items.every((item) => sameChange(entry, item, items[0])) ? { entry, each: items } : null;
}

/** A tool call the reply asked the person about. */
export type Asked = { toolCallId: string; toolName: string; input: unknown };
/**
 * The calls a reply asked about, as the steps that wait for the person's answer. Every one
 * becomes a step, since every one needs its result written: a call that names no action
 * any more waits under its tool's name, and fails when it's run.
 */
export function askedSteps(requests: Asked[], held: (path: string, input: unknown) => number | undefined = () => undefined) {
  return requests.map(({ toolCallId, toolName: tool, input }) => {
    // A bulk change waits as one step: the list of what each change is given, and how many there are.
    // A batch of one is that one change, and is asked about as it would be alone.
    const many = batched(tool, input);
    if (many && many.each.length > 1) return { toolCallId, tool, path: many.entry.path, input: cut(JSON.stringify(many.each), STEP_TEXT_MAX), batch: many.each.length };
    const call = many ? { entry: many.entry, input: many.each[0] } : called(tool, input);
    const subject = call && subjectOf(call.input);
    // What a call that spends credits holds at most goes with its step, for the person asked.
    const credits = call ? held(call.entry.path, call.input) : undefined;
    // What the person is asked about, where the action says: its arguments don't all read as what it does.
    const shown = call && call.entry.kind !== "query" && call.entry.shown ? cut(JSON.stringify(call.entry.shown(call.input)), STEP_TEXT_MAX) : undefined;
    return { toolCallId, tool, path: call?.entry.path ?? tool, input: cut(JSON.stringify(call?.input ?? input ?? {}), STEP_TEXT_MAX), ...(subject ? { subject } : {}), ...(credits === undefined ? {} : { credits }), ...(shown ? { shown } : {}) };
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
  const raw = error instanceof Error ? error.message : String(error);
  const fit = misfit(raw);
  if (fit) return fit;
  console.error("[assistant] an action failed with an error it didn't write", error);
  return cut(raw.split("\n")[0].replace(/^(?:\[Request ID: \w+\] Server Error\s*)?(?:Uncaught \w*Error: )?/, ""), 300);
};

/**
 * What Convex says of an argument that doesn't fit, as the model can act on it: which
 * argument, what it takes and what it got. Its first line alone, "Value does not match
 * validator", named none of them: given a collection's name where its ID goes, the model
 * was told nothing it could correct. Null for any other error.
 */
export function misfit(text: string) {
  if (!text.includes("ArgumentValidationError")) return null;
  const line = (label: string) => text.match(new RegExp(`^\\s*${label}: (.*)$`, "m"))?.[1]?.trim();
  const [path, value, takes] = [line("Path"), line("Value"), line("Validator")];
  const said = text.split("\n").find((part) => part.includes("ArgumentValidationError"))!.replace(/^.*ArgumentValidationError: /, "");
  // A missing or an unknown field is said whole on the error's own line, which names it. Inside another argument, that one is named too.
  if (!path || !takes || !said.startsWith("Value does not match validator")) return cut(`These arguments don't fit${path ? `, in ${path.replace(/^\./, "")}` : ""}: ${said}`, 400);
  return cut(`The argument ${path.replace(/^\./, "")} doesn't fit: it takes ${takes}${value ? `, and got ${value}` : ""}.${takes.startsWith("v.id(") ? " An ID is one a result gave you, never a name." : ""}`, 400);
}

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
 * `halted` says whether the person has stopped the reply: a bulk change ends there. `changed`
 * is how many changes of each kind the reply had called for before this request (`kindOf`).
 */
export function toolsFor(
  ctx: ActionCtx,
  {
    userId,
    threadId,
    order,
    attemptId,
    stopped,
    halted = async () => false,
    made = 0,
    changed = {},
  }: {
    userId: Id<"users">;
    threadId: Id<"assistantThreads">;
    order: number;
    attemptId: string;
    stopped: () => string | null;
    halted?: () => Promise<boolean>;
    made?: number;
    changed?: Record<string, number>;
  },
) {
  let calls = made;
  let asked = 0;
  // What this request's calls came to, an entry a call, for telling whether the reply is going round in
  // circles. A read is told apart by what it returned, so one whose result changes, such as a job's
  // progress, is never a repeat. A change is told apart by what it was asked to do, whatever came back:
  // each one makes its own revision and undo, and doing the same one over is a repeat all the same.
  const did: string[] = [];
  const note = (name: string, input: unknown, outcome: unknown) => did.push(JSON.stringify([name, input, outcome ?? null]));
  // What this request's calls that spend credits hold at most, and whether the person's allowance covers each (./asking.ts):
  // read once a call, when it's checked for asking, and kept for its step.
  // How many changes of each kind the reply has called for unasked, in all its requests: counted as each call arrives,
  // since a request's calls run together, and carried from request to request with the rest of where the reply stands.
  const changes = new Map(Object.entries(changed));
  const holds = new Map<string, { credits: number; covered: boolean }>();
  const sameCall = (path: string, input: unknown) => JSON.stringify([path, input]);
  const hold = async (entry: UserAction, input: Record<string, unknown>) => {
    const key = sameCall(entry.path, input);
    if (!holds.has(key)) {
      const read = await ctx.runQuery(internal.assistant.asking.spend, { threadId, userId, path: entry.path, input: JSON.stringify(input) });
      if (!read) return null;
      holds.set(key, read);
    }
    return holds.get(key)!;
  };
  /**
   * Runs one call, kept as a step from when it starts to how it ended. The model reads the
   * short form of the result, and an action's failure as its message, so it can say what
   * went wrong or try something else. `allowed` is the step of a call the person was asked
   * about and said yes to: it runs whatever the reply's limits are. `inBatch` is one change
   * of a bulk change they said yes to, which is allowed the same and is a step of its own.
   */
  const call = async (entry: UserAction, input: Record<string, unknown>, toolCallId: string, allowed?: Id<"assistantSteps">, approvedFor?: number, inBatch = false) => {
    const approved = inBatch || allowed !== undefined;
    // A call that spends credits and wasn't asked about runs only when the person's allowance covers what it holds.
    const within = approved || entry.kind === "query" || !entry.spendsCredits ? undefined : holds.get(sameCall(entry.path, input));
    if (!approved) {
      // One that asks first only gets here allowed. The rest is refused: an action that spends credits past what the person allowed, or with no estimate to ask them with, or a call nothing asked about.
      let why = stopped() ?? (runsWithoutAsking(entry) || within?.covered ? null : entry.kind !== "query" && entry.spendsCredits && !entry.estimate ? NO_ESTIMATE : ASKS_FIRST);
      if (!why && changesSomething(entry)) {
        const kind = kindOf(entry, input);
        const nth = (changes.get(kind) ?? 0) + 1;
        changes.set(kind, nth);
        if (nth > BULK) why = BULK_FIRST;
      }
      if (why) {
        note(entry.path, input, { error: why });
        return { error: why };
      }
    }
    // A call the person allowed was counted when it was asked about.
    const key = allowed ? `${attemptId}:${allowed}` : `${attemptId}:${calls++}`;
    const subject = subjectOf(input);
    const stepId =
      allowed ??
      (await ctx.runMutation(internal.assistant.steps.begin, { threadId, order, userId, toolCallId, path: entry.path, input: cut(JSON.stringify(input), STEP_TEXT_MAX), ...(subject ? { subject } : {}), ...(within ? { credits: within.credits } : {}) }));
    try {
      // A change ends its step in its own transaction, so the two are saved together. A read's step is ended here.
      const change = changesSomething(entry);
      // What the person let it hold goes with a call that spends credits: the figure they said yes to, or the one their allowance covered.
      const result = await written(() => runAction(ctx, userId, entry, input, key, change ? stepId : undefined, approved, allowed ? approvedFor : within?.credits));
      if (!change) await ctx.runMutation(internal.assistant.steps.read, { stepId, result: JSON.stringify(result ?? null) });
      note(entry.path, input, change ? "made" : result);
      // A change that returns nothing says it was made. A read that returns nothing found nothing.
      return forModel(change ? (result ?? DONE) : result);
    } catch (error) {
      const message = messageOf(error);
      await ctx.runMutation(internal.assistant.steps.failed, { stepId, error: message });
      note(entry.path, input, { error: message });
      return { error: message };
    }
  };
  /**
   * Whether the person is asked before a call runs (decisions 8 and 12): its action reaches
   * outside the account or can't be undone, or this call of it can't (`asksFirst`).
   */
  const asks = async (entry: UserAction, input: Record<string, unknown>) => {
    if (entry.kind === "query") return false;
    if (entry.spendsCredits) {
      // Asked with the most it holds, unless they allowed that much in this chat. With no estimate there's nothing to ask with, and the call is refused.
      const held = await hold(entry, input);
      return held !== null && !held.covered;
    }
    return !runsWithoutAsking(entry) || (await ctx.runQuery(internal.assistant.asking.first, { userId, path: entry.path, input: JSON.stringify(input) }));
  };
  /**
   * Whether the person is asked before a batch of changes runs: with the changes of its kind
   * the reply has made, it's more than `BULK`, or one of its changes would ask alone.
   */
  const asksMany = async ({ entry, each }: { entry: UserAction; each: Record<string, unknown>[] }) => {
    // One that can't go in a batch is refused when it runs: there's nothing to ask.
    if (!bulkable(entry)) return false;
    if ((changes.get(kindOf(entry, each[0])) ?? 0) + each.length > BULK) return true;
    if (entry.kind === "query" || !entry.asksFirst) return false;
    for (const input of each) if (await ctx.runQuery(internal.assistant.asking.first, { userId, path: entry.path, input: JSON.stringify(input) })) return true;
    return false;
  };
  /**
   * Runs a batch's changes one after another, each a step of its own with its own undo.
   * `allowed`: the person said yes to the batch. A Stop ends it between two changes: what ran
   * stays, and the rest isn't made. Its `error` says so, or that none of them could be made,
   * which counts as a failed call like any other.
   */
  const runMany = async (entry: UserAction, each: Record<string, unknown>[], toolCallId: string, allowed = false) => {
    const results: unknown[] = [];
    for (const [i, input] of each.entries()) {
      if (await halted()) break;
      results.push(await call(entry, input, `${toolCallId}:${i}`, undefined, undefined, allowed));
    }
    const failed = results.flatMap((result) => (result && typeof result === "object" && "error" in result ? [String(result.error)] : []));
    const made = results.length - failed.length;
    const error =
      results.length < each.length
        ? `The person stopped the reply after ${made} of these ${each.length} changes were made. The rest weren't.`
        : made === 0
          ? `None of these ${each.length} changes were made. The first failed with: ${failed[0]}`
          : undefined;
    return { ...(error ? { error } : {}), results };
  };
  const approval = async ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
    // A call the reply's limits refuse anyway isn't worth asking about.
    if (stopped()) return undefined;
    const many = batched(toolCall.toolName, toolCall.input);
    const call = many ? null : called(toolCall.toolName, toolCall.input);
    if (many ? !(await asksMany(many)) : !call || !(await asks(call.entry, call.input))) return undefined;
    // What it's given waits on its step for the answer, so it has to fit there.
    if (JSON.stringify(many ? many.each : call!.input).length > STEP_TEXT_MAX)
      return { type: "denied" as const, reason: many ? "The list is too long to ask the person about in one go. Split it into shorter run_many calls." : "Its arguments are too long to ask the person about." };
    if (asked >= MAX_ASKS) return { type: "denied" as const, reason: `A reply asks the person about at most ${MAX_ASKS} actions at a time. Ask about the rest once these are answered.` };
    asked++;
    calls++;
    // Asking counts as what the request did: a model that asks for the same thing again, each time it's declined, is going round in circles too.
    note(many ? RUN_MANY : call!.entry.path, many ? [many.entry.path, many.each] : call!.input, "asked");
    return "user-approval" as const;
  };
  const resume = async (step: { stepId: Id<"assistantSteps">; toolCallId: string; path: string; input: string; credits?: number; batch?: number }) => {
    // Claimed once, for this reply: one that died after this and is tried again doesn't run it a second time, and a stopped one runs nothing more.
    if (!(await ctx.runMutation(internal.assistant.steps.resume, { stepId: step.stepId, attemptId }))) return false;
    const entry = entryAt(step.path);
    if (!entry) await ctx.runMutation(internal.assistant.steps.failed, { stepId: step.stepId, error: "This action can't be run any more." });
    else if (step.batch === undefined) await call(entry, JSON.parse(step.input), step.toolCallId, step.stepId, step.credits);
    else {
      // A bulk change the person allowed: its step ends with what every change came to, or as failed when it was stopped partway or none could be made.
      const outcome = await runMany(entry, JSON.parse(step.input), step.toolCallId, true);
      if (outcome.error) await ctx.runMutation(internal.assistant.steps.failed, { stepId: step.stepId, error: outcome.error });
      else await ctx.runMutation(internal.assistant.steps.read, { stepId: step.stepId, result: JSON.stringify(outcome) });
    }
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
      execute: async ({ keywords }) => {
        const result = stopped() ? { error: stopped() } : found(keywords);
        note("find_action", keywords, result);
        return forModel(result);
      },
    }),
    run_action: tool({
      description: "Runs an action find_action returned, by its name, with its arguments. An undo in a result is run the same way: the action it names, with its arguments.",
      inputSchema: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      execute: async ({ name, arguments: given }, { toolCallId }) => {
        const entry = entryAt(name);
        const parsed = entry && inputSchema(entry).safeParse(given);
        // The arguments it takes come back with the refusal, for one more try.
        const refused =
          stopped() ??
          (!entry ? `No action is named ${cut(name, 200)}. Look one up with find_action.` : !parsed!.success ? `These arguments don't fit: ${cut(z.prettifyError(parsed!.error), 1_000)}` : null);
        if (refused) {
          note("run_action", [name, given], { error: refused });
          return entry && parsed && !parsed.success && !stopped() ? forModel({ error: refused, arguments: definition(entry).arguments }) : { error: refused };
        }
        return call(entry!, parsed!.data as Record<string, unknown>, toolCallId);
      },
    }),
    run_many: tool({
      description:
        `Makes the same kind of change to many records in one go: one action, run once for each set of arguments in "each". Use it whenever there are more than ${BULK} changes of one kind to make, such as removing 30 papers or rating every paper in a collection. ` +
        'The person is asked once, with the whole list, before any of it runs, so list every change and make none of them one by one first. "name" is an action\'s name as find_action gives it, or the name of one of your tools.',
      inputSchema: z.object({ name: z.string(), each: z.array(z.record(z.string(), z.unknown())) }),
      execute: async ({ name, each }, { toolCallId }) => {
        const entry = namedAs(name);
        const many = batched(RUN_MANY, { name, each });
        const misfit = entry && !many ? each.map((given, i) => ({ i, parsed: inputSchema(entry).safeParse(given) })).find(({ parsed }) => !parsed.success) : undefined;
        const refused =
          stopped() ??
          (!entry
            ? `No action is named ${cut(name, 200)}. Look one up with find_action.`
            : !bulkable(entry)
              ? "run_many makes changes that run without asking. This action reads, or asks every time: run it with its own tool or run_action, once for each."
              : misfit
                ? `The arguments of change ${misfit.i + 1} don't fit: ${cut(z.prettifyError(misfit.parsed.error!), 1_000)}`
                : !each.length
                  ? '"each" is empty: give one set of arguments for each change.'
                  : !many
                    ? "These aren't all the same change. Make one run_many call for each, so the person is asked about each."
                    : // Asked about before it got here, unless what the reply has made since tipped it over.
                    (await asksMany(many))
                    ? ASKS_FIRST
                    : null);
        if (refused || !many) {
          note(RUN_MANY, [name, each], { error: refused });
          return entry && misfit && !stopped() ? forModel({ error: refused, arguments: definition(entry).arguments }) : { error: refused };
        }
        return forModel(await runMany(many.entry, many.each, toolCallId));
      },
    }),
  };
  return { tools, approval, resume, made: () => calls, changes: () => Object.fromEntries(changes), digest: () => (did.length ? fnv(did.slice().sort().join("\n")) : undefined), held: (path: string, input: unknown) => holds.get(sameCall(path, input))?.credits };
}
