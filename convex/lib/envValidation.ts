"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

export const REQUIRED_ENV_VARS = [
  "STRIPE_SECRET_KEY",
  "ENCRYPTION_KEY",
  "STRIPE_GO_PRICE_ID",
  "STRIPE_PRO_PRICE_ID",
  "STRIPE_WEBHOOK_SECRET",
  "CLERK_JWT_ISSUER_DOMAIN",
  "EVIDENCE_LIBRARY_PLATFORM_DOMAIN",
] as const;

export function validateRequiredEnvVars(): { missing: string[] } {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );
  return { missing: [...missing] };
}

export const checkRequiredEnvVars = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { missing } = validateRequiredEnvVars();

    if (missing.length > 0) {
      console.error(
        "[ENV_VALIDATION] Missing required env vars:",
        missing.join(", "),
      );
      await ctx.runMutation(internal.lib.audit.writeAuditLog, {
        action: "ENV_VALIDATION_FAILURE",
        metadata: { missing: missing.join(",") },
      });
    }

    return null;
  },
});
