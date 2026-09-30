/**
 * The action registry: every user action is defined once, as a core that takes the
 * acting user, and both the public function the UI calls and the assistant's tool
 * come from that one entry. `scripts/check-user-actions.ts` fails CI when a public
 * function is neither registered in `userActionRegistry.ts` nor exempt with a reason.
 * The assistant's tools are built from the same entries in `assistantTools.ts`, which
 * only actions import, so queries and mutations never bundle the AI SDK.
 */
import { v, type GenericValidator, type Infer, type ObjectType, type PropertyValidators } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./functions";
import type { Id } from "../_generated/dataModel";
import { requireActiveUser, requireAuth } from "./auth";

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

export type UserMutation<Args extends PropertyValidators, Returns extends GenericValidator> = Common<Args, Returns> & {
  kind: "mutation";
  /** Decision 12: three separate labels. Credits and outside effects ask first; undoable writes offer undo. */
  spendsCredits: boolean;
  outsideEffect: boolean;
  undoable: boolean;
  /** The argument the tool fills with its tool call's ID, so a retried call applies once. */
  retryKey?: keyof Args & string;
  run: (ctx: MutationCtx, userId: Id<"users">, args: ObjectType<Args>, author: Author) => Promise<Infer<Returns>>;
};

/** What the registry list and the assistant's tools read from an entry. */
export type UserAction =
  | { kind: "query"; path: string; description: string; args: PropertyValidators }
  | { kind: "mutation"; path: string; description: string; args: PropertyValidators; spendsCredits: boolean; outsideEffect: boolean; undoable: boolean; retryKey?: string };

/** Entries are written with these so their argument and result types are inferred. */
export const defineUserQuery = <Args extends PropertyValidators, Returns extends GenericValidator>(
  entry: Omit<UserQuery<Args, Returns>, "kind">,
): UserQuery<Args, Returns> => ({ kind: "query", ...entry });
export const defineUserMutation = <Args extends PropertyValidators, Returns extends GenericValidator>(
  entry: Omit<UserMutation<Args, Returns>, "kind">,
): UserMutation<Args, Returns> => ({ kind: "mutation", ...entry });

/** The internal twin of a public function, which the assistant's tools call with the sender's user ID. */
export const assistantPath = (path: string) => `${path}ForAssistant`;

/** Marks a Convex function as built from the registry entry at `path`; the gate reads this at runtime. */
function tagged<Fn extends object>(fn: Fn, path: string): Fn {
  return Object.assign(fn, { userActionPath: path });
}

const accountArg = { accountId: v.string() };
const userArg = { userId: v.id("users") };

/** The acting user and the action's own arguments, from an internal call. */
function asUser<Args extends PropertyValidators>(args: ObjectType<Args & typeof userArg>) {
  const { userId, ...rest } = args as unknown as ObjectType<typeof userArg> & Record<string, unknown>;
  return { userId, rest: rest as ObjectType<Args> };
}

/** The session's user, refusing when the session has changed account since the page loaded for `accountId`. */
async function accountUser(ctx: QueryCtx | MutationCtx, accountId: string) {
  const user = await requireAuth(ctx);
  if (user.clerkId !== accountId) throw new Error("Account changed. Retry after signing in.");
  return user._id;
}

function split<Args extends PropertyValidators>(args: ObjectType<Args & typeof accountArg>) {
  const { accountId, ...rest } = args as unknown as ObjectType<typeof accountArg> & Record<string, unknown>;
  return { accountId, rest: rest as ObjectType<Args> };
}

/** The public query the UI calls, for the signed-in user. */
export function userQuery<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserQuery<Args, Returns>) {
  return tagged(
    query<Args, Returns, Promise<Infer<Returns>>>({
      args: entry.args,
      returns: entry.returns,
      handler: async (ctx, args) => entry.run(ctx, (await requireAuth(ctx))._id, args as ObjectType<Args>),
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
    query<Args & typeof accountArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...accountArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { accountId, rest } = split<Args>(args);
        return entry.run(ctx, await accountUser(ctx, accountId), rest);
      },
    }),
    entry.path,
  );
}

/** The same query for the assistant, run as the user who sent the message. */
export function assistantQuery<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserQuery<Args, Returns>) {
  return tagged(
    internalQuery<Args & typeof userArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...userArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { userId, rest } = asUser<Args>(args);
        // The sender may have been suspended or deleted since the turn began.
        return entry.run(ctx, (await requireActiveUser(ctx, userId))._id, rest);
      },
    }),
    entry.path,
  );
}

/** The public mutation the UI calls, for the signed-in user. */
export function userMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    mutation<Args, Returns, Promise<Infer<Returns>>>({
      args: entry.args,
      returns: entry.returns,
      handler: async (ctx, args) => entry.run(ctx, (await requireAuth(ctx))._id, args as ObjectType<Args>, "user"),
    }),
    entry.path,
  );
}

/** The public mutation for pages that load for one account; see `accountQuery`. */
export function accountMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    mutation<Args & typeof accountArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...accountArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { accountId, rest } = split<Args>(args);
        return entry.run(ctx, await accountUser(ctx, accountId), rest, "user");
      },
    }),
    entry.path,
  );
}

/** The same mutation for the assistant: it runs as the sender and records the assistant as the author. */
export function assistantMutation<Args extends PropertyValidators, Returns extends GenericValidator>(entry: UserMutation<Args, Returns>) {
  return tagged(
    internalMutation<Args & typeof userArg, Returns, Promise<Infer<Returns>>>({
      args: { ...entry.args, ...userArg },
      returns: entry.returns,
      handler: async (ctx, args) => {
        const { userId, rest } = asUser<Args>(args);
        // The sender may have been suspended or deleted since the turn began.
        return entry.run(ctx, (await requireActiveUser(ctx, userId))._id, rest, "assistant");
      },
    }),
    entry.path,
  );
}

