import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../lib/functions";
import {
  AI_PROVIDER,
  AI_PROVIDER_CREDENTIAL_KEY,
  type ApplyAiProviderKey,
} from "../../lib/evidence-libraries/configuration/ai";
import { ConfigurationAssemblyError } from "../../lib/evidence-libraries/configuration/assembly";
import { writeAuditLogRecord } from "../lib/audit";
import { createError } from "../lib/errors";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import {
  isDeploymentLeaseHeld,
  isSetupLeaseHeld,
} from "./operationLeases";
import { readActiveOperations } from "./operations";
import { requireEvidenceLibraryAccess } from "./access";
import type { LibraryCredentialSource } from "./validators";

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
): Promise<LibraryCredentialSource> {
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
 * Refuses to move the key while a setup or a publish is actually working.
 * Those two read the key once and ship it minutes later, so it must not move
 * underneath them.
 *
 * Only a `running` operation of those two kinds counts, and only while its
 * lease is live. Queued work has not read the key yet, other kinds never
 * read it, and an attempt whose lease ran out has stalled: the setup and
 * deployment pipelines reclaim such an attempt and read the key again
 * (`setupOperation.ts` and `configurationDeployment.ts` both refuse to claim
 * only while the lease is live). Without those limits a queued `validate`,
 * which nothing ever starts, would lock the key away for good.
 */
export async function requireNoRunningOperation(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  message = AI_PROVIDER_KEY_BUSY_MESSAGE,
): Promise<void> {
  const now = Date.now();
  // The same rules the two pipelines use to decide whether an attempt may
  // be reclaimed, so this guard can never disagree with them.
  const [setups, publishes] = await Promise.all([
    readActiveOperations(ctx, libraryId, "running", "setup"),
    readActiveOperations(ctx, libraryId, "running", "publish"),
  ]);
  if (
    setups.some((operation) => isSetupLeaseHeld(operation, now)) ||
    publishes.some((operation) => isDeploymentLeaseHeld(operation, now))
  ) {
    throw createError("CONFLICT", message);
  }
}

export const AI_PROVIDER_KEY_CHANGED_MESSAGE =
  "The AI key changed while the library was publishing. Publish again.";

/** Stops a publish that read a key which has since been replaced or removed. */
export async function requireUnchangedAiProviderKey(
  ctx: ReadCtx,
  libraryId: Id<"evidenceLibraries">,
  source: LibraryCredentialSource,
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
