import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { validateOwnerSections } from "../../lib/evidence-libraries/configuration/owner-rules";
import { CURRENT_OWNER_CONFIGURATION_VERSION } from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { isPlatformMailConfigured } from "./platformMail";
import { createError } from "../lib/errors";
import {
  claimDomainTransitionRow,
  readAttachedDomainOrigins,
  settleDomainDeploymentRow,
} from "./domains";
import { applyEvidenceLibraryCanonicalAddress } from "./versions";
import { requireEvidenceLibraryAccess } from "./access";
import { LIBRARY_SERVICE_CREDENTIAL_KEY } from "./credentials";
import { readLibraryZoteroGroupCredentials } from "../zotero/libraryGroups";
import { zoteroGroupScopesValidator } from "../zotero/libraryGroupValidators";
import { aiProviderKeySourceValidator } from "./validators";
import { isDeploymentLeaseHeld } from "./operationLeases";
import {
  readAiProviderKeySource,
  readLibraryAiProviderKey,
  requireUnchangedAiProviderKey,
} from "./aiProviderKey";
import {
  sanitizeConfigurationIssues,
  sanitizeOperationError,
  validateOperationReceipt,
} from "./operations";
import { readRevisionDefaultLocale } from "./revisionConfiguration";
import {
  AUTHENTICATION_SECRET_PATH,
  DATABASE_URL_PATH,
  SEARCH_KEY_PATH,
  STORAGE_SERVICE_KEY_PATH,
} from "./runtimeCredentials";
import { applyEvidenceLibraryAddressMove } from "./addressRecovery";
import { loadRevisionConfigurationSnapshot } from "./configurationSnapshot";
import { isRuntimeImageReference } from "./runtimeImageRegistry";
import {
  evidenceLibraryAddressMoveValidator,
  evidenceLibraryConfigurationDeploymentTargetValidator,
  evidenceLibraryOperationFailureValidator,
  evidenceLibraryRuntimeUpdateValidator,
  sectionRowValidator,
} from "./validators";
import {
  isConfigurationDeploymentOperation,
  isAcceptableSavedConfigurationTarget,
  isCurrentConfigurationTargetBaseUrl,
  isCurrentConfigurationDeploymentTarget,
  isRetryableConfigurationDeployment,
} from "./operations";

export { isConfigurationDeploymentOperation } from "./operations";

export const CONFIGURATION_DEPLOYMENT_LEASE_MS = 20 * 60 * 1_000;
const CONFIGURATION_DEPLOYMENT_POLL_DELAY_MS = 5_000;

export const isFailedRuntimeTarget = internalQuery({
  args: {
    libraryId: v.id("evidenceLibraries"),
    runtimeCommit: v.string(),
    runtimeImage: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const operation = await ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_failed_runtime", (query) =>
        query
          .eq("libraryId", args.libraryId)
          .eq("status", "failed")
          .eq("runtimeUpdate.to", args.runtimeCommit)
          .eq("runtimeUpdate.toImage", args.runtimeImage),
      )
      .first();
    return operation !== null;
  },
});

/**
 * Puts the deployment's lease forward and books the watchdog that will pick
 * it up if this worker stops answering.
 *
 * Every lease write goes through here. The watchdog is fenced by the
 * operation, the attempt and the exact deadline it was booked for, so only
 * the last renewal's watchdog can ever act.
 */
async function renewConfigurationLease(
  ctx: MutationCtx,
  operation: Doc<"evidenceLibraryConfigOperations">,
  attemptToken: string,
): Promise<number> {
  const leaseExpiresAt = Date.now() + CONFIGURATION_DEPLOYMENT_LEASE_MS;
  await ctx.scheduler.runAt(
    leaseExpiresAt + WATCHDOG_GRACE_MS,
    internal.evidenceLibraries.configurationDeployment
      .failExpiredConfigurationDeployment,
    { operationId: operation._id, attemptToken, leaseExpiresAt },
  );
  return leaseExpiresAt;
}

/** How long after a lease runs out the watchdog looks. */
const WATCHDOG_GRACE_MS = 60_000;

const MAX_CONFIGURATION_DEPLOYMENT_POLLS = 120;
const CONFIGURATION_READINESS_POLL_DELAY_MS = 5_000;
const MAX_CONFIGURATION_READINESS_POLLS = 24;

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

function requireRuntimeImage(value: string | undefined): string {
  if (!isRuntimeImageReference(value)) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime image is missing or invalid",
    );
  }
  return value;
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
    !isConfigurationDeploymentOperation(operation) ||
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
    !isCurrentConfigurationDeploymentTarget(
      library,
      revision,
      runtimeBinding,
      target,
      operation,
    )
  ) {
    throw createError(
      "CONFLICT",
      "The saved configuration target no longer matches its runtime binding",
    );
  }
  return { library, operation, revision, runtimeBinding };
}

function requireCurrentConfigurationRevision(
  revision: Doc<"evidenceLibraryConfigRevisions">,
): void {
  if (
    revision.ownerConfigurationVersion !== CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
    throw createError(
      "CONFLICT",
      "Evidence Library configuration revision is not a current owner format",
    );
  }
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
        isConfigurationDeploymentOperation(operation)
      ) {
        throw createError(
          "CONFLICT",
          "Another Evidence Library configuration deployment is already running",
        );
      }
    }
  }
}

async function claimAndScheduleAuthorizedConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
) {
  await requireNoActiveConfigurationDeployment(
    ctx,
    args.libraryId,
    args.operationId,
  );
  const deployment = await readConfigurationDeployment(ctx, args);
  const now = Date.now();
  if (isDeploymentLeaseHeld(deployment.operation, now)) {
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
    issues: undefined,
    startedAt: now,
    completedAt: undefined,
    configurationAttemptToken: attemptToken,
    configurationLeaseExpiresAt: await renewConfigurationLease(
      ctx,
      deployment.operation,
      attemptToken,
    ),
    configurationDeploymentPollCount: 0,
    configurationReadinessPollCount: 0,
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

export async function claimAndScheduleConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  return await claimAndScheduleAuthorizedConfigurationDeployment(ctx, args);
}

export async function claimAndScheduleInternalConfigurationDeployment(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    operationId: Id<"evidenceLibraryConfigOperations">;
  },
) {
  return await claimAndScheduleAuthorizedConfigurationDeployment(ctx, args);
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
      runtimeUpdate: v.optional(evidenceLibraryRuntimeUpdateValidator),
    }),
    v.object({
      state: v.literal("new"),
      runtimeUpdate: v.optional(evidenceLibraryRuntimeUpdateValidator),
      addressMove: v.optional(evidenceLibraryAddressMoveValidator),
      applicationId: v.string(),
      targetBaseUrl: v.string(),
      customDomains: v.array(v.string()),
      revision: v.object({ key: v.string(), createdAt: v.number() }),
      sections: v.array(sectionRowValidator),
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
      zoteroGroups: v.array(
        v.object({
          groupId: v.string(),
          encryptedApiKey: v.string(),
          scopes: zoteroGroupScopesValidator,
        }),
      ),
      source: v.object({
        runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
        bindingUpdatedAt: v.number(),
        bindingFingerprint: v.string(),
        machine: sourceCredentialValidator,
        authentication: sourceCredentialValidator,
        database: sourceCredentialValidator,
        search: sourceCredentialValidator,
        storage: sourceCredentialValidator,
        aiProviderKey: aiProviderKeySourceValidator,
      }),
      // The key itself, for the action that builds the configuration. It is
      // never written to the operation, which owners can read.
      aiProviderKey: v.optional(v.object({ encryptedApiKey: v.string() })),
      defaultLocale: v.string(),
      runtimeCommit: v.string(),
      runtimeImage: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    requireCurrentConfigurationRevision(deployment.revision);
    if (
      deployment.operation.stage !== "assembling" &&
      deployment.operation.stage !== "publishing" &&
      deployment.operation.stage !== "activating"
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration deployment is not publishing",
      );
    }
    const savedTarget = deployment.operation.configurationDeploymentTarget;
    if (savedTarget) {
      if (
        !(await isAcceptableSavedConfigurationTarget(ctx, deployment.operation))
      ) {
        throw createError(
          "CONFLICT",
          "The saved configuration target no longer matches the current runtime",
        );
      }
      const receipt = deployment.operation.receipt;
      if (
        receipt &&
        (!("runtimeCommit" in receipt) ||
          receipt.revisionKey !== savedTarget.revisionKey ||
          receipt.targetConfigSha256 !== savedTarget.runtimeConfigSha256 ||
          receipt.runtimeCommit !== savedTarget.runtimeCommit ||
          receipt.runtimeImage !== savedTarget.runtimeImage ||
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
        ...(deployment.operation.runtimeUpdate
          ? { runtimeUpdate: deployment.operation.runtimeUpdate }
          : {}),
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
    const runtimeUpdate = deployment.operation.runtimeUpdate;
    if (
      runtimeUpdate &&
      (runtimeUpdate.from !== deployment.runtimeBinding.runtimeCommit ||
        (runtimeUpdate.fromImage !== undefined &&
          runtimeUpdate.fromImage !== deployment.runtimeBinding.runtimeImage))
    ) {
      throw createError(
        "CONFLICT",
        "The library moved to other software after this update was requested",
      );
    }
    const [
      configurationSnapshot,
      authentication,
      machine,
      database,
      search,
      storage,
    ] = await Promise.all([
      loadRevisionConfigurationSnapshot(ctx, deployment.revision._id, {
        requireComplete: true,
      }),
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
    // A change of the library's own address travels on the operation. The
    // deployment carries the new address so the running site starts using
    // it; nothing stored moves until readiness passes.
    const canonicalChange =
      deployment.operation.domainChange?.reason === "canonical"
        ? deployment.operation.domainChange.address
        : undefined;
    const addressMove = deployment.operation.addressMove;
    const candidateAddress =
      canonicalChange ??
      (addressMove && deployment.runtimeBinding.canonicalBaseUrl === undefined
        ? addressMove.to
        : undefined);
    const expectedBaseUrl =
      candidateAddress ??
      deployment.runtimeBinding.canonicalBaseUrl ??
      deployment.runtimeBinding.targetBaseUrl;
    const sections = configurationSnapshot.migration.snapshot.sections.map(
      (section) => ({
        sectionKey: section.sectionKey,
        payload:
          candidateAddress && section.sectionKey === "identity"
            ? {
                ...(section.payload as Record<string, unknown>),
                baseUrl: candidateAddress,
              }
            : section.payload,
      }),
    );
    const validated = validateOwnerSections(sections, {
      expectedBaseUrl,
      requireComplete: true,
      platformMailConfigured: isPlatformMailConfigured(),
    });
    if (!validated.valid) {
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
    const aiProviderKey = await readAiProviderKeySource(ctx, args.libraryId);
    const aiProviderApiKey = await readLibraryAiProviderKey(
      ctx,
      args.libraryId,
    );
    return {
      state: "new" as const,
      ...(runtimeUpdate ? { runtimeUpdate } : {}),
      ...(deployment.operation.addressMove
        ? { addressMove: deployment.operation.addressMove }
        : {}),
      applicationId: deployment.runtimeBinding.targetRuntimeId,
      targetBaseUrl:
        deployment.operation.addressMove?.to ??
        deployment.runtimeBinding.targetBaseUrl,
      customDomains: await readAttachedDomainOrigins(ctx, args.libraryId),
      revision: {
        key: deployment.revision.revisionKey,
        createdAt: deployment.revision.createdAt,
      },
      sections,
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
      zoteroGroups: await readLibraryZoteroGroupCredentials(
        ctx,
        args.libraryId,
      ),
      ...(aiProviderApiKey ? { aiProviderKey: aiProviderApiKey } : {}),
      source: {
        runtimeBindingId: deployment.runtimeBinding._id,
        bindingUpdatedAt: deployment.runtimeBinding.updatedAt,
        bindingFingerprint: runtimeBindingFingerprint(
          deployment.runtimeBinding,
        ),
        aiProviderKey,
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
      runtimeCommit:
        runtimeUpdate?.to ?? deployment.runtimeBinding.runtimeCommit,
      runtimeImage: requireRuntimeImage(
        runtimeUpdate?.toImage ?? deployment.runtimeBinding.runtimeImage,
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
      aiProviderKey: aiProviderKeySourceValidator,
    }),
    target: v.object({
      applicationId: v.string(),
      targetBaseUrl: v.string(),
      customDomains: v.array(v.string()),
      revisionKey: v.string(),
      defaultLocale: v.string(),
      runtimeCommit: v.string(),
      runtimeImage: v.string(),
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
    await requireUnchangedAiProviderKey(
      ctx,
      args.libraryId,
      args.source.aiProviderKey,
    );
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
      !isCurrentConfigurationTargetBaseUrl(
        deployment.runtimeBinding,
        args.target.targetBaseUrl,
        deployment.operation,
      ) ||
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
      aiProviderKey: args.source.aiProviderKey,
      runtimeBindingId: deployment.runtimeBinding._id,
      targetBaseUrl: requireNonBlank(
        "targetBaseUrl",
        args.target.targetBaseUrl,
      ),
      customDomains: args.target.customDomains.map((domain) =>
        requireNonBlank("customDomain", domain),
      ),
      revisionKey: requireNonBlank("revisionKey", args.target.revisionKey),
      defaultLocale: requireNonBlank(
        "defaultLocale",
        args.target.defaultLocale,
      ),
      runtimeCommit: requireCommit(args.target.runtimeCommit),
      runtimeImage: requireRuntimeImage(args.target.runtimeImage),
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
      configurationLeaseExpiresAt: await renewConfigurationLease(
        ctx,
        deployment.operation,
        args.attemptToken,
      ),
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
      runtimeImage: target.runtimeImage,
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
      configurationLeaseExpiresAt: await renewConfigurationLease(
        ctx,
        deployment.operation,
        args.attemptToken,
      ),
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
      configurationLeaseExpiresAt: await renewConfigurationLease(
        ctx,
        deployment.operation,
        args.attemptToken,
      ),
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
    runtimeImage: v.string(),
    coolifyConfigHash: v.string(),
    revisionKey: v.string(),
    targetBaseUrl: v.string(),
    platformBaseUrl: v.string(),
    customDomains: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    const target = deployment.operation.configurationDeploymentTarget;
    const receipt = deployment.operation.receipt;
    if (
      !target ||
      !receipt ||
      !("runtimeCommit" in receipt) ||
      receipt?.revisionKey !== target.revisionKey ||
      receipt.targetConfigSha256 !== target.runtimeConfigSha256 ||
      receipt.runtimeCommit !== target.runtimeCommit ||
      receipt.runtimeImage !== target.runtimeImage ||
      !receipt.runtimeReceiptId ||
      !receipt.coolifyConfigHash
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    // The last look before the library goes live: a key replaced or removed
    // during the publish must not reach it.
    await requireUnchangedAiProviderKey(
      ctx,
      args.libraryId,
      target.aiProviderKey,
    );
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      stage: "activating",
      configurationLeaseExpiresAt: await renewConfigurationLease(
        ctx,
        deployment.operation,
        args.attemptToken,
      ),
      updatedAt: now,
    });
    return {
      applicationId: target.applicationId,
      deploymentId: receipt.runtimeReceiptId,
      runtimeCommit: target.runtimeCommit,
      runtimeImage: requireRuntimeImage(target.runtimeImage),
      coolifyConfigHash: receipt.coolifyConfigHash,
      revisionKey: target.revisionKey,
      // Readiness reads the address the library calls its own, which is the
      // custom domain once one is primary. When a change of address is
      // travelling on this operation, that is the address to read.
      targetBaseUrl:
        deployment.operation.domainChange?.reason === "canonical"
          ? (deployment.operation.domainChange.address ??
            deployment.runtimeBinding.canonicalBaseUrl ??
            target.targetBaseUrl)
          : (deployment.runtimeBinding.canonicalBaseUrl ??
            target.targetBaseUrl),
      platformBaseUrl: target.targetBaseUrl,
      customDomains: target.customDomains,
    };
  },
});

export const scheduleConfigurationReadinessPoll = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
  },
  returns: v.union(
    v.object({ pollCount: v.number(), status: v.literal("running") }),
    v.object({ status: v.literal("exhausted") }),
  ),
  handler: async (ctx, args) => {
    const deployment = await requireCurrentConfigurationDeployment(ctx, args);
    if (deployment.operation.stage !== "activating") {
      throw createError(
        "CONFLICT",
        "Evidence Library configuration is not waiting for readiness",
      );
    }
    const pollCount =
      (deployment.operation.configurationReadinessPollCount ?? 0) + 1;
    if (pollCount > MAX_CONFIGURATION_READINESS_POLLS) {
      return { status: "exhausted" as const };
    }
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      configurationReadinessPollCount: pollCount,
      configurationLeaseExpiresAt: await renewConfigurationLease(
        ctx,
        deployment.operation,
        args.attemptToken,
      ),
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      CONFIGURATION_READINESS_POLL_DELAY_MS,
      internal.evidenceLibraries.configurationDeploymentActions
        .runConfigurationDeployment,
      args,
    );
    return { pollCount, status: "running" as const };
  },
});

async function completeConfigurationAddressMove(
  ctx: MutationCtx,
  deployment: CurrentDeployment,
): Promise<void> {
  const move = deployment.operation.addressMove;
  if (!move || move.applied) return;
  if (
    deployment.runtimeBinding.targetBaseUrl !== move.from &&
    deployment.runtimeBinding.targetBaseUrl !== move.to
  ) {
    throw createError(
      "CONFLICT",
      "The Evidence Library address changed after this move was requested",
    );
  }
  const taken = await ctx.db
    .query("evidenceLibraryRuntimeBindings")
    .withIndex("by_targetBaseUrl", (query) =>
      query.eq("targetBaseUrl", move.to),
    )
    .first();
  if (taken && taken._id !== deployment.runtimeBinding._id) {
    throw createError(
      "CONFLICT",
      "Another Evidence Library took that address first",
    );
  }
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) =>
      query.eq("libraryId", deployment.library._id),
    )
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  await applyEvidenceLibraryAddressMove(ctx, {
    bindingId: deployment.runtimeBinding._id,
    draftId: draft._id,
    revisionId: deployment.revision._id,
    nextAddress: move.to,
  });
  await ctx.db.patch(deployment.operation._id, {
    addressMove: { ...move, applied: true },
    updatedAt: Date.now(),
  });
}

async function updateDraftBaseRevision(
  ctx: MutationCtx,
  deployment: CurrentDeployment,
): Promise<void> {
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) =>
      query.eq("libraryId", deployment.library._id),
    )
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  if (draft.baseRevisionId !== deployment.revision._id) {
    await ctx.db.patch(draft._id, {
      baseRevisionId: deployment.revision._id,
    });
  }
}

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
    if (target) {
      // The last check of all: a key replaced while the runtime was being
      // asked whether it is ready must not reach a live library.
      await requireUnchangedAiProviderKey(
        ctx,
        args.libraryId,
        target.aiProviderKey,
      );
    }
    const receipt = validateOperationReceipt({
      ...deployment.operation.receipt,
      activatedAt: args.checkedAt,
    });
    if (
      !target ||
      receipt?.revisionKey !== target.revisionKey ||
      receipt.targetConfigSha256 !== target.runtimeConfigSha256 ||
      receipt.runtimeCommit !== target.runtimeCommit ||
      receipt.runtimeImage !== target.runtimeImage ||
      !receipt.runtimeReceiptId ||
      !receipt.coolifyConfigHash
    ) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library deployment receipt is incomplete",
      );
    }
    await completeConfigurationAddressMove(ctx, deployment);
    const now = Date.now();
    await ctx.db.patch(deployment.operation._id, {
      status: "succeeded",
      stage: "completed",
      receipt,
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      configurationDeploymentPollCount: undefined,
      configurationReadinessPollCount: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.runtimeBinding._id, {
      runtimeCommit: receipt.runtimeCommit,
      runtimeImage: requireRuntimeImage(receipt.runtimeImage),
      ...(deployment.operation.runtimeUpdate
        ? {
            previousRuntime: {
              commit: deployment.runtimeBinding.runtimeCommit,
              image: deployment.runtimeBinding.runtimeImage,
            },
          }
        : {}),
      lastVerifiedAt: args.checkedAt,
      // Readiness just read our own health answer at this address.
      addressState: "ours",
      addressCheckedAt: args.checkedAt,
      updatedAt: now,
    });
    await ctx.db.patch(deployment.library._id, {
      activeRevisionId: deployment.revision._id,
      activeDeploymentOperationId: deployment.operation._id,
      updatedByClerkUserId: deployment.operation.requestedByClerkUserId,
      updatedAt: now,
    });
    // A custom domain change finishes here, and only here.
    const domainChange = deployment.operation.domainChange;
    if (domainChange) {
      // The domain must still be held by this change. If it is not, this
      // throws and the operation fails rather than reporting success for a
      // change that was never written.
      await settleDomainDeploymentRow(ctx, {
        domainId: domainChange.domainId,
        operationId: deployment.operation._id,
        token: domainChange.token,
        outcome: "succeeded",
      });
      // The library's new address is written in this same transaction as the
      // readiness-checked operation, so nothing that runs later can overwrite
      // a newer state with a stale one.
      if (domainChange.reason === "canonical" && domainChange.address) {
        await applyEvidenceLibraryCanonicalAddress(ctx, {
          libraryId: args.libraryId,
          domainId: domainChange.domainId,
          address: domainChange.address,
        });
      }
    }
    await updateDraftBaseRevision(ctx, deployment);
    return { status: "succeeded" as const };
  },
});

export const failConfigurationDeployment = internalMutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    attemptCount: v.number(),
    error: evidenceLibraryOperationFailureValidator,
  },
  returns: v.union(v.literal("failed"), v.literal("ignored")),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation ||
      operation.libraryId !== args.libraryId ||
      !isConfigurationDeploymentOperation(operation) ||
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
      issues: sanitizeConfigurationIssues(args.error.issues),
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      configurationReadinessPollCount: undefined,
      updatedAt: now,
    });
    // A domain change that failed gives the domain back, so the owner can
    // try again instead of waiting for a lease to expire. What it owes —
    // the proxy change and its deployment — is kept, so the retry knows
    // where it stopped.
    if (operation.domainChange) {
      await settleDomainDeploymentRow(ctx, {
        domainId: operation.domainChange.domainId,
        operationId: operation._id,
        // A failure only frees the change it was carrying: a newer one that
        // has already taken the domain keeps it.
        token: operation.domainChange.token,
        outcome: "failed",
      });
    }
    return "failed" as const;
  },
});

/**
 * Marks a deployment failed when the worker that held it stopped answering.
 * Booked whenever a lease is written, so nothing is left running for ever.
 */
export const failExpiredConfigurationDeployment = internalMutation({
  args: {
    operationId: v.id("evidenceLibraryConfigOperations"),
    attemptToken: v.string(),
    /** The deadline this watchdog was booked for. A renewal replaces it. */
    leaseExpiresAt: v.number(),
  },
  returns: v.union(v.literal("failed"), v.literal("ignored")),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation ||
      operation.status !== "running" ||
      // Another attempt has taken over, or this one finished.
      operation.configurationAttemptToken !== args.attemptToken ||
      // The work carried on, so a later watchdog owns this deployment now.
      operation.configurationLeaseExpiresAt !== args.leaseExpiresAt ||
      args.leaseExpiresAt > Date.now()
    ) {
      return "ignored" as const;
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "failed",
      error: {
        code: "CONFIGURATION_DEPLOYMENT_STALLED",
        message: "The publish stopped answering. Try again.",
        stage: operation.stage,
      },
      completedAt: now,
      configurationAttemptToken: undefined,
      configurationLeaseExpiresAt: undefined,
      updatedAt: now,
    });
    if (operation.domainChange) {
      await settleDomainDeploymentRow(ctx, {
        domainId: operation.domainChange.domainId,
        operationId: operation._id,
        token: operation.domainChange.token,
        outcome: "failed",
      });
    }
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
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.libraryId !== args.libraryId) {
      throw createError(
        "NOT_FOUND",
        "Evidence Library configuration deployment not found",
      );
    }
    if (!(await isRetryableConfigurationDeployment(ctx, operation))) {
      throw createError(
        "CONFLICT",
        "This Evidence Library configuration deployment cannot be retried",
      );
    }
    // A domain change that failed gave the domain back, so trying again has
    // to take it afresh. Done in the same transaction that books the worker,
    // so the retry never runs holding a lease that is no longer its own.
    if (operation?.domainChange) {
      const change = operation.domainChange;
      const domain = await ctx.db.get(
        "evidenceLibraryDomains",
        change.domainId,
      );
      if (!domain) {
        throw createError("NOT_FOUND", "That domain is no longer there");
      }
      // The failed attempt's own record does not stand in its way.
      if (domain.pendingDeployment?.operationId === args.operationId) {
        await ctx.db.patch(change.domainId, { pendingDeployment: undefined });
      }
      const fresh = await ctx.db.get("evidenceLibraryDomains", change.domainId);
      // A detach is a removal: its domain has `removingAt` set, which only
      // a removal is allowed to take.
      const claimed = await claimDomainTransitionRow(
        ctx,
        fresh!,
        change.reason === "detach"
          ? "remove"
          : change.reason === "canonical"
            ? "canonical"
            : "attach",
      );
      await claimed.write();
      await ctx.db.patch(change.domainId, {
        pendingDeployment: {
          operationId: args.operationId,
          phase: change.reason,
        },
        deploymentPending: undefined,
        updatedAt: Date.now(),
      });
      await ctx.db.patch(args.operationId, {
        domainChange: { ...change, token: claimed.token },
      });
    }
    return await claimAndScheduleConfigurationDeployment(ctx, args);
  },
});
