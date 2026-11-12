import { describe, expect, it, onTestFinished, vi } from "vitest";
import { DEFAULT_CHECKS } from "../../lib/reports/settings";
import { api, internal } from "../_generated/api";
import { stageOf, type Metadata } from "../../lib/reports/report";
import { startsLeft } from "./limits";
import { activate, atDetails, checked, details, passed, read, refused, row, setup, sign } from "./reports.test-support";
import { sameTitle } from "./published";
import { purgeWorkspace } from "../workspaces/purge";
import { ensureWorkspace } from "../workspaces/create";

describe("starting a report", () => {
  it("reserves a key and a DOI, and counts against the workspace's day", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    expect(key).toBe("R100001");
    expect(await read(world.author, world.own, key)).toMatchObject({ doi: "10.53832/openscholar-r.r100001", step: "doi", status: "draft", mine: true, signer: "Ada Author" });
    // Signing again before doing anything with it, as after a reload that lost the answer, gives the same report.
    expect(await sign(world.author, world.own)).toBe("R100001");
    expect(await world.author.query(api.reports.flow.starts, { workspaceId: world.own, now: Date.now() })).toMatchObject({ left: 0, untouched: "R100001" });
    // Once it has moved on, a person's own workspace starts no other that day; the organisation's count is its own.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FORBIDDEN"));
    expect(await sign(world.author, world.lab)).toBe("R100002");
  });

  it("is refused while publishing is off, for an agreement that changed, and without a name", async () => {
    const world = await setup();
    await expect(world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "Ada", onBehalfOfAll: false, version: 7, licence: "CC BY 4.0" })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.sign, { workspaceId: world.own, name: "   ", onBehalfOfAll: false, version: 1, licence: "CC BY 4.0" })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await world.t.run(async (ctx) => ctx.db.patch("reportSettings", (await ctx.db.query("reportSettings").first())!._id, { enabled: false }));
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FEATURE_DISABLED"));
    // Nothing a refused signing asked for was kept or counted.
    expect(await world.t.run((ctx) => ctx.db.query("reports").take(5))).toHaveLength(0);
    expect(await world.t.run((ctx) => startsLeft(ctx, world.own, Date.now()))).toMatchObject({ left: 1 });
  });

  it("keeps a discarded report's start used", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.author.query(api.reports.flow.get, { workspaceId: world.own, key })).toBeNull();
    await expect(sign(world.author, world.own)).rejects.toMatchObject(refused("FORBIDDEN"));
  });
});

describe("reports that wait in a person's other workspaces", () => {
  it("tells an admin of the lab, from their own workspace, and tells a member nothing", async () => {
    const world = await setup();
    await checked(world, [passed("byline"), passed("harm")], world.member, world.lab);
    const ownOf = (clerkId: string) => world.t.run(async (ctx) => ensureWorkspace(ctx, { kind: "personal", userId: (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId)).unique())!._id }));
    expect(await world.orgAdmin.query(api.reports.flow.waitingElsewhere, { workspaceId: await ownOf("orgadmin") })).toEqual({ ready: 1, first: { name: "Learning Lab", slug: "lab", ready: 1 } });
    // In the lab itself its own Publish says so, and a member activates nothing.
    expect(await world.orgAdmin.query(api.reports.flow.waitingElsewhere, { workspaceId: world.lab })).toEqual({ ready: 0, first: null });
    expect(await world.member.query(api.reports.flow.waitingElsewhere, { workspaceId: await ownOf("member") })).toEqual({ ready: 0, first: null });
    // A person's own ready report is said in the lab, where they are only a member.
    await checked(world, [passed("byline"), passed("harm")]);
    expect(await world.author.query(api.reports.flow.waitingElsewhere, { workspaceId: world.lab })).toEqual({ ready: 1, first: { name: "", slug: null, ready: 1 } });
  });
});

describe("a PDF read while its author went back", () => {
  it("leaves the report at its DOI, with the details read, and the upload a step away", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a report"], { type: "application/pdf" })));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf" });
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "doi" });
    const { _id: reportId, pdf } = await row(world.t, key);
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdf!.at, pages: 12, metadata: details() });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "doi", pdf: { pages: 12 }, metadata: { title: details().title } });
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "details" });
  });
});

describe("who works on a workspace's report", () => {
  it("lets every member see it, and only its owner and the workspace's admins change it", async () => {
    const world = await setup();
    const key = await sign(world.author, world.lab);
    expect(await read(world.member, world.lab, key)).toMatchObject({ mine: false });
    expect(await read(world.orgAdmin, world.lab, key)).toMatchObject({ mine: true });
    expect((await world.member.query(api.reports.flow.page, { workspaceId: world.lab, page: 1 })).rows).toMatchObject([{ key, mine: false }]);
    await expect(world.member.mutation(api.reports.flow.discard, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(api.reports.flow.startUpload, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await expect(world.member.mutation(internal.reports.checkRuns.start, { workspaceId: world.lab, key, metadata: details(), runId: "r", from: { pdfAt: 1 } })).rejects.toMatchObject(refused("FORBIDDEN"));
    await world.orgAdmin.mutation(api.reports.flow.discard, { workspaceId: world.lab, key });
  });

  it("shows it to nobody outside the workspace, and names its workspace to a member who asks from another", async () => {
    const world = await setup();
    const key = await sign(world.author, world.lab);
    await expect(world.stranger.query(api.reports.flow.get, { workspaceId: world.lab, key })).rejects.toMatchObject(refused("NOT_FOUND"));
    // Asked from the author's own workspace, the organisation's report is named, not shown.
    expect(await world.author.query(api.reports.flow.get, { workspaceId: world.own, key })).toEqual({ elsewhere: { name: "Learning Lab", slug: "lab" } });
    // A change sent to the wrong workspace is refused.
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("NOT_FOUND"));
  });
});

describe("a report's PDF", () => {
  it("takes only a PDF within its size, deleting anything else and saying why", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const text = await world.t.run((ctx) => ctx.storage.store(new Blob(["notes"])));
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file: text, name: "notes.txt" })).toBe("Choose a PDF.");
    expect(await world.t.run((ctx) => ctx.db.system.get(text))).toBeNull();
    const empty = await world.t.run((ctx) => ctx.storage.store(new Blob([])));
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file: empty, name: "empty.pdf" })).toMatch(/empty/);
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "doi" });
  });

  it("is never a file that isn't this upload's, and such a file is left alone", async () => {
    const world = await setup();
    const first = await atDetails(world);
    const firstPdf = (await row(world.t, first.key)).pdf!.file;
    // The first report's PDF, named again for a report in another workspace with a name that would be refused.
    const other = await sign(world.author, world.lab);
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.lab, key: other, file: firstPdf, name: "not-a-pdf.txt" })).toMatch(/didn't arrive/);
    expect(await world.t.run((ctx) => ctx.db.system.get(firstPdf))).not.toBeNull();
    expect((await read(world.author, world.own, first.key)).pdf?.url).toEqual(expect.any(String));
    expect((await read(world.author, world.lab, other)).step).toBe("doi");
  });

  it("is given up when its report was discarded while it was on its way", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7"])));
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf" })).toMatch(/discarded/);
    expect(await world.t.run((ctx) => ctx.db.system.get(file))).toBeNull();
  });

  it("reads its details again from the PDF that replaced another, when its author asks, and only then", async () => {
    const world = await setup();
    const first = await atDetails(world);
    // Read from its first PDF, the details aren't kept from anything: there is nothing to read again.
    await expect(world.author.mutation(api.reports.flow.readAgain, { workspaceId: world.own, key: first.key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 the right file"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key: first.key, file, name: "right.pdf" });
    const at = (await row(world.t, first.key)).pdf!.at;
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at, pages: 3 });
    expect(await read(world.author, world.own, first.key)).toMatchObject({ step: "details", pdf: { kept: true }, metadata: { title: "Shade trees and maize yields" } });
    // Asked for, the kept details go and the PDF is read as a first one is.
    await world.author.mutation(api.reports.flow.readAgain, { workspaceId: world.own, key: first.key });
    expect(await read(world.author, world.own, first.key)).toMatchObject({ step: "upload" });
    expect((await read(world.author, world.own, first.key)).metadata).toBeUndefined();
    const again_at = (await row(world.t, first.key)).pdf!.at;
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: again_at, pages: 3, metadata: details("The right file's title") });
    // A Details form left open on the kept details, in another tab, changes nothing when it saves.
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: details("Typed over the kept details"), pdfAt: at });
    const again = await read(world.author, world.own, first.key);
    expect(again).toMatchObject({ step: "details", metadata: { title: "The right file's title" } });
    expect(again.pdf?.kept).toBeUndefined();
  });

  it("has the byline's page added to a PDF that lacks the line, when its author asks, and moves on with the new file", async () => {
    const world = await setup();
    const { key, reportId } = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 no line"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "no-line.pdf", bylineBy: "self" });
    // Nothing to add while the PDF hasn't been found lacking.
    await expect(world.author.mutation(api.reports.flow.addByline, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: (await row(world.t, key)).pdf!.at, pages: 4, lacksByline: true });
    await world.author.mutation(api.reports.flow.addByline, { workspaceId: world.own, key });
    const asked = (await row(world.t, key)).pdf!;
    expect(asked).toMatchObject({ file, bylineBy: "added" });
    expect((await world.t.query(internal.reports.readingState.begin, { reportId, at: asked.at }))?.added).toBe(true);
    // The reading adds the page: the file with it replaces the upload, which is deleted.
    const added = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 no line, and a page with it"])));
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: asked.at, pages: 5, withByline: { file: added, bytes: 36 } });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", pdf: { pages: 5, bytes: 36, bylineBy: "added" }, metadata: { title: "Shade trees and maize yields" } });
    expect((await row(world.t, key)).pdf!).toMatchObject({ file: added, stamped: true });
    expect(await world.t.run((ctx) => ctx.db.system.get(file))).toBeNull();
    // The checks write the page again with the details they read: that file takes the last one's place.
    const again = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 no line, and the page again"])));
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { run: { id: "run-1", at: Date.now() } }));
    await world.t.mutation(internal.reports.readingState.restamped, { reportId, runId: "run-1", at: asked.at, file: again, bytes: 37 });
    expect((await row(world.t, key)).pdf!).toMatchObject({ file: again, bytes: 37, stamped: true });
    expect(await world.t.run((ctx) => ctx.db.system.get(added))).toBeNull();
    // One written by a run that is no longer the report's is given up.
    const late = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 late"])));
    await world.t.mutation(internal.reports.readingState.restamped, { reportId, runId: "run-0", at: asked.at, file: late, bytes: 13 });
    expect((await row(world.t, key)).pdf!.file).toBe(again);
    expect(await world.t.run((ctx) => ctx.db.system.get(late))).toBeNull();
  });

  it("stays at the upload, saying so, when its PDF's text doesn't carry the byline, with the way on to its details", async () => {
    const world = await setup();
    // A first PDF, read, then replaced by one without the line: the reading is what finds it missing.
    const { key, reportId } = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 no line"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "no-line.pdf" });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: (await row(world.t, key)).pdf!.at, pages: 4, lacksByline: true });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", pdf: { pages: 4, lacksByline: true }, metadata: { title: "Shade trees and maize yields" } });
    // The line is looked for only while the byline check is switched on: with it off, the reading is given none.
    const at = (await row(world.t, key)).pdf!.at;
    expect((await world.t.query(internal.reports.readingState.begin, { reportId, at }))?.byline).toBe((await row(world.t, key)).byline);
    await world.t.run(async (ctx) => {
      const settings = (await ctx.db.query("reportSettings").first())!;
      await ctx.db.patch("reportSettings", settings._id, { checks: (settings.checks ?? DEFAULT_CHECKS).map((check) => (check.id === "byline" ? { ...check, enabled: false } : check)) });
    });
    expect((await world.t.query(internal.reports.readingState.begin, { reportId, at }))?.byline).toBeNull();
    // Its details are read all the same, so its author can go on to them.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "details" });
    expect((await read(world.author, world.own, key)).step).toBe("details");
  });

  it("keeps the details it has when its PDF is replaced, and a save typed over the PDF before it changes nothing", async () => {
    const world = await setup();
    const first = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "upload" });
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a second report"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key: first.key, file, name: "second.pdf" });
    const second = (await row(world.t, first.key)).pdf!.at;
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: second, pages: 3, metadata: details("The second PDF's title") });
    // A tab left open on the first PDF's details saves, and asks for the checks.
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: details("Typed over the first PDF"), pdfAt: first.pdfAt });
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key: first.key, metadata: details("Typed over the first PDF"), runId: "stale", from: { pdfAt: first.pdfAt } })).rejects.toMatchObject(refused("CONFLICT"));
    // The details stay as they were before the second PDF: neither its reading nor the stale tab's typing replaces them.
    expect(await read(world.author, world.own, first.key)).toMatchObject({ step: "details", pdf: { name: "second.pdf", pages: 3 }, metadata: { title: "Shade trees and maize yields" } });
  });

  it("fills the signer's own author row from their profile where the PDF gave no iD or institution", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const { _id: reportId, ownerId } = await row(world.t, key);
    const lab = { id: "I1", name: "University of Ghana", country: "GH" };
    await world.t.run((ctx) => ctx.db.patch("users", ownerId, { profile: { affiliations: [lab], orcid: "0000-0002-1825-0097", emails: { updates: false, news: false, research: false } } }));
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a report"], { type: "application/pdf" })));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf" });
    const author = (name: string, orcid = "") => ({ name, orcid, openalexId: null, affiliations: [], corresponding: false, roles: [] });
    // The signer's iD wasn't printed: ORCID's search guessed one, which their own profile comes before.
    const readFromPdf = { ...details(), authors: [author("Kofi Mensah", "0000-0001-5109-3700"), { ...author("ada  AUTHOR", "0000-0003-1415-9269"), orcidFound: "University of Lagos" }, author("Ama Owusu")] };
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: (await row(world.t, key)).pdf!.at, pages: 12, metadata: readFromPdf });
    const { metadata } = await read(world.author, world.own, key);
    // The signer, matched by the name signed with however it is spaced or cased; the others keep what the PDF gave.
    expect(metadata?.authors).toMatchObject([{ orcid: "0000-0001-5109-3700", affiliations: [] }, { orcid: "0000-0002-1825-0097", affiliations: [lab] }, { orcid: "", affiliations: [] }]);
    expect(metadata?.authors[1]?.orcidFound).toBeUndefined();
  });

  it("opens its details once read, and ignores the reading of a PDF since replaced", async () => {
    const world = await setup();
    const first = await atDetails(world);
    expect(await read(world.author, world.own, first.key)).toMatchObject({ step: "details", metadata: { title: "Shade trees and maize yields" }, pdf: { pages: 12 } });
    // A second PDF keeps the details, and its own step waits until it is read.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "upload" });
    // A change typed just before stepping back arrives after it, and is kept.
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: { keywords: ["agroforestry"] }, pdfAt: first.pdfAt });
    expect((await read(world.author, world.own, first.key)).metadata?.keywords).toEqual(["agroforestry"]);
    const file = await world.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.7 a second report"])));
    await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key: first.key, file, name: "second.pdf" });
    const replaced = await read(world.author, world.own, first.key);
    expect(replaced.step).toBe("upload");
    expect(replaced.metadata?.title).toBe("Shade trees and maize yields");
    await expect(world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key: first.key, step: "details" })).rejects.toMatchObject(refused("CONFLICT"));
    await world.t.mutation(internal.reports.readingState.finish, { reportId: first.reportId, at: first.pdfAt, pages: 12, metadata: details("The first PDF's title") });
    expect((await read(world.author, world.own, first.key)).step).toBe("upload");
  });

  it("keeps each person's role and the references as written, and refuses a reference with neither words nor a DOI", async () => {
    const world = await setup();
    const first = await atDetails(world);
    const authors = [{ name: "Chikondi Banda", orcid: "", openalexId: null, affiliations: [], corresponding: true, roles: [] }, { name: "Ada Okafor", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [], kind: "editor" as const }];
    const citations = [{ text: "Banerjee, A., & Duflo, E. (2011). Poor Economics. PublicAffairs." }, { text: "Piper, B. (2018). Scaling up successfully.", doi: "10.1007/s10833-018-9325-4" }];
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: { authors, citations, references: ["10.1007/s10833-018-9325-4"] }, pdfAt: first.pdfAt });
    expect((await read(world.author, world.own, first.key)).metadata).toMatchObject({ authors: [{ name: "Chikondi Banda" }, { name: "Ada Okafor", kind: "editor" }], citations, references: ["10.1007/s10833-018-9325-4"] });
    await expect(world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: { citations: [{ text: " " }] }, pdfAt: first.pdfAt })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key: first.key, changes: { citations: [{ text: "A reference", doi: " " }] }, pdfAt: first.pdfAt })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
  });

  it("wears the picture drawn of it, and drops one that is too big to be a cover", async () => {
    const world = await setup();
    const key = await sign(world.author, world.own);
    const attach = async (cover: Blob) => {
      const [file, picture] = await world.t.run(async (ctx) => [await ctx.storage.store(new Blob(["%PDF-1.7"])), await ctx.storage.store(cover)] as const);
      await world.author.mutation(api.reports.flow.attachPdf, { workspaceId: world.own, key, file, name: "report.pdf", cover: picture });
      return picture;
    };
    const huge = await attach(new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" }));
    expect((await read(world.author, world.own, key)).coverUrl).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.system.get(huge))).toBeNull();
    await attach(new Blob(["jpeg"], { type: "image/jpeg" }));
    expect((await read(world.author, world.own, key)).coverUrl).toEqual(expect.any(String));
  });

  it("says when it couldn't be opened, and when its details couldn't be read", async () => {
    const world = await setup();
    const { key, reportId, pdfAt } = await atDetails(world);
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", pdf: { trouble: "unopened" } });
    await world.t.mutation(internal.reports.readingState.finish, { reportId, at: pdfAt, pages: 3, metadata: details(), trouble: "unread" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", pdf: { trouble: "unread" } });
  });
});

describe("a report's checks", () => {
  it("make it ready when all pass, and wait for a reviewer exactly while review is on", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline"), passed("harm")]);
    const report = await read(world.author, world.own, key);
    expect(report).toMatchObject({ step: "done", status: "passed", results: [{ checkId: "byline", pass: true }, { checkId: "harm", pass: true }] });
    // An author's page never gets the model behind an answer.
    expect(report.results![0]).not.toHaveProperty("model");
    expect(stageOf(report, true)).toBe("review");
    // Nothing about review is kept on the report: switched off, the same report is ready.
    expect(stageOf(report, false)).toBe("ready");
    expect(await world.author.query(api.reports.flow.counts, { workspaceId: world.own })).toMatchObject({ review: 1, ready: 0 });
  });

  it("go live when its author activates it, and only once no review is owed", async () => {
    const world = await setup({ humanReview: true });
    const { key } = await checked(world, [passed("byline")]);
    await expect(activate(world, key)).rejects.toMatchObject(refused("CONFLICT"));
    await world.t.run(async (ctx) => ctx.db.patch("reportSettings", (await ctx.db.query("reportSettings").first())!._id, { humanReview: false }));
    await activate(world, key);
    // Its route was Crossref alone, so only Crossref's registration is queued.
    expect(await read(world.author, world.own, key)).toMatchObject({ status: "live", deposit: "queued", archive: "none" });
    await expect(activate(world, key)).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("stop it when a blocking check fails, and flag it for a reviewer when another does", async () => {
    const world = await setup();
    const blocked = await checked(world, [passed("byline", false), passed("harm")]);
    expect(await read(world.author, world.own, blocked.key)).toMatchObject({ status: "failed" });
    const flagged = await checked(world, [passed("byline"), passed("published", false, false)], world.author, world.lab);
    const report = await read(world.author, world.lab, flagged.key);
    expect(report).toMatchObject({ status: "passed", flagged: true });
    expect(stageOf(report, false)).toBe("review");
    // The assistant is told where it stands as the Publish page shows it, waiting for review, not just that it passed.
    const asked = { userId: world.authorId, workspaceId: world.lab };
    expect(await world.t.query(internal.reports.flow.getForAssistant, { ...asked, key: flagged.key })).toMatchObject({ report: { stage: "review" } });
    expect((await world.t.query(internal.reports.flow.pageForAssistant, { ...asked, page: 1 })).rows).toMatchObject([{ key: flagged.key, stage: "review" }]);
  });

  it("save nothing from a run that a newer run or a new PDF replaced", async () => {
    const world = await setup();
    const { key, reportId, pdfAt } = await atDetails(world);
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "old", from: { pdfAt } });
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Corrected title"), runId: "new", from: { pdfAt } });
    await world.t.mutation(internal.reports.checkRuns.answer, { reportId, runId: "old", result: passed("byline", false) });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "old", results: [passed("byline", false)], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "draft", run: { results: [] }, metadata: { title: "Corrected title" } });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "new", results: [passed("byline")], version: 1 });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "done", status: "passed" });
    // Checked, it takes no more runs, saves or uploads.
    await expect(world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details(), runId: "late", from: { pdfAt } })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.startUpload, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, changes: details("Changed after the checks"), pdfAt });
    expect((await read(world.author, world.own, key)).metadata?.title).toBe("Corrected title");
  });

  it("let a failed report ask for a person, go back for a new PDF, or be discarded", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "  The byline is on page 2.  " });
    expect(await read(world.author, world.own, key)).toMatchObject({ asked: true, reviewRequest: { comment: "The byline is on page 2." } });
    // Its details open again without a new PDF, and its PDF can be replaced.
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "details" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "failed", metadata: { title: "Shade trees and maize yields" } });
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "upload" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "upload", status: "failed" });
    await world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key });
    expect(await world.t.run((ctx) => ctx.db.query("reportDetails").take(5))).toHaveLength(0);
  });

  it("returns a failed report to its checks with its review request, after its steps were opened with nothing changed", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline", false)]);
    await world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "The byline is on page 2." });
    await world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step: "doi" });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "doi", reopened: true });
    await world.author.mutation(api.reports.flow.backToChecks, { workspaceId: world.own, key });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "done", status: "failed", asked: true, reviewRequest: { comment: "The byline is on page 2." } });
  });

  it("can't be asked about or discarded once it has passed", async () => {
    const world = await setup();
    const { key } = await checked(world, [passed("byline")]);
    await expect(world.author.mutation(api.reports.flow.requestReview, { workspaceId: world.own, key, comment: "" })).rejects.toMatchObject(refused("CONFLICT"));
    await expect(world.author.mutation(api.reports.flow.discard, { workspaceId: world.own, key })).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("goes back from its checks until it is activated, and returns to them unchanged without running them again", async () => {
    const world = await setup();
    const { key, reportId, pdfAt } = await checked(world, [passed("byline")]);
    const back = (step: "doi" | "upload" | "details") => world.author.mutation(api.reports.flow.goTo, { workspaceId: world.own, key, step });
    const toChecks = () => world.author.mutation(api.reports.flow.backToChecks, { workspaceId: world.own, key });

    await back("doi");
    await back("details");
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", status: "passed", reopened: true });
    await toChecks();
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "done", status: "passed", reopened: false, results: [{ checkId: "byline" }] });
    await expect(toChecks()).rejects.toMatchObject(refused("CONFLICT"));

    // Sent to the checks again, it can't return to the old ones, even if that run never finishes.
    await back("details");
    await world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata: details("Shade trees, sent again"), runId: "run-2", from: { pdfAt } });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", reopened: false });
    await world.t.mutation(internal.reports.checkRuns.finish, { reportId, runId: "run-2", results: [passed("byline")], version: 1 });

    // A change to its details runs the checks again.
    await back("details");
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, changes: { title: "Shade trees and maize yields, revised" }, pdfAt });
    expect(await read(world.author, world.own, key)).toMatchObject({ step: "details", reopened: false });
    await expect(toChecks()).rejects.toMatchObject(refused("CONFLICT"));

    // While a payment for it is being charged or waits on the bank, it stays as it is. A charge left behind by an action
    // that died long ago holds nothing.
    const paying = await checked(world, [passed("byline")], world.author, world.lab);
    const by = await world.t.run(async (ctx) => (await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", "author")).unique())!._id);
    const charge = (state: "charging" | "pending", at: number) => world.t.run((ctx) => ctx.db.insert("reportActivations", { workspaceId: world.lab, reportId: paying.reportId, at, by, state }));
    const toDetails = () => world.author.mutation(api.reports.flow.goTo, { workspaceId: world.lab, key: paying.key, step: "details" });
    await charge("charging", Date.now() - 10 * 60_000);
    for (const state of ["charging", "pending"] as const) {
      const id = await charge(state, Date.now());
      await expect(toDetails()).rejects.toMatchObject(refused("CONFLICT"));
      expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key: paying.key })).toMatchObject({ paying: { until: state === "charging" ? expect.any(Number) : null } });
      await world.t.run((ctx) => ctx.db.delete("reportActivations", id));
    }
    expect(await read(world.author, world.lab, paying.key)).toMatchObject({ step: "done", reopened: false });
    expect(await world.author.query(api.reports.activation.terms, { workspaceId: world.lab, key: paying.key })).toMatchObject({ paying: null });
    await toDetails();
    expect(await read(world.author, world.lab, paying.key)).toMatchObject({ step: "details", reopened: true });

    // Live, it changes through its corrections instead.
    const live = await checked(world, [passed("byline")], world.author, world.lab);
    await activate(world, live.key, { as: "orgadmin", workspaceId: world.lab });
    await expect(world.author.mutation(api.reports.flow.goTo, { workspaceId: world.lab, key: live.key, step: "details" })).rejects.toMatchObject(refused("CONFLICT"));
  });
});

describe("a deleted workspace's reports", () => {
  it("go with it when they never went live, files included, and stay published when they did", async () => {
    const world = await setup();
    const draft = await atDetails(world, world.author, world.lab);
    const draftFile = (await row(world.t, draft.key)).pdf!.file;
    const published = await checked(world, [passed("byline")], world.author, world.lab);
    await activate(world, published.key, { as: "orgadmin", workspaceId: world.lab });

    expect(await world.t.run((ctx) => purgeWorkspace(ctx, world.lab))).toBe(true);
    expect(await row(world.t, draft.key)).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.system.get(draftFile))).toBeNull();
    expect(await world.t.run((ctx) => ctx.db.query("reportStarts").withIndex("by_workspaceId_and_at", (q) => q.eq("workspaceId", world.lab)).collect())).toEqual([]);
    expect(await row(world.t, published.key)).toMatchObject({ status: "live" });
  });
});

describe("the already-published check's titles", () => {
  it("match across case, accents and punctuation, in any script, and never on nothing", () => {
    expect(sameTitle("Shade Trees & Maize Yields.", "shade trees maize yields")).toBe(true);
    expect(sameTitle("Éducation à l'école", "Education a l ecole")).toBe(true);
    expect(sameTitle("学校教育研究", "学校教育政策研究")).toBe(false);
    expect(sameTitle("学校教育研究", "学校教育研究")).toBe(true);
    expect(sameTitle("…", "!!!")).toBe(false);
  });
});

describe("a report's links and words", () => {
  it("are saved while typed, hold the checks while a link leads nowhere, and drop a link left empty", async () => {
    const world = await setup();
    const { key, pdfAt } = await atDetails(world);
    const withLinks = (...targets: string[]) => ({ ...details(), relations: targets.map((target) => ({ kind: "data" as const, target })) });
    const run = (metadata: ReturnType<typeof details>, runId: string) => world.author.mutation(internal.reports.checkRuns.start, { workspaceId: world.own, key, metadata, runId, from: { pdfAt } });
    // Half typed, it is kept as it is: the form saves on every pause.
    await world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, changes: withLinks("javascript:alert(1)"), pdfAt });
    await expect(run(withLinks("javascript:alert(1)"), "bad-link")).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(run(withLinks("https://?"), "no-host")).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    // A value that has a list is one of the list's, whoever sends it: the registrars take no other.
    for (const stray of [{ language: "English" }, { type: "essay" }, { sdgs: ["18"] }, { studyDesigns: ["survey"] }, { countries: ["Atlantis"] }, { countries: ["world"] }])
      await expect(run({ ...details(), ...stray }, "off-list")).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    // A DOI and its doi.org address are the same link: the first is kept.
    await run(withLinks("https://example.org/data", "  ", "10.5281/zenodo.1234567", "https://doi.org/10.5281/ZENODO.1234567"), "good-links");
    expect((await read(world.author, world.own, key)).metadata!.relations.map((relation) => relation.target)).toEqual(["https://example.org/data", "10.5281/zenodo.1234567"]);
    // A keyword longer than a keyword is refused, wherever it is saved from.
    const other = await atDetails(world, world.author, world.lab);
    await expect(world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.lab, key: other.key, changes: { ...details(), keywords: ["k".repeat(101)] }, pdfAt: other.pdfAt })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
  });
});

describe("a report's details", () => {
  it("are refused with an ORCID iD that isn't one, or a title past its limit, and kept otherwise", async () => {
    const world = await setup();
    const { key, pdfAt } = await atDetails(world);
    const author = (orcid: string) => ({ name: "Ada Author", orcid, openalexId: null, affiliations: [], corresponding: true, roles: [] });
    const save = (metadata: Metadata) => world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, changes: metadata, pdfAt });
    await expect(save({ ...details(), authors: [author("banana")] })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(save({ ...details(), authors: [author("0000-0002-1825-0098")] })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await expect(save({ ...details("x".repeat(501)) })).rejects.toMatchObject(refused("VALIDATION_ERROR"));
    await save({ ...details("A kept title"), authors: [author("0000-0002-1825-0097")] });
    expect(await read(world.author, world.own, key)).toMatchObject({ title: "A kept title", metadata: { authors: [{ orcid: "0000-0002-1825-0097" }] } });
  });

  it("keep a field another tab saved when this tab saves a different one", async () => {
    const world = await setup();
    const { key, pdfAt } = await atDetails(world);
    const save = (changes: Partial<Metadata>) => world.author.mutation(api.reports.flow.saveDetails, { workspaceId: world.own, key, changes, pdfAt });
    await save({ title: "Title from tab one" });
    await save({ subtitle: "Subtitle from tab two" });
    expect(await read(world.author, world.own, key)).toMatchObject({ title: "Title from tab one", metadata: { title: "Title from tab one", subtitle: "Subtitle from tab two" } });
  });
});

describe("a workspace's list of reports", () => {
  it("lists the newest first and keeps one stage when asked", async () => {
    const world = await setup();
    // A second apart, as people work: reports made in the same instant have no order to list them in.
    vi.useFakeTimers({ now: 1_800_000_000_000, toFake: ["Date"] });
    onTestFinished(() => void vi.useRealTimers());
    const ready = await checked(world, [passed("byline")], world.author, world.lab);
    vi.advanceTimersByTime(1000);
    const failed = await checked(world, [passed("byline", false)], world.author, world.lab);
    vi.advanceTimersByTime(1000);
    const draft = await sign(world.author, world.lab);
    const all = await world.author.query(api.reports.flow.page, { workspaceId: world.lab, page: 1 });
    expect(all.rows.map((r) => r.key)).toEqual([draft, failed.key, ready.key]);
    // A page past the last answers the last, and says which it is.
    expect(await world.author.query(api.reports.flow.page, { workspaceId: world.lab, page: 999, show: "failed" })).toMatchObject({ rows: [{ key: failed.key }], page: 1, pages: 1, total: 1 });
    expect(await world.author.query(api.reports.flow.counts, { workspaceId: world.lab })).toMatchObject({ all: 3, draft: 1, failed: 1, ready: 1 });
    // The assistant reads the same, as the person who asked: which reports the workspace has, and where one stands.
    const asked = { userId: world.authorId, workspaceId: world.lab };
    expect((await world.t.query(internal.reports.flow.pageForAssistant, { ...asked, page: 1 })).rows.map((r) => r.key)).toEqual([draft, failed.key, ready.key]);
    expect(await world.t.query(internal.reports.flow.getForAssistant, { ...asked, key: failed.key })).toMatchObject({ report: { key: failed.key, status: "failed" } });
    expect(await world.t.query(internal.reports.flow.countsForAssistant, asked)).toMatchObject({ all: 3 });
    // Someone outside the organisation is told nothing of its reports through it.
    await expect(world.t.query(internal.reports.flow.pageForAssistant, { userId: world.strangerId, workspaceId: world.lab, page: 1 })).rejects.toThrow();
  });
});
