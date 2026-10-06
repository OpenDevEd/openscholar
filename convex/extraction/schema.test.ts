/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

describe("extractionJobs schema", () => {

  it("accepts an extraction-mode job with all counter fields populated", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_ext",
        email: "e@test",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        sourceType: "history",
        status: "pending",
        totalPapers: 0,
        name: "ext job",
        usePdfs: true,
        createdAt: 0,
        updatedAt: 0,
      });
      const job = await ctx.db.get(jobId);
      expect(job?.mode).toBe("extraction");
      expect(job?.usePdfs).toBe(true);
      expect(job?.status).toBe("pending");
    });
  });
});
