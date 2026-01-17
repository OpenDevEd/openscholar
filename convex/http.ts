import { httpRouter } from "convex/server";
import { workosWebhook } from "./webhooks/workos";
import { stripeWebhook } from "./webhooks/stripe";

const http = httpRouter();

// WorkOS webhook for user/org/membership sync
http.route({
  path: "/webhooks/workos",
  method: "POST",
  handler: workosWebhook,
});

// Stripe webhook for subscription/payment events
http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: stripeWebhook,
});

export default http;
