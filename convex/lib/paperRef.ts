// A paper named by its source, as the tables keep it (lib/papers/paper-ref.ts holds the rules;
// plans/evidence-library-sources). `paperKey` is the indexed form, `ref` the parts, `crossRefs`
// what finds the same paper elsewhere.
import { v } from "convex/values";
import { crossRefsOf, paperKey, type CrossRefs, type PaperRef } from "../../lib/papers/paper-ref";

export const paperRefValidator = v.union(
  v.object({ source: v.literal("openalex"), work: v.string() }),
  v.object({ source: v.literal("openscholar"), work: v.string() }),
  v.object({ source: v.literal("library"), libraryId: v.string(), key: v.string() }),
  v.object({ source: v.literal("zotero"), library: v.union(v.literal("user"), v.literal("group")), owner: v.string(), key: v.string() }),
  v.object({ source: v.literal("upload"), file: v.string() }),
);

export const crossRefsValidator = v.object({ openalexId: v.optional(v.string()), doi: v.optional(v.string()) });

/** The fields a row that holds a paper carries: its key and source, and what finds it elsewhere when anything does. */
export const paperIdentityFields = {
  paperKey: v.string(),
  ref: paperRefValidator,
  crossRefs: v.optional(crossRefsValidator),
};

export type PaperIdentity = { paperKey: string; ref: PaperRef; crossRefs: CrossRefs };

/** A paper's identity from a ref and what else is known of it. */
export function identityOf(ref: PaperRef, known: { openalexId?: string | null; doi?: string | null } = {}): PaperIdentity {
  return { paperKey: paperKey(ref), ref, crossRefs: crossRefsOf(ref, known) };
}
