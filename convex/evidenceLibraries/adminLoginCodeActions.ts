"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { generateOpaqueToken } from "../lib/opaqueToken";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";

const ADMIN_LOGIN_CODE_TTL_MS = 5 * 60 * 1000;

export const issueAdminLoginCode = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    code: v.string(),
    expiresAt: v.number(),
  }),
  handler: async (ctx, args): Promise<{ code: string; expiresAt: number }> => {
    const code = generateOpaqueToken("elc_");
    const issuedAt = Date.now();
    const stored: {
      codeId: Id<"evidenceLibraryAdminLoginCodes">;
      expiresAt: number;
      role: "owner" | "editor";
    } = await ctx.runMutation(
      internal.evidenceLibraries.adminLoginCodes.storeIssuedCode,
      {
        libraryId: args.libraryId,
        codeDigest: await digestOpaqueToken(code),
        issuedAt,
        expiresAt: issuedAt + ADMIN_LOGIN_CODE_TTL_MS,
      },
    );
    return { code, expiresAt: stored.expiresAt };
  },
});
