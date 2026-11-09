// An approval names a community paper by its title, not its record key: but only to someone who sent it or can see the community.
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "../_generated/api";
import { detailsOf } from "./details";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.ts");

it("names a community record by the title of the paper sent to it, to its sender and no one else", async () => {
  const t = convexTest(schema, modules);
  const { sender, stranger, senderHome, strangerHome, libraryId } = await t.run(async (ctx) => {
    const sender = await ctx.db.insert("users", { clerkId: "sender", email: "s@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const stranger = await ctx.db.insert("users", { clerkId: "stranger", email: "x@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const owner = await ctx.db.insert("users", { clerkId: "owner", email: "o@example.org", state: "active", createdAt: 1, updatedAt: 1 });
    const senderHome = await ctx.db.insert("workspaces", { kind: "personal", userId: sender });
    const strangerHome = await ctx.db.insert("workspaces", { kind: "personal", userId: stranger });
    const ownerHome = await ctx.db.insert("workspaces", { kind: "personal", userId: owner });
    const libraryId = await ctx.db.insert("evidenceLibraries", { workspaceId: ownerHome, name: "Private", slug: "private", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 } as never);
    return { sender, stranger, senderHome, strangerHome, libraryId };
  });
  await t.mutation(internal.evidenceLibraries.submissions.recordSent, { userId: sender, libraryId, requestId: "r1", papers: [{ itemKey: "BS5T3W88", title: "Peer tutoring in reading", authors: "", year: 2020, openalexId: "W1", doi: null, status: "queued" }] });
  const input = JSON.stringify({ libraryId, itemKey: "BS5T3W88" });
  expect(await t.query(internal.assistant.steps.about, { userId: sender, workspaceId: senderHome, input })).toBe("Peer tutoring in reading");
  // Someone who neither sent it nor can see the community learns nothing of what's waiting there.
  expect(await t.query(internal.assistant.steps.about, { userId: stranger, workspaceId: strangerHome, input })).not.toBe("Peer tutoring in reading");
  // The approval's own lines name the paper by its title in place of the key, to its sender.
  const lines = await t.run(async (ctx) => detailsOf(ctx, (await ctx.db.get("users", sender))!, senderHome, input));
  expect(lines).toContainEqual({ name: "title", value: "Peer tutoring in reading" });
  expect(lines.some((line) => line.value === "BS5T3W88")).toBe(false);
});
