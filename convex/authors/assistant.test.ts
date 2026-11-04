/// <reference types="vite/client" />
// Author profiles and a research area's publications as the assistant reads and makes them (#323).
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../lib/billing/plans";
import { ensureWorkspace } from "../workspaces/create";
const modules = import.meta.glob("/convex/**/*.ts");
const mail = vi.hoisted(() => ({ sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => mail } }));

async function setup() {
  const t = convexTest(schema, modules);
  const [owner, other] = await t.run(async (ctx) => {
    const people = [];
    for (const clerkId of ["owner", "other"]) {
      const userId = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, state: "active", createdAt: 1, updatedAt: 1 });
      people.push({ userId, workspaceId: await ensureWorkspace(ctx, { kind: "personal", userId }) });
    }
    // The owner's own workspace has a plan with Evidence Libraries, which profiles come with.
    await seedCreditsForTest(ctx, { userId: people[0].userId, features: [EVIDENCE_LIBRARIES_FEATURE] });
    return people;
  });
  return { t, owner, other };
}

describe("author profiles, for the assistant", () => {
  it("makes one in the workspace, lists and reads it, and shows who has it only where it is", async () => {
    const { t, owner, other } = await setup();
    const authors = internal.authors.assistant;
    const { profileId, name } = await t.mutation(authors.createForAssistant, { ...owner, name: "  Caitlin Mills ", approved: true });
    expect(name).toBe("Caitlin Mills");
    // Without Evidence Libraries in its plan, a workspace makes none, and still reads the public directory.
    await expect(t.mutation(authors.createForAssistant, { ...other, name: "Someone", approved: true })).rejects.toThrow(/FORBIDDEN/);
    expect((await t.query(authors.directoryForAssistant, other)).page).toEqual([expect.objectContaining({ profileId })]);

    expect((await t.query(authors.directoryForAssistant, { ...owner, search: "caitlin" })).page).toEqual([expect.objectContaining({ profileId, name: "Caitlin Mills" })]);
    expect(await t.query(authors.profileForAssistant, { ...owner, profileId })).toMatchObject({ profileId, name: "Caitlin Mills", role: "owner", member: true });
    // Its page is public, so anyone reads it; what the person is to it, and who has it with their emails, stay in its workspace.
    expect(await t.query(authors.profileForAssistant, { ...other, profileId })).toMatchObject({ profileId, role: null, member: false });
    expect((await t.query(authors.editorsForAssistant, { ...owner, profileId })).members).toEqual([expect.objectContaining({ userId: owner.userId, role: "owner" })]);
    await expect(t.query(authors.editorsForAssistant, { ...other, profileId })).rejects.toThrow(/not found/);

    // Invited to edit it, the other person sees the invitation in their own workspace.
    await t.mutation(internal.sharing.invitations.prepare, { ...owner, author: "user", kind: "author", id: profileId, email: "other@example.org", role: "editor" });
    expect(await t.query(authors.invitationsForAssistant, other)).toEqual([expect.objectContaining({ profileId, name: "Caitlin Mills" })]);
    // A profile with no publications yet reads as none.
    expect(await t.action(authors.publicationsForAssistant, { ...owner, profileId })).toEqual({ publications: [], unavailable: 0 });
  });

  it("reads a research area's publications by its topic ID, and refuses anything else", async () => {
    const { t, owner } = await setup();
    const topics = internal.topics.assistant;
    await expect(t.action(topics.publicationsForAssistant, { ...owner, topicId: "../T1" })).rejects.toThrow(/topic ID/);
    expect(await t.action(topics.publicationsForAssistant, { ...owner, topicId: "t10044" })).toEqual({ publications: [], next: null, unavailable: 0, updating: false });
  });
});
