import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createError } from "../lib/errors";
import { loadRevisionConfigurationSnapshot } from "./configurationSnapshot";

export async function readRevisionDefaultLocale(
  ctx: MutationCtx,
  revisionId: Id<"evidenceLibraryConfigRevisions">,
): Promise<string> {
  const snapshot = await loadRevisionConfigurationSnapshot(ctx, revisionId, {
    requireComplete: true,
  });
  const localization = snapshot.migration.snapshot.sections.find(
    (section) => section.sectionKey === "localization",
  );
  const payload = localization?.payload;
  if (
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
