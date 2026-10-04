import { publicationSettingsValidator } from "./publicationValidators";
import type { GenericId } from "convex/values";
import { v, type Infer } from "convex/values";
import {
  SECTION_REGISTRY,
  type SectionKey,
} from "../../lib/evidence-libraries/configuration/section-registry";
import { MAX_LIBRARY_MEMBERS, MAX_ORGANIZATION_MEMBERS_READ, MAX_PENDING_INVITATIONS_PER_LIBRARY } from "../lib/queryBounds";
import { MAX_CONFIGURATION_ISSUES, MAX_CONFIG_SECTIONS, MAX_DNS_RECORDS, MAX_LIBRARY_DOMAINS, MAX_REDIRECT_URIS, MAX_RELEASES, MAX_RELEASE_CHANGES, MAX_RELEASE_NOTES, MAX_SECTION_PAYLOAD_BYTES, capped, sized } from "../lib/listCaps";

export type { SectionKey };

export const evidenceLibraryOperationAttemptArgsValidatorFields = {
  libraryId: v.id("evidenceLibraries"),
  operationId: v.id("evidenceLibraryConfigOperations"),
  attemptToken: v.string(),
  attemptCount: v.number(),
};

/**
 * What a publish saw of the AI provider key: which row it read and when that
 * row last changed, or the fact that there was none. Carried through the
 * deployment so a Replace or a Remove that lands mid-publish is noticed
 * instead of shipping the old key. Never the key itself, encrypted or not:
 * this travels on the operation, which owners can read.
 */
export const libraryCredentialSourceValidator = v.union(
  v.object({ present: v.literal(false) }),
  v.object({
    present: v.literal(true),
    id: v.id("evidenceLibraryCredentials"),
    // A hash of the stored ciphertext. It changes on every write, including
    // two in the same millisecond, and says nothing about the key itself.
    digest: v.string(),
  }),
);
export type LibraryCredentialSource = Infer<
  typeof libraryCredentialSourceValidator
>;

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
  v.literal("creator"),
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
  /**
   * Whether the platform team switched Evidence Libraries on for this
   * organisation, from Clerk public metadata `{ "evidenceLibraries": true }`.
   * The webhook always computes it, so the snapshot always carries it.
   */
  evidenceLibrariesEnabled: v.boolean(),
  authorsEnabled: v.boolean(),
  extractionEnabled: v.boolean(),
  devEnabled: v.optional(v.boolean()),
  clerkCreatedAt: v.number(),
  clerkUpdatedAt: v.number(),
};

export const organizationFields = {
  ...clerkOrganizationSnapshotFields,
  authorsEnabled: v.optional(v.boolean()),
  extractionEnabled: v.optional(v.boolean()),
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

/** A section's settings: its contract checks the shape, and its JSON stays within MAX_SECTION_PAYLOAD_BYTES. */
export const sectionPayloadValidator = sized(v.any(), MAX_SECTION_PAYLOAD_BYTES);

// One owner-edited section as it travels to and from the client. The payload
// is checked in the mutation against the generated validator for its section.
export const sectionRowValidator = v.object({
  sectionKey: sectionKeyValidator,
  payload: sectionPayloadValidator,
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

// Revisions preserve every supported historical version. Draft storage accepts
// the previous version during the widen-migrate-narrow rollout so existing rows
// can be loaded and migrated transactionally before this is narrowed again.
export const ownerConfigurationVersionValidator = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
  v.literal(5),
  v.literal(6),
  v.literal(7),
  v.literal(8),
);
export const draftOwnerConfigurationVersionValidator = v.union(
  v.literal(3),
  v.literal(4),
  v.literal(5),
  v.literal(6),
  v.literal(7),
  v.literal(8),
);
export const currentOwnerConfigurationVersionValidator = v.literal(8);

export const evidenceLibraryStateValidator = v.union(
  v.literal("provisioning"),
  v.literal("active"),
  v.literal("disabled"),
);

export const evidenceLibraryFields = {
  activePublicationConfigDigest: v.optional(v.string()),
  // Set once every approved OpenAlex query version in the library's revisions is in
  // evidenceLibraryApprovedQueries; until then a sources save reads the revisions (#357).
  approvedQueriesRecorded: v.optional(v.literal(true)),
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

// One custom domain of one library. `host` is unique across the platform.
export const evidenceLibraryDomainStateValidator = v.union(
  // Saved; the records have not been seen yet.
  v.literal("added"),
  // The CNAME chain reaches our target.
  v.literal("pointing"),
  // The ownership record matches too.
  v.literal("verified"),
  // The library answers on the domain.
  v.literal("active"),
  // The last check failed; `failure` says why.
  v.literal("failed"),
);

// Only reasons a check actually found. A check that could not run writes
// nothing at all, so it has no stored reason.
/** Which part of deleting a library stopped, as a name the page can say. */
export const evidenceLibraryTeardownStepValidator = v.union(
  v.literal("runtime"),
  v.literal("files"),
  v.literal("database"),
  v.literal("records"),
);

export const evidenceLibraryDomainFailureValidator = v.union(
  v.literal("no-name"),
  v.literal("no-records"),
  v.literal("wrong-target"),
  v.literal("token-mismatch"),
  v.literal("host-taken"),
  v.literal("not-served"),
  v.literal("caa-blocked"),
  v.literal("tls-timeout"),
);

export const evidenceLibraryDomainFields = {
  libraryId: v.id("evidenceLibraries"),
  host: v.string(),
  verificationToken: v.string(),
  verificationHost: v.string(),
  role: v.union(v.literal("primary"), v.literal("redirect")),
  state: evidenceLibraryDomainStateValidator,
  failure: v.optional(evidenceLibraryDomainFailureValidator),
  // Set while the host is in the proxy's domain list. Kept apart from
  // `state` so a check that has not run yet cannot silently drop a host the
  // proxy is already serving.
  attachedAt: v.optional(v.number()),
  // One lease covers every change to this domain: checking, attaching,
  // becoming the library's address, and being removed. Whoever holds it is
  // the only one who may write, and every write carries the same token, so a
  // slow step cannot land after another has taken over.
  transition: v.optional(
    v.object({
      kind: v.union(
        v.literal("check"),
        v.literal("attach"),
        v.literal("canonical"),
        v.literal("remove"),
      ),
      token: v.string(),
      expiresAt: v.number(),
    }),
  ),
  // The deployment that has to carry the current proxy change to the running
  // site. Cleared only when that deployment succeeds, so a failed one is
  // still owed and a retry redeploys rather than probing.
  pendingDeployment: v.optional(
    v.object({
      operationId: v.id("evidenceLibraryConfigOperations"),
      token: v.string(),
      phase: v.union(
        v.literal("attach"),
        v.literal("detach"),
        v.literal("canonical"),
      ),
    }),
  ),
  // Counts every change this domain has been through. It goes into each
  // operation's key, so the same change asked for twice is two operations
  // rather than one that already succeeded and will not run again.
  // How many changes this domain has been through. Every change reads it,
  // writes with it, and moves it on, so no two changes can share a key.
  generation: v.number(),
  // Set the moment the proxy was written but before the deployment exists.
  deploymentPending: v.optional(v.boolean()),
  // Whether the name is a zone of its own, read from its records rather
  // than guessed from how many parts it has.
  isApex: v.optional(v.boolean()),
  // Set once the owner asked for the domain to go. The row survives until
  // the proxy has been redeployed without it.
  removingAt: v.optional(v.number()),
  // Set when the owner removed the library's main address. It stays until
  // the next activation has moved the library to another address, and then
  // goes by itself.
  removeOnActivateAt: v.optional(v.number()),
  // Set just before the proxy is asked to hold this host, so a crash between
  // the proxy accepting it and the receipt being saved is still visible.
  attachIntentAt: v.optional(v.number()),
  checkedAt: v.optional(v.number()),
  activatedAt: v.optional(v.number()),
  createdByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
};

// One writer at a time for a library's custom-domain route file. Each writer
// reads the attached domains after it takes this, so the last write always
// carries the newest set.
export const evidenceLibraryDomainRouteLeaseFields = {
  libraryId: v.id("evidenceLibraries"),
  token: v.string(),
  expiresAt: v.number(),
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
  ownerConfigurationVersion: draftOwnerConfigurationVersionValidator,
  contractProvenance: configProvenanceValidator,
  // The address the owner chose for the library, applied by the next
  // activation like any other change: a domain, or null for the platform
  // address. Absent means the address stays as it is.
  mainDomainId: v.optional(v.union(v.id("evidenceLibraryDomains"), v.null())),
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
  ownerConfigurationVersion: ownerConfigurationVersionValidator,
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
    payload: sectionPayloadValidator,
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
    payload: sectionPayloadValidator,
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
  issues: capped(v.optional(v.array(configurationIssueValidator)), MAX_CONFIGURATION_ISSUES),
});

// Who answers the public address, from the last check. "not-ours" means
// another site holds it; "unreachable" means nothing answered.
export const evidenceLibraryAddressStateValidator = v.union(
  v.literal("ours"),
  v.literal("not-ours"),
  v.literal("unreachable"),
);

const evidenceLibraryRuntimeBindingBaseFields = {
  libraryId: v.id("evidenceLibraries"),
  targetBaseUrl: v.string(),
  // The address the library calls its own. Unset means the platform address.
  // A custom domain the owner made primary is held here; the platform
  // address stays on `targetBaseUrl` and is never released, because DOI
  // landing pages already registered point at it.
  canonicalBaseUrl: v.optional(v.string()),
  addressState: v.optional(evidenceLibraryAddressStateValidator),
  addressCheckedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};

const evidenceLibraryRuntimeBindingProvisionedFields = {
  targetRuntimeId: v.string(),
  // The Evidence Library software commit the library runs. Setup writes it;
  // every completed publish rewrites it from the operation receipt.
  runtimeCommit: v.string(),
  runtimeImage: v.string(),
  previousRuntime: v.optional(
    v.object({
      commit: v.string(),
      image: v.string(),
    }),
  ),
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

// One commit between the software a library runs and the newest software.
export const runtimeReleaseChangeValidator = v.object({
  sha: v.string(),
  message: v.string(),
});

// One published Evidence Library release: its commit and the plain-language
// notes written for library owners.
export const runtimeReleaseNotesValidator = v.object({
  commit: v.string(),
  summary: v.string(),
  notes: capped(v.array(v.string()), MAX_RELEASE_NOTES),
});

// The newest Evidence Library software commit, checked against GitHub and
// kept for ten minutes. One row per running commit.
/**
 * Whether the running software and the latest release read the configuration
 * contract OpenScholar is pinned to (`commit`). Rows checked against another
 * contract say nothing about this one.
 */
export const runtimeContractSupportValidator = v.object({
  commit: v.string(),
  running: v.boolean(),
  latest: v.boolean(),
});

export const evidenceLibraryDigestResultValidator = v.object({
  title: v.string(),
  summary: v.string(),
  markdown: v.string(),
  model: v.string(),
  reasoning: v.string(),
});

export const evidenceLibraryDigestJobFields = {
  libraryId: v.id("evidenceLibraries"),
  editionId: v.string(),
  requestId: v.optional(v.id("_storage")),
  status: v.union(v.literal("pending"), v.literal("succeeded"), v.literal("failed")),
  startedAt: v.number(),
  result: v.optional(evidenceLibraryDigestResultValidator),
};

/** The commits and the release notes one software check holds, capped as the release row stores them. */
export const runtimeReleaseChangesValidator = capped(v.array(runtimeReleaseChangeValidator), MAX_RELEASE_CHANGES);
export const runtimeReleasesValidator = capped(v.array(runtimeReleaseNotesValidator), MAX_RELEASES);

export const evidenceLibraryRuntimeReleaseFields = {
  running: v.string(),
  latest: v.string(),
  latestImage: v.string(),
  changes: runtimeReleaseChangesValidator,
  // Rows written before release notes existed have no list; the check treats
  // them as stale and asks GitHub again.
  releases: capped(v.optional(v.array(runtimeReleaseNotesValidator)), MAX_RELEASES),
  checkedAt: v.number(),
  contractSupport: v.optional(runtimeContractSupportValidator),
};

export const evidenceLibraryCredentialFields = {
  publicationSettings: v.optional(publicationSettingsValidator),
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
    runtimeImage: v.string(),
    runtimeConfigSha256: v.string(),
    coolifyConfigHash: v.string(),
  },
  deployment: {
    outcome: evidenceLibraryDeploymentOutcomeValidator,
    step: v.literal("deployment"),
    applicationId: v.string(),
    deploymentId: v.string(),
    runtimeCommit: v.string(),
    runtimeImage: v.string(),
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

const evidenceLibraryOperationReceiptBaseFields = {
  revisionKey: v.optional(v.string()),
  targetConfigSha256: v.optional(v.string()),
  runtimeReceiptId: v.optional(v.string()),
  coolifyConfigHash: v.optional(v.string()),
  activatedAt: v.optional(v.number()),
};

export const evidenceLibraryOperationReceiptValidator = v.union(
  v.object({
    ...evidenceLibraryOperationReceiptBaseFields,
    runtimeCommit: v.string(),
    runtimeImage: v.string(),
  }),
  v.object(evidenceLibraryOperationReceiptBaseFields),
);

export const evidenceLibraryConfigurationDeploymentTargetValidator = v.object({
  applicationId: v.string(),
  // The AI key row this configuration was built from, so a Replace or a
  // Remove during the publish is caught before the library goes live.
  aiProviderKey: libraryCredentialSourceValidator,
  openAlexApiKey: libraryCredentialSourceValidator,
  publicationProviders: v.optional(libraryCredentialSourceValidator),
  runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
  targetBaseUrl: v.string(),
  // The custom domains the proxy serves beside the platform address, taken
  // from our own records when the deployment was planned.
  customDomains: capped(v.array(v.string()), MAX_LIBRARY_DOMAINS),
  revisionKey: v.string(),
  defaultLocale: v.string(),
  runtimeCommit: v.string(),
  runtimeImage: v.string(),
  encryptedRuntimeConfig: v.string(),
  runtimeConfigSha256: v.string(),
  savedAt: v.number(),
});

// A publish that moves the library to newer Evidence Library software. The
// sections stay the same; only the software commit changes.
export const evidenceLibraryRuntimeUpdateValidator = v.object({
  from: v.string(),
  to: v.string(),
  fromImage: v.string(),
  toImage: v.string(),
});

// Where the platform is sending a library after another site answered its
// address. `from` is the address it started on, `to` the one it is taking.
// `applied` says whether the records already carry `to`; a live move only
// writes them once Coolify serves the new address.
export const evidenceLibraryAddressMoveValidator = v.object({
  from: v.string(),
  to: v.string(),
  movedAt: v.number(),
  count: v.number(),
  applied: v.boolean(),
});

// A publish caused by a custom domain: the proxy rules only reach the
// running container through a deployment, and making a domain primary also
// rewrites the address the library calls its own.
export const evidenceLibraryDomainChangeValidator = v.object({
  host: v.string(),
  domainId: v.id("evidenceLibraryDomains"),
  reason: v.union(
    v.literal("attach"),
    v.literal("detach"),
    v.literal("canonical"),
  ),
  // For a canonical change: the address the library should call its own once
  // this deployment is live. Nothing is written until it is.
  address: v.optional(v.string()),
  // For a canonical change away from a custom domain: carried by a
  // deployment, which never has to reach that domain or its certificate.
  redeploy: v.optional(v.literal(true)),
  // The lease this change holds on the domain. Checked when the deployment
  // finishes, so a change that was overtaken cannot land. Every domain
  // change carries one.
  token: v.string(),
});

export const evidenceLibraryOperationFields = {
  libraryId: v.id("evidenceLibraries"),
  kind: evidenceLibraryOperationKindValidator,
  idempotencyKey: v.string(),
  activationEditVersion: v.optional(v.number()),
  runtimeUpdate: v.optional(evidenceLibraryRuntimeUpdateValidator),
  addressMove: v.optional(evidenceLibraryAddressMoveValidator),
  domainChange: v.optional(evidenceLibraryDomainChangeValidator),
  revisionId: v.optional(v.id("evidenceLibraryConfigRevisions")),
  setupReceipts: v.optional(evidenceLibrarySetupReceiptsValidator),
  setupAttemptToken: v.optional(v.string()),
  setupLeaseExpiresAt: v.optional(v.number()),
  setupEncryptedDatabasePassword: v.optional(v.string()),
  // What the setup saw of the AI key. Kept until the library is live so the
  // last step can refuse a key that moved on the way.
  setupAiProviderKey: v.optional(libraryCredentialSourceValidator),
  setupPublicationProviders: v.optional(libraryCredentialSourceValidator),
  setupOpenAlexApiKey: v.optional(libraryCredentialSourceValidator),
  setupRuntimeCommit: v.optional(v.string()),
  setupRuntimeImage: v.optional(v.string()),
  setupDeploymentId: v.optional(v.string()),
  setupDeploymentOutcome: v.optional(evidenceLibraryDeploymentOutcomeValidator),
  setupDeploymentNotBefore: v.optional(v.number()),
  setupDeploymentPollCount: v.optional(v.number()),
  // A running teardown holds the operation for a while. Without it, an
  // attempt that died left the teardown running for ever and every later
  // attempt walked away.
  teardownLeaseExpiresAt: v.optional(v.number()),
  // Names the attempt that holds the teardown. Every write it makes carries
  // it, so a replacement worker after the claim expired cannot be written
  // over by the attempt it replaced.
  teardownAttemptToken: v.optional(v.string()),
  // Saved before Coolify is asked to delete the application. A later retry
  // still needs the UUID to remove the application's exact data volume after
  // the Coolify row and tag have gone.
  teardownApplicationId: v.optional(v.string()),
  setupReadinessPollCount: v.optional(v.number()),
  configurationDeploymentTarget: v.optional(
    evidenceLibraryConfigurationDeploymentTargetValidator,
  ),
  configurationAttemptToken: v.optional(v.string()),
  configurationLeaseExpiresAt: v.optional(v.number()),
  // Which part of deleting the library stopped, so the list can say it in
  // plain words instead of repeating another service's message.
  teardownFailedStep: v.optional(evidenceLibraryTeardownStepValidator),
  configurationDeploymentPollCount: v.optional(v.number()),
  configurationReadinessPollCount: v.optional(v.number()),
  // A direct activation that failed after it may have landed, and put the
  // previous configuration back. The runtime stamped that one with the time
  // it ran, so a retry has to build a newer copy than the one saved here.
  rolledBackAt: v.optional(v.number()),
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
  issues: capped(v.optional(v.array(configurationIssueValidator)), MAX_CONFIGURATION_ISSUES),
  requestedByClerkUserId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
};

/**
 * What an owner may read about an operation. An allowlist, so a field added
 * to the table later is private until someone chooses to publish it. The
 * fields left out hold the library's encrypted configuration, its database
 * password, and the leases only the platform uses.
 */
const PUBLIC_OPERATION_FIELDS = [
  "libraryId",
  "kind",
  "activationEditVersion",
  "runtimeUpdate",
  "addressMove",
  "revisionId",
  "setupReceipts",
  "status",
  "stage",
  "attemptCount",
  "receipt",
  "error",
  "issues",
  "teardownFailedStep",
  "requestedByClerkUserId",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
] as const satisfies readonly (keyof typeof evidenceLibraryOperationFields)[];

export const evidenceLibraryPublicOperationFields = Object.fromEntries(
  PUBLIC_OPERATION_FIELDS.map((key) => [
    key,
    evidenceLibraryOperationFields[key],
  ]),
) as Pick<
  typeof evidenceLibraryOperationFields,
  (typeof PUBLIC_OPERATION_FIELDS)[number]
>;

type EvidenceLibraryOperationRow = Infer<
  ReturnType<typeof v.object<typeof evidenceLibraryOperationFields>>
> & {
  _id: GenericId<"evidenceLibraryConfigOperations">;
  _creationTime: number;
};

/** The operation as an owner sees it: the allowlisted fields and nothing else. */
export function toPublicEvidenceLibraryOperation(
  operation: EvidenceLibraryOperationRow,
) {
  const publicOperation: Record<string, unknown> = {
    _id: operation._id,
    _creationTime: operation._creationTime,
  };
  for (const key of PUBLIC_OPERATION_FIELDS) {
    if (operation[key] !== undefined) publicOperation[key] = operation[key];
  }
  return publicOperation as Pick<
    EvidenceLibraryOperationRow,
    "_id" | "_creationTime" | (typeof PUBLIC_OPERATION_FIELDS)[number]
  >;
}

/**
 * A deleted OpenScholar account is removed from every library, not only the
 * ones the reader comes back to. One row per library still owed the call; the
 * row goes away when the library confirms.
 */
export const evidenceLibraryReaderDeletionFields = {
  libraryId: v.id("evidenceLibraries"),
  clerkUserId: v.string(),
  attempts: v.number(),
  state: v.union(v.literal("pending"), v.literal("failed")),
  lastError: v.optional(v.object({ status: v.optional(v.number()), message: v.string() })),
  createdAt: v.number(),
  updatedAt: v.number(),
};

/**
 * The Clerk OAuth application a library signs readers and admins in with.
 * `intentAt` is written before Clerk is asked to create it, so an attempt
 * whose answer was lost is adopted on the next try instead of repeated.
 * `redirectUris` is what Clerk last confirmed; every sync reads Clerk again,
 * because an answer can be lost after Clerk applied the change.
 */
export const evidenceLibraryOAuthClientFields = {
  libraryId: v.id("evidenceLibraries"),
  intentAt: v.number(),
  applicationId: v.optional(v.string()),
  clientId: v.optional(v.string()),
  encryptedClientSecret: v.optional(v.string()),
  discoveryUrl: v.optional(v.string()),
  redirectUris: capped(v.array(v.string()), MAX_REDIRECT_URIS),
  // One sync at a time per library: two that overlap could each create an
  // application, or save a secret Clerk has already replaced.
  lease: v.optional(v.object({ token: v.string(), expiresAt: v.number() })),
  lastError: v.optional(
    v.object({
      status: v.optional(v.number()),
      code: v.optional(v.string()),
      traceId: v.optional(v.string()),
      message: v.string(),
      at: v.number(),
    }),
  ),
  updatedAt: v.number(),
};

/**
 * Clerk users OpenScholar has seen deleted, kept even when no user row ever
 * existed, so a deletion delivered before the creation is not forgotten.
 */
export const clerkDeletedUserFields = {
  clerkId: v.string(),
  deletedAt: v.number(),
};

/** The DNS records one custom domain needs. */
export const dnsRecordsValidator = capped(
  v.array(
    v.object({
      type: v.union(v.literal("A"), v.literal("CNAME"), v.literal("TXT")),
      label: v.string(),
      name: v.string(),
      value: v.string(),
    }),
  ),
  MAX_DNS_RECORDS,
);

/** What a check found for each of a library's domains still waiting: at most the MAX_LIBRARY_DOMAINS a library has. */
export const checkedDomainResultsValidator = capped(
  v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      state: evidenceLibraryDomainStateValidator,
      failure: v.optional(evidenceLibraryDomainFailureValidator),
    }),
  ),
  MAX_LIBRARY_DOMAINS,
);

/** A custom domain as the Domain section shows it. A library has at most MAX_LIBRARY_DOMAINS (./domains.ts refuses more). */
export const domainRowsValidator = capped(
  v.array(
    v.object({
      domainId: v.id("evidenceLibraryDomains"),
      host: v.string(),
      role: v.union(v.literal("primary"), v.literal("redirect")),
      state: evidenceLibraryDomainStateValidator,
      failure: v.optional(evidenceLibraryDomainFailureValidator),
      attached: v.boolean(),
      removing: v.boolean(),
      deploymentPending: v.boolean(),
      isApex: v.boolean(),
      checkedAt: v.optional(v.number()),
      suggestedWwwHost: v.optional(v.string()),
      /** The main address the owner chose, applied by the next activation. */
      main: v.boolean(),
      /** Removed by the owner; goes once the next activation is live. */
      removeOnActivate: v.boolean(),
      records: dnsRecordsValidator,
    }),
  ),
  MAX_LIBRARY_DOMAINS,
);

/** The sections one configuration version changed. */
export const changedSectionsValidator = capped(v.array(sectionKeyValidator), MAX_CONFIG_SECTIONS);

const sectionFields = { sectionKey: sectionKeyValidator, payload: sectionPayloadValidator, payloadByteLength: v.number(), contractProvenance: configProvenanceValidator };
/** A draft's or a revision's sections: one per section key, so never more than the registry holds. */
export const draftSectionsValidator = capped(v.array(v.object({ ...sectionFields, updatedAt: v.number() })), MAX_CONFIG_SECTIONS);
export const revisionSectionsValidator = capped(v.array(v.object({ ...sectionFields, createdAt: v.number() })), MAX_CONFIG_SECTIONS);

/** One person on a library's team page. */
export const teamPersonValidator = v.object({
  clerkUserId: v.string(),
  name: v.string(),
  email: v.string(),
  imageUrl: v.optional(v.string()),
});
/** People of the library's organization: its owners, or those who could be added. A team page reads no more members than this and refuses a larger organization. */
export const organizationPeopleValidator = capped(v.array(teamPersonValidator), MAX_ORGANIZATION_MEMBERS_READ);
/** People a library grants a role to directly: granting another past this is refused. */
export const grantedPeopleValidator = capped(v.array(teamPersonValidator), MAX_LIBRARY_MEMBERS);
/** A library's invitations waiting: inviting another past this is refused. */
export const teamInvitationsValidator = capped(
  v.array(v.object({ invitationId: v.id("evidenceLibraryInvitations"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")), delivery: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed")) })),
  MAX_PENDING_INVITATIONS_PER_LIBRARY,
);
