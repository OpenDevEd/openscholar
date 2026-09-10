"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import { decrypt } from "../../lib/crypto";
import { createError } from "../../lib/errors";
import { requireRuntimeEnvironment } from "../runtimeActionConfig";

const resultSchema = z.discriminatedUnion("status", [
  z.object({status: z.literal("queued"), editionId: z.string().uuid(), publicationCount: z.number().int().positive()}),
  z.object({status: z.literal("empty")}),
  z.object({status: z.literal("disabled")}),
]);

export const send = action({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.union(
    v.object({status: v.literal("queued"), editionId: v.string(), publicationCount: v.number()}),
    v.object({status: v.literal("empty")}),
    v.object({status: v.literal("disabled")}),
  ),
  handler: async (ctx, args): Promise<z.infer<typeof resultSchema>> => {
    const target = await ctx.runQuery(internal.evidenceLibraries.digests.manual.target, args);
    const key = requireRuntimeEnvironment("ENCRYPTION_KEY", message => createError("INVALID_DATA", message));
    try {
      const response = await fetch(new URL("/api/v1/openscholar/digests", target.targetBaseUrl), {
        method: "POST",
        headers: {Authorization: `Bearer ${decrypt(target.encryptedMachineCredential, key)}`},
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Library returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return resultSchema.parse(await response.json());
    } catch (error) {
      console.error("Manual library digest request failed", {libraryId: args.libraryId, error});
      throw createError("EVIDENCE_LIBRARY_RUNTIME_ERROR", "The digest request could not be confirmed. Try again; existing editions will not be sent twice.");
    }
  },
});
