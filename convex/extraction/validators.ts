/**
 * Shared validators for extraction module
 * Reusable across queries, mutations, and actions
 */
import { v } from "convex/values";

// Analysis status enum
export const analysisStatusValidator = v.union(
  v.literal("draft"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed")
);

// Source types
export const sourceTypeValidator = v.union(
  v.literal("search_history"),
  v.literal("zotero"),
  v.literal("upload"),
  v.literal("manual")
);

// Source status
export const sourceStatusValidator = v.union(
  v.literal("pending"),
  v.literal("importing"),
  v.literal("ready"),
  v.literal("error")
);

// Document processing status
export const processingStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("error")
);

// Extraction result status
export const extractionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("error")
);

// Question type
export const questionTypeValidator = v.union(
  v.literal("text"),
  v.literal("number"),
  v.literal("boolean")
);

// Extraction question object
export const extractionQuestionValidator = v.object({
  id: v.string(),
  key: v.string(),
  question: v.string(),
  type: questionTypeValidator,
});

// Source metadata
export const sourceMetaValidator = v.object({
  query: v.optional(v.string()),
  count: v.optional(v.number()),
  name: v.optional(v.string()),
});

// Document input (for creating documents)
export const documentInputValidator = v.object({
  externalId: v.string(),
  title: v.string(),
  abstract: v.optional(v.string()),
  authors: v.optional(v.array(v.string())),
  year: v.optional(v.number()),
  doi: v.optional(v.string()),
  openAccessUrl: v.optional(v.string()), // URL to open access PDF
});
