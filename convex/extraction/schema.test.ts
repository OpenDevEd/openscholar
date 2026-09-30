/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");

describe("extractionJobs schema", () => {
  it("accepts a chat-mode job without extraction-only fields", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_chat",
        email: "c@test",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat",
        name: "chat job",
        sourceType: "history",
        createdAt: 0,
        updatedAt: 0,
        chatThreadId: "t1",
        chatModelId: undefined,
        lastMessageAt: 1,
        messageCount: 0,
      });
      const job = await ctx.db.get(jobId);
      expect(job?.mode).toBe("chat");
      expect(job?.status).toBeUndefined();
      expect(job?.totalPapers).toBeUndefined();
    });
  });

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
        mode: "extraction",
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

  it("can be queried via the by_user_mode_updated index for one mode", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_mix",
        email: "m@test",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("extractionJobs", {
        userId, mode: "extraction", sourceType: "history", status: "pending",
        totalPapers: 0,
        name: "a", createdAt: 1, updatedAt: 1,
      });
      await ctx.db.insert("extractionJobs", {
        userId, mode: "chat", sourceType: "history",
        name: "b", createdAt: 2, updatedAt: 2,
      });
      const chats = await ctx.db
        .query("extractionJobs")
        .withIndex("by_user_mode_updated", q =>
          q.eq("userId", userId).eq("mode", "chat"))
        .collect();
      expect(chats).toHaveLength(1);
      expect(chats[0].name).toBe("b");
    });
  });

  it("can be queried via the by_chatThread index", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
        clerkId: "c_thread",
        email: "t@test",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("extractionJobs", {
        userId, mode: "chat", sourceType: "history",
        name: "t", createdAt: 0, updatedAt: 0,
        chatThreadId: "threadA",
      });
      const hit = await ctx.db
        .query("extractionJobs")
        .withIndex("by_chatThread", q => q.eq("chatThreadId", "threadA"))
        .unique();
      expect(hit?.chatThreadId).toBe("threadA");
    });
  });
});
