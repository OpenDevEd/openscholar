// Assistant chats (#324): who can open, change and share one, and how a person's chats list.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { seedOrganizationFeatures } from "../organizationFeatures.test-support";
import schema from "../schema";
import { touchThread } from "./access";
import { people } from "./assistant.test-support";

const firstPage = { cursor: null, numItems: 10 };
const titles = (page: { page: Array<{ title: string }> }) => page.page.map((chat) => chat.title);

describe("assistant chats", () => {
  it("suggest sharing with the person's own organizations and the people in them", async () => {
    const t = convexTest(schema);
    const { asAda, asCy, ben, team, elsewhere } = await people(t);
    const names = (found: Array<{ principal: { kind: string } }>) => found.map((one) => one.principal);

    expect(names(await asAda.query(api.assistant.sharing.candidates, {}))).toEqual([
      { kind: "organization", organizationId: team },
      { kind: "user", userId: ben },
    ]);
    expect(await asAda.query(api.assistant.sharing.candidates, { text: "BEN@" })).toMatchObject([{ principal: { kind: "user", userId: ben }, email: "ben@example.org" }]);
    expect(await asAda.query(api.assistant.sharing.candidates, { text: "cy" })).toEqual([]);
    // Cy is alone in the other organization.
    expect(names(await asCy.query(api.assistant.sharing.candidates, {}))).toEqual([{ kind: "organization", organizationId: elsewhere }]);

    // The access list says how big an organization is.
    const threadId = await asAda.mutation(api.assistant.threads.create, {});
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "organization", organizationId: team }, role: "read" });
    const access = await asAda.query(api.assistant.sharing.listAccess, { threadId, paginationOpts: firstPage });
    expect(access.page.find((row) => row.principal.kind === "organization")).toMatchObject({ members: 2, role: "read" });
  });

  it("list with who each is shared with and who has it open now", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, asCy, ada, ben, team, threadId } = await (async () => {
      const who = await people(t);
      const threadId = await who.asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
      await who.asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: who.ben }, role: "read" });
      await who.asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "organization", organizationId: who.team }, role: "read" });
      return { ...who, threadId };
    })();
    const row = async (as: typeof asAda) => (await as.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage })).page[0];
    const organization = (await t.run(async (ctx) => ctx.db.get("organizations", team)))!.name;

    // Ada sees Ben; Ben sees Ada, the owner. Nobody has it open yet.
    expect(await row(asAda)).toMatchObject({ preview: "", writing: false, members: [{ userId: ben, here: false }], organization });
    expect(await row(asBen)).toMatchObject({ members: [{ userId: ada, here: false }], organization });

    // Ben opens it. Whatever user ID his browser sends, the room holds his own.
    const opened = await asBen.mutation(api.assistant.presence.heartbeat, { roomId: threadId, userId: ada, sessionId: "tab-1", interval: 10_000 });
    expect((await row(asAda)).members).toEqual([{ userId: ben, name: "", here: true }]);
    expect(await t.query(api.assistant.presence.list, { roomToken: opened.roomToken })).toMatchObject([{ userId: ben, online: true }]);
    await expect(asCy.mutation(api.assistant.presence.heartbeat, { roomId: threadId, userId: ben, sessionId: "tab-2", interval: 10_000 })).rejects.toThrow(/Chat not found/);

    // His tab closes.
    await t.mutation(api.assistant.presence.disconnect, { sessionToken: opened.sessionToken });
    expect((await row(asAda)).members).toEqual([{ userId: ben, name: "", here: false }]);
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

  it("are shared to read or to write, and only the owner renames, shares or deletes", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });
    const withBen = { threadId, principal: { kind: "user" as const, userId: ben } };

    await asAda.mutation(api.assistant.sharing.grant, { ...withBen, role: "read" });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ role: "read" });
    await asAda.mutation(api.assistant.sharing.grant, { ...withBen, role: "write" });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ role: "write" });

    await expect(asBen.mutation(api.assistant.threads.rename, { threadId, title: "Ben's" })).rejects.toThrow(/Only the chat's owner/);
    await expect(asBen.mutation(api.assistant.threads.remove, { threadId })).rejects.toThrow(/Only the chat's owner/);
    await expect(asBen.mutation(api.assistant.sharing.grant, { ...withBen, role: "write" })).rejects.toThrow(/Only the chat's owner/);

    await asAda.mutation(api.assistant.sharing.revoke, withBen);
    await expect(asBen.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
  });

  it("can be shared with an organization the owner is in, and with its people, but with no one else", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, cy, team, elsewhere } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, { title: "Reading trials" });

    await expect(asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: cy }, role: "read" })).rejects.toThrow(/people in your organizations/);
    await expect(asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "organization", organizationId: elsewhere }, role: "read" })).rejects.toThrow(/organization you belong to/);

    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "organization", organizationId: team }, role: "write" });
    expect(await asBen.query(api.assistant.threads.get, { threadId })).toMatchObject({ role: "write" });

    const access = await asBen.query(api.assistant.sharing.listAccess, { threadId, paginationOpts: firstPage });
    // Ada gave no name. Her email is for her alone, so Ben gets neither.
    expect(access.page.map((row) => [row.principal.kind, row.role, row.name])).toEqual([
      ["organization", "write", "Feature test"],
      ["user", "owner", ""],
    ]);
    expect(JSON.stringify(access)).not.toContain("ada@example.org");
    const own = await asAda.query(api.assistant.sharing.listAccess, { threadId, paginationOpts: firstPage });
    expect(own.page.find((row) => row.role === "owner")?.email).toBe("ada@example.org");
  });

  it("list newest first, once each however they reach the person, by scope and by title", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben, team } = await people(t);
    const make = async (as: typeof asAda, title: string) => as.mutation(api.assistant.threads.create, { title });
    const coaching = await make(asAda, "Teacher coaching");
    const reading = await make(asAda, "Reading trials");
    const own = await make(asBen, "Ben's own notes");
    // Reading reaches Ben twice, as himself and through the team; coaching once.
    await asAda.mutation(api.assistant.sharing.grant, { threadId: reading, principal: { kind: "user", userId: ben }, role: "read" });
    await asAda.mutation(api.assistant.sharing.grant, { threadId: reading, principal: { kind: "organization", organizationId: team }, role: "write" });
    await asAda.mutation(api.assistant.sharing.grant, { threadId: coaching, principal: { kind: "organization", organizationId: team }, role: "read" });
    // Messages arrive in this order, so the lists run the other way.
    await t.run(async (ctx) => {
      for (const [at, threadId] of [[10, coaching], [20, own], [30, reading]] as Array<[number, Id<"assistantThreads">]>) await touchThread(ctx, threadId, at);
    });

    const list = (scope: "all" | "mine" | "shared", text?: string) => asBen.query(api.assistant.threads.list, { scope, ...(text ? { text } : {}), paginationOpts: firstPage });
    const all = await list("all");
    expect(titles(all)).toEqual(["Reading trials", "Ben's own notes", "Teacher coaching"]);
    // The most he may do, through any way the chat reaches him.
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
  });

  it("lists within Convex's limits when hundreds of chats reach someone through their last organization and none match", async () => {
    const t = convexTest(schema);
    const { asBen, ada } = await people(t);
    // Ben is in four more organizations; the chats are shared with the last of them.
    const last = await t.run(async (ctx) => {
      const made: Array<Id<"organizations">> = [];
      for (let i = 0; i < 4; i++) made.push(await seedOrganizationFeatures(ctx, ["ben"], {}));
      return made.sort().at(-1)!;
    });
    for (let from = 0; from < 900; from += 300) {
      await t.run(async (ctx) => {
        for (let i = from; i < from + 300; i++) {
          const threadId = await ctx.db.insert("assistantThreads", { ownerId: ada, title: `Chat ${i}`, agentThreadId: `agent${i}`, lastMessageAt: i, createdAt: i, updatedAt: i });
          await ctx.db.insert("assistantThreadAccess", { threadId, principal: `user:${ada}`, role: "owner", lastMessageAt: i, createdAt: i });
          await ctx.db.insert("assistantThreadAccess", { threadId, principal: `organization:${last}`, role: "read", lastMessageAt: i, createdAt: i });
        }
      });
    }
    // A page that finds nothing stops at its read allowance and says there is more.
    const page = await asBen.query(api.assistant.threads.list, { scope: "all", text: "no such chat", paginationOpts: firstPage });
    expect(page).toMatchObject({ page: [], isDone: false });
    expect(titles(await asBen.query(api.assistant.threads.list, { scope: "shared", paginationOpts: { cursor: null, numItems: 2 } }))).toEqual(["Chat 899", "Chat 898"]);
  });

  it("can be shared with 50 people and organizations, and no more", async () => {
    const t = convexTest(schema);
    const { asAda, team } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, {});
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) await ctx.db.insert("assistantThreadAccess", { threadId, principal: `user:filler${i}`, role: "read", lastMessageAt: 1, createdAt: 1 });
    });
    await expect(asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "organization", organizationId: team }, role: "read" })).rejects.toThrow(/up to 50/);
  });

  it("are gone for everyone once the owner deletes one", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ben } = await people(t);
    const threadId = await asAda.mutation(api.assistant.threads.create, {});
    await asAda.mutation(api.assistant.sharing.grant, { threadId, principal: { kind: "user", userId: ben }, role: "write" });

    await asAda.mutation(api.assistant.threads.remove, { threadId });

    await expect(asBen.query(api.assistant.threads.get, { threadId })).rejects.toThrow(/Chat not found/);
    expect(titles(await asAda.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage }))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("assistantThreadAccess").take(5))).toEqual([]);
  });

  it("go with their owner's account when it is purged, and so does that person's access to other chats", async () => {
    const t = convexTest(schema);
    const { asAda, asBen, ada, ben } = await people(t);
    const hers = await asAda.mutation(api.assistant.threads.create, { title: "Ada's" });
    await asAda.mutation(api.assistant.sharing.grant, { threadId: hers, principal: { kind: "user", userId: ben }, role: "read" });
    const his = await asBen.mutation(api.assistant.threads.create, { title: "Ben's" });
    await asBen.mutation(api.assistant.sharing.grant, { threadId: his, principal: { kind: "user", userId: ada }, role: "write" });
    // Ada's account was deleted more than 30 days ago.
    await t.run((ctx) => ctx.db.patch(ada, { state: "deleted", updatedAt: 1 }));

    await t.mutation(internal.maintenance.mutations.cleanupDeletedUsers, {});

    await expect(asBen.query(api.assistant.threads.get, { threadId: hers })).rejects.toThrow(/Chat not found/);
    expect(titles(await asBen.query(api.assistant.threads.list, { scope: "all", paginationOpts: firstPage }))).toEqual(["Ben's"]);
    const left = await t.run((ctx) => ctx.db.query("assistantThreadAccess").take(10));
    expect(left.map((row) => [row.threadId, row.role])).toEqual([[his, "owner"]]);
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
