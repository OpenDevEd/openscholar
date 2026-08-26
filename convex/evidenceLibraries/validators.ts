import { v, type Infer } from "convex/values";
import {
  SECTION_REGISTRY,
  type SectionKey,
} from "../../lib/evidence-libraries/configuration/section-registry";

export type { SectionKey };

export const organizationStateValidator = v.union(
  v.literal("active"),
  v.literal("deleted"),
);

export const organizationRoleValidator = v.union(
  v.literal("org:admin"),
  v.literal("org:member"),
);

export const organizationMembershipStateValidator = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

export const evidenceLibraryAdminRoleValidator = v.union(
  v.literal("owner"),
  v.literal("editor"),
);

export const clerkEventOutcomeValidator = v.union(
  v.literal("applied"),
  v.literal("duplicate"),
  v.literal("stale"),
  v.literal("timestamp_conflict"),
);

export const clerkEventEntityTypeValidator = v.union(
  v.literal("user"),
  v.literal("organization"),
  v.literal("organizationMembership"),
);

export const clerkEventLogFields = {
  instanceId: v.string(),
  eventId: v.string(),
  eventType: v.string(),
  entityType: clerkEventEntityTypeValidator,
  entityId: v.string(),
  occurredAt: v.number(),
  payloadSha256: v.string(),
  outcome: clerkEventOutcomeValidator,
  processedAt: v.number(),
};

export const clerkOrganizationSnapshotFields = {
  clerkOrganizationId: v.string(),
  name: v.string(),
  slug: v.string(),
  imageUrl: v.optional(v.string()),
  clerkCreatedAt: v.number(),
  clerkUpdatedAt: v.number(),
};

export const organizationFields = {
  ...clerkOrganizationSnapshotFields,
  state: organizationStateValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const clerkMembershipSnapshotFields = {
  clerkMembershipId: v.string(),
  clerkUserId: v.string(),
  role: organizationRoleValidator,
  state: organizationMembershipStateValidator,
  clerkCreatedAt: v.number(),
  clerkUpdatedAt: v.number(),
  organization: v.object(clerkOrganizationSnapshotFields),
};

export const organizationMembershipFields = {
  organizationId: v.id("organizations"),
  clerkMembershipId: clerkMembershipSnapshotFields.clerkMembershipId,
  clerkUserId: clerkMembershipSnapshotFields.clerkUserId,
  role: clerkMembershipSnapshotFields.role,
  state: clerkMembershipSnapshotFields.state,
  clerkCreatedAt: clerkMembershipSnapshotFields.clerkCreatedAt,
  clerkUpdatedAt: clerkMembershipSnapshotFields.clerkUpdatedAt,
  createdAt: v.number(),
  updatedAt: v.number(),
};

const sectionKeyValidators = SECTION_REGISTRY.map((section) =>
  v.literal(section.key),
);
export const sectionKeyValidator = v.union(
  ...(sectionKeyValidators as [
    (typeof sectionKeyValidators)[number],
    (typeof sectionKeyValidators)[number],
    ...(typeof sectionKeyValidators)[number][],
  ]),
);

// One owner-edited section as it travels to and from the client. The payload
// is checked in the mutation against the generated validator for its section.
export const sectionRowValidator = v.object({
  sectionKey: sectionKeyValidator,
  payload: v.any(),
});

// One problem the full validator found while assembling a configuration.
export const configurationIssueValidator = v.object({
  pointer: v.string(),
  message: v.string(),
});

export const configProvenanceValidator = v.object({
  repository: v.string(),
  commit: v.string(),
  schemaVersion: v.number(),
  catalogVersion: v.number(),
  schemaSha256: v.string(),
  catalogsSha256: v.string(),
});

export const evidenceLibraryStateValidator = v.union(
  v.literal("provisioning"),
  v.literal("active"),
  v.literal("disabled"),
);

export const evidenceLibraryFields = {
  organizationId: v.id("organizations"),
  name: v.string(),
  slug: v.string(),
  state: evidenceLibraryStateValidator,
  draftId: v.optional(v.id("evidenceLibraryConfigDrafts")),
  latestRevisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
  setupOperationId: v.optional(v.id("evidenceLibraryConfigOperations")),
  runtimeBindingId: v.optional(v.id("evidenceLibraryRuntimeBindings")),
  activeRevisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
  activeDeploymentOperationId: v.optional(
    v.id("evidenceLibraryConfigOperations"),
  ),
  createdByClerkUserId: v.string(),
  updatedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const evidenceLibrarySetupIdentityFields = {
  name: v.string(),
  publicAddress: v.string(),
  shortName: v.string(),
  slug: v.string(),
};

export const evidenceLibraryConfigDraftFields = {
  libraryId: v.id("evidenceLibraries"),
  baseRevisionId: v.union(v.id("evidenceLibraryConfigRevisions"), v.null()),
  editVersion: v.number(),
  contractProvenance: configProvenanceValidator,
  createdByClerkUserId: v.string(),
  updatedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const evidenceLibraryConfigRevisionFields = {
  libraryId: v.id("evidenceLibraries"),
  revisionKey: v.string(),
  revisionNumber: v.number(),
  basedOnRevisionId: v.union(v.id("evidenceLibraryConfigRevisions"), v.null()),
  rollbackOfRevisionId: v.union(
    v.id("evidenceLibraryConfigRevisions"),
    v.null(),
  ),
  contractProvenance: configProvenanceValidator,
  createdByClerkUserId: v.string(),
  createdAt: v.number(),
};

export const evidenceLibraryConfigSectionValidator = v.union(
  v.object({
    kind: v.literal("draft"),
    libraryId: v.id("evidenceLibraries"),
    draftId: v.id("evidenceLibraryConfigDrafts"),
    sectionKey: sectionKeyValidator,
    payload: v.any(),
    payloadByteLength: v.number(),
    contractProvenance: configProvenanceValidator,
    updatedByClerkUserId: v.string(),
    updatedAt: v.number(),
  }),
  v.object({
    kind: v.literal("revision"),
    libraryId: v.id("evidenceLibraries"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    sectionKey: sectionKeyValidator,
    payload: v.any(),
    payloadByteLength: v.number(),
    contractProvenance: configProvenanceValidator,
    createdByClerkUserId: v.string(),
    createdAt: v.number(),
  }),
);

export const evidenceLibraryOperationErrorInputValidator = v.object({
  code: v.string(),
  message: v.string(),
});

// What a failed pipeline step reports. Assembly failures add the list of
// issues so the configuration page can show them.
export const evidenceLibraryOperationFailureValidator = v.object({
  code: v.string(),
  message: v.string(),
  issues: v.optional(v.array(configurationIssueValidator)),
});

const evidenceLibraryRuntimeBindingBaseFields = {
  libraryId: v.id("evidenceLibraries"),
  targetBaseUrl: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const evidenceLibraryRuntimeBindingProvisionedFields = {
  targetRuntimeId: v.string(),
  searchHost: v.string(),
  searchIndex: v.string(),
  storageUrl: v.string(),
  storagePrivateBucket: v.string(),
  storagePublicBucket: v.string(),
  storageMaxPdfBytes: v.number(),
  zoteroTranslationUrl: v.optional(v.string()),
  databaseCredentialId: v.id("evidenceLibraryCredentials"),
  searchCredentialId: v.id("evidenceLibraryCredentials"),
  storageCredentialId: v.id("evidenceLibraryCredentials"),
  lastVerifiedAt: v.optional(v.number()),
};

export const evidenceLibraryRuntimeBindingVariantFields = {
  pendingUnassigned: {
    ...evidenceLibraryRuntimeBindingBaseFields,
    state: v.literal("pending"),
  },
  pendingProvisioned: {
    ...evidenceLibraryRuntimeBindingBaseFields,
    ...evidenceLibraryRuntimeBindingProvisionedFields,
    state: v.literal("pending"),
  },
  ready: {
    ...evidenceLibraryRuntimeBindingBaseFields,
    ...evidenceLibraryRuntimeBindingProvisionedFields,
    state: v.literal("ready"),
  },
  failedUnassigned: {
    ...evidenceLibraryRuntimeBindingBaseFields,
    state: v.literal("failed"),
    error: evidenceLibraryOperationErrorInputValidator,
  },
  failedProvisioned: {
    ...evidenceLibraryRuntimeBindingBaseFields,
    ...evidenceLibraryRuntimeBindingProvisionedFields,
    state: v.literal("failed"),
    error: evidenceLibraryOperationErrorInputValidator,
  },
};

export const evidenceLibraryRuntimeBindingValidator = v.union(
  v.object(evidenceLibraryRuntimeBindingVariantFields.pendingUnassigned),
  v.object(evidenceLibraryRuntimeBindingVariantFields.pendingProvisioned),
  v.object(evidenceLibraryRuntimeBindingVariantFields.ready),
  v.object(evidenceLibraryRuntimeBindingVariantFields.failedUnassigned),
  v.object(evidenceLibraryRuntimeBindingVariantFields.failedProvisioned),
);

export const evidenceLibraryCredentialFields = {
  libraryId: v.id("evidenceLibraries"),
  credentialKey: v.string(),
  pathPattern: v.optional(v.string()),
  instanceKey: v.optional(v.string()),
  encryptedValue: v.string(),
  credentialDigest: v.optional(v.string()),
  maskedHint: v.optional(v.string()),
  validationState: v.union(
    v.literal("untested"),
    v.literal("valid"),
    v.literal("invalid"),
  ),
  lastValidatedAt: v.optional(v.number()),
  createdByClerkUserId: v.string(),
  updatedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const evidenceLibraryAdminLoginCodeFields = {
  libraryId: v.id("evidenceLibraries"),
  organizationId: v.id("organizations"),
  clerkUserId: v.string(),
  role: evidenceLibraryAdminRoleValidator,
  codeDigest: v.string(),
  issuedAt: v.number(),
  expiresAt: v.number(),
  consumedAt: v.optional(v.number()),
};

export const evidenceLibraryRequestableOperationKindValidator = v.union(
  v.literal("validate"),
  v.literal("rollback"),
);

export const evidenceLibraryOperationKindValidator = v.union(
  v.literal("setup"),
  v.literal("publish"),
  v.literal("teardown"),
  evidenceLibraryRequestableOperationKindValidator,
);
export type EvidenceLibraryOperationKind = Infer<
  typeof evidenceLibraryOperationKindValidator
>;

export const evidenceLibrarySetupStageValidator = v.union(
  v.literal("database"),
  v.literal("storage"),
  v.literal("application"),
  v.literal("deployment"),
  v.literal("health_check"),
);
export type EvidenceLibrarySetupStage = Infer<
  typeof evidenceLibrarySetupStageValidator
>;

export const evidenceLibraryReconcileOutcomeValidator = v.union(
  v.literal("created"),
  v.literal("matched"),
  v.literal("updated"),
);

export const evidenceLibraryDeploymentOutcomeValidator = v.union(
  v.literal("created"),
  v.literal("matched"),
);

const evidenceLibrarySetupResultVariantFields = {
  database: {
    outcome: evidenceLibraryReconcileOutcomeValidator,
    step: v.literal("database"),
    databaseName: v.string(),
    loginName: v.string(),
  },
  storage: {
    outcome: evidenceLibraryReconcileOutcomeValidator,
    step: v.literal("storage"),
    privateBucket: v.string(),
    publicBucket: v.string(),
  },
  application: {
    outcome: evidenceLibraryReconcileOutcomeValidator,
    step: v.literal("application"),
    applicationId: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
  },
  deployment: {
    outcome: evidenceLibraryDeploymentOutcomeValidator,
    step: v.literal("deployment"),
    applicationId: v.string(),
    deploymentId: v.string(),
    runtimeCommit: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
  },
  healthCheck: {
    outcome: v.literal("matched"),
    step: v.literal("health_check"),
    applicationId: v.string(),
    deploymentId: v.string(),
    revisionKey: v.string(),
  },
};

export const evidenceLibrarySetupResultValidator = v.union(
  v.object(evidenceLibrarySetupResultVariantFields.database),
  v.object(evidenceLibrarySetupResultVariantFields.storage),
  v.object(evidenceLibrarySetupResultVariantFields.application),
  v.object(evidenceLibrarySetupResultVariantFields.deployment),
  v.object(evidenceLibrarySetupResultVariantFields.healthCheck),
);
export type EvidenceLibrarySetupResult = Infer<
  typeof evidenceLibrarySetupResultValidator
>;

const evidenceLibrarySetupReceiptVariantFields = {
  database: {
    ...evidenceLibrarySetupResultVariantFields.database,
    checkedAt: v.number(),
  },
  storage: {
    ...evidenceLibrarySetupResultVariantFields.storage,
    checkedAt: v.number(),
  },
  application: {
    ...evidenceLibrarySetupResultVariantFields.application,
    checkedAt: v.number(),
  },
  deployment: {
    ...evidenceLibrarySetupResultVariantFields.deployment,
    checkedAt: v.number(),
  },
  healthCheck: {
    ...evidenceLibrarySetupResultVariantFields.healthCheck,
    checkedAt: v.number(),
  },
};

export const evidenceLibrarySetupReceiptValidator = v.union(
  v.object(evidenceLibrarySetupReceiptVariantFields.database),
  v.object(evidenceLibrarySetupReceiptVariantFields.storage),
  v.object(evidenceLibrarySetupReceiptVariantFields.application),
  v.object(evidenceLibrarySetupReceiptVariantFields.deployment),
  v.object(evidenceLibrarySetupReceiptVariantFields.healthCheck),
);
export type EvidenceLibrarySetupReceipt = Infer<
  typeof evidenceLibrarySetupReceiptValidator
>;

export const evidenceLibrarySetupReceiptsValidator = v.object({
  database: v.optional(
    v.object(evidenceLibrarySetupReceiptVariantFields.database),
  ),
  storage: v.optional(
    v.object(evidenceLibrarySetupReceiptVariantFields.storage),
  ),
  application: v.optional(
    v.object(evidenceLibrarySetupReceiptVariantFields.application),
  ),
  deployment: v.optional(
    v.object(evidenceLibrarySetupReceiptVariantFields.deployment),
  ),
  health_check: v.optional(
    v.object(evidenceLibrarySetupReceiptVariantFields.healthCheck),
  ),
});
export type EvidenceLibrarySetupReceipts = Infer<
  typeof evidenceLibrarySetupReceiptsValidator
>;

export const evidenceLibraryConfigRunningStageValidator = v.union(
  v.literal("assembling"),
  v.literal("validating"),
  v.literal("publishing"),
  v.literal("activating"),
);

export const evidenceLibraryOperationReceiptValidator = v.object({
  revisionKey: v.optional(v.string()),
  targetConfigSha256: v.optional(v.string()),
  runtimeReceiptId: v.optional(v.string()),
  runtimeCommit: v.optional(v.string()),
  coolifyConfigHash: v.optional(v.string()),
  activatedAt: v.optional(v.number()),
});

export const evidenceLibraryConfigurationDeploymentTargetValidator = v.object({
  applicationId: v.string(),
  runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
  targetBaseUrl: v.string(),
  revisionKey: v.string(),
  defaultLocale: v.string(),
  runtimeCommit: v.string(),
  encryptedRuntimeConfig: v.string(),
  runtimeConfigSha256: v.string(),
  savedAt: v.number(),
});

export const evidenceLibraryOperationFields = {
  libraryId: v.id("evidenceLibraries"),
  kind: evidenceLibraryOperationKindValidator,
  idempotencyKey: v.string(),
  activationEditVersion: v.optional(v.number()),
  revisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
  setupReceipts: v.optional(evidenceLibrarySetupReceiptsValidator),
  setupAttemptToken: v.optional(v.string()),
  setupLeaseExpiresAt: v.optional(v.number()),
  setupEncryptedDatabasePassword: v.optional(v.string()),
  setupRuntimeCommit: v.optional(v.string()),
  setupDeploymentId: v.optional(v.string()),
  setupDeploymentOutcome: v.optional(evidenceLibraryDeploymentOutcomeValidator),
  setupDeploymentNotBefore: v.optional(v.number()),
  setupDeploymentPollCount: v.optional(v.number()),
  setupReadinessPollCount: v.optional(v.number()),
  configurationDeploymentTarget: v.optional(
    evidenceLibraryConfigurationDeploymentTargetValidator,
  ),
  configurationAttemptToken: v.optional(v.string()),
  configurationLeaseExpiresAt: v.optional(v.number()),
  configurationDeploymentPollCount: v.optional(v.number()),
  configurationReadinessPollCount: v.optional(v.number()),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
  ),
  stage: v.union(
    v.literal("queued"),
    v.literal("assembling"),
    v.literal("validating"),
    v.literal("publishing"),
    v.literal("activating"),
    v.literal("database"),
    v.literal("storage"),
    v.literal("application"),
    v.literal("deployment"),
    v.literal("health_check"),
    v.literal("coolify"),
    v.literal("convex"),
    v.literal("completed"),
  ),
  attemptCount: v.number(),
  receipt: v.optional(evidenceLibraryOperationReceiptValidator),
  error: v.optional(
    v.object({
      code: v.string(),
      message: v.string(),
      stage: v.string(),
    }),
  ),
  issues: v.optional(v.array(configurationIssueValidator)),
  requestedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
};
