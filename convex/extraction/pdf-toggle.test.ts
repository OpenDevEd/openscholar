import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

async function seed(
  t: ReturnType<typeof convexTest>,
  opts: { flag: boolean; usePdfs: boolean | undefined },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "c_pdf",
      email: "p@t",
      state: "active",
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.pdf",
      enabled: opts.flag,
      updatedAt: 0,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction",
      sourceType: "history",
      status: "pending",
      totalPapers: 0,
      usePdfs: opts.usePdfs,
      name: "p",
      createdAt: 0,
      updatedAt: 0,
    });
    return { userId, jobId };
  });
}

describe("getJobAndFlagsInternal — effective pdfEnabled", () => {
  it("pdfEnabled === true only when BOTH the admin flag is on AND the job opted in", async () => {
    const t = convexTest(schema);
    const { jobId } = await seed(t, { flag: true, usePdfs: true });
    const res = await t.query(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    expect(res.pdfEnabled).toBe(true);
  });

  it("pdfEnabled === false when the flag is off, even with usePdfs: true", async () => {
    const t = convexTest(schema);
    const { jobId } = await seed(t, { flag: false, usePdfs: true });
    const res = await t.query(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    expect(res.pdfEnabled).toBe(false);
  });

  it("pdfEnabled === false when the job opted out, even with flag: true", async () => {
    const t = convexTest(schema);
    const { jobId } = await seed(t, { flag: true, usePdfs: false });
    const res = await t.query(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    expect(res.pdfEnabled).toBe(false);
  });

  it("pdfEnabled === false when usePdfs is undefined (pre-P9.T4 legacy rows)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seed(t, { flag: true, usePdfs: undefined });
    const res = await t.query(
      internal.extraction.queries.internal.getJobAndFlagsInternal,
      { jobId },
    );
    expect(res.pdfEnabled).toBe(false);
  });
});
