import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  createEvidenceLibraryAddressCandidate,
  MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES,
} from "../../lib/evidence-libraries/setup/naming";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryPlatformDomain } from "./setupNaming";

type AddressRecoveryCtx = Pick<QueryCtx | MutationCtx, "db">;

/**
 * The addresses this library may move to, in order. Position 1 is the plain
 * name, so a move always starts at position 2. The address the library sits on
 * now is skipped; every other position is offered even if a later check finds
 * it taken.
 */
export function evidenceLibraryAddressMoveCandidates(input: {
  name: string;
  platformDomain: string;
  currentAddress: string;
}): string[] {
  const candidates: string[] = [];
  for (
    let position = 2;
    position <= MAX_EVIDENCE_LIBRARY_ADDRESS_CANDIDATES;
    position += 1
  ) {
    const candidate = createEvidenceLibraryAddressCandidate(
      input.name,
      input.platformDomain,
      position,
    );
    if (candidate !== input.currentAddress) candidates.push(candidate);
  }
  return candidates;
}

/**
 * The first numbered address for this name that no library holds. Lane A adds
 * the shared Coolify and host checks; this is the database rule they extend.
 */
export async function findNextFreeEvidenceLibraryAddress(
  ctx: AddressRecoveryCtx,
  args: { name: string; currentAddress: string },
): Promise<string> {
  const candidates = evidenceLibraryAddressMoveCandidates({
    name: args.name,
    platformDomain: requireEvidenceLibraryPlatformDomain(),
    currentAddress: args.currentAddress,
  });
  for (const candidate of candidates) {
    const taken = await ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_targetBaseUrl", (query) =>
        query.eq("targetBaseUrl", candidate),
      )
      .first();
    if (!taken) return candidate;
  }
  throw createError(
    "CONFLICT",
    "No platform address is available for this Evidence Library name",
  );
}

async function moveIdentityBaseUrl(
  ctx: MutationCtx,
  section: Doc<"evidenceLibraryConfigSections"> | null,
  nextAddress: string,
) {
  if (!section) return;
  const payload = section.payload as Record<string, unknown> | null;
  if (payload === null || typeof payload !== "object") return;
  await ctx.db.patch(section._id, {
    payload: { ...payload, baseUrl: nextAddress },
  });
}

/**
 * Points the library at a new address: the runtime binding, the draft the
 * owner edits, and the revision that is being deployed all carry it.
 */
export async function applyEvidenceLibraryAddressMove(
  ctx: MutationCtx,
  args: {
    bindingId: Id<"evidenceLibraryRuntimeBindings">;
    draftId: Id<"evidenceLibraryConfigDrafts">;
    revisionId: Id<"evidenceLibraryConfigRevisions">;
    nextAddress: string;
  },
): Promise<void> {
  const [draftIdentity, revisionIdentity] = await Promise.all([
    ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_draftId_and_sectionKey", (query) =>
        query.eq("draftId", args.draftId).eq("sectionKey", "identity"),
      )
      .unique(),
    ctx.db
      .query("evidenceLibraryConfigSections")
      .withIndex("by_revisionId_and_sectionKey", (query) =>
        query.eq("revisionId", args.revisionId).eq("sectionKey", "identity"),
      )
      .unique(),
  ]);
  await ctx.db.patch(args.bindingId, {
    targetBaseUrl: args.nextAddress,
    updatedAt: Date.now(),
  });
  await moveIdentityBaseUrl(ctx, draftIdentity, args.nextAddress);
  await moveIdentityBaseUrl(ctx, revisionIdentity, args.nextAddress);
}
