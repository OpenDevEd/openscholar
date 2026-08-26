import { mutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { EVIDENCE_LIBRARY_CONFIG_PROVENANCE } from "../../lib/evidence-libraries/configuration/contract";
import { createInitialEvidenceLibraryShortName } from "../../lib/evidence-libraries/setup/naming";
import {
  validateEssentialConfiguration,
  type EssentialConfigurationSections,
} from "../../lib/evidence-libraries/configuration/essential-configuration";
import { createError } from "../lib/errors";
import {
  requireEvidenceLibraryAccess,
  requireOrganizationAccess,
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
  findAvailableEvidenceLibrarySetupIdentity,
  readProvisioningEvidenceLibrarySetupByName,
  readEvidenceLibrarySetupIdentity,
  validateEvidenceLibraryIdentityPayload,
  validateEvidenceLibrarySetupName,
  type EvidenceLibrarySetupIdentity,
} from "./setupNaming";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";
import {
  evidenceLibrarySetupIdentityFields,
  essentialConfigurationSectionsValidator,
  type SectionKey,
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
  args: { name: string; slug: string; publicAddress: string },
) {
  const access = await requireOrganizationAccess(ctx, "manage");
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
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftId = await ctx.db.insert("evidenceLibraryConfigDrafts", {
    libraryId,
    baseRevisionId: revisionId,
    editVersion: 0,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    updatedByClerkUserId: access.clerkUserId,
    createdAt: now,
    updatedAt: now,
  });
  const identityPayload = { baseUrl: publicAddress, name, shortName };
  await ctx.db.insert("evidenceLibraryConfigSections", {
    kind: "draft",
    libraryId,
    draftId,
    sectionKey: "identity",
    payload: identityPayload,
    payloadByteLength: validateSectionPayload(identityPayload),
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
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

async function createEvidenceLibrarySetupFromName(
  ctx: MutationCtx,
  args: { name: string },
) {
  const access = await requireOrganizationAccess(ctx, "manage");
  const name = validateEvidenceLibrarySetupName(args.name);
  const current = await readProvisioningEvidenceLibrarySetupByName(ctx, {
    organizationId: access.organization._id,
    name,
  });
  if (current) {
    return toSetupDraftResult(current.setup, current.identity);
  }

  return await createEvidenceLibrarySetup(
    ctx,
    await findAvailableEvidenceLibrarySetupIdentity(ctx, {
      organizationId: access.organization._id,
      name,
    }),
  );
}

async function saveEvidenceLibraryDraftSections(
  ctx: MutationCtx,
  args: {
    access: Awaited<ReturnType<typeof requireEvidenceLibraryAccess>>;
    libraryId: Id<"evidenceLibraries">;
    sections: Array<{ sectionKey: SectionKey; payload: unknown }>;
    expectedEditVersion: number;
  },
) {
  const { access } = args;
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
  const identity = args.sections.find(
    (section) => section.sectionKey === "identity",
  );
  if (identity) {
    const runtimeBindingId = access.library.runtimeBindingId;
    const runtimeBinding = runtimeBindingId
      ? await ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId)
      : null;
    if (!runtimeBinding || runtimeBinding.libraryId !== args.libraryId) {
      throw createError(
        "INVALID_DATA",
        "Evidence Library runtime binding not found",
      );
    }
    validateEvidenceLibraryIdentityPayload(
      identity.payload,
      runtimeBinding.targetBaseUrl,
      "VALIDATION_ERROR",
    );
  }
  const writes = args.sections.map((section) => ({
    ...section,
    payloadByteLength: validateSectionPayload(section.payload),
  }));
  for (const write of writes) {
    assertNoCredentialMaterial(write.sectionKey, write.payload);
  }
  const storedSections = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const writeKeys = new Set(writes.map((write) => write.sectionKey));
  const totalByteLength =
    storedSections.reduce(
      (total, section) =>
        total +
        (writeKeys.has(section.sectionKey) ? 0 : section.payloadByteLength),
      0,
    ) + writes.reduce((total, write) => total + write.payloadByteLength, 0);
  assertDraftPayloadBudget(totalByteLength);

  const now = Date.now();
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
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: now,
  });
  return { editVersion, writes };
}

export async function saveEssentialEvidenceLibraryConfiguration(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    sections: EssentialConfigurationSections;
    expectedEditVersion: number;
  },
) {
  const access = await requireEvidenceLibraryAccess(
    ctx,
    args.libraryId,
    "manage",
  );
  const runtimeBindingId = access.library.runtimeBindingId;
  const binding = runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId)
    : null;
  if (!binding || binding.libraryId !== args.libraryId) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding not found",
    );
  }
  const validation = validateEssentialConfiguration(args.sections, {
    expectedBaseUrl: binding.targetBaseUrl,
  });
  if (!validation.valid) {
    const issue = validation.issues[0]!;
    throw createError(
      "VALIDATION_ERROR",
      `${issue.pointer}: ${issue.message}`,
      { pointer: issue.pointer },
    );
  }
  const result = await saveEvidenceLibraryDraftSections(ctx, {
    access,
    libraryId: args.libraryId,
    sections: [
      { sectionKey: "identity", payload: args.sections.identity },
      { sectionKey: "theme", payload: args.sections.theme },
      { sectionKey: "localization", payload: args.sections.localization },
      { sectionKey: "footer", payload: args.sections.footer },
    ],
    expectedEditVersion: args.expectedEditVersion,
  });
  await ctx.db.patch("evidenceLibraries", args.libraryId, {
    name: validation.value!.identity.name,
    updatedByClerkUserId: access.clerkUserId,
    updatedAt: Date.now(),
  });
  return { editVersion: result.editVersion };
}

async function finalizeEvidenceLibraryDraft(
  ctx: MutationCtx,
  args: {
    libraryId: Id<"evidenceLibraries">;
    expectedEditVersion: number;
    sectionKeys?: SectionKey[];
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
    basedOnRevisionId: draft.baseRevisionId,
    rollbackOfRevisionId: null,
    contractProvenance: EVIDENCE_LIBRARY_CONFIG_PROVENANCE,
    createdByClerkUserId: access.clerkUserId,
    createdAt: now,
  });
  const draftSections = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const includedSections = args.sectionKeys
    ? draftSections.filter((section) =>
        args.sectionKeys!.includes(section.sectionKey),
      )
    : draftSections;
  for (const section of includedSections) {
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
  const runtimeBindingId = access.library.runtimeBindingId;
  const binding = runtimeBindingId
    ? await ctx.db.get("evidenceLibraryRuntimeBindings", runtimeBindingId)
    : null;
  if (!binding || binding.libraryId !== args.libraryId) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library runtime binding not found",
    );
  }
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
  const rows = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", draft._id),
    )
    .collect();
  const payloads = Object.fromEntries(
    rows.map((row) => [row.sectionKey, row.payload]),
  );
  const validation = validateEssentialConfiguration(payloads, {
    expectedBaseUrl: binding.targetBaseUrl,
  });
  if (!validation.valid) {
    const issue = validation.issues[0]!;
    throw createError(
      "VALIDATION_ERROR",
      `${issue.pointer}: ${issue.message}`,
      { pointer: issue.pointer },
    );
  }
  if (access.library.state === "active") {
    await requireNoActiveConfigurationDeployment(ctx, args.libraryId);
  }

  const frozen = await finalizeEvidenceLibraryDraft(ctx, {
    ...args,
    sectionKeys: ["identity", "theme", "localization", "footer"],
  });
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
  const started = await claimAndScheduleEvidenceLibrarySetupOperation(ctx, {
    libraryId: args.libraryId,
    operationId: setup.setupOperation._id,
  });
  return {
    operationId: setup.setupOperation._id,
    status: started.status,
  };
}

export const createSetupDraft = mutation({
  args: { name: v.string() },
  returns: v.object({
    draftId: v.id("evidenceLibraryConfigDrafts"),
    editVersion: v.number(),
    ...evidenceLibrarySetupIdentityFields,
    libraryId: v.id("evidenceLibraries"),
    revisionId: v.id("evidenceLibraryConfigRevisions"),
    runtimeBindingId: v.id("evidenceLibraryRuntimeBindings"),
    setupOperationId: v.id("evidenceLibraryConfigOperations"),
    state: v.literal("provisioning"),
  }),
  handler: createEvidenceLibrarySetupFromName,
});

export const saveEssentialConfiguration = mutation({
  args: {
    libraryId: v.id("evidenceLibraries"),
    sections: essentialConfigurationSectionsValidator,
    expectedEditVersion: v.number(),
  },
  returns: v.object({ editVersion: v.number() }),
  handler: saveEssentialEvidenceLibraryConfiguration,
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
