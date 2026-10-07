/**
 * Count writes a mutation queues once, when it ends (#633, #634). Triggers that keep an
 * aggregate push their writes here; the app's mutation builders (./functions.ts) and the
 * test wrapper flush them in one call per aggregate. Written in place, a save of a few
 * hundred rows passes the 4,096 index ranges one transaction may read; queued one by one,
 * each reads the aggregate queue's newest entry again, and a few hundred pass the 16 MiB.
 * The aggregate's batch worker applies them in order a moment later, so reads of these
 * counts are `stale`.
 *
 * This module holds no Convex functions, so the triggers can load it.
 */
import type { AggregateOperation, DirectAggregate } from "@convex-dev/aggregate";
import type { MutationCtx } from "../_generated/server";

type AnyAggregate = DirectAggregate<{ Namespace: string; Key: any; Id: string }>;
type Operation = AggregateOperation<any, string, string>;
export type CountQueue = Map<AnyAggregate, Operation[]>;
export type QueueingCtx = MutationCtx & { countQueue?: CountQueue };

/** Queues `operations` for `aggregate`; a write outside the app's builders, such as a test's uncapped seed, queues its own at once. */
export async function queueCounts(ctx: QueueingCtx, aggregate: AnyAggregate, operations: Operation[]) {
  if (operations.length === 0) return;
  if (!ctx.countQueue) return void (await aggregate.enqueueBatch(ctx, operations));
  ctx.countQueue.set(aggregate, [...(ctx.countQueue.get(aggregate) ?? []), ...operations]);
}

/** Queues every write gathered, one call per aggregate. */
export async function flushCountQueue(ctx: MutationCtx, queue: CountQueue) {
  for (const [aggregate, operations] of queue) await aggregate.enqueueBatch(ctx, operations);
  queue.clear();
}
