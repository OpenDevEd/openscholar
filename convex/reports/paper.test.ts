import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { checked, live, passed, refused, row, setup, type World } from "./reports.test-support";
import { trimPaperData } from "../../lib/library/trim-paper-data";
import { reportPaper } from "../../lib/reports/report-paper";

const decide = async (world: World, key: string, decision: "withdraw" | "reinstate") =>
  world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: (await row(world.t, key)).pdf!.at });

describe("a report's page", () => {
  it("is anyone's to read once the report is live, and no one's before", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    expect(await world.t.query(api.reports.paper.get, { key: waiting.key })).toBeNull();
    expect(await world.t.query(internal.reports.paper.doiOf, { key: waiting.key })).toBeNull();
    expect(await world.t.query(api.reports.paper.get, { key: "R999999" })).toBeNull();
    expect(await world.t.query(api.reports.paper.keyByDoi, { doi: (await row(world.t, waiting.key)).doi })).toBeNull();

    const { key } = await live(world, world.author, world.lab);
    const page = await world.t.query(api.reports.paper.get, { key });
    expect(page).toMatchObject({ state: "live", key, doi: "10.53832/openscholar-r.r100002", metadata: { title: "Shade trees and maize yields" }, series: { name: "Openscholar Reports" } });
    expect(await world.t.query(internal.reports.paper.doiOf, { key })).toBe("10.53832/openscholar-r.r100002");
    // A DOI link may carry the DOI in any case.
    expect(await world.t.query(api.reports.paper.keyByDoi, { doi: "10.53832/OPENSCHOLAR-R.R100002" })).toBe(key);
  });

  it("keeps the series name it was signed under when the series is renamed, as its registrations do", async () => {
    const world = await setup();
    const { key } = await live(world);
    await world.reviewer.mutation(api.reports.settings.update, { series: { name: "Working Reports" } });
    expect(await world.t.query(api.reports.paper.get, { key })).toMatchObject({ series: { name: "Openscholar Reports" } });
    expect(await world.t.query(internal.reports.paper.forCommunity, { dois: [(await row(world.t, key)).doi], libraryId: "community-1" })).toMatchObject([{ series: "Openscholar Reports" }]);
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
    // Its page still says it was withdrawn, so its DOI's link still leads there.
    expect(await world.t.query(api.reports.paper.keyByDoi, { doi: (await row(world.t, key)).doi })).toBe(key);
    await decide(world, key, "reinstate");
    expect(await world.t.query(api.reports.paper.get, { key })).toMatchObject({ state: "live" });
  });

  it("is given to a community by its DOI: live with its details, corrected with a new version, withdrawn as withdrawn", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    const { key } = await live(world, world.author, world.lab);
    const doi = (await row(world.t, key)).doi;
    const ask = (...dois: string[]) => world.t.query(internal.reports.paper.forCommunity, { dois, libraryId: "community-1" });
    // In the order asked; a DOI that is no report of ours, and a report that never went live, name nothing.
    const [first, other, unpublished] = await ask(doi.toUpperCase(), "10.1000/elsewhere", (await row(world.t, waiting.key)).doi);
    expect(first).toMatchObject({ state: "live", key, doi, title: "Shade trees and maize yields", series: "Openscholar Reports", hasPdf: true });
    expect([other, unpublished]).toEqual([null, null]);
    // A reviewer's edit is the report's at once: the community is told by the version.
    const seenAt = (await row(world.t, key)).updatedAt;
    const page = await world.t.query(api.reports.paper.get, { key });
    if (page?.state !== "live") throw new Error("The report isn't live");
    // Its funding and its authors' affiliations reach the community with the rest, so a corrected funder does too.
    const funding = [{ funder: { id: "https://ror.org/021nxhr62", name: "National Science Foundation" }, awards: ["QA-WAVE9-CORRECTED"] }];
    const author = { name: "Chikondi Banda", orcid: "0000-0002-1825-0097", openalexId: null, affiliations: [{ id: "I4210087849", name: "University of Rwanda", country: "RW", ror: "https://ror.org/00286hs46" }], corresponding: true, roles: [] };
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt, metadata: { ...page.metadata, title: "Shade trees, corrected", funding, authors: [author], sdgs: ["2"] } });
    const [corrected] = await ask(doi);
    expect(corrected).toMatchObject({ state: "live", title: "Shade trees, corrected", funding, sdgs: ["2"], authors: [{ name: author.name, orcid: author.orcid, affiliations: author.affiliations }] });
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

  it("keeps its saved copies in step in every workspace: corrected, withdrawn and reinstated", async () => {
    vi.useFakeTimers();
    try {
      const world = await setup();
      const { key } = await live(world);
      const page = await world.t.query(api.reports.paper.get, { key });
      if (page?.state !== "live") throw new Error("The report isn't live");
      // Saved as its page saves it, by its author at home and by a colleague in the organisation.
      const paper = reportPaper({ key, doi: page.doi, pdfUrl: page.pdfUrl, updatedAt: page.updatedAt }, page.metadata, page.series);
      const saved = { ...trimPaperData(paper), paperData: JSON.stringify(paper) };
      await world.author.mutation(api.library.mutations.saveToLibrary, { workspaceId: world.own, ...saved });
      await world.orgAdmin.mutation(api.library.mutations.saveToLibrary, { workspaceId: world.lab, ...saved });
      const copies = () => world.t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", `report:${key}`)).collect());
      expect((await copies()).map((copy) => copy.title)).toEqual(["Shade trees and maize yields", "Shade trees and maize yields"]);

      await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: { ...page.metadata, title: "Shade trees, corrected" } });
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const copy of await copies()) {
        expect(copy).toMatchObject({ title: "Shade trees, corrected", pdfUrl: `/papers/${key}/report.pdf` });
        expect(copy.searchableText).toContain("Shade trees, corrected");
        expect(JSON.parse(copy.paperData!)).toMatchObject({ title: "Shade trees, corrected" });
      }

      await decide(world, key, "withdraw");
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const copy of await copies()) {
        expect(copy.title).toBe("Withdrawn: Shade trees, corrected");
        expect(copy.pdfUrl).toBeUndefined();
        expect(copy.oaUrl).toBeUndefined();
      }

      await decide(world, key, "reinstate");
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      for (const copy of await copies()) expect(copy).toMatchObject({ title: "Shade trees, corrected", pdfUrl: `/papers/${key}/report.pdf` });
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
  it("is saved as the report has it, however it is saved, and never before it goes live", async () => {
    const world = await setup();
    const waiting = await checked(world, [passed("byline", false)]);
    const { key } = await live(world, world.author, world.lab);
    const copies = () => world.t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", `report:${key}`)).collect());
    // Details sent with a save are not the report's: the report's own are kept.
    await world.author.mutation(api.library.mutations.saveToLibrary, { workspaceId: world.own, paper: `https://openscholar.ai/${key}`, title: "Something else", abstract: "Made up", paperData: "{}" });
    // The assistant saves it by the ID search results give it, as any paper.
    await world.orgAdmin.action(api.library.papers.save, { workspaceId: world.lab, id: key });
    const saved = await copies();
    expect(saved).toHaveLength(2);
    for (const copy of saved) {
      expect(copy).toMatchObject({ title: "Shade trees and maize yields", abstract: "We measure maize yields on 640 plots.", pdfUrl: `/papers/${key}/report.pdf` });
      expect(JSON.parse(copy.paperData!)).toMatchObject({ id: `https://openscholar.ai/${key}`, title: "Shade trees and maize yields" });
    }
    // A report that never went live has no details to copy, however it is named.
    await expect(world.author.mutation(api.library.mutations.saveToLibrary, { workspaceId: world.own, paper: `report:${waiting.key}`, title: "A guess" })).rejects.toMatchObject(refused("NOT_FOUND"));
    await expect(world.author.action(api.library.papers.save, { workspaceId: world.own, id: waiting.key })).rejects.toMatchObject(refused("NOT_FOUND"));
    const collectionId = await world.t.run((ctx) => ctx.db.insert("collections", { workspaceId: world.own, createdBy: world.authorId, name: "Reading", sortName: "reading", createdAt: 1, updatedAt: 1, itemCount: 0 }));
    await expect(world.author.mutation(api.library.mutations.setPaperInCollection, { workspaceId: world.own, paper: { paper: `report:${waiting.key}`, title: "A guess" }, collectionId, inCollection: true })).rejects.toMatchObject({ data: expect.objectContaining({ code: "NOT_FOUND", message: "No report published on Openscholar has this key." }) });
  });

  it("brings its saved copies in step with a reviewer's edit while withdrawn, and with the series' new ISSN", async () => {
    vi.useFakeTimers();
    try {
      const world = await setup();
      const { key } = await live(world, world.author, world.lab);
      await world.orgAdmin.action(api.library.papers.save, { workspaceId: world.lab, id: key });
      const copy = async () => (await world.t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_paperKey", (q) => q.eq("paperKey", `report:${key}`)).unique()))!;
      const page = await world.t.query(api.reports.paper.get, { key });
      if (page?.state !== "live") throw new Error("The report isn't live");
      await decide(world, key, "withdraw");
      await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: { ...page.metadata, title: "Shade trees, retitled" } });
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await copy()).title).toBe("Withdrawn: Shade trees, retitled");

      await world.reviewer.mutation(api.reports.settings.update, { series: { issn: "2049-3630" } });
      await world.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(JSON.parse((await copy()).paperData!)).toMatchObject({ primary_location: { source: { issn_l: "2049-3630" } } });
    } finally {
      vi.useRealTimers();
    }
  });
  it("gives its file only to whom its access allows: private to no one, readers-only to an agreed community, an embargo from its day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    try {
      const world = await setup();
      const { key, reportId } = await live(world);
      const doi = (await row(world.t, key)).doi;
      const page = () => world.t.query(api.reports.paper.get, { key });
      const community = async (libraryId: string) => (await world.t.query(internal.reports.paper.forCommunity, { dois: [doi], libraryId }))[0];
      const access = (fileAccess: { mode: "open" } | { mode: "private" } | { mode: "embargo"; until: string }) => world.author.mutation(api.reports.flow.setFileAccess, { workspaceId: world.own, key, fileAccess });

      // Live, its file only ever opens: anyone may have had it, so it can't be made private again.
      await expect(access({ mode: "private" })).rejects.toThrow(/only open further/);
      // Signed private, it is private on its page and to communities.
      // Its cover is a picture of the PDF's first page, held back with the PDF.
      await world.t.run(async (ctx) => ctx.db.patch("reports", reportId, { fileAccess: { mode: "private" }, cover: { file: await ctx.storage.store(new Blob(["first page"])), at: 1 } }));
      expect(await page()).toMatchObject({ pdfUrl: null, coverUrl: null, fileAccess: { mode: "private" } });
      expect(await community("community-1")).toMatchObject({ hasPdf: false });

      await access({ mode: "embargo", until: "2026-11-21" });
      expect(await page()).toMatchObject({ pdfUrl: null });
      expect(await world.t.mutation(internal.reports.fileAccess.openEmbargoes, {})).toBe(0);
      vi.setSystemTime(new Date("2026-11-21T00:30:00Z"));
      expect(await world.t.mutation(internal.reports.fileAccess.openEmbargoes, {})).toBe(1);
      expect(await page()).toMatchObject({ pdfUrl: expect.any(String), coverUrl: expect.any(String), fileAccess: { mode: "open" } });
      expect(await community("community-1")).toMatchObject({ hasPdf: true });

      // Under the author's own licence that isn't open, readers here get the file, and a community only once agreed.
      const [agreed, other] = await world.t.run(async (ctx) => {
        const library = (slug: string) => ctx.db.insert("evidenceLibraries", { workspaceId: world.own, name: slug, slug, state: "active", createdByClerkUserId: "ada", updatedByClerkUserId: "ada", createdAt: 1, updatedAt: 1 } as never);
        return [await library("agreed"), await library("other")];
      });
      await world.t.run((ctx) => ctx.db.patch("reports", reportId, { licence: { name: "Our terms", url: "https://example.org/terms", open: false }, fileAccess: { mode: "readers" }, pdfCommunities: [] }));
      expect(await page()).toMatchObject({ pdfUrl: expect.any(String) });
      expect(await community(agreed)).toMatchObject({ hasPdf: false });
      await world.t.run((ctx) => ctx.db.patch("reports", reportId, { pdfCommunities: [agreed] }));
      expect(await community(agreed)).toMatchObject({ hasPdf: true });
      expect(await community(other)).toMatchObject({ hasPdf: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
