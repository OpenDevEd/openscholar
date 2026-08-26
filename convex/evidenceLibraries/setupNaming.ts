import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createEvidenceLibraryBaseSlug,
  createEvidenceLibraryPublicAddress,
  createEvidenceLibrarySlugCandidate,
  createInitialEvidenceLibraryShortName,
  EVIDENCE_LIBRARY_PLATFORM_DOMAIN_ENV,
  MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES,
  MAX_EVIDENCE_LIBRARY_NAME_LENGTH,
  MAX_EVIDENCE_LIBRARY_SHORT_NAME_LENGTH,
  normalizeEvidenceLibraryName,
  validateEvidenceLibraryPlatformDomain,
} from "../../lib/evidence-libraries/setup/naming";
import { createError } from "../lib/errors";
import { readEvidenceLibrarySetupRecords } from "./setupRecords";

type SetupNamingCtx = Pick<QueryCtx | MutationCtx, "db">;

export type EvidenceLibrarySetupIdentity = {
  name: string;
  publicAddress: string;
  shortName: string;
  slug: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateEvidenceLibrarySetupName(value: string): string {
  const name = normalizeEvidenceLibraryName(value);
  if (!name || Array.from(name).length > MAX_EVIDENCE_LIBRARY_NAME_LENGTH) {
    throw createError(
      "VALIDATION_ERROR",
      "Evidence Library name must be between 1 and 100 characters",
    );
  }
  return name;
}

// Setup only needs the names. The public address rule lives in owner-rules.
export function readEvidenceLibraryIdentityNames(
  value: unknown,
  errorCode: "INVALID_DATA" | "VALIDATION_ERROR",
): { name: string; shortName: string } {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    Array.from(value.name).length > MAX_EVIDENCE_LIBRARY_NAME_LENGTH ||
    typeof value.shortName !== "string" ||
    !value.shortName.trim() ||
    Array.from(value.shortName).length > MAX_EVIDENCE_LIBRARY_SHORT_NAME_LENGTH
  ) {
    throw createError(
      errorCode,
      "Evidence Library identity needs a name and a short name",
    );
  }
  return { name: value.name, shortName: value.shortName };
}

export function requireEvidenceLibraryPlatformDomain(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return validateEvidenceLibraryPlatformDomain(
    env[EVIDENCE_LIBRARY_PLATFORM_DOMAIN_ENV],
  );
}

export async function findAvailableEvidenceLibrarySetupIdentity(
  ctx: SetupNamingCtx,
  args: { organizationId: Id<"organizations">; name: string },
): Promise<EvidenceLibrarySetupIdentity> {
  const name = validateEvidenceLibrarySetupName(args.name);
  const shortName = createInitialEvidenceLibraryShortName(name);
  const baseSlug = createEvidenceLibraryBaseSlug(name);
  const platformDomain = requireEvidenceLibraryPlatformDomain();

  for (
    let position = 1;
    position <= MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES;
    position += 1
  ) {
    const slug = createEvidenceLibrarySlugCandidate(baseSlug, position);
    const publicAddress = createEvidenceLibraryPublicAddress(
      slug,
      platformDomain,
    );
    const [library, runtimeBinding] = await Promise.all([
      ctx.db
        .query("evidenceLibraries")
        .withIndex("by_organizationId_and_slug", (query) =>
          query.eq("organizationId", args.organizationId).eq("slug", slug),
        )
        .unique(),
      ctx.db
        .query("evidenceLibraryRuntimeBindings")
        .withIndex("by_targetBaseUrl", (query) =>
          query.eq("targetBaseUrl", publicAddress),
        )
        .unique(),
    ]);
    if (!library && !runtimeBinding) {
      return { name, publicAddress, shortName, slug };
    }
  }

  throw createError(
    "CONFLICT",
    "No platform address is available for this Evidence Library name",
  );
}

export async function readEvidenceLibrarySetupIdentity(
  ctx: SetupNamingCtx,
  setup: Awaited<ReturnType<typeof readEvidenceLibrarySetupRecords>>,
): Promise<EvidenceLibrarySetupIdentity> {
  const identitySection = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_draftId_and_sectionKey", (query) =>
      query.eq("draftId", setup.draft._id).eq("sectionKey", "identity"),
    )
    .unique();
  if (!identitySection || identitySection.kind !== "draft") {
    throw createError(
      "INVALID_DATA",
      "Evidence Library setup identity is incomplete",
    );
  }
  const payload = readEvidenceLibraryIdentityNames(
    identitySection.payload,
    "INVALID_DATA",
  );

  return {
    name: payload.name,
    publicAddress: setup.publicAddress,
    shortName: payload.shortName,
    slug: setup.library.slug,
  };
}

export async function readProvisioningEvidenceLibrarySetupByName(
  ctx: SetupNamingCtx,
  args: { organizationId: Id<"organizations">; name: string },
) {
  const library = await ctx.db
    .query("evidenceLibraries")
    .withIndex("by_organizationId_and_name_and_state", (query) =>
      query
        .eq("organizationId", args.organizationId)
        .eq("name", args.name)
        .eq("state", "provisioning"),
    )
    .unique();
  if (!library) return null;

  const setup = await readEvidenceLibrarySetupRecords(ctx, library);
  return {
    identity: await readEvidenceLibrarySetupIdentity(ctx, setup),
    setup,
  };
}
