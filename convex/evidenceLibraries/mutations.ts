import { hasPublicationProviderChanges } from "./publicationProviders";
import { requireLibraryOrganization } from "../organizationFeatures";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createInitialEvidenceLibraryShortName } from "../../lib/evidence-libraries/setup/naming";
import {
  aiProviderIssues,
  selectedAiModelIds,
} from "../../lib/evidence-libraries/configuration/ai";
import {
  initialIdentityPayload,
  initialLocalizationPayload,
} from "../../lib/evidence-libraries/configuration/initial-sections";
import {
  type OwnerSectionRow,
  validateOwnerSections,
} from "../../lib/evidence-libraries/configuration/owner-rules";
import {
  CURRENT_OWNER_CONFIGURATION_VERSION,
} from "../../lib/evidence-libraries/configuration/owner-configuration-migrations";
import { isPlatformMailConfigured } from "./platformMail";
import { createError } from "../lib/errors";
import {
  requireEvidenceLibraryAccess,
} from "./access";
import { nextDraftEditVersion } from "./draftVersion";
import {
  attachRevisionToSetupOperation,
  queueConfigurationDeploymentOperation,
  queueEvidenceLibraryOperation,
} from "./operations";
import {
  claimAndScheduleConfigurationDeployment,
  requireNoActiveConfigurationDeployment,
} from "./configurationDeployment";
import { claimAndScheduleEvidenceLibrarySetupOperation } from "./setupOperation";
import {
  createPendingRuntimeBinding,
  validateTargetBaseUrl,
} from "./provisioning";
import {
  assertDraftPayloadBudget,
  assertNoCredentialMaterial,
  validateSectionPayload,
} from "./sectionPayload";
import {
  isEvidenceLibraryAddressFree,
  readEvidenceLibraryByName,
  readEvidenceLibrarySetupIdentity,
  readEvidenceLibraryIdentityNames,
  validateEvidenceLibrarySetupName,
  type EvidenceLibrarySetupIdentity,
} from "./setupNaming";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import {
  configurationSnapshotsEqual,
  loadDraftConfigurationSnapshot,
  loadRevisionConfigurationSnapshot,
  persistDraftConfigurationSnapshot,
} from "./configurationSnapshot";
import {
  evidenceLibrarySetupIdentityFields,
  sectionRowValidator,
} from "./validators";

const SETUP_OPERATION_IDEMPOTENCY_KEY = "library-setup";

function toSetupDraftResult(
  setup: Awaited<ReturnType<typeof readEvidenceLibrarySetupRecords>>,
  identity: EvidenceLibrarySetupIdentity,
) {
  if (setup.library.state !== "provisioning") {
    throw createError(
      "CONFLICT",
      "Evidence Library setup is no longer a draft",
    );
  }
  return {
    draftId: setup.draft._id,
    editVersion: setup.draft.editVersion,
    ...identity,
    libraryId: setup.library._id,
    revisionId: setup.revision._id,
    runtimeBindingId: setup.runtimeBinding._id,
    setupOperationId: setup.setupOperation._id,
    state: "provisioning" as const,
  };
}

export async function createEvidenceLibrarySetup(
  ctx: MutationCtx,
  args: { name: string; slug: string; publicAddress: string; organizationId: Id<"organizations"> },
) {
  const access = await requireLibraryOrganization(ctx, args.organizationId);
  const name = validateEvidenceLibrarySetupName(args.name);
  const shortName = createInitialEvidenceLibraryShortName(name);
  const slug = args.slug.trim();
  const publicAddress = validateTargetBaseUrl(args.publicAddress);
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw createError(
      "VALIDATION_ERROR",
      "Invalid Evidence Library name or slug",
    );
  }
  const existing = await ctx.db
    .query("evidenceLibraries")
    .withIndex("by_organizationId_and_slug", (query) =>
      query.eq("organizationId", access.organization._id).eq("slug", slug),
    )
    .unique();
  if (existing) {
    const setup = await readEvidenceLibrarySetupRecords(ctx, existing);
    const identity = await readEvidenceLibrarySetupIdentity(ctx, setup);
    if (
      identity.name !== name ||
      identity.publicAddress !== publicAddress ||
      identity.shortName !== shortName ||
      identity.slug !== slug
    ) {
      throw createError(
        "CONFLICT",
        "Evidence Library setup retry does not match the original request",
      );
    }
    return toSetupDraftResult(setup, identity);
  }

  const now = Date.now();
  const libraryId = await ctx.db.insert("evidenceLibraries", {
    organizationId: access.organization._id,
    name,
    slug,
    state: "provisioning",
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {
    libraryId,
    revisionKey: "r1",
    revisionNumber: 1,
    basedOnRevisionId: null,
    rollbackOfRevisionId: null,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
    libraryId,
    baseRevisionId: revisionId,
    editVersion: 0,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  // A new library starts with identity and localization only. Every other
  // section is absent until the owner saves it and takes the schema defaults.
  const seededSections: OwnerSectionRow[] = [
    {
      sectionKey: "identity",
      payload: initialIdentityPayload({ baseUrl: publicAddress, name, shortName }),
    },
    { sectionKey: "localization", payload: initialLocalizationPayload() },
  ];
  for (const section of seededSections) {
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "draft",
      libraryId,
      draftId,
      sectionKey: section.sectionKey,
      payload: section.payload,
      payloadByteLength: validateSectionPayload(section.payload),
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: access.clerkUserId,
      updatedAt: now,
    });
  }
  const [setupOperation, runtimeBinding] = await Promise.all([
    queueEvidenceLibraryOperation(ctx, {
      libraryId,
      kind: "setup",
      idempotencyKey: SETUP_OPERATION_IDEMPOTENCY_KEY,
    }),
    createPendingRuntimeBinding(ctx, {
      libraryId,
      publicAddress,
    }),
  ]);
  await ctx.db.patch("evidenceLibraries", libraryId, {
    draftId,
    latestRevisionId: revisionId,
    runtimeBindingId: runtimeBinding.bindingId,
    setupOperationId: setupOperation.operationId,
  });
  const library = await ctx.db.get("evidenceLibraries", libraryId);
  if (!library) {
    throw new Error("Created Evidence Library could not be read");
  }
  const setup = await readEvidenceLibrarySetupRecords(ctx, library);
  return toSetupDraftResult(
    setup,
    await readEvidenceLibrarySetupIdentity(ctx, setup),
  );
}

function throwFirstIssue(issues: { pointer: string; message: string }[]) {
  const issue = issues[0];
  if (!issue) return;
  throw createError("VALIDATION_ERROR", `${issue.pointer}: ${issue.message}`, {
    pointer: issue.pointer,
  });
}

async function readRuntimeBindingBaseUrl(
  ctx: MutationCtx,
  library: Doc<"evidenceLibraries">,
) {
  const runtimeBindingId = library.runtimeBindingId;
  const binding = runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId)
    : null;
  if (!binding || binding.libraryId !== library._id) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding not found",
    );
  }
  // The address the library calls its own: a custom domain the owner made
  // primary, otherwise the platform address.
  return binding.canonicalBaseUrl ?? binding.targetBaseUrl;
}

// The only way owner sections reach the draft. Each payload is checked
// against the generated validator for its section plus the owner rules, may
// not carry credential material, and must fit the size budgets.
export async function saveEvidenceLibraryDraftSections(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    sections: OwnerSectionRow[];
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  if (args.sections.length === 0) {
    throw createError("VALIDATION_ERROR", "Nothing to save");
  }
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    args.expectedEditVersion,
  );
  const now = Date.now();
  const loaded = await loadDraftConfigurationSnapshot(ctx, draft._id, {
    requireComplete: false,
  });
  await persistDraftConfigurationSnapshot(ctx, loaded, {
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  // Read the rows again after the migration write. Request edits always merge
  // over the persisted current snapshot, never over an in-memory transform.
  const persisted = await loadDraftConfigurationSnapshot(ctx, draft._id, {
    requireComplete: false,
  });
  const expectedBaseUrl = await readRuntimeBindingBaseUrl(ctx, access.library);
  const storedSections = persisted.sections;
  const storedSnapshotSections = persisted.migration.snapshot.sections;
  // A save carries only the cards that changed, so the AI rules read the
  // draft as it will be: the rows being written over the rows already there.
  const effectivePayload = (sectionKey: string): unknown =>
    args.sections.find((section) => section.sectionKey === sectionKey)
      ?.payload ??
    storedSnapshotSections.find((section) => section.sectionKey === sectionKey)
      ?.payload;
  const effectiveFeatures = effectivePayload("features");
  const featuresAi =
    typeof effectiveFeatures === "object" &&
    effectiveFeatures !== null &&
    (effectiveFeatures as { ai?: unknown }).ai === true;
  const storedFeatures = storedSnapshotSections.find(
    (section) => section.sectionKey === "features",
  )?.payload;
  const storedFeaturesAi =
    typeof storedFeatures === "object" &&
    storedFeatures !== null &&
    (storedFeatures as { ai?: unknown }).ai === true;
  const validatesAi =
    args.sections.some((section) => section.sectionKey === "ai") ||
    (args.sections.some((section) => section.sectionKey === "features") &&
      storedFeaturesAi !== featuresAi);
  const effectiveAi = effectivePayload("ai");
  let modelCatalogReady: boolean | undefined;
  let allowedAiModels: Set<string> | undefined;
  if (validatesAi) {
    modelCatalogReady = (await ctx.db.query("models").first()) !== null;
    allowedAiModels = new Set<string>();
    for (const modelId of selectedAiModelIds(effectiveAi)) {
      const model = await ctx.db
        .query("models")
        .withIndex("by_model_id", (q) => q.eq("modelId", modelId))
        .unique();
      if (model && model.retiredAt === undefined) allowedAiModels.add(model.modelId);
    }
  }
  throwFirstIssue(
    validateOwnerSections(args.sections, {
      expectedBaseUrl,
      platformMailConfigured: isPlatformMailConfigured(),
      featuresAi,
      allowedAiModels,
      modelCatalogReady,
    }).issues,
  );
  // AI answers and the provider entry live in two rows. Either one changing
  // is checked against the other, so they can never drift apart.
  if (validatesAi) {
    throwFirstIssue(
      aiProviderIssues(
        typeof effectiveAi === "object" && effectiveAi !== null
          ? (effectiveAi as { providers?: unknown }).providers
          : undefined,
        featuresAi,
        effectiveAi !== undefined,
        allowedAiModels,
        modelCatalogReady,
      ),
    );
  }
  const identity = args.sections.find(
    (section) => section.sectionKey === "identity",
  );
  const identityPayload = identity
    ? readEvidenceLibraryIdentityNames(identity.payload, "VALIDATION_ERROR")
    : undefined;
  for (const section of args.sections) {
    try {
      assertNoCredentialMaterial(section.sectionKey, section.payload);
    } catch {
      throw createError(
        "VALIDATION_ERROR",
        `/${section.sectionKey}: Keys and passwords are managed separately and cannot be saved here.`,
        { pointer: `/${section.sectionKey}` },
      );
    }
  }
  const writes = args.sections.map((section) => ({
    ...section,
    payloadByteLength: validateSectionPayload(section.payload),
  }));
  const writeKeys = new Set(writes.map((write) => write.sectionKey));
  const totalByteLength =
    storedSections.reduce(
      (total, section) =>
        total +
        (writeKeys.has(section.sectionKey) ? 0 : section.payloadByteLength),
      0,
    ) + writes.reduce((total, write) => total + write.payloadByteLength, 0);
  assertDraftPayloadBudget(totalByteLength);

  for (const write of writes) {
    const existing = storedSections.find(
      (section) => section.sectionKey === write.sectionKey,
    );
    const sectionFields = {
      kind: "draft" as const,
      libraryId: args.libraryId,
      draftId: draft._id,
      sectionKey: write.sectionKey,
      payload: write.payload,
      payloadByteLength: write.payloadByteLength,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      updatedByClerkUserId: access.clerkUserId,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(
        "evidenceLibraryConfigSections",
        existing._id,
        sectionFields,
      );
    } else {
      await ctx.db.insert("evidenceLibraryConfigSections", sectionFields);
    }
  }
  await ctx.db.patch("evidenceLibraryConfigDrafts", draft._id, {
    editVersion,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  if (identityPayload) {
    await ctx.db.patch("evidenceLibraries", args.libraryId, {
      name: identityPayload.name,
      updatedByClerkUserId: access.clerkUserId,
      updatedAt: now,
    });
  }
  return { editVersion };
}

// Copies every draft row into a new frozen revision.
async function finalizeEvidenceLibraryDraft(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  const editVersion = nextDraftEditVersion(
    draft.editVersion,
    args.expectedEditVersion,
  );
  const persistedDraft = await loadDraftConfigurationSnapshot(ctx, draft._id, {
    requireComplete: true,
  });
  if (
    persistedDraft.header.ownerConfigurationVersion !==
    CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library draft did not migrate to the current version",
    );
  }
  const latestRevision = await ctx.db
    .query("evidenceLibraryConfigRevisions")
    .withIndex("by_libraryId_and_revisionNumber", (query) =>
      query.eq("libraryId", args.libraryId),
    )
    .order("desc")
    .first();
  const revisionNumber = (latestRevision?.revisionNumber ?? 0) + 1;
  const revisionKey = `r${revisionNumber}`;
  const now = Date.now();
  const revisionId = await ctx.db.insert("evidenceLibraryConfigRevisions", {
    libraryId: args.libraryId,
    revisionKey,
    revisionNumber,
    // A failed publish leaves the draft pointing at its failed candidate.
    // New publishes must branch from what is actually live, not that failed
    // candidate. Setup has no active revision yet, so it keeps the draft base.
    basedOnRevisionId: access.library.activeRevisionId ?? draft.baseRevisionId,
    rollbackOfRevisionId: null,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftSections = persistedDraft.sections;
  for (const section of draftSections) {
    if (section.kind !== "draft") {
      throw new Error("Draft section index returned a revision row");
    }
    await ctx.db.insert("evidenceLibraryConfigSections", {
      kind: "revision",
      libraryId: args.libraryId,
      revisionId,
      sectionKey: section.sectionKey,
      payload: section.payload,
      payloadByteLength: section.payloadByteLength,
      contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
      createdByClerkUserId: access.clerkUserId,
      createdAt: now,
    });
  }
  await ctx.db.patch("evidenceLibraryConfigDrafts", draft._id, {
    baseRevisionId: revisionId,
    editVersion,
    ownerConfigurationVersion: CURRENT_OWNER_CONFIGURATION_VERSION,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  await ctx.db.patch("evidenceLibraries", args.libraryId, {
    latestRevisionId: revisionId,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  return { editVersion, revisionId, revisionKey, revisionNumber };
}

function completedActivationResult(
  draft: Doc<"evidenceLibraryConfigDrafts">,
  operation: Doc<"evidenceLibraryConfigOperations">,
  revision: Doc<"evidenceLibraryConfigRevisions">,
  kind: "setup" | "publish",
) {
  return {
    editVersion: draft.editVersion,
    kind,
    operationId: operation._id,
    revisionId: revision._id,
    revisionKey: revision.revisionKey,
    revisionNumber: revision.revisionNumber,
    status: operation.status,
  };
}

async function readCompletedActivation(
  ctx: MutationCtx,
  args: {
    draft: Doc<"evidenceLibraryConfigDrafts">;
    expectedEditVersion: number;
    library: Doc<"evidenceLibraries">;
  },
) {
  if (
    args.draft.editVersion !== args.expectedEditVersion + 1 ||
    !args.draft.baseRevisionId
  ) {
    return null;
  }

  const [setupOperation, publishOperation] = await Promise.all([
    ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_activationEditVersion", (query) =>
        query
          .eq("libraryId", args.library._id)
          .eq("activationEditVersion", args.expectedEditVersion),
      )
      .unique(),
    ctx.db
      .query("evidenceLibraryConfigOperations")
      .withIndex("by_libraryId_and_idempotencyKey", (query) =>
        query
          .eq("libraryId", args.library._id)
          .eq("idempotencyKey", `activate:${args.expectedEditVersion}`),
      )
      .unique(),
  ]);
  const operation = setupOperation ?? publishOperation;
  if (
    !operation ||
    operation.libraryId !== args.library._id ||
    operation.revisionId !== args.draft.baseRevisionId ||
    (operation.kind !== "setup" && operation.kind !== "publish")
  ) {
    return null;
  }
  const revision = await ctx.db.get(
    "evidenceLibraryConfigRevisions",
    args.draft.baseRevisionId,
  );
  if (!revision || revision.libraryId !== args.library._id) return null;
  return completedActivationResult(
    args.draft,
    operation,
    revision,
    operation.kind === "setup" ? "setup" : "publish",
  );
}

export async function activateEvidenceLibraryConfiguration(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  if (access.library.state === "disabled") {
    throw createError(
      "CONFLICT",
      "Disabled Evidence Libraries cannot be activated",
    );
  }
  const expectedBaseUrl = await readRuntimeBindingBaseUrl(ctx, access.library);
  const draft = await ctx.db
    .query("evidenceLibraryConfigDrafts")
    .withIndex("by_libraryId", (query) => query.eq("libraryId", args.libraryId))
    .unique();
  if (!draft) {
    throw createError("NOT_FOUND", "Evidence Library draft not found");
  }
  if (draft.editVersion !== args.expectedEditVersion) {
    const completed = await readCompletedActivation(ctx, {
      draft,
      expectedEditVersion: args.expectedEditVersion,
      library: access.library,
    });
    if (completed) return completed;
    nextDraftEditVersion(draft.editVersion, args.expectedEditVersion);
  }
  const loaded = await loadDraftConfigurationSnapshot(ctx, draft._id, {
    requireComplete: false,
  });
  await persistDraftConfigurationSnapshot(ctx, loaded, {
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: Date.now(),
  });
  // Activation validates rows after the migration has committed them. It
  // never freezes an in-memory version that was not stored first.
  const persisted = await loadDraftConfigurationSnapshot(ctx, draft._id, {
    requireComplete: false,
  });
  if (
    persisted.header.ownerConfigurationVersion !==
    CURRENT_OWNER_CONFIGURATION_VERSION
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library draft did not migrate to the current version",
    );
  }
  if (access.library.state === "active") {
    if (!access.library.activeRevisionId) {
      throw createError(
        "INVALID_DATA",
        "Active Evidence Library revision not found",
      );
    }
    const active = await loadRevisionConfigurationSnapshot(
      ctx,
      access.library.activeRevisionId,
      { requireComplete: false },
    );
    if (
      configurationSnapshotsEqual(
        persisted.migration.snapshot,
        active.migration.snapshot,
      ) && !await hasPublicationProviderChanges(ctx, access.library)
    ) {
      throw createError("CONFLICT", "There are no saved changes to activate");
    }
  }
  const rows = persisted.sections;
  // Every row must pass its own validator, and the sections the schema
  // requires must be present. The full validator runs again at assembly.
  throwFirstIssue(
    validateOwnerSections(
      rows.map((row) => ({ sectionKey: row.sectionKey, payload: row.payload })),
      {
        expectedBaseUrl,
        requireComplete: true,
        platformMailConfigured: isPlatformMailConfigured(),
      },
    ).issues,
  );
  if (access.library.state === "active") {
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  }

  const frozen = await finalizeEvidenceLibraryDraft(ctx, args);
  if (access.library.state === "provisioning") {
    const setupOperationId = access.library.setupOperationId;
    if (!setupOperationId) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library setup operation not found",
      );
    }
    await attachRevisionToSetupOperation(ctx, {
      libraryId: args.libraryId,
      operationId: setupOperationId,
      revisionId: frozen.revisionId,
      activationEditVersion: args.expectedEditVersion,
    });
    const started = await claimAndScheduleEvidenceLibrarySetupOperation(ctx, {
      libraryId: args.libraryId,
      operationId: setupOperationId,
    });
    return {
      ...frozen,
      kind: "setup" as const,
      operationId: setupOperationId,
      status: started.status,
    };
  }
  const operation = await queueConfigurationDeploymentOperation(ctx, {
    libraryId: args.libraryId,
    revisionId: frozen.revisionId,
    idempotencyKey: `activate:${args.expectedEditVersion}`,
    activationEditVersion: args.expectedEditVersion,
  });
  const started = await claimAndScheduleConfigurationDeployment(ctx, {
    libraryId: args.libraryId,
    operationId: operation.operationId,
  });
  return { ...frozen, kind: "publish" as const, ...started };
}

export async function retryEvidenceLibrarySetup(
  ctx: MutationCtx,
  args: { libraryId: Id<"evidenceLibraries"> },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const setup = await readEvidenceLibrarySetupRecords(ctx, access.library);
  if (setup.setupOperation.status !== "failed") {
    throw createError(
      "CONFLICT",
      "Only a failed Evidence Library setup can be retried",
    );
  }
  // A failed setup must follow the platform's current supported release.
  // Keeping the first attempt's pin can make every retry rebuild against a
  // runtime that no longer accepts the current configuration contract.
  await ctx.db.patch(setup.setupOperation._id, {
    setupRuntimeCommit: undefined,
    setupRuntimeImage: undefined,
  });
  const started = await claimAndScheduleEvidenceLibrarySetupOperation(ctx, {
    libraryId: args.libraryId,
    operationId: setup.setupOperation._id,
  });
  return {
    operationId: setup.setupOperation._id,
    status: started.status,
  };
}

/**
 * Keeps the hosts Coolify serves for the next check.
 * `evidenceLibraries.addressActions` is the only caller.
 */
export const writeServedHostsCache = internalMutation({
  args: { hosts: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Internal only, and the same for everybody: address recovery writes it
    // with no signed-in owner behind the request.
    const fields = {
      source: "coolify" as const,
      hosts: args.hosts,
      fetchedAt: Date.now(),
    };
    const existing = await ctx.db
      .query("evidenceLibraryServedHosts")
      .withIndex("by_source", (query) => query.eq("source", "coolify"))
      .unique();
    if (existing) {
      await ctx.db.replace("evidenceLibraryServedHosts", existing._id, fields);
    } else {
      await ctx.db.insert("evidenceLibraryServedHosts", fields);
    }
    return null;
  },
});

/**
 * Takes the address the check found free. The same checks run again inside
 * this transaction, so two people reserving at once cannot both win.
 * `evidenceLibraries.addressActions.reserveAddress` is the only caller.
 */
export const reserveAddress = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    publicAddress: v.string(),
    slug: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.literal("reserved"),
      draftId: v.id("evidenceLibraryConfigDrafts"),
      editVersion: v.number(),
      ...evidenceLibrarySetupIdentityFields,
      libraryId: v.id("evidenceLibraries"),
      revisionId: v.id("evidenceLibraryConfigRevisions"),
      runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
      setupOperationId: v.id("evidenceLibraryConfigOperations"),
      state: v.literal("provisioning"),
    }),
    v.object({
      status: v.literal("name-taken"),
      libraryId: v.id("evidenceLibraries"),
    }),
    v.object({ status: v.literal("address-taken") }),
  ),
  handler: async (ctx, args) => {
    const access = await requireLibraryOrganization(ctx, args.organizationId);
    const name = validateEvidenceLibrarySetupName(args.name);
    const named = await readEvidenceLibraryByName(ctx, {
      organizationId: access.organization._id,
      name,
    });
    if (named) {
      return { status: "name-taken" as const, libraryId: named._id };
    }
    if (
      !(await isEvidenceLibraryAddressFree(ctx, {
        organizationId: access.organization._id,
        publicAddress: args.publicAddress,
        slug: args.slug,
      }))
    ) {
      return { status: "address-taken" as const };
    }
    return {
      status: "reserved" as const,
      ...(await createEvidenceLibrarySetup(ctx, {
        name,
        organizationId: args.organizationId,
        publicAddress: args.publicAddress,
        slug: args.slug,
      })),
    };
  },
});

export const saveDraftSections = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    sections: v.array(sectionRowValidator),
    expectedEditVersion: v.number(),
  },
  returns: v.object({ editVersion: v.number() }),
  handler: saveEvidenceLibraryDraftSections,
});

export const activateConfiguration = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    expectedEditVersion: v.number(),
  },
  returns: v.object({
    editVersion: v.number(),
    kind: v.union(v.literal("setup"), v.literal("publish")),
    operationId: v.id("evidenceLibraryConfigOperations"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    revisionKey: v.string(),
    revisionNumber: v.number(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
    ),
  }),
  handler: activateEvidenceLibraryConfiguration,
});

export const retrySetup = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.object({
    operationId: v.id("evidenceLibraryConfigOperations"),
    status: v.literal("running"),
  }),
  handler: retryEvidenceLibrarySetup,
});
