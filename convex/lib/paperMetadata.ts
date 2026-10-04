import { v } from "convex/values";

/** Source facts kept throughout screening and extraction; absence means unknown. */
export const sourceMetadataFields = {
  authorsUnparsed: v.optional(v.string()),
  workType: v.optional(v.string()),
  isOpenAccess: v.optional(v.boolean()),
  oaStatus: v.optional(v.string()),
  oaUrl: v.optional(v.string()),
  pdfUrl: v.optional(v.string()),
};
