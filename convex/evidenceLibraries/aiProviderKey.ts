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
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { requireEvidenceLibraryAccess } from "./access";
import type { AiProviderKeySource } from "./validators";

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

/**
 * The stored key, still encrypted, for deploy-time assembly. It travels only
 * between the deploy mutation and the deploy action, never onto an operation.
 */
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
 * Gives the switched-on OpenRouter entry the stored key, and nothing else the
 * key. An entry that is on without a key stops the publish here, with the
 * pointer the page can link.
 */
export function createAiProviderKey(
  apiKey: string | undefined,
): ApplyAiProviderKey {
  return (providers) => {
    if (providers.length !== 1) {
      throw new ConfigurationAssemblyError([
        {
          pointer: "/ai/providers",
          section: "ai",
          keyword: "aiProvider",
          message: "This library saves exactly one AI provider, OpenRouter.",
        },
      ]);
    }
    return providers.map((provider, index) => {
      const refuse = (message: string) => {
        throw new ConfigurationAssemblyError([
          {
            pointer: `/ai/providers/${index}`,
            section: "ai",
            keyword: "aiProvider",
            message,
          },
        ]);
      };
      // Belt and braces: the caller checks the entry first, so reaching here
      // with anything but one OpenRouter entry means a caller skipped it.
      if (provider.provider !== AI_PROVIDER) {
        refuse("OpenRouter is the only AI provider this library can use.");
      }
      if (index > 0) {
        refuse("This library saves exactly one AI provider, OpenRouter.");
      }
      if (provider.enabled !== true) return { ...provider };
      if (!apiKey) refuse("AI answers need an OpenRouter key.");
      return { ...provider, apiKey };
    });
  };
}

export async function readAiProviderKeySource(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<AiProviderKeySource> {
  const credential = await findAiProviderCredential(ctx, libraryId);
  return credential
    ? {
        present: true,
        id: credential._id,
        digest: await digestOpaqueToken(credential.encryptedValue),
      }
    : { present: false };
}

export const AI_PROVIDER_KEY_BUSY_MESSAGE =
  "Wait for the current publish to finish, then change the AI key.";

/**
 * Refuses to move the key while the library is being set up or published.
 * The publish reads the key once and ships it minutes later, so the simplest
 * safe rule is that it cannot move underneath one.
 */
export async function requireNoRunningOperation(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
): Promise<void> {
  // Operations are read newest first. A library only ever has one in flight,
  // so twenty is far more than enough to find it.
  const running = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", libraryId),
    )
    .order("desc")
    .take(20);
  // A new library's setup operation is created queued and only starts once
  // the owner activates. Until it holds a revision it is waiting, not
  // running, so an owner can still add the key before the first setup.
  const inFlight = running.some(
    (operation) =>
      (operation.status === "queued" || operation.status === "running") &&
      !(operation.kind === "setup" && !operation.revisionId),
  );
  if (inFlight) {
    throw createError("CONFLICT", AI_PROVIDER_KEY_BUSY_MESSAGE);
  }
}

export const AI_PROVIDER_KEY_CHANGED_MESSAGE =
  "The AI key changed while the library was publishing. Publish again.";

/** Stops a publish that read a key which has since been replaced or removed. */
export async function requireUnchangedAiProviderKey(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  source: AiProviderKeySource,
): Promise<void> {
  const current = await readAiProviderKeySource(ctx, libraryId);
  const same =
    current.present === source.present &&
    (!current.present ||
      !source.present ||
      (current.id === source.id && current.digest === source.digest));
  if (!same) {
    throw createError("CONFLICT", AI_PROVIDER_KEY_CHANGED_MESSAGE);
  }
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
    await requireNoRunningOperation(ctx, args.libraryId);
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
