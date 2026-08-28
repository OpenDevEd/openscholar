import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  type ApplyAiProviderKey,
} from "../../lib/evidence-libraries/configuration/ai";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";

/**
 * One row per library holds the OpenRouter key. The owner writes it through
 * `credentialActions.writeCredential`; it is only ever read again inside the
 * deploy action, and only to build the configuration the runtime receives.
 */

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;

async function findAiProviderCredential(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  return await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (query) =>
      query
        .eq("libraryId", libraryId)
        .eq("credentialKey", AI_PROVIDER_CREDENTIAL_KEY),
    )
    .unique();
}

/** The stored key, still encrypted, for deploy-time assembly. */
export async function readLibraryAiProviderKey(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<{ encryptedApiKey: string } | undefined> {
  const credential = await findAiProviderCredential(ctx, libraryId);
  return credential
    ? { encryptedApiKey: credential.encryptedValue }
    : undefined;
}

/**
 * Gives every switched-on provider entry the stored key. An entry that is on
 * without a key stops the publish here, with the pointer the page can link.
 */
export function createAiProviderKey(
  apiKey: string | undefined,
): ApplyAiProviderKey {
  return (providers) =>
    providers.map((provider, index) => {
      if (provider.enabled !== true) return { ...provider };
      if (!apiKey) {
        throw new ConfigurationAssemblyError([
          {
            pointer: `/ai/providers/${index}/apiKey`,
            section: "ai",
            keyword: "missingKey",
            message: "AI answers need a provider key.",
          },
        ]);
      }
      return { ...provider, apiKey };
    });
}

export const removeAiProviderKey = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    const credential = await findAiProviderCredential(ctx, args.libraryId);
    if (!credential) {
      throw createError("NOT_FOUND", "This library has no AI key stored");
    }
    await ctx.db.delete("evidenceLibraryCredentials", credential._id);
    await writeAuditLogRecord(ctx, {
      action: "evidence_library.ai_provider_key.removed",
      userId: access.clerkUserId,
      metadata: { libraryId: args.libraryId, provider: AI_PROVIDER },
    });
    return null;
  },
});
