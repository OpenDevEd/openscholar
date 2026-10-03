import { v, type Infer } from "convex/values";
import { libraryViewValidator } from "./library/validators";

export const exportFormatValidator = v.union(v.literal("csv"), v.literal("json"));
export type ExportFormat = Infer<typeof exportFormatValidator>;

/** What an export writes: a view of the person's library, or their search history. */
export const exportSourceValidator = v.union(
  v.object({ kind: v.literal("library"), view: libraryViewValidator }),
  v.object({ kind: v.literal("history") }),
);
export type ExportSource = Infer<typeof exportSourceValidator>;
