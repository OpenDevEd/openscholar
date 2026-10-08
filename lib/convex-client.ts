import { ConvexReactClient, type Watch, type WatchQueryOptions } from "convex/react";
import { getFunctionName, type ArgsAndOptions, type FunctionReference, type FunctionReference_future, type FunctionReturnType, type OptionalRestArgs } from "convex/server";
import { ConvexError, convexToJson } from "convex/values";

/** How long to wait before each new run of a query the backend timed out; past the last, the failure reaches the page. */
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
/**
 * The backend's own time limits (convex-backend `crates/isolate`). It reports them on their
 * own line; an error the function threw reads "Uncaught Error: …" instead.
 */
const TIMED_OUT = /(?:^|\n|\] )(?:Function execution timed out|Your request timed out performing too many system operations)/;

type Subscription = { open: () => () => void; stop: () => void };
/** One query, by name and arguments: everyone subscribed to it, and its retries. */
type Query = {
  subscriptions: Set<Subscription>;
  /** Runs in a row the backend timed out. */
  failures: number;
  /** The latest timeout is counted in `failures`; the next one comes from a new run. */
  counted: boolean;
  timer?: ReturnType<typeof setTimeout>;
  last?: unknown;
};

const timedOut = (error: unknown) => error instanceof Error && !(error instanceof ConvexError) && TIMED_OUT.test(error.message);
const keyOf = (query: FunctionReference<"query"> | FunctionReference_future<"query">, args: unknown) => JSON.stringify([getFunctionName(query), convexToJson((args ?? {}) as never)]);

/**
 * A Convex client that runs a query again when the backend timed out running it, as a busy
 * host makes it do, instead of handing the failure to the page. Until a run succeeds, the
 * query reads as its last result, or as loading if it never had one, and its subscribers
 * hear nothing. The backend runs a query again only once every subscriber has dropped it and
 * one subscribes anew, so a retry drops and reopens all of them together.
 *
 * ponytail: every hook in convex 1.46 subscribes through `watchQuery`. `watchPaginatedQuery`
 * (`usePaginatedQuery_experimental`) isn't covered; cover it when Convex moves
 * `usePaginatedQuery` onto it or the app uses it.
 */
export class RetryingConvexClient extends ConvexReactClient {
  private readonly queries = new Map<string, Query>();

  override watchQuery<Q extends FunctionReference<"query"> | FunctionReference_future<"query">>(
    query: Q,
    ...argsAndOptions: ArgsAndOptions<Q, WatchQueryOptions>
  ): Watch<FunctionReturnType<Q>> {
    const watch = super.watchQuery(query, ...argsAndOptions);
    const key = keyOf(query, argsAndOptions[0]);
    return {
      ...watch,
      onUpdate: (callback) => {
        let entry = this.queries.get(key);
        if (!entry) this.queries.set(key, (entry = { subscriptions: new Set(), failures: 0, counted: false }));
        const tracked = entry;
        const subscription: Subscription = {
          open: () => watch.onUpdate(() => {
            if (this.observe(tracked, watch)) callback();
          }),
          stop: () => {},
        };
        subscription.stop = subscription.open();
        tracked.subscriptions.add(subscription);
        return () => {
          subscription.stop();
          tracked.subscriptions.delete(subscription);
          if (tracked.subscriptions.size > 0) return;
          clearTimeout(tracked.timer);
          if (this.queries.get(key) === tracked) this.queries.delete(key);
        };
      },
      localQueryResult: () => {
        const entry = this.queries.get(key);
        try {
          const value = watch.localQueryResult();
          return value === undefined && entry !== undefined && entry.failures > 0 ? (entry.last as FunctionReturnType<Q>) : value;
        } catch (error) {
          if (!timedOut(error)) throw error;
          // Convex keeps a failed run until the backend's next message. With no one subscribed,
          // that run is over, and subscribing runs the query anew.
          if (entry === undefined) return undefined;
          if (entry.failures <= RETRY_DELAYS_MS.length) return entry.last as FunctionReturnType<Q> | undefined;
          throw error;
        }
      },
    };
  }

  /** A one-shot read waits out a retry for the run that answers, never taking the result it replaces. */
  override query<Q extends FunctionReference<"query"> | FunctionReference_future<"query">>(query: Q, ...args: OptionalRestArgs<Q>): Promise<FunctionReturnType<Q>> {
    const entry = this.queries.get(keyOf(query, args[0]));
    if (entry === undefined || entry.failures === 0 || entry.failures > RETRY_DELAYS_MS.length) return super.query(query, ...args);
    const watch = this.watchQuery(query, ...(args as unknown as ArgsAndOptions<Q, WatchQueryOptions>));
    return new Promise((resolve, reject) => {
      const stop = watch.onUpdate(() => {
        stop();
        try {
          resolve(watch.localQueryResult() as FunctionReturnType<Q>);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  override setAuth(...args: Parameters<ConvexReactClient["setAuth"]>) {
    this.forgetResults();
    super.setAuth(...args);
  }

  override clearAuth() {
    this.forgetResults();
    super.clearAuth();
  }

  override async close() {
    for (const entry of this.queries.values()) clearTimeout(entry.timer);
    this.queries.clear();
    await super.close();
  }

  /** A result read as one identity never stands in for another's while a retry runs. */
  private forgetResults() {
    for (const entry of this.queries.values()) entry.last = undefined;
  }

  /** Follows the query's latest run; returns whether its subscribers should hear about it. */
  private observe(entry: Query, watch: Watch<unknown>) {
    let value: unknown;
    try {
      value = watch.localQueryResult();
    } catch (error) {
      if (!timedOut(error)) {
        this.settle(entry);
        return true;
      }
      if (!entry.counted) {
        entry.counted = true;
        entry.failures += 1;
        if (entry.failures <= RETRY_DELAYS_MS.length) entry.timer = setTimeout(() => this.rerun(entry), RETRY_DELAYS_MS[entry.failures - 1]);
      }
      return entry.failures > RETRY_DELAYS_MS.length;
    }
    // A run on its way after a timeout changes nothing the page shows.
    if (value === undefined) return entry.failures === 0;
    this.settle(entry);
    entry.last = value;
    return true;
  }

  /** The query has an answer, or an error of its own: no retry is waiting. */
  private settle(entry: Query) {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.failures = 0;
    entry.counted = false;
  }

  private rerun(entry: Query) {
    entry.timer = undefined;
    entry.counted = false;
    // Every subscriber drops it before any opens it again, or the backend keeps the failed run.
    for (const subscription of entry.subscriptions) subscription.stop();
    for (const subscription of entry.subscriptions) subscription.stop = subscription.open();
  }
}
