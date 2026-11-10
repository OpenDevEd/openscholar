// The Zenodo and Crossref accounts Openscholar Reports registers with, read and saved for ./publicationActions.ts,
// which verifies them first.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../lib/functions";
import { requireAdmin } from "../admins/access";
import { createError } from "../lib/errors";
import { publicationSettingsValidator } from "../evidenceLibraries/publicationValidators";
import { reportSettings, settingsRow } from "./settings";

export const CHANGED = "Publishing settings changed. Reload and try again.";

/** What the accounts are now, for an admin about to change them. */
export const prepare = internalQuery({
  args: {},
  returns: v.object({ settings: publicationSettingsValidator, encryptedCredentials: v.union(v.string(), v.null()), savedAt: v.union(v.number(), v.null()) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await reportSettings(ctx);
    return { settings: settings.publication, encryptedCredentials: settings.row?.encryptedCredentials ?? null, savedAt: settings.row?.publicationSavedAt ?? null };
  },
});

export const saveVerified = internalMutation({
  args: { settings: publicationSettingsValidator, encryptedCredentials: v.string(), expectedUpdatedAt: v.union(v.null(), v.number()) },
  returns: v.null(),
  handler: async (ctx, { settings, encryptedCredentials, expectedUpdatedAt }) => {
    await requireAdmin(ctx);
    const row = await settingsRow(ctx);
    // Another admin saved while this one's accounts were being verified.
    if ((row.publicationSavedAt ?? null) !== expectedUpdatedAt) throw createError("CONFLICT", CHANGED);
    const now = Date.now();
    await ctx.db.patch("reportSettings", row._id, { publication: settings, encryptedCredentials, publicationSavedAt: now, updatedAt: now });
    return null;
  },
});
