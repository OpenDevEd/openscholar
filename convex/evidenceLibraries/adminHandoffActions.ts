"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { sanitiseAdminReturnPath } from "../../lib/evidence-libraries/admin-handoff";
import type { AdminHandoffOutcome } from "./adminHandoff";

const ADMIN_LOGIN_CODE_TTL_MS = 5 * 60 * 1000;

export type AdminHandoffResponse =
  | { status: "allowed"; launchUrl: string }
  | { status: "no_access"; organisationName: string | null }
  | { status: "not_ready"; isOwner: boolean };

/**
 * The one call the admin page makes. It answers with the address that signs
 * the person into the library, or with the reason they cannot go there.
 */
export const issueAdminHandoff = action({
  args: {
    libraryId: v.string(),
    returnPath: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ status: v.literal("allowed"), launchUrl: v.string() }),
    v.object({
      status: v.literal("no_access"),
      organisationName: v.union(v.string(), v.null()),
    }),
    v.object({ status: v.literal("not_ready"), isOwner: v.boolean() }),
  ),
  handler: async (ctx, args): Promise<AdminHandoffResponse> => {
    const returnPath = sanitiseAdminReturnPath(args.returnPath);
    const code = generateOpaqueToken("elc_");
    const issuedAt = Date.now();
    const outcome: AdminHandoffOutcome = await ctx.runMutation(
      internal.evidenceLibraries.adminHandoff.issueHandoffCode,
      {
        libraryId: args.libraryId,
        codeDigest: await digestOpaqueToken(code),
        issuedAt,
        expiresAt: issuedAt + ADMIN_LOGIN_CODE_TTL_MS,
      },
    );
    if (outcome.status !== "allowed") return outcome;

    const launchUrl = new URL("/api/admin/session", outcome.targetBaseUrl);
    launchUrl.searchParams.set("code", code);
    launchUrl.searchParams.set("return", returnPath);
    return { status: "allowed", launchUrl: launchUrl.toString() };
  },
});
