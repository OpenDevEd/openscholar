import { v, type Infer } from "convex/values";
import { libraryViewValidator } from "./library/validators";

export const exportFormatValidator = v.union(v.literal("csv"), v.literal("json"));
export type ExportFormat = Infer<typeof exportFormatValidator>;

/** What an export writes: a view of the person's library, their search history, or their query shortcuts. */
export const exportSourceValidator = v.union(
  v.object({ kind: v.literal("library"), view: libraryViewValidator }),
  v.object({ kind: v.literal("history") }),
  v.object({ kind: v.literal("shortcuts") }),
);
export type ExportSource = Infer<typeof exportSourceValidator>;
