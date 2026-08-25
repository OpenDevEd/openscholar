import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createError } from "../lib/errors";
import { requireEvidenceLibraryAccess } from "./access";

export function validateTargetBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw createError(
      "VALIDATION_ERROR",
      "Target base URL must be a valid URL",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash || url.origin === "null") {
    throw createError(
      "VALIDATION_ERROR",
      "Target base URL must be origin-only",
    );
  }
  return url.origin;
}

export function requireNonBlankProvisioningValue(
  field: string,
  value: string,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw createError("VALIDATION_ERROR", `${field} must not be blank`);
  }
  return normalized;
}

export async function createPendingRuntimeBinding(
  ctx: MutationCtx,
  args: { libraryId: Id<"evidenceLibraries">; publicAddress: string },
) {
  await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
  const targetBaseUrl = validateTargetBaseUrl(args.publicAddress);
  const [existing, occupied] = await Promise.all([
    ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_libraryId", (query) =>
        query.eq("libraryId", args.libraryId),
      )
      .unique(),
    ctx.db
      .query("evidenceLibraryRuntimeBindings")
      .withIndex("by_targetBaseUrl", (query) =>
        query.eq("targetBaseUrl", targetBaseUrl),
      )
      .unique(),
  ]);
  if (existing) {
    throw createError(
      "CONFLICT",
      "Evidence Library runtime binding already exists",
    );
  }
  if (occupied) {
    throw createError(
      "CONFLICT",
      "Evidence Library public address is already used",
    );
  }

  const now = Date.now();
  const bindingId = await ctx.db.insert("evidenceLibraryRuntimeBindings", {
    libraryId: args.libraryId,
    targetBaseUrl,
    state: "pending",
    createdAt: now,
    updatedAt: now,
  });
  return { bindingId, targetBaseUrl };
}
