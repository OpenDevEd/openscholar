// What a library's configuration operations say now: the guards that ask whether one is under way or can be retried, and
// the checks on a runtime's receipt. Kept apart from `operations.ts`, which queues operations and reads a revision's
// changed sections through the 4 MB generated validator, so the many modules that only ask stay light.
import type { MutationCtx, QueryCtx } from "../lib/functions";
import type { Doc, Id } from "../_generated/dataModel";
import { CURRENT_OWNER_CONFIGURATION_VERSION } from "../../lib/evidence-libraries/configuration/owner-configuration-version";
import { createError } from "../lib/errors";
import { isConfigurationDeploymentOperation } from "./operationKinds";
import { isRuntimeImageReference } from "./runtimeImageRegistry";
import { readAttachedDomainOrigins } from "./domains";
import { MAX_CONFIGURATION_ISSUES } from "../lib/listCaps";
import { MAX_ACTIVE_OPERATIONS_READ } from "../lib/queryBounds";

/** Newest publish operations read to find the newest configuration deployment. */
const NEWEST_PUBLISHES_READ = 50;

type OperationReadCtx = QueryCtx | MutationCtx;
type ConfigurationDeploymentTarget = NonNullable<
  Doc<"evidenceLibraryConfigOperations">["configurationDeploymentTarget"]
>;

/**
 * A target may name the address a pending operation is about to make live.
 * Until readiness succeeds, the binding still names the address that serves
 * the current library.
 */
export function isCurrentConfigurationTargetBaseUrl(
  runtimeBinding: Doc<"evidenceLibraryRuntimeBindings">,
  targetBaseUrl: string,
  operation?: Doc<"evidenceLibraryConfigOperations">,
): boolean {
  const pendingAddressMove = operation?.addressMove;
  if (pendingAddressMove !== undefined) {
    return (
      targetBaseUrl === pendingAddressMove.to &&
      runtimeBinding.targetBaseUrl === pendingAddressMove.from
    );
  }
  return targetBaseUrl === runtimeBinding.targetBaseUrl;
}

/**
 * A library's queued or running operations of one kind, for the guards that ask whether a
 * setup or a deployment is under way. Only that kind is read, so requests nothing starts,
 * such as a queued validation, never count. One setup and one deployment run at a time;
 * past the bound the library is refused as busy by name, because a guard can't call it idle
 * on a partial read.
 */
export async function readActiveOperations(
  ctx: Pick<OperationReadCtx, "db">,
  libraryId: Id<"evidenceLibraries">,
  status: "queued" | "running",
  kind: "setup" | "publish",
) {
  const operations = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_status_and_kind", (query) =>
      query.eq("libraryId", libraryId).eq("status", status).eq("kind", kind),
    )
    .take(MAX_ACTIVE_OPERATIONS_READ + 1);
  if (operations.length > MAX_ACTIVE_OPERATIONS_READ) {
    console.error("[evidence library] More active operations than a guard reads", { libraryId, status, kind, read: MAX_ACTIVE_OPERATIONS_READ });
    throw createError("CONFLICT", `This community has more than ${MAX_ACTIVE_OPERATIONS_READ} ${status} ${kind} operations. Wait for them to finish before changing it.`);
  }
  return operations;
}

export { isConfigurationDeploymentOperation };

/** The target still describes the ready runtime and the revision being sent. */
export function isCurrentConfigurationDeploymentTarget(
  library: Doc<"evidenceLibraries">,
  revision: Doc<"evidenceLibraryConfigRevisions">,
  runtimeBinding: Doc<"evidenceLibraryRuntimeBindings"> | null,
  target: ConfigurationDeploymentTarget | undefined,
  operation?: Doc<"evidenceLibraryConfigOperations">,
): boolean {
  if (
    !target ||
    library.state !== "active" ||
    !runtimeBinding ||
    library.runtimeBindingId !== runtimeBinding._id ||
    runtimeBinding.libraryId !== library._id ||
    runtimeBinding.state !== "ready"
  ) {
    return false;
  }
  return (
    target.runtimeBindingId === runtimeBinding._id &&
    target.applicationId === runtimeBinding.targetRuntimeId &&
    isCurrentConfigurationTargetBaseUrl(
      runtimeBinding,
      target.targetBaseUrl,
      operation,
    ) &&
    target.revisionKey === revision.revisionKey
  );
}

const RETRYABLE_CONFIGURATION_FAILURE_CODES = new Set([
  "CONFIGURATION_DEPLOYMENT_STALLED",
  "COOLIFY_UNAVAILABLE",
  "READINESS_UNAVAILABLE",
  "DOMAIN_LOOKUP_UNAVAILABLE",
  "RUNTIME_ROUTE_UNAVAILABLE",
  "RUNTIME_NOT_READY",
  "CONFIG_NOT_READY",
  "PAGE_NOT_READY",
]);

function isRetryableConfigurationFailure(
  error: Doc<"evidenceLibraryConfigOperations">["error"],
): boolean {
  return (
    error !== undefined && RETRYABLE_CONFIGURATION_FAILURE_CODES.has(error.code)
  );
}

/**
 * The saved target still belongs to the current configuration deployment.
 * This check is independent of operation status so it can fence a claimed
 * retry before the worker contacts Coolify.
 */
export async function isAcceptableSavedConfigurationTarget(
  ctx: OperationReadCtx,
  operation: Doc<"evidenceLibraryConfigOperations">,
): Promise<boolean> {
  if (
    !isConfigurationDeploymentOperation(operation) ||
    !operation.revisionId ||
    !operation.configurationDeploymentTarget
  ) {
    return false;
  }
  const [library, revision] = await Promise.all([
    ctx.db.get("evidenceLibraries", operation.libraryId),
    ctx.db.get("evidenceLibraryConfigRevisions", operation.revisionId),
  ]);
  if (
    !library ||
    !revision ||
    revision.libraryId !== operation.libraryId ||
    revision.ownerConfigurationVersion !==
      CURRENT_OWNER_CONFIGURATION_VERSION ||
    (revision._id !== library.activeRevisionId &&
      revision.basedOnRevisionId !== library.activeRevisionId)
  ) {
    return false;
  }
  // Configuration deployments are publish operations, and nearly every publish is one, so
  // the newest is among the newest few publishes. Not finding one among them reads as a
  // stale target, which only means the next attempt assembles a new one.
  const publishes = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_kind_and_createdAt", (query) =>
      query.eq("libraryId", operation.libraryId).eq("kind", "publish"),
    )
    .order("desc")
    .take(NEWEST_PUBLISHES_READ);
  const newestConfigurationOperation = publishes.find(isConfigurationDeploymentOperation);
  if (newestConfigurationOperation?._id !== operation._id) return false;
  const runtimeBinding = library.runtimeBindingId
    ? await ctx.db.get(
        "evidenceLibraryRuntimeBindings",
        library.runtimeBindingId,
      )
    : null;
  if (
    !runtimeBinding ||
    runtimeBinding.state !== "ready" ||
    !isCurrentConfigurationDeploymentTarget(
      library,
      revision,
      runtimeBinding,
      operation.configurationDeploymentTarget,
      operation,
    )
  ) {
    return false;
  }
  const target = operation.configurationDeploymentTarget;
  if (!target) return false;
  if (operation.runtimeUpdate) {
    if (
      target.runtimeCommit !== operation.runtimeUpdate.to ||
      runtimeBinding.runtimeCommit !== operation.runtimeUpdate.from ||
      (operation.runtimeUpdate.toImage !== undefined &&
        target.runtimeImage !== operation.runtimeUpdate.toImage) ||
      (operation.runtimeUpdate.fromImage !== undefined &&
        runtimeBinding.runtimeImage !== operation.runtimeUpdate.fromImage)
    ) {
      return false;
    }
  } else if (
    target.runtimeCommit !== runtimeBinding.runtimeCommit ||
    (target.runtimeImage !== undefined &&
      target.runtimeImage !== runtimeBinding.runtimeImage)
  ) {
    return false;
  }
  const attachedDomains = await readAttachedDomainOrigins(
    ctx,
    operation.libraryId,
  );
  const targetDomains = [...target.customDomains].sort();
  if (attachedDomains.length !== targetDomains.length) return false;
  return attachedDomains.every(
    (domain, index) => domain === targetDomains[index],
  );
}

/**
 * Reopens a failed same-key command when another configuration command made
 * its saved target stale. The candidate and attempt history stay attached to
 * this operation, but the next attempt must assemble and save a new target.
 */
export async function reissueConfigurationDeploymentOperation(
  ctx: MutationCtx,
  operation: Doc<"evidenceLibraryConfigOperations">,
): Promise<void> {
  if (
    operation.status !== "failed" ||
    !isConfigurationDeploymentOperation(operation)
  ) {
    return;
  }
  if (
    operation.configurationDeploymentTarget &&
    (await isAcceptableSavedConfigurationTarget(ctx, operation))
  ) {
    return;
  }

  // The command must come after the newest configuration deployment; the newest operation
  // of any kind is at least as new, and is one read.
  const newest = await ctx.db
    .query("evidenceLibraryConfigOperations")
    .withIndex("by_libraryId_and_createdAt", (query) =>
      query.eq("libraryId", operation.libraryId),
    )
    .order("desc")
    .first();
  const newestCreatedAt = Math.max(operation.createdAt, newest?.createdAt ?? 0);
  const commandAt = Math.max(Date.now(), newestCreatedAt) + 1;
  await ctx.db.patch(operation._id, {
    configurationDeploymentTarget: undefined,
    receipt: undefined,
    createdAt: commandAt,
    updatedAt: commandAt,
  });
}

/**
 * One server decision shared by the owner projection and the retry mutation.
 * It never inspects an error message or exposes the saved target.
 */
export async function isRetryableConfigurationDeployment(
  ctx: OperationReadCtx,
  operation: Doc<"evidenceLibraryConfigOperations">,
): Promise<boolean> {
  return (
    operation.status === "failed" &&
    isConfigurationDeploymentOperation(operation) &&
    isRetryableConfigurationFailure(operation.error) &&
    (await isAcceptableSavedConfigurationTarget(ctx, operation))
  );
}

type OperationReceipt = {
  revisionKey?: string;
  targetConfigSha256?: string;
  runtimeReceiptId?: string;
  runtimeCommit?: string;
  runtimeImage?: string;
  coolifyConfigHash?: string;
  activatedAt?: number;
};

export function configurationOperationRequiresDeployment(
  operation: Pick<
    Doc<"evidenceLibraryConfigOperations">,
    "addressMove" | "domainChange" | "runtimeUpdate"
  >,
) {
  // Changing which address the library calls its own only changes its
  // configuration, which the running site takes without a restart. Adding or
  // removing a host changes the proxy's routes, which only a deployment does.
  return Boolean(
    operation.runtimeUpdate ||
      operation.addressMove ||
      (operation.domainChange &&
        (operation.domainChange.reason !== "canonical" ||
          operation.domainChange.redeploy === true)),
  );
}

export function validateOperationReceipt(
  receipt: OperationReceipt | undefined,
): OperationReceipt | undefined {
  if (!receipt) return undefined;
  const normalized: OperationReceipt = {};
  if (receipt.revisionKey !== undefined) {
    const revisionKey = receipt.revisionKey.trim();
    if (!revisionKey || revisionKey.length > 64) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt revisionKey must contain 1 to 64 characters",
      );
    }
    normalized.revisionKey = revisionKey;
  }
  if (receipt.targetConfigSha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/i.test(receipt.targetConfigSha256)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt targetConfigSha256 must be a 64-character digest",
      );
    }
    normalized.targetConfigSha256 = receipt.targetConfigSha256.toLowerCase();
  }
  if (receipt.runtimeReceiptId !== undefined) {
    const runtimeReceiptId = receipt.runtimeReceiptId.trim();
    if (!runtimeReceiptId || runtimeReceiptId.length > 200) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt runtimeReceiptId must contain 1 to 200 characters",
      );
    }
    normalized.runtimeReceiptId = runtimeReceiptId;
  }
  if (receipt.runtimeCommit !== undefined) {
    if (!/^[a-f0-9]{40}$/u.test(receipt.runtimeCommit)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt runtimeCommit must be a lowercase 40-character commit",
      );
    }
    normalized.runtimeCommit = receipt.runtimeCommit;
  }
  if (receipt.runtimeImage !== undefined) {
    if (!isRuntimeImageReference(receipt.runtimeImage)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt runtimeImage must use the fixed GHCR repository and an exact digest",
      );
    }
    normalized.runtimeImage = receipt.runtimeImage;
  }
  if (receipt.coolifyConfigHash !== undefined) {
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/iu.test(receipt.coolifyConfigHash)) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt coolifyConfigHash must be a 32- or 64-character digest",
      );
    }
    normalized.coolifyConfigHash = receipt.coolifyConfigHash.toLowerCase();
  }
  if (receipt.activatedAt !== undefined) {
    if (!Number.isFinite(receipt.activatedAt) || receipt.activatedAt < 0) {
      throw createError(
        "VALIDATION_ERROR",
        "Operation receipt activatedAt must be a finite non-negative number",
      );
    }
    normalized.activatedAt = receipt.activatedAt;
  }
  return normalized;
}


export type ConfigurationIssue = { pointer: string; message: string };

export function sanitizeConfigurationIssues(
  issues: readonly ConfigurationIssue[] | undefined,
): ConfigurationIssue[] | undefined {
  if (!issues || issues.length === 0) return undefined;
  return issues.slice(0, MAX_CONFIGURATION_ISSUES).map((issue) => ({
    pointer: issue.pointer.trim().slice(0, 500),
    message: issue.message.trim().slice(0, 500),
  }));
}

export function sanitizeOperationError(
  error: { code: string; message: string },
  stage: string,
) {
  const code = error.code.trim();
  const message = error.message.trim();
  if (!code || !message) {
    throw createError(
      "VALIDATION_ERROR",
      "Operation error code and message must not be blank",
    );
  }
  return {
    code: code.slice(0, 200),
    message: message.slice(0, 2_000),
    stage,
  };
}
