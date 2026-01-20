import { defineApp } from "convex/server";
import stripe from "@convex-dev/stripe/convex.config.js";
import rag from "@convex-dev/rag/convex.config";

const app = defineApp();
app.use(stripe);
app.use(rag);

export default app;
