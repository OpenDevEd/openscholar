/**
 * The action registry: every user action is defined once, as a core that takes the
 * acting user, and both the public function the UI calls and the assistant's tool
 * come from that one entry. `scripts/check-user-actions.ts` fails CI when a public
 * function is neither registered in `userActionRegistry.ts` nor exempt with a reason.
 * The assistant's tools are built from the same entries in `assistantTools.ts`, which
 * only actions import, so queries and mutations never bundle the AI SDK. Actions that
 * call outside services (OpenAlex, AI providers, Autumn) are entries too.
 */
import { v, type GenericValidator, type Infer, type ObjectType, type PropertyValidators } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./functions";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getCurrentUser, requireActiveUser, requireAuth } from "./auth";
import { createError } from "./errors";
import { DONE, endStep } from "../assistant/steps";
import { actorFor, type Actor } from "../workspaces/actor";

/** Who made a change: the person themselves, or the assistant acting for them. */
export type Author = "user" | "assistant";

type Common<Args extends PropertyValidators, Returns extends GenericValidator> = {
  /** The public function's path, such as "research/records:change". The tool is named after it. */
  path: string;
  /** What the assistant reads to decide when to call it. */
  description: string;
  args: Args;
  returns: Returns;
};

export type UserQuery<Args extends PropertyValidators, Returns extends GenericValidator> = Common<Args, Returns> & {
  kind: "query";
  run: (ctx: QueryCtx, userId: Id<"users">, args: ObjectType<Args>) => Promise<Infer<Returns>>;
};

/** Decision 12: three separate labels. Credits and outside effects ask first; undoable writes offer undo. */
type Labels<Key extends string = string> = {
  spendsCredits: boolean;
  outsideEffect: boolean;
  undoable: boolean;
  /** The argument the tool fills with its tool call's ID, so a retried call applies once. */
  retryKey?: Key;
};

/**
 * What reverses a change (#342), as an undoable action returns it under `undo`: the registered
 * action to run and the arguments to run it with. The same shape on every action, so a step
 * the assistant took can be undone without knowing which action made it. Left out when the
 * change changed nothing or can't be put back.
 */
export const reversedBy = <Path extends string, Args extends PropertyValidators>(path: Path, args: Args) => v.optional(reversal(path, args));
/** One way a change is reversed, for an action that has more than one: `v.optional(v.union(reversal(…), reversal(…)))`. */
export const reversal = <Path extends string, Args extends PropertyValidators>(path: Path, args: Args) =>
  v.object({ path: v.literal(path), args: v.object(args) });

/**
 * Whether one call asks the person first although its action as a whole doesn't: the call
 * would show outside the account, such as a change to a collection a library follows
 * (decision 12). The assistant reads it before it runs the call.
 */
type AsksFirst<Args extends PropertyValidators> = { asksFirst?(ctx: QueryCtx, userId: Id<"users">, args: ObjectType<Args>): Promise<boolean> };

/**
 * The most one call of an action that spends credits holds (#328): an upper estimate, read
 * before the call runs. The assistant asks the person with it, unless they allowed that much
 * in the chat. An action that spends credits and gives none can't be asked about, so the
 * assistant doesn't run it. Asked in a chat, it's told which, for an estimate that depends on the chat's model.
 */
type Estimates<Args extends PropertyValidators> = { estimate?(ctx: QueryCtx, userId: Id<"users">, args: ObjectType<Args>, chat?: { threadId: Id<"assistantThreads"> }): Promise<number> };

/**
 * What an action that calls an outside service refuses that can be read before the person is
 * asked about it, thrown as it would throw it: a change in a mutation is tried and undone
 * before it's asked about (convex/assistant/bulk.ts `tryChanges`), but an action can't be.
 * The assistant tells the model instead of asking, so a yes is never followed by a refusal.
 */
type Checks<Args extends PropertyValidators> = { check?(ctx: QueryCtx, userId: Id<"users">, args: ObjectType<Args>): Promise<void> };

/**
 * What of a call's arguments the person is shown when they're asked about it, for an action
 * whose arguments, one by one, don't read as what it does: a screening is its papers and its
 * questions to them, not the points each answer scores. IDs stay IDs here, and are shown by
 * the name of what they name (convex/assistant/details.ts).
 */
type Shows<Args extends PropertyValidators> = { shown?(args: ObjectType<Args>): Record<string, unknown> };

export type UserMutation<Args extends PropertyValidators, Returns extends GenericValidator> = Common<Args, Returns> &
  Labels<keyof Args & string> &
  AsksFirst<Args> &
  Estimates<Args> &
  Shows<Args> & {
    kind: "mutation";
    run: (ctx: MutationCtx, userId: Id<"users">, args: ObjectType<Args>, author: Author) => Promise<Infer<Returns>>;
  };

/**
 * What the assistant's side passes a change an action makes (`changes`): the step of the
 * reply the call is, and whether the person was asked about it and said yes. The action
 * hands both to the mutation that writes, which checks `asksFirst` again unless approved and
 * ends the step, in the write's own transaction, as a change that is a mutation does.
 */
export type ChangeCall = {
  stepId?: Id<"assistantSteps">;
  /** The step of the reply this call is, on any action: a job it starts keeps it, so its chat hears when the job ends (#328). */
  from?: Id<"assistantSteps">;
  approved: boolean;
  /** On a call that spends credits: the most the person let it hold, by a yes to its question or by what they allow in the chat (#328). */
  credits?: number;
};

/** A user action that calls an outside service (OpenAlex, an AI provider, Autumn), reading and writing through queries and mutations. */
export type UserActionEntry<Args extends PropertyValidators, Returns extends GenericValidator> = Common<Args, Returns> &
  Labels<keyof Args & string> &
  AsksFirst<Args> &
  Estimates<Args> &
  Checks<Args> &
  Shows<Args> & {
    kind: "action";
    /** It writes, after reading from outside: its write ends the step and rechecks approval (see ChangeCall). One without this only reads. */
    changes?: true;
    run: (ctx: ActionCtx, userId: Id<"users">, args: ObjectType<Args>, author: Author, call?: ChangeCall) => Promise<Infer<Returns>>;
  };

/** What the registry list and the assistant's tools read from an entry. */
export type UserAction =
  | { kind: "query"; path: string; description: string; args: PropertyValidators }
  | ({ kind: "mutation" | "action"; path: string; description: string; args: PropertyValidators; changes?: true } & Labels & AsksFirst<PropertyValidators> & Estimates<PropertyValidators> & Checks<PropertyValidators> & Shows<PropertyValidators>);

/** Entries are written with these so their argument and result types are inferred. */
export const defineUserQuery = <Args extends PropertyValidators, Returns extends GenericValidator>(
  entry: Omit<UserQuery<Args, Returns>, "kind">,
): UserQuery<Args, Returns> => ({ kind: "query", ...entry });
export const defineUserMutation = <Args extends PropertyValidators, Returns extends GenericValidator>(
  entry: Omit<UserMutation<Args, Returns>, "kind">,
): UserMutation<Args, Returns> => ({ kind: "mutation", ...entry });
export const defineUserAction = <Args extends PropertyValidators, Returns extends GenericValidator>(
  entry: Omit<UserActionEntry<Args, Returns>, "kind">,
): UserActionEntry<Args, Returns> => ({ kind: "action", ...entry });

/** The internal twin of a public function, which the assistant's tools call with the sender's user ID. */
export const assistantPath = (path: string) => `${path}ForAssistant`;

/** Marks a Convex function as built from the registry entry at `path`; the gate reads this at runtime. */
function tagged<Fn extends object>(fn: Fn, path: string): Fn {
  return Object.assign(fn, { userActionPath: path });
}

const accountArg = { accountId: v.string() };
const userArg = { userId: v.id("users") };
/** The workspace a call acts in (#650): every user action names it, and it's checked before the action runs. */
const workspaceArg = { workspaceId: v.id("workspaces") };
/**
 * What only the assistant's side passes a change: `stepId`, the step of the reply this call
 * is, which the change ends in its own transaction; `fromStep`, that step on an action that
 * doesn't end it; and `approved`, set when the person themselves asked for it, as when they
 * press Undo.
 */
const changeArgs = { ...userArg, ...workspaceArg, stepId: v.optional(v.id("assistantSteps")), fromStep: v.optional(v.id("assistantSteps")), approved: v.optional(v.boolean()), approvedCredits: v.optional(v.number()) };
/** What the assistant is told when a call asks the person first. */
export const ASKS_FIRST = "This needs the person's say first, and it can't be asked for here. Tell them what you would have done, so they can do it themselves.";

/** The workspace a call names, and the action's own arguments. */
function inWorkspace<Args extends PropertyValidators>(args: ObjectType<Args & typeof workspaceArg>) {
  const { workspaceId, ...rest } = args as unknown as ObjectType<typeof workspaceArg> & Record<string, unknown>;
  return { workspaceId, rest: rest as ObjectType<Args> };
}

/** The session's user, refusing when the session has changed account since the page loaded for `accountId`. */
async function accountUser(ctx: QueryCtx | MutationCtx, accountId: string) {
  const user = await requireAuth(ctx);
  if (user.clerkId !== accountId) throw new Error("Account changed. Retry after signing in.");
  return user;
}

/** The public query the UI calls, for the signed-in user. */
export function userQuery<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserQuery<Args, Returns>, options?: { signedOut: Infer<Returns> }) {
  return tagged(
    query<Args & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { workspaceId, rest } = inWorkspace<Args>(args);
        const user = options ? await getCurrentUser(ctx) : await requireAuth(ctx);
        if (!user) return options!.signedOut;
        await actorFor(ctx, user, workspaceId);
        return entry.run(ctx, user._id, rest);
      },
    }),
    entry.path,
  );
}

/**
 * The public query for pages that load for one account: it also takes that account's
 * Clerk ID, so a tab left open after switching account can't read the other one.
 */
export function accountQuery<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserQuery<Args, Returns>) {
  return tagged(
    query<Args & typeof accountArg & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...accountArg, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { accountId, workspaceId, ...rest } = args as unknown as ObjectType<typeof accountArg & typeof workspaceArg> & Record<string, unknown>;
        const user = await accountUser(ctx, accountId);
        await actorFor(ctx, user, workspaceId);
        return entry.run(ctx, user._id, rest as ObjectType<Args>);
      },
    }),
    entry.path,
  );
}

/** The same query for the assistant, run as the user who sent the message. */
export function assistantQuery<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserQuery<Args, Returns>) {
  return tagged(
    internalQuery<Args & typeof userArg & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...userArg, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { userId, workspaceId, ...rest } = args as unknown as ObjectType<typeof userArg & typeof workspaceArg> & Record<string, unknown>;
        // The sender may have been suspended or deleted since the turn began.
        const { userId: actingAs } = await actorFor(ctx, await requireActiveUser(ctx, userId), workspaceId);
        return entry.run(ctx, actingAs, rest as ObjectType<Args>);
      },
    }),
    entry.path,
  );
}

/** The public mutation the UI calls, for the signed-in user. */
export function userMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    mutation<Args & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { workspaceId, rest } = inWorkspace<Args>(args);
        const { userId } = await actorFor(ctx, await requireAuth(ctx), workspaceId);
        return entry.run(ctx, userId, rest, "user");
      },
    }),
    entry.path,
  );
}

/** The public mutation for pages that load for one account; see `accountQuery`. */
export function accountMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    mutation<Args & typeof accountArg & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...accountArg, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { accountId, workspaceId, ...rest } = args as unknown as ObjectType<typeof accountArg & typeof workspaceArg> & Record<string, unknown>;
        const { userId } = await actorFor(ctx, await accountUser(ctx, accountId), workspaceId);
        return entry.run(ctx, userId, rest as ObjectType<Args>, "user");
      },
    }),
    entry.path,
  );
}

/** The same mutation for the assistant: it runs as the sender and records the assistant as the author. */
export function assistantMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    internalMutation<Args & typeof changeArgs, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...changeArgs },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { userId, workspaceId, stepId, approved, approvedCredits: _held, ...own } = args as unknown as ObjectType<typeof changeArgs> & Record<string, unknown>;
        const rest = own as ObjectType<Args>;
        // The sender may have been suspended or deleted since the turn began.
        const { userId: actingAs } = await actorFor(ctx, await requireActiveUser(ctx, userId), workspaceId);
        // Read here, in the change's own transaction: what was true before the call may not be now.
        if (!approved && entry.asksFirst && (await entry.asksFirst(ctx, actingAs, rest))) throw createError("FORBIDDEN", ASKS_FIRST);
        const result = await entry.run(ctx, actingAs, rest, "assistant");
        // The step, and through it the model, is told a change that returns nothing was made.
        if (stepId) await endStep(ctx, stepId, result ?? DONE);
        return result;
      },
    }),
    entry.path,
  );
}

/** The public action the UI calls, for the signed-in user. */
export function userAction<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserActionEntry<Args, Returns>) {
  return tagged(
    action<Args & typeof workspaceArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...workspaceArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { workspaceId, rest } = inWorkspace<Args>(args);
        // Typed here: the generated API's types depend on every module built with this, so inference would loop.
        const actor: Actor = await ctx.runQuery(internal.workspaces.actor.signedInActor, { workspaceId });
        return entry.run(ctx, actor.userId, rest, "user");
      },
    }),
    entry.path,
  );
}

/** The same action for the assistant: it runs as the sender and records the assistant as the author. */
export function assistantAction<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserActionEntry<Args, Returns>) {
  return tagged(
    internalAction<Args & typeof changeArgs, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...changeArgs },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { userId, workspaceId, stepId, fromStep, approved, approvedCredits, ...own } = args as unknown as ObjectType<typeof changeArgs> & Record<string, unknown>;
        // The sender may have been suspended or deleted since the turn began.
        const actor: Actor = await ctx.runQuery(internal.workspaces.actor.activeActor, { userId, workspaceId });
        const from = stepId ?? fromStep;
        return entry.run(ctx, actor.userId, own as ObjectType<Args>, "assistant", { ...(stepId ? { stepId } : {}), ...(from ? { from } : {}), approved: approved === true, ...(approvedCredits === undefined ? {} : { credits: approvedCredits }) });
      },
    }),
    entry.path,
  );
}
