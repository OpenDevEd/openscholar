import { v, type Infer } from "convex/values";
import { libraryViewValidator } from "./library/validators";

export const exportFormatValidator = v.union(v.literal("csv"), v.literal("json"));
export type ExportFormat = Infer<typeof exportFormatValidator>;

/** What an export writes: a view of the person's library, their search history, their query shortcuts, or a screening job's results. */
export const exportSourceValidator = v.union(
  v.object({ kind: v.literal("library"), view: libraryViewValidator }),
  v.object({ kind: v.literal("history") }),
  v.object({ kind: v.literal("shortcuts") }),
  v.object({ kind: v.literal("screening"), jobId: v.id("screeningJobs") }),
);
export type ExportSource = Infer<typeof exportSourceValidator>;
