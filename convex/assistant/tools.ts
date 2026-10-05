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
import { USER_ACTIONS } from "../lib/userActionRegistry";
import { ASKS_FIRST, type UserAction } from "../lib/userActions";
import { variantIn, viewOf } from "../../lib/assistant/actions";
import { CHUNK } from "./bulk";
import { COLLIDED, messageOf } from "./failures";
import { PAPERS_MAX, changeOf, changePapersSchema, papersOf, type ChangePapers } from "./paperChanges";
import { BULK, DONE, MAX_ASKS, MODEL_READS, STEP_TEXT_MAX, UNDO_BULK, forModel } from "./steps";
import { ASKED_EACH_MAX } from "./validators";

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
const CHANGE_PAPERS = "change_papers";

/** Whether an action changes something, and so ends its step in its own transaction: a mutation, or an action whose write does. */
const changesSomething = (entry: UserAction) => entry.kind === "mutation" || (entry.kind === "action" && entry.changes === true);
/**
 * Whether many of an action's changes can go in one bulk change: a mutation, since a bulk
 * change runs it inside its own (./bulk.ts), that alone would run without asking. One that
 * asks every time is asked about one by one.
 */
const bulkable = (entry: UserAction) => entry.kind === "mutation" && runsWithoutAsking(entry);
/** What a reply is told at a change past `BULK` of its kind: the rest go in one call, which asks. */
export const BULK_FIRST = `You've made ${BULK} changes of this kind in this reply, and more than that is a bulk change the person is asked about first. Make all that is left in one call: change_papers for papers, run_many for anything else. They're asked once, and it is one change with one undo.`;

/** Changes to which papers a collection holds: counted with the papers they move, whatever tile their card has. */
const PLACES_PAPERS = new Set(["collect", "collectIn", "collectOut"]);
/**
 * What a call changes, for counting a reply's changes: papers, searches, collections, chats,
 * screenings or extractions, as its card's tile says (lib/assistant/actions.ts). Broad on
 * purpose: several actions rate a paper or put a search back, and each would have its own
 * count if they were told apart any finer. Putting a paper in a collection changes a paper:
 * a save into a collection and a paper put into one are the same ten.
 */
export const kindOf = (entry: UserAction, input: unknown) => {
  const { kind, words } = viewOf(entry.path, variantIn(entry.path, input));
  return PLACES_PAPERS.has(words) ? "paper" : kind;
};

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
 * A bulk change, ready to run: one action, and what each of its changes is given. `kept` is
 * what waits on its step while the person is asked, and what the reply runs it from once they
 * allow it. `shown` is what its card says in place of its arguments, for one over a set of
 * papers. `about` is what its changes are all given alike, which names the step.
 */
export type Plan = { tool: string; entry: UserAction; items: Record<string, unknown>[]; kept: string; shown?: string; variant?: string; about: string; subject?: string };

/** What every change of a batch is given alike. */
const shared = (items: Record<string, unknown>[]) => Object.fromEntries(Object.entries(items[0] ?? {}).filter(([key, value]) => items.length > 1 && items.every((item) => JSON.stringify(item[key]) === JSON.stringify(value))));

/**
 * The batch a run_many call is for: its action, and each change's arguments. A reason
 * instead when it names no action or one a bulk change can't run, lists nothing, any
 * arguments don't fit, or its changes aren't all the same change (`sameChange`): the person
 * is asked about a batch as one.
 */
export function batched(input: unknown): { entry: UserAction; each: Record<string, unknown>[] } | { error: string; entry?: UserAction; misfit?: true } {
  const { name, each } = (input && typeof input === "object" ? input : {}) as { name?: unknown; each?: unknown };
  const entry = typeof name === "string" ? namedAs(name) : undefined;
  if (!entry) return { error: `No action is named ${cut(String(name), 200)}. Look one up with find_action.` };
  if (!bulkable(entry))
    return { error: entry.kind === "action" ? "run_many can't run this action many times in one go. To save, collect, rate or remove many papers, use change_papers." : "run_many makes changes that run without asking. This action reads, or asks every time: run it with its own tool or run_action, once for each." };
  if (!Array.isArray(each) || !each.length) return { error: '"each" is empty: give one set of arguments for each change.' };
  const parsed = each.map((given) => inputSchema(entry).safeParse(given));
  const wrong = parsed.findIndex((item) => !item.success);
  if (wrong !== -1) return { error: `The arguments of change ${wrong + 1} don't fit: ${cut(z.prettifyError(parsed[wrong].error!), 1_000)}`, entry, misfit: true };
  const items = parsed.map((item) => item.data as Record<string, unknown>);
  if (!items.every((item) => sameChange(entry, item, items[0]))) return { error: "These aren't all the same change. Make one run_many call for each, so the person is asked about each." };
  return { entry, each: items };
}

/** A tool call the reply asked the person about. */
export type Asked = { toolCallId: string; toolName: string; input: unknown };
/**
 * The calls a reply asked about, as the steps that wait for the person's answer. Every one
 * becomes a step, since every one needs its result written: a call that names no action
 * any more waits under its tool's name, and fails when it's run.
 */
export function askedSteps(requests: Asked[], held: (path: string, input: unknown) => number | undefined = () => undefined, planned: (toolCallId: string) => Plan | undefined = () => undefined) {
  return requests.map(({ toolCallId, toolName: tool, input }) => {
    // A bulk change waits as one step: how many changes it is, what the reply runs it from, and what its card says.
    const plan = planned(toolCallId);
    if (plan) {
      return {
        toolCallId,
        tool,
        path: plan.entry.path,
        input: plan.kept,
        batch: plan.items.length,
        ...(plan.subject ? { subject: plan.subject } : {}),
        ...(plan.shown ? { shown: plan.shown } : {}),
        ...(plan.variant ? { variant: plan.variant } : {}),
      };
    }
    const call = called(tool, input);
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
      if (tries >= WRITE_TRIES || !COLLIDED.test(String(error))) throw error;
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
   * about and said yes to: it runs whatever the reply's limits are.
   */
  const call = async (entry: UserAction, input: Record<string, unknown>, toolCallId: string, allowed?: Id<"assistantSteps">, approvedFor?: number) => {
    const approved = allowed !== undefined;
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
   * A call of run_many or change_papers as the bulk change it is. A set of papers is read
   * here, before anyone is asked: the person is asked about the papers it holds now, and
   * those are the ones changed (#341). A reason instead when it can't be planned.
   */
  const plan = async (toolName: string, input: unknown): Promise<Plan | { error: string; arguments?: unknown }> => {
    try {
      let found: { entry: UserAction; items: Record<string, unknown>[]; kept: string; about: Record<string, unknown>; shown?: string };
      if (toolName === RUN_MANY) {
        const batch = batched(input);
        if ("error" in batch) return { error: batch.error, ...(batch.misfit && batch.entry ? { arguments: definition(batch.entry).arguments } : {}) };
        found = { entry: batch.entry, items: batch.each, kept: JSON.stringify(batch.each), about: shared(batch.each) };
      } else {
        const given = input as ChangePapers;
        const papers = await papersOf(ctx, userId, given);
        if (!papers.length) return { error: "There are no papers there: the set holds none in that range." };
        const change = changeOf(given, papers);
        const entry = entryAt(change.path)!;
        // What it was asked with, and the papers it found: the reply runs it from these once the person allows it, on those papers and no others.
        const kept = JSON.stringify({ given, ids: papers.map((paper) => paper.openalexId.split("/").at(-1)) });
        found = { entry, items: change.items, kept, about: change.shared, shown: JSON.stringify({ shared: change.shared, each: papers.slice(0, ASKED_EACH_MAX).map((paper) => cut(paper.title, 200)) }) };
      }
      const about = JSON.stringify(found.about);
      const subject = await ctx.runQuery(internal.assistant.steps.about, { userId, input: about });
      const variant = variantIn(found.entry.path, found.items[0]);
      return { tool: toolName, entry: found.entry, items: found.items, kept: found.kept, about, ...(found.shown ? { shown: found.shown } : {}), ...(variant ? { variant } : {}), ...(subject ? { subject } : {}) };
    } catch (error) {
      return { error: messageOf(error) };
    }
  };
  // The bulk changes this request's calls planned, by call: planned once, when a call is checked for asking, and run or kept from there.
  // Only this request's own calls: a step the person allowed is planned afresh, since models reuse their call IDs.
  const plans = new Map<string, ReturnType<typeof plan>>();
  const planned = new Map<string, Plan>();
  const planOf = (toolCallId: string, toolName: string, input: unknown) => {
    let made = plans.get(toolCallId);
    if (!made) {
      made = plan(toolName, input).then((ready) => {
        if (!("error" in ready)) planned.set(toolCallId, ready);
        return ready;
      });
      plans.set(toolCallId, made);
    }
    return made;
  };
  /**
   * Whether the person is asked before a bulk change runs: with the changes of its kind the
   * reply has made, it's more than `BULK`, or one of its changes would ask alone.
   */
  const asksPlan = async ({ entry, items }: Plan) => {
    if ((changes.get(kindOf(entry, items[0])) ?? 0) + items.length > BULK) return true;
    if (entry.kind === "query" || !entry.asksFirst) return false;
    for (const input of items) if (await ctx.runQuery(internal.assistant.asking.first, { userId, path: entry.path, input: JSON.stringify(input) })) return true;
    return false;
  };
  /**
   * Runs a bulk change as one step, a chunk of its changes a transaction (./bulk.ts). `asked`
   * is its step when the person was asked about it and said yes. A Stop ends it between two
   * chunks: what was made stays, and is what the step says and undoes. One that made
   * nothing fails, with why the first of its changes couldn't be made.
   */
  const runPlan = async ({ entry, items, variant, subject }: Plan, toolCallId: string, asked?: Id<"assistantSteps">) => {
    const stepId =
      asked ??
      (await ctx.runMutation(internal.assistant.steps.begin, {
        threadId,
        order,
        userId,
        toolCallId,
        path: entry.path,
        // The first of them say what kind of change it is; all of them would not fit.
        input: cut(JSON.stringify(items.slice(0, 1)), STEP_TEXT_MAX),
        batch: items.length,
        ...(subject ? { subject } : {}),
        ...(variant ? { variant } : {}),
      }));
    const key = asked ? `${attemptId}:${asked}` : `${attemptId}:${calls++}`;
    let [made, failed, tried, size] = [0, 0, 0, CHUNK];
    let stopped = false;
    // Why changes couldn't be made: the first reason of each chunk that had one.
    const why: string[] = [];
    while (tried < items.length) {
      if (await halted()) {
        stopped = true;
        break;
      }
      const chunk = items.slice(tried, tried + size);
      try {
        // Typed here: the generated API's types depend on this module, so inference would loop.
        const done: { took: number; made: number; failed: number; why?: string } = await written(() => ctx.runMutation(internal.assistant.bulk.apply, { userId, stepId, path: entry.path, items: JSON.stringify(chunk), approved: asked !== undefined, key: `${key}:${tried}` }));
        made += done.made;
        failed += done.failed;
        if (done.why) why.push(done.why);
        // It stops short when its transaction is full: the next chunk starts where it stopped.
        tried += done.took;
      } catch (error) {
        // A chunk that failed whole changed nothing: it's tried again at half the size. One change that fails alone is counted as failed.
        if (size > 1) {
          size = Math.ceil(size / 2);
          continue;
        }
        failed += 1;
        why.push(messageOf(error));
        tried += 1;
      }
    }
    if (made === 0) {
      const error = !items.length
        ? "None of the papers the person was asked about are in that set any more."
        : (why[0] ?? "The person stopped the reply before any of these were made.");
      await ctx.runMutation(internal.assistant.steps.failed, { stepId, error });
      note(entry.path, items.length, { error });
      return { error: items.length ? `None of these ${items.length} changes were made. ${error}` : error };
    }
    const result = {
      made,
      // A few reasons say why; a model that reads hundreds of them reads nothing else.
      ...(failed ? { failed, why: [...new Set(why)].slice(0, 5) } : {}),
      ...(stopped ? { stopped: `The person stopped the reply: ${items.length - tried} of these weren't made.` } : {}),
      undo: { path: UNDO_BULK, args: { change: stepId } },
    };
    await ctx.runMutation(internal.assistant.steps.read, { stepId, result: JSON.stringify(result) });
    note(entry.path, items.length, "made");
    return forModel(result);
  };
  /** Runs a call of run_many or change_papers that didn't have to ask. */
  const bulk = async (toolName: string, input: unknown, toolCallId: string) => {
    const refused = stopped();
    const plan = refused ? { error: refused } : await planOf(toolCallId, toolName, input);
    if ("error" in plan) {
      note(toolName, input, { error: plan.error });
      return forModel(plan);
    }
    const kind = kindOf(plan.entry, plan.items[0]);
    const over = () => (changes.get(kind) ?? 0) + plan.items.length > BULK;
    // Asked about before it got here, unless what the reply has made since tipped it over: then it's told how to ask, on its next call.
    if (over()) return { error: BULK_FIRST };
    if (await asksPlan(plan)) return { error: over() ? BULK_FIRST : ASKS_FIRST };
    // Counted here with nothing awaited between the check and the count: two small ones that arrived together don't both pass as the first.
    if (over()) return { error: BULK_FIRST };
    changes.set(kind, (changes.get(kind) ?? 0) + plan.items.length);
    return runPlan(plan, toolCallId);
  };
  const approval = async ({ toolCall }: { toolCall: { toolCallId: string; toolName: string; input: unknown } }) => {
    // A call the reply's limits refuse anyway isn't worth asking about.
    if (stopped()) return undefined;
    const many = toolCall.toolName === RUN_MANY || toolCall.toolName === CHANGE_PAPERS ? await planOf(toolCall.toolCallId, toolCall.toolName, toolCall.input) : null;
    // One that can't be planned says why when it's run.
    if (many && ("error" in many || !(await asksPlan(many)))) return undefined;
    const call = many ? null : called(toolCall.toolName, toolCall.input);
    if (!many && (!call || !(await asks(call.entry, call.input)))) return undefined;
    // What it's given waits on its step for the answer, so it has to fit there.
    if ((many ? many.kept : JSON.stringify(call!.input)).length > STEP_TEXT_MAX)
      return { type: "denied" as const, reason: many ? "That is too many to ask the person about in one go. Make it in two calls, each with half of them." : "Its arguments are too long to ask the person about." };
    if (asked >= MAX_ASKS) return { type: "denied" as const, reason: `A reply asks the person about at most ${MAX_ASKS} actions at a time. Ask about the rest once these are answered.` };
    asked++;
    calls++;
    // Asking counts as what the request did: a model that asks for the same thing again, each time it's declined, is going round in circles too.
    note(many ? toolCall.toolName : call!.entry.path, many ? many.kept : call!.input, "asked");
    return "user-approval" as const;
  };
  /** The bulk change a step the person allowed is, from what it kept. One over a set of papers reads the set again, for the papers' records, and changes only the ones they were asked about. */
  const kept = async (step: { toolCallId: string; input: string }): Promise<Plan | { error: string }> => {
    const { given, ids } = JSON.parse(step.input) as { given: ChangePapers; ids: string[] };
    const again = await plan(CHANGE_PAPERS, given);
    if ("error" in again) return again;
    const approved = new Set(ids);
    const at = (item: Record<string, unknown>) => String((item.paper as { openalexId?: unknown } | undefined)?.openalexId ?? item.openalexId).split("/").at(-1)!;
    return { ...again, items: again.items.filter((item) => approved.has(at(item))) };
  };
  const resume = async (step: { stepId: Id<"assistantSteps">; toolCallId: string; path: string; input: string; credits?: number; batch?: number; tool?: string }) => {
    // Claimed once, for this reply: one that died after this and is tried again doesn't run it a second time, and a stopped one runs nothing more.
    if (!(await ctx.runMutation(internal.assistant.steps.resume, { stepId: step.stepId, attemptId }))) return false;
    const entry = entryAt(step.path);
    if (!entry) await ctx.runMutation(internal.assistant.steps.failed, { stepId: step.stepId, error: "This action can't be run any more." });
    else if (step.batch === undefined) await call(entry, JSON.parse(step.input), step.toolCallId, step.stepId, step.credits);
    else {
      // A bulk change the person allowed: the same step, run from what it kept.
      const plan: Plan | { error: string } = step.tool === CHANGE_PAPERS ? await kept(step) : { tool: RUN_MANY, entry, items: JSON.parse(step.input), kept: step.input, about: "{}" };
      if ("error" in plan) await ctx.runMutation(internal.assistant.steps.failed, { stepId: step.stepId, error: plan.error });
      else await runPlan(plan, step.toolCallId, step.stepId);
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
        `Makes the same change to many records in one go: one action, run once for each set of arguments in "each". Use it for more than ${BULK} changes of one kind to anything but papers, such as renaming or removing many searches. ` +
        'It is one change, with one undo. More than that many and the person is asked once, with the whole list, before any of it runs, so list every change and make none of them one by one first. "name" is an action\'s name as find_action gives it, or the name of one of your tools. For papers, use change_papers.',
      inputSchema: z.object({ name: z.string(), each: z.array(z.record(z.string(), z.unknown())) }),
      execute: (input, { toolCallId }) => bulk(RUN_MANY, input, toolCallId),
    }),
    change_papers: tool({
      description:
        "Makes one change to many papers in one go, without reading them first. `papers` is the set: what a query finds ({kind: \"query\", query, filters}, where filters are the settings research_papers_search takes, such as {minCitations: 11}), a saved search's results ({kind: \"search\", searchId}), " +
        "a collection ({kind: \"collection\", collectionId}), every saved paper ({kind: \"saved\"}), a screening's included papers ({kind: \"screening\", jobId}), or papers you name ({kind: \"ids\", ids}). " +
        `\`first\` and \`last\` say which of the set, counting from 1. Left out, it is the whole set, up to ${PAPERS_MAX.toLocaleString("en")} papers. ` +
        "`do` is what happens to each paper: \"save\" to the library (with `collectionId`, into that collection too), \"collect\" into `collectionId`, \"uncollect\" out of `collectionId`, \"remove\" from the library, or \"rate\" with `rating`. " +
        `It is one change, with one undo. More than ${BULK} papers and the person is asked once, with how many and the first titles. Use it whenever a change is to more than a few papers: never read a set page by page to change its papers one by one.`,
      inputSchema: changePapersSchema(),
      execute: (input, { toolCallId }) => bulk(CHANGE_PAPERS, input, toolCallId),
    }),
  };
  return { tools, approval, resume, planned: (toolCallId: string) => planned.get(toolCallId), made: () => calls, changes: () => Object.fromEntries(changes), digest: () => (did.length ? fnv(did.slice().sort().join("\n")) : undefined), held: (path: string, input: unknown) => holds.get(sameCall(path, input))?.credits };
}
