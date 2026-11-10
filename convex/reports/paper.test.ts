import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { checked, live, passed, row, setup, type World } from "./reports.test-support";

const decide = async (world: World, key: string, decision: "withdraw" | "reinstate") =>
  world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: (await row(world.t, key)).pdf!.at });

describe("a report's page", () => {
  it("is anyone's to read once the report is live, and no one's before", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    expect(await world.t.query(api.reports.paper.get, { key: waiting.key })).toBeNull();
    expect(await world.t.query(internal.reports.paper.doiOf, { key: waiting.key })).toBeNull();
    expect(await world.t.query(api.reports.paper.get, { key: "R999999" })).toBeNull();

    const { key } = await live(world, world.author, world.lab);
    const page = await world.t.query(api.reports.paper.get, { key });
    expect(page).toMatchObject({ state: "live", key, doi: "10.53832/openscholar-r.r100002", metadata: { title: "Shade trees and maize yields" }, series: { name: "Openscholar Reports" } });
    expect(await world.t.query(internal.reports.paper.doiOf, { key })).toBe("10.53832/openscholar-r.r100002");
  });

  it("says a withdrawn report was withdrawn, without its details or its files, until it is reinstated", async () => {
    const world = await setup();
    const { key } = await live(world);
    await decide(world, key, "withdraw");
    const page = await world.t.query(api.reports.paper.get, { key });
    expect(page).toMatchObject({ state: "withdrawn", key, title: "Shade trees and maize yields", year: 2026 });
    expect(page).not.toHaveProperty("metadata");
    expect(page).not.toHaveProperty("pdfUrl");
    expect(await world.t.query(internal.reports.paper.doiOf, { key })).toBeNull();
    await decide(world, key, "reinstate");
    expect(await world.t.query(api.reports.paper.get, { key })).toMatchObject({ state: "live" });
  });

  it("is given to a community by its DOI: live with its details, corrected with a new version, withdrawn as withdrawn", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    const { key } = await live(world, world.author, world.lab);
    const doi = (await row(world.t, key)).doi;
    const ask = (...dois: string[]) => world.t.query(internal.reports.paper.forCommunity, { dois });
    // In the order asked; a DOI that is no report of ours, and a report that never went live, name nothing.
    const [first, other, unpublished] = await ask(doi.toUpperCase(), "10.1000/elsewhere", (await row(world.t, waiting.key)).doi);
    expect(first).toMatchObject({ state: "live", key, doi, title: "Shade trees and maize yields", series: "Openscholar Reports", hasPdf: true });
    expect([other, unpublished]).toEqual([null, null]);
    // A reviewer's edit is the report's at once: the community is told by the version.
    const seenAt = (await row(world.t, key)).updatedAt;
    const page = await world.t.query(api.reports.paper.get, { key });
    if (page?.state !== "live") throw new Error("The report isn't live");
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt, metadata: { ...page.metadata, title: "Shade trees, corrected" } });
    const [corrected] = await ask(doi);
    expect(corrected).toMatchObject({ state: "live", title: "Shade trees, corrected" });
    expect(corrected!.version).not.toBe(first!.version);
    await decide(world, key, "withdraw");
    const [withdrawn] = await ask(doi);
    expect(withdrawn).toMatchObject({ state: "withdrawn", key, doi });
    expect(withdrawn).not.toHaveProperty("title");
    expect(withdrawn!.version > corrected!.version).toBe(true);
    // Reinstated, it is told as a change again: a community that withdrew it takes it back.
    await decide(world, key, "reinstate");
    const [back] = await ask(doi);
    expect(back).toMatchObject({ state: "live", title: "Shade trees, corrected" });
    expect(back!.version > withdrawn!.version).toBe(true);
  });

  it("moves a withdrawn report's files, so the addresses its readers were given stop working", async () => {
    vi.useFakeTimers();
    try {
      const world = await setup();
      const { key, reportId } = await live(world);
      const before = (await row(world.t, key)).pdf!.file;
      await decide(world, key, "withdraw");
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      // Withdrawing schedules this. It is also run here by hand, so the test doesn't hang on when the scheduler got
      // to it: run twice, it moves the files once more, which changes nothing this test looks at.
      await world.t.action(internal.reports.files.rotate, { reportId });
      const after = await row(world.t, key);
      expect(after.pdf!.file).not.toBe(before);
      expect(await world.t.run((ctx) => ctx.db.system.get(before))).toBeNull();
      // The file is the report's still: reinstated, its page gives the PDF again, and discarding rules still find it.
      expect(await world.t.run((ctx) => ctx.db.query("reportFiles").withIndex("by_file", (q) => q.eq("file", after.pdf!.file)).unique())).not.toBeNull();
      await decide(world, key, "reinstate");
      expect(await world.t.query(api.reports.paper.get, { key })).toMatchObject({ state: "live", pdfUrl: expect.any(String) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is read by the assistant as a paper, only while it is live", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    expect(await world.t.query(internal.reports.paper.record, { key: waiting.key })).toBeNull();
    const { key } = await live(world, world.author, world.lab);
    expect(await world.t.query(internal.reports.paper.record, { key })).toMatchObject({ id: `https://openscholar.ai/${key}`, title: "Shade trees and maize yields", venue: "Openscholar Reports", doi: "10.53832/openscholar-r.r100002", year: 2026, openAccess: true });
  });

  it("offers its corrections to its owner and its workspace's admins alone", async () => {
    const world = await setup();
    const { key } = await live(world, world.author, world.lab);
    const mine = (who: Pick<World["t"], "query">) => who.query(api.reports.paper.mine, { key });
    // With its workspace's address, where the correction opens whichever workspace the page is read in.
    expect(await mine(world.author)).toEqual({ waiting: false, slug: "lab" });
    expect(await mine(world.orgAdmin)).toEqual({ waiting: false, slug: "lab" });
    expect(await mine(world.member)).toBeNull();
    expect(await mine(world.stranger)).toBeNull();
    expect(await mine(world.t)).toBeNull();
  });
});
