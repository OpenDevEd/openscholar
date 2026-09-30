/**
 * A sharded counter whose shard choice lasts one transaction. `ShardedCounter` remembers the
 * shard it picked for a key on the instance, and a module-level instance outlives the
 * transaction: two executions that picked the same shard then collide on every retry, and a
 * write fails for good. A load run lost 38 of 600 result writes that way (#351). Keyed by
 * the transaction's database, a write sticks to one shard within its transaction and picks
 * again on the next one, retries included.
 */
import { ShardedCounter } from "@convex-dev/sharded-counter";

type Ctx = { db: object; innerDb?: object };

export function transactionCounter<Key extends string>(make: () => ShardedCounter<Key>) {
  const counters = new WeakMap<object, ShardedCounter<Key>>();
  const shared = make();
  return {
    /** The counter to write with: one per transaction. Triggers pass the transaction's own database as `innerDb`. */
    for(ctx: Ctx) {
      const transaction = ctx.innerDb ?? ctx.db;
      let counter = counters.get(transaction);
      if (!counter) counters.set(transaction, (counter = make()));
      return counter;
    },
    /** For reads, which don't choose a shard. */
    read: shared,
  };
}
