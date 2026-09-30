import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import extractionPaperWorkpool from "@convex-dev/workpool/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import shardedCounter from "@convex-dev/sharded-counter/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";

const app = defineApp();
app.use(migrations);
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
// Per-job counts of extraction results by status and error code, kept by a trigger on
// extractionResults (convex/extraction/resultCounts.ts).
app.use(shardedCounter, { name: "extractionResultCounter" });
// creditsAgg: per-job credit totals (convex/extraction/aggregates.ts).
app.use(aggregate, { name: "creditsAgg" });
// Screening progress aggregates (plan-02). Both are namespaced by jobId:
// - screeningResultStatusAgg: counts terminal result states by status
// - screeningQualifiedAgg: counts completed qualified results
app.use(aggregate, { name: "screeningResultStatusAgg" });
app.use(aggregate, { name: "screeningQualifiedAgg" });
// usageAgg: each charge counted under its user and its job, newest last, so the
// billing page can page through charges with page numbers (convex/billing/usageLog.ts).
app.use(aggregate, { name: "usageAgg" });
export default app;
