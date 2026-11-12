import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCrossrefPublicationXml, buildZenodoRecordPayload, mapCrossrefRecord } from "@opendeved/doi-sync-core";
import { api, internal } from "../_generated/api";
import { registrationRecord, zenodoRecord } from "../../lib/reports/registration-record";
import { REGISTRATION_TRIES } from "./registration";
import { details, live, refused, row, setup, type World } from "./reports.test-support";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.test");
  vi.stubEnv("EL_SMTP_HOST", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const settled = (world: World) => world.t.finishAllScheduledFunctions(vi.runAllTimers);
type ReportId = Awaited<ReturnType<typeof live>>["reportId"];
const revOf = async (world: World, reportId: ReportId) => (await world.t.run((ctx) => ctx.db.get("reports", reportId)))!.registrationRev!;
/** A registrar's answer to the report's latest asking, or to the one `rev` names. */
const settle = async (world: World, reportId: ReportId, provider: "crossref" | "zenodo", outcome: "done" | "refused" | "unreached", error?: string, rev?: number) =>
  world.t.mutation(internal.reports.registration.settle, { reportId, rev: rev ?? (await revOf(world, reportId)), provider, outcome, ...(error && { error }) });

describe("a report's record for its registrars", () => {
  const report = { key: "R100001", doi: "10.53832/openscholar-r.r100001" };
  const m = { ...details("Shade trees"), subtitle: "Evidence from Malawi", authors: [{ name: "Chikondi  Banda", orcid: "0000-0002-1825-0097", openalexId: null, affiliations: [{ id: "I4210087849", name: "LUANAR", country: "MW" }, { id: null, name: "A typed institute", country: "" }], corresponding: true, roles: ["Conceptualization", "Writing, review and editing"] }, { name: "Plato", orcid: "", openalexId: null, affiliations: [], corresponding: false, roles: [] }] };
  const series = { name: "Openscholar Reports", issn: "" };

  it("is one Crossref takes as a report, with each person's family name, roles and affiliations by ROR", () => {
    const record = registrationRecord(report, m, series, "https://openscholar.ai/", { funders: {}, institutions: { I4210087849: "https://ror.org/0188qm081" } });
    expect(record).toMatchObject({ itemType: "Report", license: "cc-by-4.0", title: "Shade trees", subtitle: "Evidence from Malawi", landingUrl: "https://openscholar.ai/papers/R100001", publisher: "Openscholar", institution: "Openscholar Reports", copyright: `© ${m.date.slice(0, 4)} The authors` });
    expect(record.creators).toEqual([
      {
        type: "personal", name: "Banda, Chikondi", creatorType: "author", givenName: "Chikondi", familyName: "Banda", orcid: "0000-0002-1825-0097",
        affiliations: [{ name: "LUANAR", ror: "0188qm081", country: "MW" }, { name: "A typed institute" }],
        roles: ["conceptualization", "writing-review-editing"], corresponding: true,
      },
      { type: "personal", name: "Plato", creatorType: "author", familyName: "Plato" },
    ]);
    // A body that wrote the report keeps its name whole.
    const body = registrationRecord(report, { ...m, authors: [{ ...m.authors[1]!, name: "World Health Organization" }] }, series, "https://openscholar.ai");
    expect(body.creators).toEqual([{ type: "organizational", name: "World Health Organization", creatorType: "author" }]);
    expect(mapCrossrefRecord(body, report.doi)).toMatchObject({ ok: true });
    expect(mapCrossrefRecord(record, report.doi)).toMatchObject({ ok: true, record: { kind: "report", metadata: { doi: report.doi, subtitle: "Evidence from Malawi" } } });
  });

  it("carries its subjects, places, study design, funders by Registry DOI and ROR, references, links, pages and full text, in its series", () => {
    const full = {
      ...m,
      topics: [{ id: "T10439", name: "Climate change impacts on agriculture", score: 0.8 }],
      sdgs: ["2"],
      studyDesigns: ["observational-study"],
      countries: ["MW", "eastern_africa"],
      funding: [{ funder: { id: "https://openalex.org/F4320306076", name: "National Science Foundation" }, awards: ["CHE-1152342"] }, { funder: { id: null, name: "A local trust" }, awards: [] }],
      references: ["10.1000/cited.1"],
      relations: [
        { kind: "data" as const, target: "https://doi.org/10.5281/zenodo.42" },
        { kind: "version" as const, target: "https://example.org/preprint" },
      ],
    };
    const record = registrationRecord({ ...report, pages: 12, hasPdf: true }, full, { ...series, issn: "2049-3630" }, "https://openscholar.ai", { funders: { F4320306076: { doi: "https://doi.org/10.13039/100000001", ror: "https://ror.org/021nxhr62" } }, institutions: {} });
    expect(record).toMatchObject({
      subjects: ["Climate change impacts on agriculture", "SDG 2: Zero hunger"],
      methods: "Observational study",
      locations: [{ place: "Malawi", country: "MW" }, { place: "Eastern Africa" }],
      funding: [{ funderName: "National Science Foundation", funderIdentifier: "https://doi.org/10.13039/100000001", funderRor: "021nxhr62", awards: ["CHE-1152342"] }, { funderName: "A local trust", awards: [] }],
      references: ["10.1000/cited.1"],
      relations: [
        { type: "isSupplementedBy", identifierType: "doi", identifier: "10.5281/zenodo.42", description: "Data" },
        { type: "hasVersion", identifierType: "uri", identifier: "https://example.org/preprint", description: "Other version" },
      ],
      pages: 12,
      formats: ["application/pdf"],
      fullTextUrl: "https://openscholar.ai/papers/R100001/report.pdf",
    });
    expect(mapCrossrefRecord(record, report.doi)).toMatchObject({ ok: true, record: { series: { title: "Openscholar Reports", issns: ["2049-3630"] }, freeToRead: true } });
  });

  it("sends a funder only ROR knows by its ROR ID, with the Funder Registry DOI ROR lists for it where it lists one", () => {
    const funding = [
      { funder: { id: null, name: "The LEGO Foundation", ror: "https://ror.org/020yc1y85" }, awards: ["G-1"] },
      { funder: { id: null, name: "Foreign, Commonwealth & Development Office", ror: "https://ror.org/037wke960" }, awards: [] },
    ];
    const record = registrationRecord(report, { ...m, funding }, series, "https://openscholar.ai", { funders: {}, institutions: {}, rorFunders: { "020yc1y85": "10.13039/100018325" } });
    expect(record.funding).toEqual([
      { funderName: "The LEGO Foundation", funderIdentifier: "https://doi.org/10.13039/100018325", funderRor: "020yc1y85", awards: ["G-1"] },
      // Not in the Funder Registry: Crossref still knows it by its ROR ID.
      { funderName: "Foreign, Commonwealth & Development Office", funderRor: "037wke960", awards: [] },
    ]);
  });

  it("keeps a date its PDF gives as a month as a month for Crossref, and gives Zenodo, which takes only a whole date, the first of it", () => {
    const record = registrationRecord(report, { ...m, date: "2026-10" }, series, "https://openscholar.ai");
    const mapped = mapCrossrefRecord(record, report.doi);
    if (!mapped.ok) throw new Error("Crossref refused the record");
    const xml = buildCrossrefPublicationXml({ batchId: "b", timestamp: "1", depositorName: "d", emailAddress: "e@example.org", registrant: "r", record: mapped.record });
    expect(xml.match(/<publication_date[^>]*>[\s\S]*?<\/publication_date>/)?.[0].replace(/\s+/g, "")).toBe('<publication_datemedia_type="online"><month>10</month><year>2026</year></publication_date>');
    const { landingUrl, doi, ...metadata } = zenodoRecord(record, { ...m, date: "2026-10" });
    expect(buildZenodoRecordPayload({ doiPolicy: "external-crossref", metadata: { ...metadata, doi }, resourceUrl: landingUrl }).metadata.publication_date).toBe("2026-10-01");
  });

  it("goes to Zenodo as the kind of work its author chose, while Crossref still takes it as a report in the series", () => {
    const zenodoType = (type: string) => {
      const record = registrationRecord(report, { ...m, type }, series, "https://openscholar.ai");
      const { landingUrl, doi, ...metadata } = zenodoRecord(record, { ...m, type });
      expect(mapCrossrefRecord(record, doi).ok).toBe(true);
      return buildZenodoRecordPayload({ doiPolicy: "external-crossref", metadata: { ...metadata, doi }, resourceUrl: landingUrl }).metadata.resource_type;
    };
    expect(zenodoType("article")).toEqual({ id: "publication-article" });
    expect(zenodoType("dataset")).toEqual({ id: "dataset" });
    expect(zenodoType("report")).toEqual({ id: "publication-report" });
    expect(zenodoType("paratext")).toEqual({ id: "publication-other" });
    // A dissertation is awarded by its author's university, never by Openscholar, the publisher.
    const thesis = (authors: typeof m.authors) => {
      const record = registrationRecord(report, { ...m, authors, type: "dissertation" }, series, "https://openscholar.ai");
      const { landingUrl, doi, ...metadata } = zenodoRecord(record, { ...m, authors, type: "dissertation" });
      const payload = buildZenodoRecordPayload({ doiPolicy: "external-crossref", metadata: { ...metadata, doi }, resourceUrl: landingUrl });
      return { type: payload.metadata.resource_type, thesis: payload.custom_fields["thesis:thesis"] };
    };
    expect(thesis(m.authors)).toMatchObject({ type: { id: "publication-dissertation" }, thesis: { university: "LUANAR" } });
    // Its first author has no institution: no university to name, so it stays a report.
    expect(thesis([m.authors[1]!, m.authors[0]!])).toEqual({ type: { id: "publication-report" }, thesis: undefined });
  });

  it("says so in its title once the report is withdrawn, with the day, and no longer points at its file", () => {
    const withdrawnAt = Date.UTC(2026, 10, 10, 15);
    const record = registrationRecord({ ...report, withdrawnAt, hasPdf: true }, m, series, "https://openscholar.ai");
    expect(record).toMatchObject({ title: "WITHDRAWN: Shade trees", withdrawnOn: "2026-11-10", doi: report.doi });
    expect(record).not.toHaveProperty("fullTextUrl");
  });
});

describe("registering a live report", () => {
  it("is refused in words when no registrar is connected, tells the team, and a reviewer alone can send it again", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    expect(await row(world.t, key)).toMatchObject({ status: "live", deposit: "failed", registrationError: expect.stringContaining("Crossref isn't connected") });
    expect(await world.t.run(async (ctx) => (await ctx.db.query("reportEmails").withIndex("by_reportId", (q) => q.eq("reportId", reportId)).take(20)).map((email) => email.event))).toContain("Registration refused");
    await expect(world.author.mutation(api.reports.registration.retry, { key })).rejects.toMatchObject(refused("FORBIDDEN"));
    await world.reviewer.mutation(api.reports.registration.retry, { key });
    expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
    expect(await row(world.t, key)).not.toHaveProperty("registrationError");
    await settled(world);
    // Sent again with nothing connected, it is refused again; with nothing refused there is nothing to send.
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "deposited" }));
    await expect(world.reviewer.mutation(api.reports.registration.retry, { key })).rejects.toMatchObject(refused("CONFLICT"));
  });

  it("keeps each registrar's answer, tries one that couldn't be reached again, and ignores an answer about an older record", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "queued", registrationError: undefined }));
    for (let tried = 1; tried < REGISTRATION_TRIES; tried++) {
      await settle(world, reportId, "crossref", "unreached", "Crossref answered 503");
      expect(await row(world.t, key)).toMatchObject({ deposit: "queued", registrationTries: tried });
    }
    await settle(world, reportId, "crossref", "unreached", "Crossref answered 503");
    expect(await row(world.t, key)).toMatchObject({ deposit: "failed", registrationError: "Crossref answered 503" });
    // Already settled: a late answer changes nothing.
    await settle(world, reportId, "crossref", "done");
    expect(await row(world.t, key)).toMatchObject({ deposit: "failed" });
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "queued" }));
    await settle(world, reportId, "crossref", "done");
    expect(await row(world.t, key)).toMatchObject({ deposit: "deposited" });
  });

  it("never takes an answer about the record as it was for the record as it is, and holds a report for one action at a time", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    const before = await revOf(world, reportId);
    // Corrected while an action for the record as it was is still out: that action's answer registers nothing.
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata: details("A corrected title") });
    expect(await revOf(world, reportId)).toBe(before + 1);
    expect(await settle(world, reportId, "crossref", "done", undefined, before)).toBe(false);
    expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
    // The record Zenodo made is the report's whichever asking made it.
    await world.t.mutation(internal.reports.registration.settle, { reportId, rev: before, provider: "zenodo", outcome: "done", zenodoRecordId: "638432" });
    expect(await row(world.t, key)).toMatchObject({ zenodoRecordId: "638432" });
    // Two actions for the same asking: the first is given the report, the second nothing until the first lets go.
    await world.t.run((ctx) => ctx.db.patch("reports", reportId, { registrationLease: undefined }));
    const rev = await revOf(world, reportId);
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).toMatchObject({ key, waiting: ["crossref"] });
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).toBeNull();
    await world.t.mutation(internal.reports.registration.end, { reportId });
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev })).not.toBeNull();
    expect(await world.t.mutation(internal.reports.registration.begin, { reportId, rev: before })).toBeNull();
  });

  it("goes to its registrars again when it is withdrawn and when it is reinstated", async () => {
    const world = await setup();
    const { key, reportId } = await live(world);
    await settled(world);
    const decide = async (decision: "withdraw" | "reinstate") => world.reviewer.mutation(api.reports.review.decide, { key, decision, seenPdfAt: (await row(world.t, key)).pdf!.at });
    for (const decision of ["withdraw", "reinstate"] as const) {
      await world.t.run((ctx) => ctx.db.patch("reports", reportId, { deposit: "deposited", registrationError: undefined }));
      await decide(decision);
      expect(await row(world.t, key)).toMatchObject({ deposit: "queued" });
      await settled(world);
    }
  });
});
