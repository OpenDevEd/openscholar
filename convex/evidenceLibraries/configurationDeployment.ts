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
import { readRevisionDefaultLocale } from "./revisionConfiguration";
import {
  AUTHENTICATION_SECRET_PATH,
  DATABASE_URL_PATH,
  SEARCH_KEY_PATH,
  STORAGE_SERVICE_KEY_PATH,
} from "./runtimeCredentials";
import {
  essentialConfigurationSectionsValidator,
  evidenceLibraryConfigurationDeploymentTargetValidator,
  evidenceLibraryOperationErrorInputValidator,
} from "./validators";

export const CONFIGURATION_DEPLOYMENT_LEASE_MS = 20 * 60 * 1_000;
const CONFIGURATION_DEPLOYMENT_POLL_DELAY_MS = 5_000;
const MAX_CONFIGURATION_DEPLOYMENT_POLLS = 120;

type ReadyRuntimeBinding = Extract<
  Doc<"evidenceLibraryRuntimeBindings">,
  { state: "ready" }
>;

type CurrentDeployment = {
  library: Doc<"evidenceLibraries">;
  operation: Doc<"evidenceLibraryConfigOperations">;
  revision: Doc<"evidenceLibraryConfigRevisions">;
  runtimeBinding: ReadyRuntimeBinding;
};

function isReadyRuntimeBinding(
  binding: Doc<"evidenceLibraryRuntimeBindings">,
): binding is ReadyRuntimeBinding {
  return binding.state === "ready" && "targetRuntimeId" in binding;
}

function requireNonBlank(field: string, value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 900_000) {
    throw createError("VALIDATION_ERROR", `${field} is missing or too large`);
  }
  return normalized;
}

function requireDigest(field: string, value: string): string {
  const digest = requireNonBlank(field, value);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw createError(
      "VALIDATION_ERROR",
      `${field} must be a lowercase SHA-256 digest`,
    );
  }
  return digest;
}

function requireCommit(value: string): string {
  const commit = requireNonBlank("runtimeCommit", value);
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw createError(
      "VALIDATION_ERROR",
      "runtimeCommit must be a lowercase 40-character commit",
    );
  }
  return commit;
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
    operation.activationEditVersion === undefined ||
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
  const target = operation.configurationDeploymentTarget;
  if (
    target &&
    (library.runtimeBindingId !== target.runtimeBindingId ||
      runtimeBinding._id !== target.runtimeBindingId ||
      runtimeBinding.targetRuntimeId !== target.applicationId ||
      runtimeBinding.targetBaseUrl !== target.targetBaseUrl ||
      revision.revisionKey !== target.revisionKey)
  ) {
    throw createError(
      "CONFLICT",
      "The saved configuration target no longer matches its runtime binding",
    );
  }
  return { library, operation, revision, runtimeBinding };
}

function requireCurrentAttempt(
  deployment: CurrentDeployment,
  args: { attemptToken: string; attemptCount: number },
) {
  if (
    deployment.operation.status !== "running" ||
    deployment.operation.attemptCount !== args.attemptCount ||
    deployment.operation.configurationAttemptToken !== args.attemptToken ||
    !deployment.operation.configurationLeaseExpiresAt ||
    deployment.operation.configurationLeaseExpiresAt <= Date.now()
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration deployment attempt is no longer active",
    );
  }
}

async function requireCurrentConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
    attemptToken: string;
    attemptCount: number;
  },
) {
  const deployment = await readConfigurationDeployment(ctx, args);
  requireCurrentAttempt(deployment, args);
  return deployment;
}

export async function requireNoActiveConfigurationDeployment(
  ctx: MutationCtx,
  libraryId: Id<"evidenceLibraries">,
  exceptOperationId?: Id<"evidenceLibraryConfigOperations">,
) {
  for (const status of ["queued", "running"] as const) {
    const operations = ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_status_and_updatedAt", (query) =>
        query.eq("libraryId", libraryId).eq("status", status),
      );
    for await (const operation of operations) {
      if (
        operation._id !== exceptOperationId &&
        operation.kind === "publish" &&
        operation.activationEditVersion !== undefined
      ) {
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
  await requireNoActiveConfigurationDeployment(
    ctx,
    args.libraryId,
    args.operationId,
  );
  const deployment = await readConfigurationDeployment(ctx, args);
  const now = Date.now();
  if (
    deployment.operation.status === "running" &&
    (!deployment.operation.configurationLeaseExpiresAt ||
      deployment.operation.configurationLeaseExpiresAt > now)
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration deployment is already running",
    );
  }
  if (deployment.operation.status === "succeeded") {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration deployment is already complete",
    );
  }
  const attemptCount = deployment.operation.attemptCount + 1;
  const attemptToken = `elconfig_${deployment.operation._id}_${attemptCount}`;
  await ctx.db.patch(deployment.operation._id, {
    status: "running",
    stage: deployment.operation.configurationDeploymentTarget
      ? "publishing"
      : "assembling",
    attemptCount,
    error: undefined,
    startedAt: now,
    completedAt: undefined,
    configurationAttemptToken: attemptToken,
    configurationLeaseExpiresAt: now + CONFIGURATION_DEPLOYMENT_LEASE_MS,
    configurationDeploymentPollCount: 0,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.evidenceLibraries.configurationDeploymentActions
      .runConfigurationDeployment,
    {
      libraryId: args.libraryId,
      operationId: args.operationId,
      attemptToken,
      attemptCount,
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

function runtimeBindingFingerprint(binding: ReadyRuntimeBinding): string {
  return JSON.stringify({
    targetRuntimeId: binding.targetRuntimeId,
    targetBaseUrl: binding.targetBaseUrl,
    searchHost: binding.searchHost,
    searchIndex: binding.searchIndex,
    storageUrl: binding.storageUrl,
    storagePrivateBucket: binding.storagePrivateBucket,
    storagePublicBucket: binding.storagePublicBucket,
    storageMaxPdfBytes: binding.storageMaxPdfBytes,
    zoteroTranslationUrl: binding.zoteroTranslationUrl,
    databaseCredentialId: binding.databaseCredentialId,
    searchCredentialId: binding.searchCredentialId,
    storageCredentialId: binding.storageCredentialId,
  });
}

const sourceCredentialValidator = v.object({
  id: v.id("evidenceLibraryCredentials"),
  encryptedValue: v.string(),
  updatedAt: v.number(),
});

const savedDeploymentValidator = v.object({
  deploymentId: v.string(),
  coolifyConfigHash: v.string(),
});

export const prepareConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({
      state: v.literal("saved"),
      target: evidenceLibraryConfigurationDeploymentTargetValidator,
      deployment: v.optional(savedDeploymentValidator),
    }),
    v.object({
      state: v.literal("new"),
      applicationId: v.string(),
      targetBaseUrl: v.string(),
      revision: v.object({ key: v.string(), createdAt: v.number() }),
      sections: essentialConfigurationSectionsValidator,
      credentials: v.object({
        encryptedMachine: v.string(),
        encryptedAuthentication: v.string(),
        encryptedDatabaseUrl: v.string(),
      }),
      search: v.object({
        host: v.string(),
        encryptedKey: v.string(),
        index: v.string(),
      }),
      storage: v.object({
        url: v.string(),
        encryptedServiceRoleKey: v.string(),
        privateBucket: v.string(),
        publicBucket: v.string(),
        maxPdfBytes: v.number(),
      }),
      zoteroTranslationUrl: v.optional(v.string()),
      source: v.object({
        runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
        bindingUpdatedAt: v.number(),
        bindingFingerprint: v.string(),
        machine: sourceCredentialValidator,
        authentication: sourceCredentialValidator,
        database: sourceCredentialValidator,
        search: sourceCredentialValidator,
        storage: sourceCredentialValidator,
      }),
      defaultLocale: v.string(),
    }),
  ),
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
    const savedTarget = deployment.operation.configurationDeploymentTarget;
    if (savedTarget) {
      const receipt = deployment.operation.receipt;
      if (
        receipt &&
        (receipt.revisionKey !== savedTarget.revisionKey ||
          receipt.targetConfigSha256 !== savedTarget.runtimeConfigSha256 ||
          receipt.runtimeCommit !== savedTarget.runtimeCommit ||
          !receipt.runtimeReceiptId ||
          !receipt.coolifyConfigHash)
      ) {
        throw createError(
          "INVALID_DATA",
          "Evidence Library deployment receipt is incomplete",
        );
      }
      return {
        state: "saved" as const,
        target: savedTarget,
        ...(receipt
          ? {
              deployment: {
                deploymentId: receipt.runtimeReceiptId!,
                coolifyConfigHash: receipt.coolifyConfigHash!,
              },
            }
          : {}),
      };
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
    const required = {
      machine: requireCredential(
        machine,
        args.libraryId,
        LIBRARY_SERVICE_CREDENTIAL_KEY,
      ),
      authentication: requireCredential(
        authentication,
        args.libraryId,
        AUTHENTICATION_SECRET_PATH,
      ),
      database: requireCredential(database, args.libraryId, DATABASE_URL_PATH),
      search: requireCredential(search, args.libraryId, SEARCH_KEY_PATH),
      storage: requireCredential(
        storage,
        args.libraryId,
        STORAGE_SERVICE_KEY_PATH,
      ),
    };
    return {
      state: "new" as const,
      applicationId: deployment.runtimeBinding.targetRuntimeId,
      targetBaseUrl: deployment.runtimeBinding.targetBaseUrl,
      revision: {
        key: deployment.revision.revisionKey,
        createdAt: deployment.revision.createdAt,
      },
      sections: validated.value,
      credentials: {
        encryptedMachine: required.machine.encryptedValue,
        encryptedAuthentication: required.authentication.encryptedValue,
        encryptedDatabaseUrl: required.database.encryptedValue,
      },
      search: {
        host: deployment.runtimeBinding.searchHost,
        encryptedKey: required.search.encryptedValue,
        index: deployment.runtimeBinding.searchIndex,
      },
      storage: {
        url: deployment.runtimeBinding.storageUrl,
        encryptedServiceRoleKey: required.storage.encryptedValue,
        privateBucket: deployment.runtimeBinding.storagePrivateBucket,
        publicBucket: deployment.runtimeBinding.storagePublicBucket,
        maxPdfBytes: deployment.runtimeBinding.storageMaxPdfBytes,
      },
      ...(deployment.runtimeBinding.zoteroTranslationUrl === undefined
        ? {}
        : {
            zoteroTranslationUrl:
              deployment.runtimeBinding.zoteroTranslationUrl,
          }),
      source: {
        runtimeBindingId: deployment.runtimeBinding._id,
        bindingUpdatedAt: deployment.runtimeBinding.updatedAt,
        bindingFingerprint: runtimeBindingFingerprint(
          deployment.runtimeBinding,
        ),
        machine: {
          id: required.machine._id,
          encryptedValue: required.machine.encryptedValue,
          updatedAt: required.machine.updatedAt,
        },
        authentication: {
          id: required.authentication._id,
          encryptedValue: required.authentication.encryptedValue,
          updatedAt: required.authentication.updatedAt,
        },
        database: {
          id: required.database._id,
          encryptedValue: required.database.encryptedValue,
          updatedAt: required.database.updatedAt,
        },
        search: {
          id: required.search._id,
          encryptedValue: required.search.encryptedValue,
          updatedAt: required.search.updatedAt,
        },
        storage: {
          id: required.storage._id,
          encryptedValue: required.storage.encryptedValue,
          updatedAt: required.storage.updatedAt,
        },
      },
      defaultLocale: await readRevisionDefaultLocale(
        ctx,
        deployment.revision._id,
      ),
    };
  },
});

export const saveConfigurationDeploymentTarget = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    source: v.object({
      runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
      bindingUpdatedAt: v.number(),
      bindingFingerprint: v.string(),
      machine: sourceCredentialValidator,
      authentication: sourceCredentialValidator,
      database: sourceCredentialValidator,
      search: sourceCredentialValidator,
      storage: sourceCredentialValidator,
    }),
    target: v.object({
      applicationId: v.string(),
      targetBaseUrl: v.string(),
      revisionKey: v.string(),
      defaultLocale: v.string(),
      runtimeCommit: v.string(),
      encryptedRuntimeConfig: v.string(),
      runtimeConfigSha256: v.string(),
    }),
  },
  returns: evidenceLibraryConfigurationDeploymentTargetValidator,
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (deployment.operation.configurationDeploymentTarget) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration target is already saved",
      );
    }
    const sourceVersions = [
      args.source.machine,
      args.source.authentication,
      args.source.database,
      args.source.search,
      args.source.storage,
    ];
    const sourceCredentials = await Promise.all(
      sourceVersions.map(({ id }) => ctx.db.get(id)),
    );
    if (
      deployment.runtimeBinding._id !== args.source.runtimeBindingId ||
      deployment.runtimeBinding.updatedAt !== args.source.bindingUpdatedAt ||
      runtimeBindingFingerprint(deployment.runtimeBinding) !==
        args.source.bindingFingerprint ||
      sourceCredentials.some(
        (credential, index) =>
          !credential ||
          credential.encryptedValue !== sourceVersions[index]!.encryptedValue ||
          credential.updatedAt !== sourceVersions[index]!.updatedAt,
      ) ||
      args.target.applicationId !== deployment.runtimeBinding.targetRuntimeId ||
      args.target.targetBaseUrl !== deployment.runtimeBinding.targetBaseUrl ||
      args.target.revisionKey !== deployment.revision.revisionKey
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library runtime inputs changed before the target was saved",
      );
    }
    const now = Date.now();
    const target = {
      applicationId: requireNonBlank(
        "applicationId",
        args.target.applicationId,
      ),
      runtimeBindingId: deployment.runtimeBinding._id,
      targetBaseUrl: requireNonBlank(
        "targetBaseUrl",
        args.target.targetBaseUrl,
      ),
      revisionKey: requireNonBlank("revisionKey", args.target.revisionKey),
      defaultLocale: requireNonBlank(
        "defaultLocale",
        args.target.defaultLocale,
      ),
      runtimeCommit: requireCommit(args.target.runtimeCommit),
      encryptedRuntimeConfig: requireNonBlank(
        "encryptedRuntimeConfig",
        args.target.encryptedRuntimeConfig,
      ),
      runtimeConfigSha256: requireDigest(
        "runtimeConfigSha256",
        args.target.runtimeConfigSha256,
      ),
      savedAt: now,
    };
    await ctx.db.patch(deployment.operation._id, {
      configurationDeploymentTarget: target,
      configurationLeaseExpiresAt: now + CONFIGURATION_DEPLOYMENT_LEASE_MS,
      updatedAt: now,
    });
    return target;
  },
});

export const saveConfigurationDeploymentReceipt = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    deploymentId: v.string(),
    coolifyConfigHash: v.string(),
    replacesDeploymentId: v.optional(v.string()),
  },
  returns: v.object({ status: v.literal("running") }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    const target = deployment.operation.configurationDeploymentTarget;
    if (!target) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration target is not saved",
      );
    }
    const receipt = validateOperationReceipt({
      revisionKey: target.revisionKey,
      targetConfigSha256: target.runtimeConfigSha256,
      runtimeReceiptId: args.deploymentId,
      runtimeCommit: target.runtimeCommit,
      coolifyConfigHash: args.coolifyConfigHash,
    })!;
    const existingDeploymentId = deployment.operation.receipt?.runtimeReceiptId;
    if (
      existingDeploymentId &&
      existingDeploymentId !== receipt.runtimeReceiptId &&
      args.replacesDeploymentId !== existingDeploymentId
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment already saved another deployment",
      );
    }
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      receipt,
      stage: "publishing",
      configurationDeploymentPollCount: 0,
      configurationLeaseExpiresAt: now + CONFIGURATION_DEPLOYMENT_LEASE_MS,
      updatedAt: now,
    });
    return { status: "running" as const };
  },
});

export const scheduleConfigurationDeploymentPoll = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
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
    const pollCount =
      (deployment.operation.configurationDeploymentPollCount ?? 0) + 1;
    if (pollCount > MAX_CONFIGURATION_DEPLOYMENT_POLLS) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment did not finish in time",
      );
    }
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      configurationDeploymentPollCount: pollCount,
      configurationLeaseExpiresAt: now + CONFIGURATION_DEPLOYMENT_LEASE_MS,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      CONFIGURATION_DEPLOYMENT_POLL_DELAY_MS,
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      args,
    );
    return { pollCount, status: "running" as const };
  },
});

export const prepareConfigurationActivation = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
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
    const target = deployment.operation.configurationDeploymentTarget;
    const receipt = deployment.operation.receipt;
    if (
      !target ||
      receipt?.revisionKey !== target.revisionKey ||
      receipt.targetConfigSha256 !== target.runtimeConfigSha256 ||
      receipt.runtimeCommit !== target.runtimeCommit ||
      !receipt.runtimeReceiptId ||
      !receipt.coolifyConfigHash
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      stage: "activating",
      configurationLeaseExpiresAt: now + CONFIGURATION_DEPLOYMENT_LEASE_MS,
      updatedAt: now,
    });
    return {
      applicationId: target.applicationId,
      deploymentId: receipt.runtimeReceiptId,
      runtimeCommit: target.runtimeCommit,
      coolifyConfigHash: receipt.coolifyConfigHash,
      revisionKey: target.revisionKey,
      targetBaseUrl: target.targetBaseUrl,
      defaultLocale: target.defaultLocale,
    };
  },
});

export const completeConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
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
    const target = deployment.operation.configurationDeploymentTarget;
    const receipt = validateOperationReceipt({
      ...deployment.operation.receipt,
      activatedAt: args.checkedAt,
    });
    if (
      !target ||
      receipt?.revisionKey !== target.revisionKey ||
      receipt.targetConfigSha256 !== target.runtimeConfigSha256 ||
      receipt.runtimeCommit !== target.runtimeCommit ||
      !receipt.runtimeReceiptId ||
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
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      configurationDeploymentPollCount: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.runtimeBinding._id, {
      lastVerifiedAt: args.checkedAt,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.library._id, {
      activeRevisionId: deployment.revision._id,
      activeDeploymentOperationId: deployment.operation._id,
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
    attemptToken: v.string(),
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
      operation.activationEditVersion === undefined ||
      operation.status !== "running" ||
      operation.attemptCount !== args.attemptCount ||
      operation.configurationAttemptToken !== args.attemptToken
    ) {
      return "ignored" as const;
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "failed",
      error: sanitizeOperationError(args.error, operation.stage),
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
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
