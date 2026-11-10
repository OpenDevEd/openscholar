// Applying to join a community (OS-31): who can apply, the owners and editors who answer, what accepting gives, and
// the wait a decline leaves.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createReadySetupFixture } from "../../tests/helpers/evidence-library-setup-fixture";
import { grantLibraryRole } from "./team.test-support";

const DAY = 86_400_000;
const page = { cursor: null, numItems: 20 };

/** A live community, its owner (the organization's admin), and someone outside it with a workspace of their own. */
async function community(suffix: string) {
  const fixture = await createReadySetupFixture(suffix);
  const libraryId = fixture.created.libraryId;
  const workspaceId = (await fixture.t.run((ctx) => ctx.db.get("evidenceLibraries", libraryId)))!.workspaceId!;
  const person = async (clerkId: string) => {
    const home = await fixture.t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { clerkId, email: `${clerkId}@example.org`, firstName: "Ada", state: "active", createdAt: 1, updatedAt: 1 });
      return await ctx.db.insert("workspaces", { kind: "personal", userId });
    });
    return { as: fixture.t.withIdentity({ subject: clerkId }), workspaceId: home as Id<"workspaces"> };
  };
  const applicant = await person("user_applicant");
  const apply = (message = "I study teacher coaching and would add 30 papers.") =>
    applicant.as.mutation(api.evidenceLibraries.applications.apply, { workspaceId: applicant.workspaceId, libraryId, message });
  const owner = { as: fixture.admin, workspaceId };
  const scheduled = () => fixture.t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).map((job) => job.name));
  return { fixture, libraryId, workspaceId, applicant, apply, owner, person, scheduled };
}

afterEach(() => { vi.useRealTimers(); });

describe("applying to join a community", () => {
  it("sends one application with its message, tells the owners and editors, and shows it to both sides", async () => {
    const { libraryId, applicant, apply, owner, scheduled } = await community("applications_apply");
    const applicationId = await apply();
    // A second press, or a second tab, sends nothing more.
    expect(await apply()).toBe(applicationId);
    expect((await scheduled()).filter((name) => name === "evidenceLibraries/applicationEmails:toReviewers")).toHaveLength(1);

    const mine = await applicant.as.query(api.evidenceLibraries.applications.mine, { workspaceId: applicant.workspaceId, state: "waiting", paginationOpts: page });
    expect(mine.page).toEqual([expect.objectContaining({ libraryId, state: "waiting", message: "I study teacher coaching and would add 30 papers." })]);
    const standing = await applicant.as.query(api.evidenceLibraries.applications.standing, { workspaceId: applicant.workspaceId, libraryIds: [libraryId] });
    expect(standing.page).toEqual([{ libraryId, member: false, application: expect.objectContaining({ state: "waiting", appliesAgainAt: null, hidden: false }) }]);

    const counts = await owner.as.query(api.evidenceLibraries.applications.waitingCounts, { workspaceId: owner.workspaceId, libraryIds: [libraryId] });
    expect(counts.page).toEqual([{ libraryId, waiting: 1 }]);
    const waiting = await owner.as.query(api.evidenceLibraries.applications.waiting, { workspaceId: owner.workspaceId, libraryId, paginationOpts: page });
    expect(waiting.page).toEqual([expect.objectContaining({ applicationId, name: "Ada", email: "user_applicant@example.org" })]);
  });

  it("refuses someone already in it, an empty message, and a community whose owners turned applications off", async () => {
    const { fixture, libraryId, apply, owner, person } = await community("applications_refused");
    await expect(apply("   ")).rejects.toThrow(/Write a few words/);

    const creator = await person("user_creator");
    await fixture.t.run((ctx) => grantLibraryRole(ctx, libraryId, "user_creator", "creator"));
    await expect(creator.as.mutation(api.evidenceLibraries.applications.apply, { workspaceId: creator.workspaceId, libraryId, message: "Hello" })).rejects.toThrow(/already in this community/);
    // Only an owner turns them off.
    await expect(creator.as.mutation(api.evidenceLibraries.applications.setOpen, { workspaceId: creator.workspaceId, libraryId, open: false })).rejects.toThrow(/FORBIDDEN/);

    await owner.as.mutation(api.evidenceLibraries.applications.setOpen, { workspaceId: owner.workspaceId, libraryId, open: false });
    await expect(apply()).rejects.toThrow(/isn't taking applications/);
    expect(await fixture.t.query(api.evidenceLibraries.directory.card, { libraryId })).toMatchObject({ applicationsOpen: false });
  });

  it("lets only owners and editors answer, and makes the person a Creator once", async () => {
    const { fixture, libraryId, applicant, apply, owner, person, scheduled } = await community("applications_accept");
    const applicationId = await apply();
    const creator = await person("user_creator");
    await fixture.t.run((ctx) => grantLibraryRole(ctx, libraryId, "user_creator", "creator"));
    await expect(creator.as.mutation(api.evidenceLibraries.applications.accept, { workspaceId: creator.workspaceId, applicationId })).rejects.toThrow(/owners and editors/);

    await owner.as.mutation(api.evidenceLibraries.applications.accept, { workspaceId: owner.workspaceId, applicationId });
    await owner.as.mutation(api.evidenceLibraries.applications.accept, { workspaceId: owner.workspaceId, applicationId });
    const grants = await fixture.t.run(async (ctx) => {
      const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "user_applicant")).unique();
      return await ctx.db.query("itemAccess").withIndex("by_item_and_user", (q) => q.eq("item", libraryId).eq("userId", user!._id)).collect();
    });
    expect(grants.map((grant) => grant.role)).toEqual(["creator"]);
    expect(await scheduled()).toContain("evidenceLibraries/applicationEmails:toApplicant");
    // In the community now: not among their applications, and the card knows.
    expect((await applicant.as.query(api.evidenceLibraries.applications.mine, { workspaceId: applicant.workspaceId, state: "waiting", paginationOpts: page })).page).toEqual([]);
    expect((await applicant.as.query(api.evidenceLibraries.applications.standing, { workspaceId: applicant.workspaceId, libraryIds: [libraryId] })).page[0]?.member).toBe(true);
  });

  it("takes the place an invitation waiting for the applicant holds, so they aren't counted twice", async () => {
    const { fixture, libraryId, apply, owner } = await community("applications_invited");
    const applicationId = await apply();
    const invitationId = await fixture.t.run(async (ctx) => {
      const inviter = (await ctx.db.query("users").first())!._id;
      return await ctx.db.insert("itemInvitations", { kind: "library", item: libraryId, email: "user_applicant@example.org", role: "editor", invitedBy: inviter, expiresAt: Date.now() + DAY, state: "pending", delivery: "sent" });
    });
    await owner.as.mutation(api.evidenceLibraries.applications.accept, { workspaceId: owner.workspaceId, applicationId });
    expect((await fixture.t.run((ctx) => ctx.db.get("itemInvitations", invitationId)))?.state).toBe("accepted");
  });

  it("gives a decline's reason and a 14-day wait, which hiding it from the sidebar keeps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
    const { libraryId, applicant, apply, owner } = await community("applications_decline");
    const applicationId = await apply();
    // The ready-made reason goes by its key, for the applicant to read in their own language, and the note as written.
    await owner.as.mutation(api.evidenceLibraries.applications.decline, { workspaceId: owner.workspaceId, applicationId, preset: "topic", reason: "  Outside our topic.  " });
    const mine = (state: "waiting" | "declined" = "declined") => applicant.as.query(api.evidenceLibraries.applications.mine, { workspaceId: applicant.workspaceId, state, paginationOpts: page }).then((result) => result.page);
    expect(await mine()).toEqual([expect.objectContaining({ state: "declined", reasonPreset: "topic", reason: "Outside our topic.", appliesAgainAt: Date.now() + 14 * DAY })]);
    await expect(apply()).rejects.toThrow(/again from 2026-11-23/);

    await applicant.as.mutation(api.evidenceLibraries.applications.hide, { workspaceId: applicant.workspaceId, libraryId });
    expect(await mine()).toEqual([]);
    await expect(apply()).rejects.toThrow(/again from/);

    vi.setSystemTime(Date.now() + 14 * DAY + 1);
    expect(await apply()).toBe(applicationId);
    expect(await mine("waiting")).toEqual([expect.objectContaining({ state: "waiting" })]);
  });

  it("lets someone the team asked to say more about their work apply again at once", async () => {
    const { applicant, apply, owner } = await community("applications_more");
    const applicationId = await apply();
    await owner.as.mutation(api.evidenceLibraries.applications.decline, { workspaceId: owner.workspaceId, applicationId, preset: "moreAbout" });
    expect(await apply("I run a 40-school coaching study and would add its 30 papers.")).toBe(applicationId);
    expect((await applicant.as.query(api.evidenceLibraries.applications.mine, { workspaceId: applicant.workspaceId, state: "waiting", paginationOpts: page })).page)
      .toEqual([expect.objectContaining({ message: "I run a 40-school coaching study and would add its 30 papers." })]);
  });

  it("takes back a waiting application, after which the person can apply again at once", async () => {
    const { libraryId, applicant, apply, owner } = await community("applications_withdraw");
    await apply();
    await applicant.as.mutation(api.evidenceLibraries.applications.withdraw, { workspaceId: applicant.workspaceId, libraryId });
    expect((await owner.as.query(api.evidenceLibraries.applications.waitingCounts, { workspaceId: owner.workspaceId, libraryIds: [libraryId] })).page).toEqual([{ libraryId, waiting: 0 }]);
    expect(await apply()).toEqual(expect.any(String));
  });

  it("shows one public community's card by its ID, and none for an unlisted one", async () => {
    const { fixture, libraryId } = await community("applications_card");
    expect(await fixture.t.query(api.evidenceLibraries.directory.card, { libraryId })).toMatchObject({ _id: libraryId, applicationsOpen: true });
    expect(await fixture.t.query(api.evidenceLibraries.directory.card, { libraryId: "not-an-id" })).toBeNull();
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { unlisted: true }));
    expect(await fixture.t.query(api.evidenceLibraries.directory.card, { libraryId })).toBeNull();
  });

  it("tells the community's own site whether Join leads somewhere: open, the reader's application waiting, or closed", async () => {
    const { fixture, libraryId, apply } = await community("applications_join_standing");
    const token = "els_" + "j".repeat(43);
    await fixture.t.run(async (ctx) => {
      const credential = await ctx.db.query("evidenceLibraryCredentials").withIndex("by_libraryId_and_credentialKey", (q) => q.eq("libraryId", libraryId).eq("credentialKey", "library-service")).unique();
      const credentialDigest = createHash("sha256").update(token).digest("hex");
      if (credential) await ctx.db.patch("evidenceLibraryCredentials", credential._id, { credentialDigest });
      else await ctx.db.insert("evidenceLibraryCredentials", { libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest, validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1 });
    });
    const ask = async (clerkUserId?: string, credential = token) => {
      const response = await fixture.t.fetch("/api/v1/evidence-libraries/join-standing", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json", "OpenScholar-Contract": "1" }, body: JSON.stringify({ libraryId, ...(clerkUserId ? { clerkUserId } : {}) }) });
      return response.status === 200 ? ((await response.json()) as { join: string }).join : response.status;
    };
    // Anyone, signed in or not, may apply; once this reader has, theirs waits, and it's still open to everyone else.
    expect(await ask()).toBe("open");
    expect(await ask("user_applicant")).toBe("open");
    await apply();
    expect(await ask("user_applicant")).toBe("waiting");
    expect(await ask()).toBe("open");
    // With applications off, or no longer public, Join leads nowhere for anyone.
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { applicationsClosed: true }));
    expect(await ask("user_applicant")).toBe("closed");
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { applicationsClosed: undefined, unlisted: true }));
    expect(await ask()).toBe("closed");
    // Switched off, its site is still answered, and told the same.
    await fixture.t.run((ctx) => ctx.db.patch("evidenceLibraries", libraryId, { unlisted: undefined, state: "disabled" }));
    expect(await ask()).toBe("closed");
    expect(await ask(undefined, "els_" + "k".repeat(43))).toBe(401);
  });
});
