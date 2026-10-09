// Clearing the person assistant chats belonged to before workspaces (#650, slice 8).
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { personalWorkspaceOf } from "../workspaces/personal";

it("clears a chat's person, gives an older step and waiting reply their person's own workspace, keeps the rest, and changes nothing run again", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema);
    const [ada, ben] = await t.run(async (ctx) => Promise.all(["ada", "ben"].map((clerkId) => ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 }))));
    const [own, bens] = await t.run(async (ctx) => Promise.all([personalWorkspaceOf(ctx, ada), personalWorkspaceOf(ctx, ben)]));
    const threadId = await runUntriggered(t, async (ctx) => {
      const asking = { senderId: ben, order: 0, promptMessageId: "m", modelId: null, spent: 0, rounds: 0, made: 0, askedAt: 1 };
      const threadId = await ctx.db.insert("assistantThreads", { ownerId: ada, workspaceId: own, createdBy: ada, title: "Trials", agentThreadId: "a", lastMessageAt: 1, createdAt: 1, updatedAt: 1, asking });
      await ctx.db.insert("assistantSteps", { threadId, order: 0, userId: ben, toolCallId: "old", path: "library/mutations:saveToLibrary", input: "{}", status: "done", startedAt: 1 });
      await ctx.db.insert("assistantSteps", { threadId, order: 1, userId: ada, workspaceId: own, toolCallId: "new", path: "library/mutations:saveToLibrary", input: "{}", status: "done", startedAt: 1 });
      return threadId;
    });
    expect(await t.action(internal.migrations.narrowAssistant.verify, {})).toBe(2);
    const rows = () => t.run(async (ctx) => ({ thread: await ctx.db.get("assistantThreads", threadId), steps: await ctx.db.query("assistantSteps").collect() }));
    await t.mutation(internal.migrations.narrowAssistant.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const once = await rows();
    expect(once.thread).not.toHaveProperty("ownerId");
    expect(once.thread).toMatchObject({ workspaceId: own, createdBy: ada, asking: { senderId: ben, workspaceId: bens } });
    expect(once.steps.map((step) => step.workspaceId)).toEqual([bens, own]);
    await t.mutation(internal.migrations.narrowAssistant.run, { reset: true });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await rows()).toEqual(once);
    expect(await t.action(internal.migrations.narrowAssistant.verify, {})).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
