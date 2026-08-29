import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import extractionPaperWorkpool from "@convex-dev/workpool/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(rag);
app.use(workpool);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
app.use(extractionPaperWorkpool, { name: "extractionPaperWorkpool" });
app.use(agent);
// Tier B (plans/extraction-occ-fixes): per-job processed/failed paper
// counters live in a sharded counter instead of mutable fields on the
// extractionJobs row. Two named instances — `extractionProcessedCounter`
// and `extractionFailedCounter` — each keyed by jobId. The previous
// singleton-row patch in markPaperTerminalTx forced P-way OCC retries
// on every job whenever extraction fanned out per paper; routing the
// increments through shards eliminates the write-write contention so
// the queue/workpool path can run at bounded parallelism without
// hot-leaf collapse.
app.use(shardedCounter, { name: "extractionProcessedCounter" });
app.use(shardedCounter, { name: "extractionFailedCounter" });
// creditsAgg (plan-04): per-job credit-spend aggregate for O(log n) total
// cost queries. Namespace = jobId; sumValue = credits spent per entry
// (extraction_llm per-result + embedding per-paper). Cleared on cascade
// delete via admin.clearJobCredits.
app.use(aggregate, { name: "creditsAgg" });
// Screening progress aggregates (plan-02). Both are namespaced by jobId:
// - screeningResultStatusAgg: counts terminal result states by status
// - screeningQualifiedAgg: counts completed qualified results
app.use(aggregate, { name: "screeningResultStatusAgg" });
app.use(aggregate, { name: "screeningQualifiedAgg" });
// Three @convex-dev/aggregate instances back the billing-transactions
// faceted-count badges (plans/billing-transactions-perf/01). Each is
// namespaced by credits._id so users never OCC-contend with each other.
// Key carries [dimensionValue, createdAt] so date-range counts are O(log n)
// via compound bounds. Populated by recordTransactionCounters at every
// creditTransactions insert site; drained for reads by
// readTransactionFacetCounts in convex/credits/aggregates.ts.
app.use(aggregate, { name: "txnTypeAgg" });
app.use(aggregate, { name: "txnCreditPoolAgg" });
app.use(aggregate, { name: "txnBillingTypeAgg" });
// plans/balance-sharded-counter: append-only credit balance backed by
// two `@convex-dev/sharded-counter` instances (one per pool). The prior
// `balanceAgg` DirectAggregate read the lazy-root B+ tree on every
// balance lookup, walking ~48 component docs for ~4k-row ledgers and
// blowing the 16 MB / mutation budget on hot billing paths.
// ShardedCounter is O(shards) per pool (16 each) regardless of ledger
// depth. Keyed by `Id<"credits">`; total balance is derived (free + paid).
app.use(shardedCounter, { name: "balanceFreeCounter" });
app.use(shardedCounter, { name: "balancePaidCounter" });
app.use(migrations);

export default app;
