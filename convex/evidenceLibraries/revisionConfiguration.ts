import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";

export async function readRevisionDefaultLocale(
  ctx: MutationCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
): Promise<string> {
  const localization = await ctx.db
    .query("evidenceLibraryConfigSections")
    .withIndex("by_revisionId_and_sectionKey", (query) =>
      query.eq("revisionId", revisionId).eq("sectionKey", "localization"),
    )
    .unique();
  const payload = localization?.payload;
  if (
    localization?.kind !== "revision" ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).defaultLocale !== "string"
  ) {
    throw createError(
      "INVALID_DATA",
      "Evidence Library default language is missing",
    );
  }
  return (payload as Record<string, string>).defaultLocale;
}
