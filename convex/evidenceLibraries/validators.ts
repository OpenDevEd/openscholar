import { v } from "convex/values";
import { SECTION_REGISTRY } from "../../lib/evidence-libraries/configuration/section-registry";

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
export type SectionKey = (typeof SECTION_REGISTRY)[number]["key"];
export const sectionKeyValidator = v.union(
  ...(sectionKeyValidators as [
    (typeof sectionKeyValidators)[number],
    (typeof sectionKeyValidators)[number],
    ...(typeof sectionKeyValidators)[number][],
  ]),
);

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
  createdByClerkUserId: v.string(),
  updatedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
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
  rollbackOfRevisionId: v.union(v.id("evidenceLibraryConfigRevisions"), v.null()),
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

export const evidenceLibraryRuntimeBindingFields = {
  libraryId: v.id("evidenceLibraries"),
  targetRuntimeId: v.optional(v.string()),
  targetBaseUrl: v.string(),
  state: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
  searchHost: v.optional(v.string()),
  searchIndex: v.optional(v.string()),
  storageUrl: v.optional(v.string()),
  storageDocumentsBucket: v.optional(v.string()),
  storageImagesBucket: v.optional(v.string()),
  storageMaxPdfBytes: v.optional(v.number()),
  zoteroTranslationUrl: v.optional(v.string()),
  databaseCredentialId: v.optional(v.id("evidenceLibraryCredentials")),
  searchCredentialId: v.optional(v.id("evidenceLibraryCredentials")),
  storageCredentialId: v.optional(v.id("evidenceLibraryCredentials")),
  lastVerifiedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

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

export const evidenceLibraryOperationKindValidator = v.union(
  v.literal("setup"),
  v.literal("validate"),
  v.literal("publish"),
  v.literal("rollback"),
);

export const evidenceLibraryRunningStageValidator = v.union(
  v.literal("assembling"),
  v.literal("validating"),
  v.literal("publishing"),
  v.literal("activating"),
);

export const evidenceLibraryOperationReceiptValidator = v.object({
  revisionKey: v.optional(v.string()),
  targetConfigSha256: v.optional(v.string()),
  runtimeReceiptId: v.optional(v.string()),
  activatedAt: v.optional(v.number()),
});

export const evidenceLibraryOperationErrorInputValidator = v.object({
  code: v.string(),
  message: v.string(),
});

export const evidenceLibraryOperationFields = {
  libraryId: v.id("evidenceLibraries"),
  kind: evidenceLibraryOperationKindValidator,
  idempotencyKey: v.string(),
  revisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
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
  requestedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
};
