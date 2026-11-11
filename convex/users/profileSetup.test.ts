/// <reference types="vite/client" />
// A new account's profile setup: who is asked, and what saving and skipping keep.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";
import { SETUP_RELEASED_AT } from "./profileSetup";
const modules = import.meta.glob("/convex/**/*.ts");

const cambridge = { id: "I241749", name: "University of Cambridge", country: "GB", ror: "https://ror.org/013meh722" };
const answers = { affiliations: [cambridge], orcid: "0000-0002-9050-4995", emails: { updates: true, news: false, research: false } };

async function world() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { clerkId: "new", email: "new@test.local", state: "active", createdAt: SETUP_RELEASED_AT + 1, updatedAt: 1 });
    await ctx.db.insert("users", { clerkId: "old", email: "old@test.local", state: "active", createdAt: SETUP_RELEASED_AT - 1, updatedAt: 1 });
  });
  return { t, newcomer: t.withIdentity({ subject: "new" }), old: t.withIdentity({ subject: "old" }) };
}

describe("the profile setup", () => {
  it("is due for an account made since it came, and for one whose row isn't made yet, but not for an older one", async () => {
    const { t, newcomer, old } = await world();
    expect(await newcomer.query(api.users.profileSetup.due, {})).toBe(true);
    expect(await t.withIdentity({ subject: "made-a-moment-ago" }).query(api.users.profileSetup.due, {})).toBe(true);
    expect(await old.query(api.users.profileSetup.due, {})).toBe(false);
    expect(await t.query(api.users.profileSetup.due, {})).toBe(false);
  });

  it("is done once the answers are saved, which an older account edits in Settings the same way", async () => {
    const { newcomer, old } = await world();
    await newcomer.mutation(api.users.profileSetup.save, answers);
    expect(await newcomer.query(api.users.profileSetup.get, {})).toEqual({ profile: answers, due: false });
    await old.mutation(api.users.profileSetup.save, { ...answers, orcid: "" });
    expect((await old.query(api.users.profileSetup.get, {}))?.profile.orcid).toBe("");
  });

  it("keeps what one tab saved when another tab's setup, left open, is sent afterwards", async () => {
    const { newcomer } = await world();
    await newcomer.mutation(api.users.profileSetup.save, { ...answers, first: true });
    await newcomer.mutation(api.users.profileSetup.save, { affiliations: [], orcid: "", emails: { updates: false, news: false, research: false }, first: true });
    expect(await newcomer.query(api.users.profileSetup.get, {})).toEqual({ profile: answers, due: false });
  });

  it("refuses an iD or a ROR ID that isn't one", async () => {
    const { newcomer } = await world();
    await expect(newcomer.mutation(api.users.profileSetup.save, { ...answers, orcid: "0000-0002-9050-4994" })).rejects.toThrow(/ORCID/);
    await expect(newcomer.mutation(api.users.profileSetup.save, { ...answers, affiliations: [{ ...cambridge, ror: "ror.org/013meh722" }] })).rejects.toThrow(/ROR/);
    expect(await newcomer.query(api.users.profileSetup.due, {})).toBe(true);
  });

  it("is put away for good when skipped, and answers saved before stay", async () => {
    const { newcomer } = await world();
    await newcomer.mutation(api.users.profileSetup.skip, {});
    expect(await newcomer.query(api.users.profileSetup.get, {})).toMatchObject({ due: false, profile: { affiliations: [], orcid: "" } });
  });
});
