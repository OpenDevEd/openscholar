import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(rag);
app.use(workflow);
app.use(workpool);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
app.use(agent);
// Three @convex-dev/aggregate instances back extractionJobStats (Task 11):
// - resultStatusAgg: per-(jobId, questionKey) counts by citationStatus
// - resultAnsweredAgg: per-(jobId, questionKey) counts by answered/unanswered
// - resultConfidenceAgg: per-(jobId, questionKey) sum/count + bucket counts
//   (key = confidence number; rows only exist when confidence is defined)
app.use(aggregate, { name: "resultStatusAgg" });
app.use(aggregate, { name: "resultAnsweredAgg" });
app.use(aggregate, { name: "resultConfidenceAgg" });
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

export default app;
