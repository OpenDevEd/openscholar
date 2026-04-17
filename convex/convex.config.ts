import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import rag from "@convex-dev/rag/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(rag);
app.use(workflow);
app.use(workpool);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
// Three @convex-dev/aggregate instances back extractionJobStats (Task 11):
// - resultStatusAgg: per-(jobId, questionKey) counts by citationStatus
// - resultAnsweredAgg: per-(jobId, questionKey) counts by answered/unanswered
// - resultConfidenceAgg: per-(jobId, questionKey) sum/count + bucket counts
//   (key = confidence number; rows only exist when confidence is defined)
app.use(aggregate, { name: "resultStatusAgg" });
app.use(aggregate, { name: "resultAnsweredAgg" });
app.use(aggregate, { name: "resultConfidenceAgg" });

export default app;
