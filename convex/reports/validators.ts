import { v } from "convex/values";
import { effortValidator, modelSummaryValidator } from "../aiModelConfig/validators";
import { publicationSettingsValidator } from "../evidenceLibraries/publicationValidators";
import { capped } from "../lib/listCaps";
import { MAX_CHECKS } from "../../lib/reports/settings";

/** A check as kept: `lib/reports/settings.ts` says what each part means. */
export const checkValidator = v.object({
  id: v.string(),
  name: v.string(),
  question: v.string(),
  fix: v.optional(v.string()),
  modelId: v.string(),
  effort: v.optional(effortValidator),
  threshold: v.number(),
  blocking: v.boolean(),
  enabled: v.boolean(),
  builtIn: v.optional(v.literal("already-published")),
});

export const checksValidator = capped(v.array(checkValidator), MAX_CHECKS);

/** The checks as the admin page shows them, each with its model as the catalog has it, or null when it has left. */
export const checkSummariesValidator = capped(v.array(v.object({ ...checkValidator.fields, model: v.union(modelSummaryValidator, v.null()) })), MAX_CHECKS);

export const seriesValidator = v.object({ name: v.string(), issn: v.string(), byline: v.string() });

/** The one settings row, once an admin changes something. Until then the series runs on `REPORT_DEFAULTS`. */
export const reportSettingsFields = {
  enabled: v.boolean(),
  humanReview: v.boolean(),
  series: seriesValidator,
  /** The Zenodo and Crossref accounts reports register with: the settings a community has, kept the same way. */
  publication: publicationSettingsValidator,
  /** Their credentials, encrypted (convex/lib/crypto.ts). Never sent to a page. */
  encryptedCredentials: v.optional(v.string()),
  publicationSavedAt: v.optional(v.number()),
  perDay: v.number(),
  orgPerDay: v.number(),
  metadataModelId: v.string(),
  metadataEffort: v.optional(effortValidator),
  checks: checksValidator,
  checksVersion: v.number(),
  agreement: v.object({ version: v.number(), text: v.string(), updatedAt: v.optional(v.number()) }),
  updatedAt: v.number(),
};
