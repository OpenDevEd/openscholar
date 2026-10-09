/// <reference types="vite/client" />
/**
 * `convex-test` as the app runs: with Convex's transaction limits on (16 MiB read and
 * written, 32,000 documents scanned, 4,096 index ranges, 16,000 documents written), so a
 * query that fails at full size in production fails in its test too, and with every
 * aggregate from convex/convex.config.ts registered, since a database trigger may write to
 * them from any mutation, and the migrations component. Writes in `t.run` go through the same
 * database triggers as the app's mutations (convex/lib/triggers.ts), so rows a test seeds
 * are counted as rows the app writes. vitest.config.ts aliases `convex-test` to this file;
 * tests import `convex-test` as usual. A test that needs other limits passes
 * `transactionLimits` itself.
 *
 * A function that takes a workspace acts in it (#650). A call that names none acts in the caller's own,
 * as a page does: an identity's, or an assistant twin's `userId`'s. Signed out, it names one
 * that doesn't exist, so the action refuses as it would anyone signed out. A test about
 * another workspace names it. An account a test seeds through `t.run` gets its own workspace
 * with it, as every account the app makes does, and a record seeded there for an account,
 * naming no workspace, is in that account's own and made by it, as the app writes one.
 * `runUncapped` and `runUntriggered` fill in neither, for seeding records from before.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getFunctionName, type DataModelFromSchemaDefinition, type FunctionReference, type FunctionReturnType, type GenericActionCtx, type GenericDataModel, type GenericMutationCtx, type GenericQueryCtx, type GenericSchema, type OptionalRestArgs, type SchemaDefinition, type UserIdentity } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerBatchWorker } from "@convex-dev/batch-worker/test";
import { register as registerMigrations } from "@convex-dev/migrations/test";
import { convexTest as baseConvexTest, type TestConvexForDataModel as BaseForDataModel, type TestConvexRoot as BaseRoot } from "convex-test/dist/index.js";
import { capWrites } from "../convex/lib/capWrites";
import { triggers } from "../convex/lib/triggers";
import { flushCountQueue, type CountQueue } from "../convex/lib/countQueue";
import type { Id } from "../convex/_generated/dataModel";
import { ensureWorkspace } from "../convex/workspaces/create";

export * from "convex-test/dist/index.js";

type Schema = SchemaDefinition<any, boolean>;
type Modules = Record<string, () => Promise<any>>;
type Options = Parameters<typeof baseConvexTest>[0] & object;

const isOptions = (value: unknown): value is Options =>
  typeof value === "object" && value !== null && !("tables" in value);

/** The aggregate instances the app uses, as `app.use` names them. */
const config = readFileSync(path.resolve(__dirname, "../convex/convex.config.ts"), "utf8");
const aggregates = [...config.matchAll(/app\.use\(aggregate, \{ name: "(\w+)" \}\)/g)].map(([, name]) => name);

type Kind = "query" | "mutation" | "action";
/** A function's arguments with its workspace optional: the caller's own unless named. */
type Scoped<Args> = Args extends { workspaceId: Id<"workspaces"> } ? Omit<Args, "workspaceId"> & { workspaceId?: Id<"workspaces"> } : Args;
type CtxOf<DataModel extends GenericDataModel, K extends Kind> = K extends "query" ? GenericQueryCtx<DataModel> : K extends "mutation" ? GenericMutationCtx<DataModel> : GenericActionCtx<DataModel>;
type Call<DataModel extends GenericDataModel, K extends Kind> = <Fn extends FunctionReference<K, any> | ((ctx: CtxOf<DataModel, K>) => Promise<any>)>(
  fn: Fn,
  ...args: Fn extends FunctionReference<K, any> ? OptionalRestArgs<FunctionReference<K, "public", Scoped<Fn["_args"]>>> : []
) => Promise<Fn extends FunctionReference<K, any> ? FunctionReturnType<Fn> : Fn extends (ctx: any) => Promise<infer Output> ? Output : never>;
/** `convex-test`'s backend `T`, whose calls act in the caller's own workspace unless they name one. */
type InWorkspaces<T, DataModel extends GenericDataModel> = Omit<T, Kind | "withIdentity"> & {
  query: Call<DataModel, "query">;
  mutation: Call<DataModel, "mutation">;
  action: Call<DataModel, "action">;
  withIdentity(identity: Partial<UserIdentity>): TestConvexForDataModel<DataModel>;
};
export type TestConvexForDataModel<DataModel extends GenericDataModel> = InWorkspaces<BaseForDataModel<DataModel>, DataModel>;
export type TestConvexRoot<DataModel extends GenericDataModel> = InWorkspaces<BaseRoot<DataModel>, DataModel>;
export type TestConvex<SchemaDef extends SchemaDefinition<any, boolean>> = TestConvexRoot<DataModelFromSchemaDefinition<SchemaDef>>;

export function convexTest<S extends GenericSchema>(schema?: SchemaDefinition<S, boolean>, modules?: Modules): TestConvex<SchemaDefinition<S, boolean>>;
export function convexTest<S extends GenericSchema>(options: Options & { schema?: SchemaDefinition<S, boolean> }): TestConvex<SchemaDefinition<S, boolean>>;
export function convexTest(schemaOrOptions?: Schema | Options, modules?: Modules) {
  const options: Options = isOptions(schemaOrOptions) ? schemaOrOptions : { schema: schemaOrOptions, modules };
  const t = baseConvexTest({ ...options, transactionLimits: options.transactionLimits ?? true } as never) as ReturnType<typeof baseConvexTest>;
  for (const name of aggregates) {
    registerAggregate(t as never, name);
    // The aggregate applies queued writes (`{ async: true }`) with its own batch worker.
    registerBatchWorker(t as never, `${name}/batchWorker`);
  }
  if (/app\.use\(migrations\)/.test(config)) registerMigrations(t as never);
  if (/app\.use\(batchWorker\)/.test(config)) registerBatchWorker(t as never, "batchWorker");
  return inOwnWorkspaces(withTriggersInRun(t));
}

/**
 * Records in a workspace (#650), each with whether it also names who made it: the tables whose
 * reads have moved to the workspace. A later slice adds its own.
 */
const IN_WORKSPACE: Record<string, { createdBy: boolean; by?: string; organization?: true }> = {
  searches: { createdBy: true },
  queryShortcuts: { createdBy: true },
  libraryItems: { createdBy: true },
  collections: { createdBy: true },
  libraryRemovals: { createdBy: false },
  libraryCounts: { createdBy: false },
  collectionCounts: { createdBy: false },
  screeningJobs: { createdBy: true },
  extractionJobs: { createdBy: true },
  screenings: { createdBy: false },
  screeningSlots: { createdBy: false },
  extractionPaperQueue: { createdBy: false },
  recordCounts: { createdBy: false },
  assistantThreads: { createdBy: true, by: "ownerId" },
  assistantSpenders: { createdBy: false },
  authorProfiles: { createdBy: true, by: "ownerId" },
  // An organization's: in its workspace.
  evidenceLibraries: { createdBy: false, organization: true },
  billingAccounts: { createdBy: false },
  billingUsage: { createdBy: false },
  billingHolds: { createdBy: false },
};

/**
 * `db`, inserting each account and organization with its own workspace, as
 * `createUserWithDefaults` and the Clerk webhook do, and, with `owned`, a record that names no
 * workspace in its account's or organization's, made by that account.
 */
function withOwnWorkspaces<Db extends { insert: (table: any, value: any) => Promise<any> }>(db: Db, owned = true): Db {
  const insert = db.insert.bind(db);
  const own = (userId: Id<"users">) => ensureWorkspace({ db } as never, { kind: "personal", userId });
  return Object.assign(Object.create(db), {
    insert: async (table: string, value: Record<string, unknown>) => {
      const kind = owned ? IN_WORKSPACE[table] : undefined;
      const userId = value[kind?.by ?? "userId"] as Id<"users"> | undefined;
      const organizationId = kind?.organization ? (value.organizationId as Id<"organizations"> | undefined) : undefined;
      const filled = kind && organizationId && value.workspaceId === undefined
        ? { ...value, workspaceId: await ensureWorkspace({ db } as never, { kind: "organization", organizationId }) }
        : kind && userId && value.workspaceId === undefined
          ? { ...value, workspaceId: await own(userId), ...(kind.createdBy && value.createdBy === undefined ? { createdBy: userId } : {}) }
          : value;
      const id = await insert(table, filled);
      if (table === "users") await own(id);
      // The Clerk webhook makes an organization's workspace with it (convex/webhooks/projections.ts).
      if (table === "organizations") await ensureWorkspace({ db } as never, { kind: "organization", organizationId: id });
      return id;
    },
  }) as Db;
}

/** The app's Convex modules, loaded when a call first needs one. */
const convexModules = import.meta.glob<Record<string, { exportArgs?: () => string }>>(["../convex/**/*.ts", "!../convex/**/*.test.ts", "!../convex/_generated/**"]);
/** Whether function `path` takes the workspace it acts in, by its own argument validator; read once per function. */
const takesWorkspace = new Map<string, Promise<boolean>>();
function inWorkspace(path: string) {
  let found = takesWorkspace.get(path);
  if (!found) {
    const [file, name = "default"] = path.split(":");
    const load = convexModules[`../convex/${file}.ts`];
    found = load
      ? load().then((module) => {
          const args = module[name]?.exportArgs?.();
          return args ? "workspaceId" in (JSON.parse(args).value ?? {}) : false;
        })
      : Promise.resolve(false);
    takesWorkspace.set(path, found);
  }
  return found;
}

type Caller = Runner & Record<Kind, (fn: any, args?: Record<string, unknown>) => Promise<any>>;

/** Gives each user action call the caller's own workspace when it names none (see the top of this file). */
function inOwnWorkspaces<T extends Runner>(target: T, identity?: Partial<UserIdentity>, root: Runner = target): T {
  const caller = target as unknown as Caller;
  const own = async (userId: Id<"users">) => (root as Required<Runner>).runUntriggered((ctx) => ensureWorkspace(ctx, { kind: "personal", userId }));
  let nowhere: Promise<Id<"workspaces">> | undefined;
  /** A workspace no one is in, for a call signed out. */
  const none = () => (nowhere ??= (root as Required<Runner>).runUntriggered(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: "nobody", email: "nobody@example.test", state: "deleted", createdAt: 0, updatedAt: 0 });
    const id = await ctx.db.insert("workspaces", { kind: "personal", userId });
    await ctx.db.delete("workspaces", id);
    await ctx.db.delete("users", userId);
    return id;
  }));
  const workspaceFor = async (args: Record<string, unknown>) => {
    if (typeof args.userId === "string") return own(args.userId as Id<"users">);
    const subject = identity?.subject;
    const user = subject ? await root.run((ctx) => ctx.db.query("users").withIndex("by_clerk_id", (q: any) => q.eq("clerkId", subject)).unique()) : null;
    return user ? own(user._id) : none();
  };
  for (const kind of ["query", "mutation", "action"] as const) {
    const call = caller[kind].bind(target);
    caller[kind] = async (fn: any, args: Record<string, unknown> = {}) =>
      typeof fn !== "function" && args.workspaceId === undefined && (await inWorkspace(getFunctionName(fn))) ? call(fn, { ...args, workspaceId: await workspaceFor(args) }) : call(fn, args);
  }
  const withIdentity = target.withIdentity.bind(target);
  target.withIdentity = (next) => inOwnWorkspaces(withIdentity(next), next, root);
  return target;
}

/**
 * Runs `fn` like `t.run`, without the list caps (convex/lib/capWrites.ts): for seeding rows
 * saved before their cap existed, such as a legacy search's history arrays.
 */
export function runUncapped<T extends { run: (fn: (ctx: any) => Promise<any>) => Promise<any> }, R>(
  t: T,
  fn: (ctx: Parameters<Parameters<T["run"]>[0]>[0]) => Promise<R>,
): Promise<R> {
  return (t as unknown as Runner).runUncapped!(fn) as Promise<R>;
}

/**
 * Runs `fn` like `t.run`, without the database triggers or the list caps: for seeding rows
 * as they were before a trigger kept something on them, such as a job without its sort name.
 */
export function runUntriggered<T extends { run: (fn: (ctx: any) => Promise<any>) => Promise<any> }, R>(
  t: T,
  fn: (ctx: Parameters<Parameters<T["run"]>[0]>[0]) => Promise<R>,
): Promise<R> {
  return (t as unknown as Runner).runUntriggered!(fn) as Promise<R>;
}

type Runner = {
  run: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  withIdentity: (identity: any) => Runner;
  /** Like `run`, without the list caps: for seeding rows saved before their cap existed. */
  runUncapped?: (fn: (ctx: any) => Promise<any>) => Promise<any>;
  /** Like `run`, without the triggers or the caps. */
  runUntriggered?: (fn: (ctx: any) => Promise<any>) => Promise<any>;
};

/**
 * Runs `t.run` callbacks, including under `withIdentity`, with the app's writes: the database
 * triggers over the list caps (convex/lib/capWrites.ts). `t.runUncapped` skips the caps.
 */
function withTriggersInRun<T extends Runner>(target: T): T {
  const run = target.run.bind(target);
  const withIdentity = target.withIdentity.bind(target);
  target.run = (fn) =>
    run(async (ctx) => {
      const countQueue: CountQueue = new Map();
      const result = await fn(triggers.wrapDB({ ...ctx, db: withOwnWorkspaces(capWrites(ctx.db)), countQueue }));
      await flushCountQueue(ctx, countQueue);
      return result;
    });
  target.runUncapped = (fn) => run((ctx) => fn(triggers.wrapDB({ ...ctx, db: withOwnWorkspaces(ctx.db, false) })));
  target.runUntriggered = run;
  target.withIdentity = (identity) => withTriggersInRun(withIdentity(identity));
  return target;
}
