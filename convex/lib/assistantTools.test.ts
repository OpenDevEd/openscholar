import { v } from "convex/values";
import { expect, it } from "vitest";
import { withoutEmptyIds } from "./assistantTools";

it("leaves out an optional ID the model sent empty, and nothing else", () => {
  const args = { by: v.optional(v.id("users")), jobId: v.id("extractionJobs"), search: v.optional(v.string()) };
  // `by` has no ID to give; an empty search is a search for everything, and a required ID sent empty is the function's to refuse.
  expect(withoutEmptyIds(args, { by: "", jobId: "", search: "", sort: "recent" })).toEqual({ jobId: "", search: "", sort: "recent" });
  expect(withoutEmptyIds(args, { by: "user_1" })).toEqual({ by: "user_1" });
});
