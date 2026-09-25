import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  OPENALEX_API_CREDENTIAL_KEY,
  OPENALEX_API_KEY_INSTANCE,
} from "../../lib/evidence-libraries/configuration/sources";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { requireEvidenceLibraryAccess } from "./access";
import { requireNoRunningOperation } from "./aiProviderKey";
import type { LibraryCredentialSource } from "./validators";

type ReadCtx = Pick<QueryCtx | MutationCtx, "db">;

async function findOpenAlexCredential(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  return await ctx.db
    .query("evidenceLibraryCredentials")
    .withIndex("by_libraryId_and_credentialKey", (query) =>
      query
        .eq("libraryId", libraryId)
        .eq("credentialKey", OPENALEX_API_CREDENTIAL_KEY),
    )
    .unique();
}

export async function readOpenAlexKeySource(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<LibraryCredentialSource> {
  const credential = await findOpenAlexCredential(ctx, libraryId);
  return credential
    ? {
        present: true,
        id: credential._id,
        digest: await digestOpaqueToken(credential.encryptedValue),
      }
    : { present: false };
}

export async function readOpenAlexEncryptedKey(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<{ encryptedApiKey: string } | undefined> {
  const credential = await findOpenAlexCredential(ctx, libraryId);
  return credential
    ? { encryptedApiKey: credential.encryptedValue }
    : undefined;
}

export async function requireUnchangedOpenAlexKey(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  source: LibraryCredentialSource,
) {
  const current = await readOpenAlexKeySource(ctx, libraryId);
  const same =
    current.present === source.present &&
    (!current.present ||
      !source.present ||
      (current.id === source.id && current.digest === source.digest));
  if (!same) {
    throw createError(
      "CONFLICT",
      "The OpenAlex key changed while the library was publishing. Publish again.",
    );
  }
}

export const removeOpenAlexKey = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireEvidenceLibraryAccess(
      ctx,
      args.libraryId,
      "manage",
    );
    await requireNoRunningOperation(
      ctx,
      args.libraryId,
      "Wait for the current publish to finish, then change the OpenAlex key.",
    );
    const credential = await findOpenAlexCredential(ctx, args.libraryId);
    if (!credential) return null;
    if (credential.instanceKey !== OPENALEX_API_KEY_INSTANCE) {
      throw createError(
        "INVALID_DATA",
        "Stored OpenAlex credential is invalid",
      );
    }
    await ctx.db.delete("evidenceLibraryCredentials", credential._id);
    await writeAuditLogRecord(ctx, {
      action: "evidence_library.openalex_key.removed",
      userId: access.clerkUserId,
      metadata: { libraryId: args.libraryId },
    });
    return null;
  },
});
