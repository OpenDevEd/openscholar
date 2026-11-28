import { defineApp } from "convex/server";
import rag from "@convex-dev/rag/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import extractionPaperWorkpool from "@convex-dev/workpool/convex.config.js";
import aggregate from "@convex-dev/aggregate/convex.config.js";
import agent from "@convex-dev/agent/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import batchWorker from "@convex-dev/batch-worker/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";

const app = defineApp();
app.use(migrations);
app.use(rag);
app.use(workpool);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
app.use(extractionPaperWorkpool, { name: "extractionPaperWorkpool" });
app.use(agent);
// creditsAgg: per-job credit totals (convex/extraction/aggregates.ts).
app.use(aggregate, { name: "creditsAgg" });
// usageAgg: each charge counted under its user and its job, newest last, so the
// billing page can page through charges with page numbers (convex/billing/usageLog.ts).
app.use(aggregate, { name: "usageAgg" });
// listCounts: how many rows each paged list holds, a namespace per list (convex/lib/listCounts.ts).
app.use(aggregate, { name: "listCounts" });
// libraryFacetCounts: each library's and collection's papers by rating, year and saved date (convex/library/facets.ts).
app.use(aggregate, { name: "libraryFacetCounts" });
// extractionFacetCounts: each extraction job's papers by confidence, status tags and answers (convex/extraction/facets.ts).
app.use(aggregate, { name: "extractionFacetCounts" });
// screeningFacetCounts: a screening's papers by source, check and reason, and each reviewer's papers by how they stand on them (convex/screening/facets.ts).
app.use(aggregate, { name: "screeningFacetCounts" });
// Queues whose one worker each does shared bookkeeping in batches, so parallel work only
// writes its own rows: Screen all's results (convex/screening/bookkeeping.ts) and the
// usage ledger (convex/billing/ledger.ts).
app.use(batchWorker);
// Who has a chat or any other item open (convex/presence.ts).
app.use(presence);
export default app;
