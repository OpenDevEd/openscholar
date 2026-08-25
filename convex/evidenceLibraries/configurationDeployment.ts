import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { validateEssentialConfiguration } from "../../lib/evidence-libraries/configuration/essential-configuration";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";
import { LIBRARY_SERVICE_CREDENTIAL_KEY } from "./credentials";
import { sanitizeOperationError, validateOperationReceipt } from "./operations";
import {
  AUTHENTICATION_SECRET_PATH,
  DATABASE_URL_PATH,
  SEARCH_KEY_PATH,
  STORAGE_SERVICE_KEY_PATH,
} from "./runtimeCredentials";
import {
  essentialConfigurationSectionsValidator,
  evidenceLibraryOperationErrorInputValidator,
} from "./validators";

const CONFIGURATION_DEPLOYMENT_POLL_DELAY_MS = 5_000;
const MAX_CONFIGURATION_DEPLOYMENT_POLLS = 120;

type CurrentDeployment = {
  library: Doc<"evidenceLibraries">;
  operation: Doc<"evidenceLibraryConfigOperations">;
  revision: Doc<"evidenceLibraryConfigRevisions">;
  runtimeBinding: Extract<
    Doc<"evidenceLibraryRuntimeBindings">,
    { state: "ready" }
  >;
};

function isReadyRuntimeBinding(
  binding: Doc<"evidenceLibraryRuntimeBindings">,
): binding is Extract<
  Doc<"evidenceLibraryRuntimeBindings">,
  { state: "ready" }
> {
  return binding.state === "ready" && "targetRuntimeId" in binding;
}

async function readConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
): Promise<CurrentDeployment> {
  const [library, operation] = await Promise.all([
    ctx.db.get(args.libraryId),
    ctx.db.get(args.operationId),
  ]);
  if (!library || library.state !== "active") {
    throw createError("CONFLICT", "Evidence Library is not active");
  }
  if (
    !operation ||
    operation.libraryId !== args.libraryId ||
    operation.kind !== "publish" ||
    !operation.revisionId
  ) {
    throw createError(
      "NOT_FOUND",
      "Evidence Library configuration deployment not found",
    );
  }
  const [revision, runtimeBinding] = await Promise.all([
    ctx.db.get(operation.revisionId),
    library.runtimeBindingId
      ? ctx.db.get(library.runtimeBindingId)
      : Promise.resolve(null),
  ]);
  if (!revision || revision.libraryId !== args.libraryId) {
    throw createError("INVALID_DATA", "Evidence Library revision not found");
  }
  if (library.latestRevisionId !== revision._id) {
    throw createError(
      "CONFLICT",
      "A newer Evidence Library configuration revision is available",
    );
  }
  if (
    !runtimeBinding ||
    runtimeBinding.libraryId !== args.libraryId ||
    !isReadyRuntimeBinding(runtimeBinding)
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library ready runtime binding not found",
    );
  }
  return { library, operation, revision, runtimeBinding };
}

async function requireCurrentConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptCount: number;
  },
) {
  const deployment = await readConfigurationDeployment(ctx, args);
  if (
    deployment.operation.status !== "running" ||
    deployment.operation.attemptCount !== args.attemptCount
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration deployment attempt is no longer active",
    );
  }
  return deployment;
}

export async function requireNoActiveConfigurationDeployment(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
) {
  for (const status of ["queued", "running"] as const) {
    const operations = ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_status_and_updatedAt", (query) =>
        query.eq("libraryId", libraryId).eq("status", status),
      );
    for await (const operation of operations) {
      if (operation.kind === "publish") {
        throw createError(
          "CONFLICT",
          "Another Evidence Library configuration deployment is already running",
        );
      }
    }
  }
}

export async function claimAndScheduleConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const deployment = await readConfigurationDeployment(ctx, args);
  if (
    deployment.operation.status !== "queued" &&
    deployment.operation.status !== "failed"
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration deployment cannot be started",
    );
  }
  const now = Date.now();
  const attemptCount = deployment.operation.attemptCount + 1;
  await ctx.db.patch(deployment.operation._id, {
    status: "running",
    stage: "assembling",
    attemptCount,
    error: undefined,
    startedAt: now,
    completedAt: undefined,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.evidenceLibraries.configurationDeploymentActions
      .runConfigurationDeployment,
    {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptCount,
      pollCount: 0,
    },
  );
  return {
    operationId: deployment.operation._id,
    revisionId: deployment.revision._id,
    status: "running" as const,
  };
}

function requireCredential(
  credential: Doc<"evidenceLibraryCredentials"> | null,
  libraryId: Id<"evidenceLibraries">,
  credentialKey: string,
) {
  if (
    !credential ||
    credential.libraryId !== libraryId ||
    credential.credentialKey !== credentialKey ||
    credential.validationState !== "valid"
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime credential is incomplete",
    );
  }
  return credential;
}

export const prepareConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
  },
  returns: v.object({
    applicationId: v.string(),
    targetBaseUrl: v.string(),
    revisionKey: v.string(),
    revisionCreatedAt: v.number(),
    sections: essentialConfigurationSectionsValidator,
    encryptedMachineCredential: v.string(),
    encryptedAuthenticationSecret: v.string(),
    encryptedDatabaseUrl: v.string(),
    searchHost: v.string(),
    encryptedSearchKey: v.string(),
    searchIndex: v.string(),
    storageUrl: v.string(),
    encryptedStorageServiceRoleKey: v.string(),
    storagePrivateBucket: v.string(),
    storagePublicBucket: v.string(),
    storageMaxPdfBytes: v.number(),
    zoteroTranslationUrl: v.optional(v.string()),
    savedReceipt: v.optional(
      v.object({
        revisionKey: v.string(),
        runtimeConfigSha256: v.string(),
        deploymentId: v.string(),
        runtimeCommit: v.string(),
        coolifyConfigHash: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (
      deployment.operation.stage !== "assembling" &&
      deployment.operation.stage !== "publishing"
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not publishing",
      );
    }
    const [sectionRows, authentication, machine, database, search, storage] =
      await Promise.all([
        ctx.db
          .query("evidenceLibraryConfigSections")
          .withIndex("by_revisionId_and_sectionKey", (query) =>
            query.eq("revisionId", deployment.revision._id),
          )
          .collect(),
        ctx.db
          .query("evidenceLibraryCredentials")
          .withIndex("by_libraryId_and_credentialKey", (query) =>
            query
              .eq("libraryId", args.libraryId)
              .eq("credentialKey", AUTHENTICATION_SECRET_PATH),
          )
          .unique(),
        ctx.db
          .query("evidenceLibraryCredentials")
          .withIndex("by_libraryId_and_credentialKey", (query) =>
            query
              .eq("libraryId", args.libraryId)
              .eq("credentialKey", LIBRARY_SERVICE_CREDENTIAL_KEY),
          )
          .unique(),
        ctx.db.get(deployment.runtimeBinding.databaseCredentialId),
        ctx.db.get(deployment.runtimeBinding.searchCredentialId),
        ctx.db.get(deployment.runtimeBinding.storageCredentialId),
      ]);
    const payloads = Object.fromEntries(
      sectionRows.map((section) => [section.sectionKey, section.payload]),
    );
    const validated = validateEssentialConfiguration(payloads, {
      expectedBaseUrl: deployment.runtimeBinding.targetBaseUrl,
    });
    if (!validated.valid || !validated.value) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library revision configuration is incomplete",
      );
    }
    const receipt = deployment.operation.receipt;
    const savedReceipt =
      receipt?.revisionKey &&
      receipt.targetConfigSha256 &&
      receipt.runtimeReceiptId &&
      receipt.runtimeCommit &&
      receipt.coolifyConfigHash
        ? {
            revisionKey: receipt.revisionKey,
            runtimeConfigSha256: receipt.targetConfigSha256,
            deploymentId: receipt.runtimeReceiptId,
            runtimeCommit: receipt.runtimeCommit,
            coolifyConfigHash: receipt.coolifyConfigHash,
          }
        : undefined;
    if (receipt && !savedReceipt) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    return {
      applicationId: deployment.runtimeBinding.targetRuntimeId,
      targetBaseUrl: deployment.runtimeBinding.targetBaseUrl,
      revisionKey: deployment.revision.revisionKey,
      revisionCreatedAt: deployment.revision.createdAt,
      sections: validated.value,
      encryptedMachineCredential: requireCredential(
        machine,
        args.libraryId,
        LIBRARY_SERVICE_CREDENTIAL_KEY,
      ).encryptedValue,
      encryptedAuthenticationSecret: requireCredential(
        authentication,
        args.libraryId,
        AUTHENTICATION_SECRET_PATH,
      ).encryptedValue,
      encryptedDatabaseUrl: requireCredential(
        database,
        args.libraryId,
        DATABASE_URL_PATH,
      ).encryptedValue,
      searchHost: deployment.runtimeBinding.searchHost,
      encryptedSearchKey: requireCredential(
        search,
        args.libraryId,
        SEARCH_KEY_PATH,
      ).encryptedValue,
      searchIndex: deployment.runtimeBinding.searchIndex,
      storageUrl: deployment.runtimeBinding.storageUrl,
      encryptedStorageServiceRoleKey: requireCredential(
        storage,
        args.libraryId,
        STORAGE_SERVICE_KEY_PATH,
      ).encryptedValue,
      storagePrivateBucket: deployment.runtimeBinding.storagePrivateBucket,
      storagePublicBucket: deployment.runtimeBinding.storagePublicBucket,
      storageMaxPdfBytes: deployment.runtimeBinding.storageMaxPdfBytes,
      ...(deployment.runtimeBinding.zoteroTranslationUrl === undefined
        ? {}
        : {
            zoteroTranslationUrl:
              deployment.runtimeBinding.zoteroTranslationUrl,
          }),
      ...(savedReceipt === undefined ? {} : { savedReceipt }),
    };
  },
});

export const saveConfigurationDeploymentReceipt = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
    deploymentId: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
    replacesDeploymentId: v.optional(v.string()),
  },
  returns: v.object({ status: v.literal("running") }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (
      deployment.operation.stage !== "assembling" &&
      deployment.operation.stage !== "publishing"
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not publishing",
      );
    }
    const receipt = validateOperationReceipt({
      revisionKey: deployment.revision.revisionKey,
      targetConfigSha256: args.runtimeConfigSha256,
      runtimeReceiptId: args.deploymentId,
      runtimeCommit: args.runtimeCommit,
      coolifyConfigHash: args.coolifyConfigHash,
    })!;
    const existingDeploymentId = deployment.operation.receipt?.runtimeReceiptId;
    if (
      existingDeploymentId &&
      existingDeploymentId !== receipt.runtimeReceiptId &&
      (args.replacesDeploymentId !== existingDeploymentId ||
        deployment.operation.attemptCount < 2)
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment already saved another deployment",
      );
    }
    await ctx.db.patch(deployment.operation._id, {
      receipt,
      stage: "publishing",
      updatedAt: Date.now(),
    });
    return { status: "running" as const };
  },
});

export const scheduleConfigurationDeploymentPoll = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
    pollCount: v.number(),
  },
  returns: v.object({ pollCount: v.number(), status: v.literal("running") }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (
      deployment.operation.stage !== "publishing" ||
      !deployment.operation.receipt?.runtimeReceiptId
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not ready to poll",
      );
    }
    const pollCount = args.pollCount + 1;
    if (pollCount > MAX_CONFIGURATION_DEPLOYMENT_POLLS) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment did not finish in time",
      );
    }
    await ctx.db.patch(deployment.operation._id, { updatedAt: Date.now() });
    await ctx.scheduler.runAfter(
      CONFIGURATION_DEPLOYMENT_POLL_DELAY_MS,
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      { ...args, pollCount },
    );
    return { pollCount, status: "running" as const };
  },
});

export const prepareConfigurationActivation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
  },
  returns: v.object({
    applicationId: v.string(),
    deploymentId: v.string(),
    runtimeCommit: v.string(),
    coolifyConfigHash: v.string(),
    revisionKey: v.string(),
    targetBaseUrl: v.string(),
    defaultLocale: v.string(),
  }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (
      deployment.operation.stage !== "publishing" &&
      deployment.operation.stage !== "activating"
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not ready for activation",
      );
    }
    const receipt = deployment.operation.receipt;
    if (
      receipt?.revisionKey !== deployment.revision.revisionKey ||
      !receipt.runtimeReceiptId ||
      !receipt.runtimeCommit ||
      !receipt.coolifyConfigHash
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    const localization = await ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_revisionId_and_sectionKey", (query) =>
        query
          .eq("revisionId", deployment.revision._id)
          .eq("sectionKey", "localization"),
      )
      .unique();
    const payload = localization?.payload;
    if (
      localization?.kind !== "revision" ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      typeof (payload as Record<string, unknown>).defaultLocale !== "string"
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library default language is missing",
      );
    }
    if (deployment.operation.stage !== "activating") {
      await ctx.db.patch(deployment.operation._id, {
        stage: "activating",
        updatedAt: Date.now(),
      });
    }
    return {
      applicationId: deployment.runtimeBinding.targetRuntimeId,
      deploymentId: receipt.runtimeReceiptId,
      runtimeCommit: receipt.runtimeCommit,
      coolifyConfigHash: receipt.coolifyConfigHash,
      revisionKey: deployment.revision.revisionKey,
      targetBaseUrl: deployment.runtimeBinding.targetBaseUrl,
      defaultLocale: (payload as Record<string, string>).defaultLocale,
    };
  },
});

export const completeConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
    checkedAt: v.number(),
  },
  returns: v.object({ status: v.literal("succeeded") }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (
      deployment.operation.stage !== "activating" ||
      !Number.isFinite(args.checkedAt) ||
      args.checkedAt < 0
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not ready to complete",
      );
    }
    const receipt = validateOperationReceipt({
      ...deployment.operation.receipt,
      activatedAt: args.checkedAt,
    });
    if (
      receipt?.revisionKey !== deployment.revision.revisionKey ||
      !receipt.targetConfigSha256 ||
      !receipt.runtimeReceiptId ||
      !receipt.runtimeCommit ||
      !receipt.coolifyConfigHash
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      status: "succeeded",
      stage: "completed",
      receipt,
      completedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.runtimeBinding._id, {
      lastVerifiedAt: args.checkedAt,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.library._id, {
      activeRevisionId: deployment.revision._id,
      updatedByClerkUserId: deployment.operation.requestedByClerkUserId,
      updatedAt: now,
    });
    return { status: "succeeded" as const };
  },
});

export const failConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptCount: v.number(),
    error: evidenceLibraryOperationErrorInputValidator,
  },
  returns: v.union(v.literal("failed"), v.literal("ignored")),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation ||
      operation.libraryId !== args.libraryId ||
      operation.kind !== "publish" ||
      operation.status !== "running" ||
      operation.attemptCount !== args.attemptCount
    ) {
      return "ignored" as const;
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "failed",
      error: sanitizeOperationError(args.error, operation.stage),
      completedAt: now,
      updatedAt: now,
    });
    return "failed" as const;
  },
});

export const retryConfigurationDeployment = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
  },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    status: v.literal("running"),
  }),
  handler: claimAndScheduleConfigurationDeployment,
});
