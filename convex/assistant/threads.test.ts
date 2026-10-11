// Assistant chats (#324): who can open, change and share one, and how a person's chats list.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { seedFeatureUser, seedOrganizationFeatures } from "../organizationFeatures.test-support";
import schema from "../schema";
import { personalWorkspaceOf } from "../workspaces/actor";
import { ensureWorkspace } from "../workspaces/create";
import { runUntriggered } from "../../tests/convex-test-with-limits";
import { touchThread } from "./access";
import { people } from "./assistant.test-support";
import { previewOf } from "./threads";
import { waitFor } from "./turn.test-support";
import { madeBy } from "../workspaces/actor.test-support";

const firstPage = { cursor: null, numItems: 10 };
const titles = (page: { page: Array<{ title: string }> }) => page.page.map((chat) => chat.title);

describe("assistant chats", () => {
  it("list with who each is shared with and who has it open now", async () => {
    const t = convexTest(schema);
    const { home, asAda, asBen, asCy, ada, ben } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
    const row = async (as: typeof asAda) => (await as.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage })).page[0];
    expect(await row(asAda)).toMatchObject({ preview: "", writing: false, members: [] });

    // Shared with Ben, he is on the row whether he's there or not, and his names Ada, who started it.
    await asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: threadId, userId: ben, role: "viewer" });
    expect((await row(asAda)).members).toEqual([{ userId: ben, name: "", here: false }]);
    expect((await row(asBen)).members).toEqual([{ userId: ada, name: "", here: false }]);

    // Ben opens it. The row says he's there, and the reader never sees themselves.
    const session = await asBen.mutation(api.presence.chatHeartbeat, { threadId, sessionId: "tab-1" });
    expect((await row(asAda)).members).toEqual([{ userId: ben, name: "", here: true }]);
    expect((await row(asBen)).members).toEqual([{ userId: ada, name: "", here: false }]);
    await expect(asCy.mutation(api.presence.chatHeartbeat, { threadId, sessionId: "tab-2" })).rejects.toThrow(/Chat not found/);

    // His panel closes the chat.
    await asBen.mutation(api.presence.leave, { sessionToken: session });
    expect((await row(asAda)).members).toEqual([{ userId: ben, name: "", here: false }]);

    // Deleting the chat empties its room afterwards, on its own.
    await asBen.mutation(api.presence.chatHeartbeat, { threadId, sessionId: "tab-3" });
    await asAda.mutation(api.assistant.threads.remove, { threadId });
    await waitFor(async () => (await t.run(async (ctx) => ctx.runQuery(components.presence.public.listRoom, { roomId: threadId }))).length === 0);
  });

  it("shows the start of a chat's newest message as plain text, cut between characters", () => {
    expect(previewOf("  Compare   the\ndesigns ")).toBe("Compare the designs");
    expect(previewOf("## Plan\n**1. Define** the `scope`\n- *then* read [the guide](https://example.com)")).toBe("Plan 1. Define the scope then read the guide");
    expect(previewOf("_Note_ the [function](https://en.wikipedia.org/wiki/Function_(mathematics)) next")).toBe("Note the function next");
    // Marks that aren't markdown stay: a product, a name with underscores, what's inside code.
    expect(previewOf("2 * 3 * 4 in snake_case_name, use `obj.__dict__`")).toBe("2 * 3 * 4 in snake_case_name, use obj.__dict__");
    // The start that's read ends inside an emoji: no half of it is left.
    expect(previewOf(`${" ".repeat(2399)}😀`)).toBe("");
    // The cut lands on an emoji, which is two code units: it stays whole.
    expect(previewOf(`${"a".repeat(118)}😀😀😀`)).toBe(`${"a".repeat(118)}😀…`);
  });

  it("belong to the person who starts them, and a stranger can't open, rename or delete one", async () => {
    const t = convexTest(schema);
    const { asAda, asCy } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "  Reading   trials " });

    expect(await asAda.query(api.assistant.threads.get, { threadId })).toMatchObject({ title: "Reading trials", role: "owner" });
    await expect(asCy.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    await expect(asCy.mutation(api.assistant.threads.rename, { threadId, title: "Mine now" })).rejects.toThrow(/Chat not found/);
    await expect(asCy.mutation(api.assistant.threads.remove, { threadId })).rejects.toThrow(/Chat not found/);
    expect(titles(await asCy.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage }))).toEqual([]);
  });

  it("in an organization are its members': each opens them, its makers and admins manage them, and they list only there", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, asCy, ada, cy, team } = await people(t);
    const lab = await t.run(async (ctx) => ensureWorkspace(ctx, { kind: "organization", organizationId: team }));
    const threadId = await asBen.mutation(api.assistant.threads.create, { workspaceId: lab, title: "Lab review" });
    await asAda.mutation(api.assistant.threads.create, { title: "Mine" });
    const listed = async (as: typeof asAda, scope: "all" | "mine" | "shared", workspaceId?: Id<"workspaces">) =>
      titles(await as.query(api.assistant.threads.list, { ...(workspaceId ? { workspaceId } : {}), scope, paginationOpts: firstPage }));

    // The lab's chat lists in the lab for each member, by who made it, and in nobody's own workspace.
    expect(await listed(asAda, "all", lab)).toEqual(["Lab review"]);
    expect(await listed(asAda, "mine", lab)).toEqual([]);
    expect(await listed(asBen, "mine", lab)).toEqual(["Lab review"]);
    expect(await listed(asAda, "shared", lab)).toEqual([]);
    expect(await listed(asAda, "all")).toEqual(["Mine"]);
    expect(await listed(asBen, "all")).toEqual([]);

    // Ada writes in it; only Ben, who made it, manages it. A page or a reply in her own workspace doesn't reach it.
    expect(await asAda.query(api.assistant.threads.get, { workspaceId: lab, threadId })).toMatchObject({ role: "write" });
    await expect(asAda.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    await expect(asAda.mutation(api.assistant.threads.rename, { workspaceId: lab, threadId, title: "Mine now" })).rejects.toThrow(/Only the chat's owner/);
    await asBen.mutation(api.assistant.threads.rename, { workspaceId: lab, threadId, title: "Lab chat" });
    // Sharing it is Ben's too, and only with people outside the lab: its members have it.
    const inLab = { workspaceId: lab, kind: "chat" as const, id: threadId };
    await expect(asAda.mutation(api.sharing.guests.add, { ...inLab, userId: cy, role: "viewer" })).rejects.toThrow(/Only whoever made this chat/);
    await expect(asBen.mutation(api.sharing.guests.add, { ...inLab, userId: ada, role: "viewer" })).rejects.toThrow(/They're in this workspace/);
    // Cy isn't in the lab.
    await expect(asCy.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    await expect(asCy.query(api.assistant.threads.list, { workspaceId: lab, scope: "all", paginationOpts: firstPage })).rejects.toThrow(/Workspace not found/);

    // Made an admin of the lab, Ada manages it too.
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", team).eq("clerkUserId", "ada").eq("state", "active")).unique();
      await ctx.db.patch("organizationMemberships", membership!._id, { role: "org:admin" });
    });
    expect(await asAda.query(api.assistant.threads.get, { workspaceId: lab, threadId })).toMatchObject({ title: "Lab chat", role: "owner" });
    await asAda.mutation(api.assistant.threads.remove, { workspaceId: lab, threadId });
    expect(await listed(asBen, "all", lab)).toEqual([]);
  });

  it("are shared to read or to write, and only the owner renames, shares or deletes", async () => {
    const t = convexTest(schema);
    const { home, asAda, asBen, ada, ben, cy } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
    const item = { workspaceId: home.ada, kind: "chat" as const, id: threadId };

    await asAda.mutation(api.sharing.guests.add, { ...item, userId: ben, role: "viewer" });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ role: "read" });
    await asAda.mutation(api.sharing.guests.setRole, { ...item, guest: { userId: ben }, role: "editor" });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ role: "write" });

    await expect(asBen.mutation(api.assistant.threads.rename, { threadId, title: "Ben's" })).rejects.toThrow(/Only the chat's owner/);
    await expect(asBen.mutation(api.assistant.threads.remove, { threadId })).rejects.toThrow(/Only the chat's owner/);
    await expect(asBen.mutation(api.sharing.guests.add, { ...item, workspaceId: home.ben, userId: cy, role: "viewer" })).rejects.toThrow(/isn't in this workspace/);

    // Each sees who is in it. Emails are for whoever shares it.
    const inIt = async (as: typeof asAda) => (await as.query(api.assistant.threads.people, { threadId })).page;
    expect(await inIt(asAda)).toEqual([
      { userId: ada, role: "owner", you: true, name: "", email: "ada@example.org" },
      { userId: ben, role: "write", you: false, name: "", email: "ben@example.org" },
    ]);
    expect(await inIt(asBen)).toEqual([
      { userId: ada, role: "owner", you: false, name: "" },
      { userId: ben, role: "write", you: true, name: "" },
    ]);

    await asAda.mutation(api.sharing.guests.remove, { ...item, guest: { userId: ben } });
    await expect(asBen.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
  });

  it("reach a colleague at once and anyone else by an invitation they accept", async () => {
    const t = convexTest(schema);
    const { home, asAda, asCy, ada, cy } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
    const item = { workspaceId: home.ada, kind: "chat" as const, id: threadId };

    // Cy is in none of Ada's organizations.
    await expect(asAda.mutation(api.sharing.guests.add, { ...item, userId: cy, role: "viewer" })).rejects.toThrow(/Invite people outside your organizations by email/);
    const invitationId = await t.mutation(internal.sharing.invitations.prepare, { userId: ada, author: "user", ...item, email: "Cy@example.org", role: "editor" });
    await expect(asCy.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    await t.mutation(internal.sharing.invitations.respondVerified, { userId: cy, invitationId, emails: ["cy@example.org"], accept: true });

    expect(await asCy.query(api.assistant.threads.get, { threadId })).toMatchObject({ title: "Reading trials", role: "write" });
    expect(titles(await asCy.query(api.assistant.threads.list, { scope: "shared", paginationOpts: firstPage }))).toEqual(["Reading trials"]);
  });

  it("list newest first, their own and the ones shared with them as one list, by scope and by title", async () => {
    const t = convexTest(schema);
    const { home, asAda, asBen, ben, team } = await people(t);
    const make = async (as: typeof asAda, title: string) => as.mutation(api.assistant.threads.create, { title });
    const coaching = await make(asAda, "Teacher coaching");
    const reading = await make(asAda, "Reading trials");
    const own = await make(asBen, "Ben's own notes");
    await asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: reading, userId: ben, role: "editor" });
    await asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: coaching, userId: ben, role: "viewer" });
    // Messages arrive in this order, so the lists run the other way.
    await t.run(async (ctx) => {
      for (const [at, threadId] of [[10, coaching], [20, own], [30, reading]] as Array<[number, Id<"assistantThreads">]>) await touchThread(ctx, threadId, at);
    });

    const list = (scope: "all" | "mine" | "shared", text?: string) => asBen.query(api.assistant.threads.list, { scope, ...(text ? { text } : {}), paginationOpts: firstPage });
    const all = await list("all");
    expect(titles(all)).toEqual(["Reading trials", "Ben's own notes", "Teacher coaching"]);
    expect(all.page.map((chat) => chat.role)).toEqual(["write", "owner", "read"]);
    expect(titles(await list("mine"))).toEqual(["Ben's own notes"]);
    expect(titles(await list("shared"))).toEqual(["Reading trials", "Teacher coaching"]);
    expect(titles(await list("all", "TRIALS"))).toEqual(["Reading trials"]);

    // Stepping a page at a time neither repeats nor drops a chat.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let reads = 0; reads < 6; reads++) {
      const page: { page: Array<{ title: string }>; isDone: boolean; continueCursor: string } = await asBen.query(api.assistant.threads.list, { scope: "all", paginationOpts: { cursor, numItems: 1 } });
      seen.push(...titles(page));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toEqual(["Reading trials", "Ben's own notes", "Teacher coaching"]);

    // Moved into an organization Ben is in, it's the organization's: it lists there, and no longer as shared with him.
    const lab = await t.run(async (ctx) => {
      const lab = await ensureWorkspace(ctx, { kind: "organization", organizationId: team });
      await ctx.db.patch("assistantThreads", reading, { workspaceId: lab });
      return lab;
    });
    expect(titles(await list("shared"))).toEqual(["Teacher coaching"]);
    expect((await asBen.query(api.sharing.shared.list, { sort: "recent", paginationOpts: firstPage })).page.map((row) => row.name)).toEqual(["Teacher coaching"]);
    // His place as its guest goes a moment later, and what's shared with him counts it no more.
    await waitFor(async () => (await asBen.query(api.sharing.shared.counts, {})).chat === 1);
    expect(await asBen.query(api.sharing.shared.counts, {})).toMatchObject({ chat: 1, total: 1 });
    expect(titles(await asBen.query(api.assistant.threads.list, { workspaceId: lab, scope: "all", paginationOpts: firstPage }))).toEqual(["Reading trials"]);
  });

  it("lists within Convex's limits when hundreds of chats are shared with someone and none match", async () => {
    const t = convexTest(schema);
    const { asBen, ada, ben } = await people(t);
    for (let from = 0; from < 900; from += 300) {
      await runUntriggered(t, async (ctx) => {
        for (let i = from; i < from + 300; i++) {
          const threadId = await ctx.db.insert("assistantThreads", { ...(await madeBy(ctx, ada)), title: `Chat ${i}`, agentThreadId: `agent${i}`, lastMessageAt: i, createdAt: i, updatedAt: i });
          await ctx.db.insert("itemAccess", { kind: "chat", item: threadId, name: `Chat ${i}`, userId: ben, role: "viewer", grantedBy: ada, grantedAt: i, lastMessageAt: i });
        }
      });
    }
    // A page that finds nothing stops at its read allowance and says there is more.
    const page = await asBen.query(api.assistant.threads.list, { scope: "all", text: "no such chat", paginationOpts: firstPage });
    expect(page).toMatchObject({ page: [], isDone: false });
    expect(titles(await asBen.query(api.assistant.threads.list, { scope: "shared", paginationOpts: { cursor: null, numItems: 2 } }))).toEqual(["Chat 899", "Chat 898"]);
  });

  it("can be shared with 50 people, and no more", async () => {
    const t = convexTest(schema);
    const { home, asAda, ada, ben } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, {});
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        const userId = await ctx.db.insert("users", { clerkId: `filler${i}`, email: `filler${i}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
        await ctx.db.insert("itemAccess", { kind: "chat", item: threadId, name: "New chat", userId, role: "viewer", grantedBy: ada, grantedAt: 1, lastMessageAt: 1 });
      }
    });
    await expect(asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: threadId, userId: ben, role: "viewer" })).rejects.toThrow(/One chat has up to 50 guests/);
  });

  it("are gone for everyone once the owner deletes one", async () => {
    const t = convexTest(schema);
    const { home, asAda, asBen, ben } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, {});
    await asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: threadId, userId: ben, role: "editor" });

    await asAda.mutation(api.assistant.threads.remove, { threadId });

    await expect(asBen.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    expect(titles(await asAda.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage }))).toEqual([]);
    // Ben's place goes with it, a moment after.
    await waitFor(async () => (await t.run((ctx) => ctx.db.query("itemAccess").take(5))).length === 0);
  });

  it("go with their owner's account when it is purged, and so does that person's place in other people's chats, but not the chats they made in an organization", async () => {
    const t = convexTest(schema);
    const { home, asAda, asBen, ada, ben, team } = await people(t);
    const lab = await t.run(async (ctx) => ensureWorkspace(ctx, { kind: "organization", organizationId: team }));
    const labs = await asAda.mutation(api.assistant.threads.create, { workspaceId: lab, title: "Ada's lab chat" });
    const hers = await asAda.mutation(api.assistant.threads.create, { title: "Ada's" });
    await asAda.mutation(api.sharing.guests.add, { workspaceId: home.ada, kind: "chat", id: hers, userId: ben, role: "viewer" });
    const his = await asBen.mutation(api.assistant.threads.create, { title: "Ben's" });
    await asBen.mutation(api.sharing.guests.add, { workspaceId: home.ben, kind: "chat", id: his, userId: ada, role: "editor" });
    // Ada's account was deleted more than 30 days ago.
    await t.run((ctx) => ctx.db.patch(ada, { state: "deleted", updatedAt: 1 }));

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    await expect(asBen.query(api.assistant.threads.get, { threadId: hers })).rejects.toThrow(/Chat not found/);
    expect(titles(await asBen.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage }))).toEqual(["Ben's"]);
    await waitFor(async () => (await t.run((ctx) => ctx.db.query("itemAccess").take(5))).length === 0);
    // The lab's chat stays the lab's.
    expect(await asBen.query(api.assistant.threads.get, { workspaceId: lab, threadId: labs })).toMatchObject({ title: "Ada's lab chat" });
  });

  it("are refused while the assistant is switched off", async () => {
    const t = convexTest(schema);
    const { asAda } = await people(t);
    await t.run(async (ctx) => {
      const flag = await ctx.db.query("featureFlags").withIndex("by_key", (q) => q.eq("key", "assistant.enabled")).unique();
      await ctx.db.patch(flag!._id, { enabled: false });
    });
    await expect(asAda.mutation(api.assistant.threads.create, {})).rejects.toThrow(/disabled/);
  });
});
