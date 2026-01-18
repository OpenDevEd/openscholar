import { components } from "./_generated/api";
import { StripeSubscriptions } from "@convex-dev/stripe";

export const stripeClient = new StripeSubscriptions(components.stripe, {});
