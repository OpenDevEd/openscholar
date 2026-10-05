/**
 * The steps a reply takes (#327): one row for each action the assistant runs, and the
 * command that reverses it when there is one (#342), for the chat's page and for Undo. The
 * model reads a short form of an action's result; the whole of it is kept beside the step.
 *
 * Asking first (decisions 8 and 12). A reply that calls an action the person has to allow
 * ends there, unanswered: the call is kept as a step that waits (`asking`), and the chat
 * takes no message until each is answered or the reply is stopped. The model's call still
 * needs its result, or the provider can't read the conversation. So whatever ends such a
 * step writes that result in the same transaction: the action's outcome when the person
 * allowed it, or that they didn't. `settleAsked` ends any that a stopped or dead reply left.
 */
import { listMessages } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { STEPS_SHOWN } from "../../lib/assistant/steps";
import { workUrl } from "../../lib/openalex/work-id";
import { ABORT_ERROR_STRING } from "../../lib/chat/abort-signal";
import { assistant } from "./agent";
import { forgetLimits, noteReply } from "./spending";

/** Characters of an action's arguments, of what reverses it, and of why it failed, that a step keeps. */
export const STEP_TEXT_MAX = 16_000;
/** Characters of an action's result that are kept, well inside one document. */
export const STEP_RESULT_MAX = 200_000;
export { STEPS_SHOWN };

/** Calls one reply may ask the person about before it carries on. More than a person would read, so the rest are refused. */
export const MAX_ASKS = 10;
/**
 * Changes a reply makes to one kind of record (papers, searches, collections) without asking,
 * whichever actions make them. More is a
 * bulk change: it goes in one call that lists every one, and the person is asked once before
 * any of it runs (./tools.ts, `run_many`). As opencode asks once for a patch, with every
 * file it touches.
 */
export const BULK = 10;
/**
 * Characters of anything a tool hands the model, about 4,000 tokens (#326). A step keeps the
 * rest of a result. Room for a page of ten papers with enough of each abstract to say what
 * the paper studied: at half this, a page carried a sentence of each.
 */
export const MODEL_READS = 16_000;
/** Rows one batch deletes of a chat being deleted: results are large, so few at a time. */
const FORGET_RESULTS = 20;
const FORGET_STEPS = 100;

type Step = Doc<"assistantSteps">;

/**
 * An exchange's steps, in the order they ran. A reply runs as many as its work takes; of
 * more than a page lists, these are the newest, so a step that waits for the person is
 * always among them.
 */
export async function stepsOfExchange(ctx: Pick<QueryCtx, "db">, threadId: Id<"assistantThreads">, order: number) {
  return (await ctx.db.query("assistantSteps").withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId).eq("order", order)).order("desc").take(STEPS_SHOWN)).reverse();
}

/** A chat's steps at one status. Only steps a reply asked about are ever many at once, and those are bounded. */
export function stepsAt(ctx: Pick<QueryCtx, "db">, threadId: Id<"assistantThreads">, status: Step["status"]) {
  return ctx.db.query("assistantSteps").withIndex("by_thread_and_status", (q) => q.eq("threadId", threadId).eq("status", status)).take(MAX_ASKS * 4);
}

const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/**
 * Levels of lists and objects a tool's result keeps. A result is saved with the reply, five
 * levels down in its message, and Convex saves no document nested past sixteen: an action
 * whose arguments nest deeper ended the reply that looked it up.
 */
export const RESULT_LEVELS = 10;
/** A value no deeper than that: what sits below is given as its JSON text, which reads the same to the model. */
const shallow = (value: unknown, levels: number): unknown =>
  !value || typeof value !== "object"
    ? value
    : levels === 0
      ? JSON.stringify(value)
      : Array.isArray(value)
        ? value.map((inner) => shallow(inner, levels - 1))
        : Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shallow(inner, levels - 1)]));

/**
 * What a change that returns nothing tells the model. Nothing at all read, to a weaker model,
 * as not done yet: after the person allowed a deletion and it ran, the reply said it was
 * still waiting for them.
 */
export const DONE = { done: true } as const;

/**
 * What the model reads of anything a tool returns, and what's saved with the reply: all of
 * it when it's short, its start and how much was left out when it isn't.
 */
export function forModel(value: unknown) {
  const text = JSON.stringify(value ?? null);
  return text.length <= MODEL_READS ? shallow(value ?? null, RESULT_LEVELS) : `${text.slice(0, MODEL_READS)}… (cut: ${(text.length - MODEL_READS).toLocaleString("en")} more characters. Ask for less at a time.)`;
}

/** The command that reverses a change, when its result carries one (#342) short enough to keep. */
export function undoOf(result: unknown) {
  const undo = result && typeof result === "object" && "undo" in result ? (result as { undo?: { path?: unknown; args?: unknown } }).undo : undefined;
  if (!undo || typeof undo.path !== "string") return undefined;
  const args = JSON.stringify(undo.args ?? {});
  return args.length <= STEP_TEXT_MAX ? { path: undo.path, args } : undefined;
}

/** What a result is, for its step's card: the title or the name of the one thing it returns. */
export function namedBy(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const { title, name } = result as { title?: unknown; name?: unknown };
  const named = [title, name].find((value) => typeof value === "string" && value.trim() !== "");
  return typeof named === "string" ? cut(named.trim(), 200) : undefined;
}

/** How many things a result lists: its page's rows, or its own when it's a list. */
export function countOf(result: unknown) {
  if (Array.isArray(result)) return result.length;
  const page = result && typeof result === "object" ? (result as { page?: unknown }).page : undefined;
  return Array.isArray(page) ? page.length : undefined;
}

type Output = { type: "json"; value: unknown } | { type: "text"; value: string } | { type: "execution-denied"; reason: string };

/**
 * Writes the model the results of calls it asked the person about, as one message. A step
 * the reply ran itself needs none from here: the reply writes that with its own messages.
 */
async function answerCalls(ctx: MutationCtx, steps: Step[], output: (step: Step) => Output) {
  const asked = steps.filter((step) => step.tool && step.prompt);
  const thread = asked.length ? await ctx.db.get("assistantThreads", asked[0].threadId) : null;
  // Its chat was deleted while it waited.
  if (!thread) return;
  await assistant.saveMessage(ctx, {
    threadId: thread.agentThreadId,
    promptMessageId: asked[0].prompt!,
    message: { role: "tool", content: asked.map((step) => ({ type: "tool-result" as const, toolCallId: step.toolCallId, toolName: step.tool!, output: output(step) as never })) },
    skipEmbeddings: true,
  });
}

/**
 * Ends a step with what its action returned: the result is kept beside it, with what
 * reverses it and how many things it lists. A change calls this in its own transaction
 * (convex/lib/userActions.ts), so a change and the record of it are saved together or not at all.
 */
export async function endStep(ctx: MutationCtx, stepId: Id<"assistantSteps">, result: unknown) {
  const step = await ctx.db.get("assistantSteps", stepId);
  // Its chat was deleted while it ran.
  if (!step) return;
  const [undo, count] = [undoOf(result), countOf(result)];
  // A call that names a paper by its ID alone is about the paper it returned.
  const subject = step.subject ? undefined : namedBy(result);
  await ctx.db.patch("assistantSteps", stepId, { status: "done", ...(count === undefined ? {} : { count }), ...(undo ? { undo } : {}), ...(subject ? { subject } : {}), endedAt: Date.now() });
  await ctx.db.insert("assistantStepResults", { threadId: step.threadId, stepId, result: cut(JSON.stringify(result ?? null), STEP_RESULT_MAX) });
  const read = forModel(result);
  await answerCalls(ctx, [step], () => (typeof read === "string" ? { type: "text", value: read } : { type: "json", value: read }));
}

async function failStep(ctx: MutationCtx, step: Step, error: string) {
  await ctx.db.patch("assistantSteps", step._id, { status: "failed", error: cut(error, STEP_TEXT_MAX), endedAt: Date.now() });
  await answerCalls(ctx, [step], () => ({ type: "json", value: { error: cut(error, MODEL_READS / 4) } }));
}

/** A step starts. */
export const begin = internalMutation({
  args: { threadId: v.id("assistantThreads"), order: v.number(), userId: v.id("users"), toolCallId: v.string(), path: v.string(), input: v.string(), subject: v.optional(v.string()), credits: v.optional(v.number()) },
  returns: v.id("assistantSteps"),
  handler: async (ctx, args) => {
    const subject = args.subject ?? (await aboutOf(ctx, args.userId, args.input));
    return ctx.db.insert("assistantSteps", { ...args, ...(subject ? { subject } : {}), status: "running", startedAt: Date.now() });
  },
});

/**
 * What a call is about when its arguments name one of the person's records by ID alone: the
 * saved paper's title, or else the collection's name. A paper it is about to save isn't
 * theirs yet, and gets its title from what the call returns (`namedBy`).
 */
async function aboutOf(ctx: Pick<MutationCtx, "db">, userId: Id<"users">, input: string) {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(input) as Record<string, unknown>;
  } catch {
    // Arguments too long to keep whole were cut, and don't parse.
    return undefined;
  }
  if (!args || typeof args !== "object") return undefined;
  const command = args.command && typeof args.command === "object" ? (args.command as Record<string, unknown>) : {};
  const paper = [args.id, args.openalexId, args.paperId, command.paperId].find((value): value is string => typeof value === "string");
  const openalexId = paper ? workUrl(paper) : null;
  if (openalexId) {
    const item = await ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId).eq("openalexId", openalexId)).first();
    if (item?.title) return cut(item.title, 200);
  }
  const collectionId = typeof args.collectionId === "string" ? ctx.db.normalizeId("collections", args.collectionId) : null;
  const collection = collectionId ? await ctx.db.get("collections", collectionId) : null;
  return collection?.userId === userId ? cut(collection.name, 200) : undefined;
}

/** A step that read something ends with its result. A change ends its own (`endStep`). */
export const read = internalMutation({
  // `result` is what the action returned, as JSON.
  args: { stepId: v.id("assistantSteps"), result: v.string() },
  returns: v.null(),
  handler: async (ctx, { stepId, result }) => {
    await endStep(ctx, stepId, JSON.parse(result));
    return null;
  },
});

/** A step fails, with why, as the model is told. */
export const failed = internalMutation({
  args: { stepId: v.id("assistantSteps"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { stepId, error }) => {
    const step = await ctx.db.get("assistantSteps", stepId);
    if (step) await failStep(ctx, step, error);
    return null;
  },
});

/** The steps the person allowed, in the order they were asked: the reply runs them as it carries on. */
export const allowed = internalQuery({
  args: { threadId: v.id("assistantThreads") },
  returns: v.array(v.object({ stepId: v.id("assistantSteps"), toolCallId: v.string(), path: v.string(), input: v.string(), credits: v.optional(v.number()), batch: v.optional(v.number()) })),
  handler: async (ctx, { threadId }) =>
    (await stepsAt(ctx, threadId, "allowed")).map((step) => ({
      stepId: step._id,
      toolCallId: step.toolCallId,
      path: step.path,
      input: step.input,
      ...(step.credits === undefined ? {} : { credits: step.credits }),
      ...(step.batch === undefined ? {} : { batch: step.batch }),
    })),
});

/**
 * An allowed step starts to run, for the reply `attemptId`. False when it isn't allowed
 * any more, so it never runs twice, or when that reply was stopped or isn't the chat's
 * reply any more, so nothing runs after a Stop.
 */
export const resume = internalMutation({
  args: { stepId: v.id("assistantSteps"), attemptId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { stepId, attemptId }) => {
    const step = await ctx.db.get("assistantSteps", stepId);
    const reply = step && (await ctx.db.get("assistantThreads", step.threadId))?.reply;
    if (step?.status !== "allowed" || reply?.attemptId !== attemptId || reply.stop) return false;
    await ctx.db.patch("assistantSteps", stepId, { status: "running", startedAt: Date.now() });
    return true;
  },
});

const DECLINED = "The person didn't allow this. Don't try it again unless they ask.";

/** The person didn't allow these calls: the model is told so, and the steps show as declined. */
export async function declineSteps(ctx: MutationCtx, steps: Step[], reason = DECLINED) {
  if (!steps.length) return;
  for (const step of steps) await ctx.db.patch("assistantSteps", step._id, { status: "declined", endedAt: Date.now() });
  await answerCalls(ctx, steps, () => ({ type: "execution-denied", reason }));
}

/**
 * Ends every step nothing will end now, when no reply is running in the chat: its reply
 * was stopped, died, or was never carried on. Calls still waiting, or allowed and not yet
 * run, are declined. A step that had started may or may not have finished, and says so;
 * one the person was asked about tells the model too. After this, each call the reply
 * asked about has its result, so the conversation reads whole again.
 */
export async function settleAsked(ctx: MutationCtx, threadId: Id<"assistantThreads">) {
  await declineSteps(ctx, [...(await stepsAt(ctx, threadId, "asking")), ...(await stepsAt(ctx, threadId, "allowed"))], "This wasn't run: the reply ended before the person's answer could be acted on.");
  // Every one read is ended, so a chat with many dead steps is worked through and none hides behind them.
  for (const step of await stepsAt(ctx, threadId, "running")) await failStep(ctx, step, "The reply ended while this ran, so it may or may not have finished. Check before trying it again.");
}

/** The newest messages of a chat that are read to find calls left without a result. A call with none is among the last a reply wrote. */
const HEAL_MESSAGES = 80;
type Part = { type?: string; toolCallId?: string; toolName?: string };
const partsOf = (content: unknown): Part[] => (Array.isArray(content) ? (content as Part[]) : []);

/**
 * Gives a result to any call of the chat's newest exchange that has none, read from the
 * conversation itself. A reply that died between asking the person and recording what it
 * asked leaves such calls with no step to end them by, and the provider refuses a
 * conversation that holds one. Run before the chat takes its next message.
 */
export async function healCalls(ctx: MutationCtx, agentThreadId: string) {
  const { page } = await listMessages(ctx, components.agent, { threadId: agentThreadId, paginationOpts: { numItems: HEAL_MESSAGES, cursor: null }, statuses: ["success"] });
  // Oldest first. A result answers the earliest call with its ID that has none: models reuse their call IDs from one round to the next.
  const exchange = page.filter((doc) => doc.order === page[0]?.order).reverse();
  const open: Part[] = [];
  for (const doc of exchange) {
    for (const part of partsOf(doc.message?.content)) {
      if (part.type === "tool-call" && part.toolCallId && doc.message?.role === "assistant") open.push(part);
      const answers = part.type === "tool-result" ? open.findIndex((call) => call.toolCallId === part.toolCallId) : -1;
      if (answers !== -1) open.splice(answers, 1);
    }
  }
  // The result goes at the end of the exchange, which any of its messages places it in: a long reply's first message isn't among the ones read.
  const anchor = exchange.find((doc) => doc.message?.role === "user") ?? exchange[0];
  if (!open.length || !anchor) return;
  await assistant.saveMessage(ctx, {
    threadId: agentThreadId,
    promptMessageId: anchor._id,
    message: { role: "tool", content: open.map((call) => ({ type: "tool-result" as const, toolCallId: call.toolCallId!, toolName: call.toolName ?? "", output: { type: "execution-denied" as const, reason: "This was never run: the reply ended before it could be." } })) },
    skipEmbeddings: true,
  });
}

/**
 * Stops a reply that waits for an answer. Nothing is running, so it ends here: what it
 * still asks is declined, the chat shows it as stopped, and the chat takes messages again.
 */
export async function stopAsking(ctx: MutationCtx, thread: Doc<"assistantThreads">, waiting: NonNullable<Doc<"assistantThreads">["asking"]>) {
  await settleAsked(ctx, thread._id);
  await assistant.saveMessage(ctx, {
    threadId: thread.agentThreadId,
    promptMessageId: waiting.promptMessageId,
    message: { role: "assistant", content: "" },
    metadata: { status: "failed", error: ABORT_ERROR_STRING },
    skipEmbeddings: true,
  });
  await ctx.db.patch("assistantThreads", thread._id, { asking: undefined });
  // It has no request running, so no charge of its own is still to settle: any name of its own will do.
  await noteReply(ctx, waiting.senderId, `waiting:${thread._id}:${waiting.askedAt}`, waiting.spent);
}

/** Deletes a deleted chat's steps and their results, a batch at a time, until none are left. */
export const forget = internalMutation({
  args: { threadId: v.id("assistantThreads") },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const results = await ctx.db.query("assistantStepResults").withIndex("by_thread", (q) => q.eq("threadId", threadId)).take(FORGET_RESULTS);
    for (const row of results) await ctx.db.delete("assistantStepResults", row._id);
    // Steps go once their results are gone, so a batch never reads large rows and small ones together.
    const steps = results.length === FORGET_RESULTS ? [] : await ctx.db.query("assistantSteps").withIndex("by_thread_and_order", (q) => q.eq("threadId", threadId)).take(FORGET_STEPS);
    for (const step of steps) await ctx.db.delete("assistantSteps", step._id);
    // What people let the assistant spend in it goes too (./spending.ts).
    const limitsLeft = await forgetLimits(ctx, threadId);
    if (results.length === FORGET_RESULTS || steps.length === FORGET_STEPS || limitsLeft) await ctx.scheduler.runAfter(0, internal.assistant.steps.forget, { threadId });
    return null;
  },
});
