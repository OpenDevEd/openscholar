import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import workflow from "@convex-dev/workflow/convex.config.js";
import screeningWorkpool from "@convex-dev/workpool/convex.config.js";
import extractionWorkpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(stripe);
app.use(workflow);
app.use(screeningWorkpool, { name: "screeningWorkpool" });
app.use(extractionWorkpool, { name: "extractionWorkpool" });

export default app;
