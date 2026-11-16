import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import { digestOpaqueToken } from "../lib/opaqueTokenDigest";
import { checked, live, passed, row, setup, type World } from "./reports.test-support";

// The engine's credential, in the form every machine credential takes.
const CREDENTIAL = `els_${"a".repeat(43)}`;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.ai");
  vi.stubEnv("SEARCH_INDEX_FEED_CREDENTIAL_DIGEST", await digestOpaqueToken(CREDENTIAL));
});
afterEach(() => vi.unstubAllEnvs());

type Item = { key: string; updatedAt: number; state: string; digest: string; doi: string; zenodoDoi: string | null; record: Record<string, unknown> | null };
type Page = { items: Item[]; after?: { updatedAt: number; key: string } | null; cursor?: string | null; done: boolean; seriesChangedAt: number };

const ask = (world: World, body: unknown, credential = CREDENTIAL) =>
  world.t.fetch("/api/v1/search-index/reports", { method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const page = async (world: World, body: unknown) => {
  const response = await ask(world, body);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
};

describe("the search index's feed of reports", () => {
  it("gives the engine every report that is or was live, from where it last read, with a record only while it is live", async () => {
    const world = await setup();
    const draft = await checked(world, [passed("byline", false)]);
    const { key } = await live(world, world.author, world.lab);
    const report = await world.t.query(api.reports.paper.get, { key });
    if (report?.state !== "live") throw new Error("The report isn't live");
    // A topic above the topics, a funder only ROR knows and an institution by its address: only what the index takes goes in.
    const metadata = {
      ...report.metadata,
      subtitle: "A field trial",
      topics: [{ id: "T10001", name: "Agroforestry", score: 0.9 }, { id: "subfields/1102", name: "Agronomy", score: 0.5 }],
      funding: [{ funder: { id: "https://openalex.org/F4320306076", name: "Wellcome Trust" }, awards: [] }, { funder: { id: null, name: "A local trust", ror: "https://ror.org/00x0x0x00" }, awards: [] }],
      authors: [{ name: "Chikondi Banda", orcid: "0000-0002-1825-0097", openalexId: null, affiliations: [{ id: "https://openalex.org/I4210087849", name: "University of Rwanda", country: "RW" }, { id: null, name: "Field station", country: "USA" }], corresponding: true, roles: [] }],
    };
    await world.reviewer.mutation(api.reports.review.editDetails, { key, seenAt: (await row(world.t, key)).updatedAt, metadata });

    // Read a report at a time, as far as the feed goes: the draft is read past, and never given.
    const read: Item[] = [];
    let after: Page["after"] = null;
    for (let step = 0; step < 10; step++) {
      const next = await page(world, { after, limit: 1 });
      read.push(...next.items);
      expect(next.after).not.toBeNull();
      after = next.after;
      if (next.done) break;
    }
    expect(read.map((item) => item.key)).toEqual([key]);
    expect(read.map((item) => item.key)).not.toContain(draft.key);
    const [first] = read;
    expect(first).toMatchObject({ key, state: "live", doi: (await row(world.t, key)).doi, zenodoDoi: null });
    expect(first!.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first!.record).toEqual({
      title: "Shade trees and maize yields: A field trial",
      abstract: "We measure maize yields on 640 plots.",
      date: report.metadata.date,
      type: "report",
      language: report.metadata.language,
      authors: [{ name: "Chikondi Banda", orcid: "0000-0002-1825-0097", affiliations: [{ id: "I4210087849", name: "University of Rwanda", country: "RW" }, { id: null, name: "Field station", country: null }] }],
      topics: ["T10001"],
      sdgs: report.metadata.sdgs,
      funders: ["F4320306076"],
      licence: "CC BY 4.0",
      series: { name: "Openscholar Reports", issn: null },
      pageUrl: `https://openscholar.ai/papers/${key}`,
      pdfUrl: `https://openscholar.ai/papers/${key}/report.pdf`,
    });

    // Nothing changed since: nothing to give, and the position holds.
    expect(await page(world, { after, limit: 200 })).toMatchObject({ items: [], after, done: true });

    // Withdrawn, it is given again, with no record: the engine takes it out of the index.
    await world.reviewer.mutation(api.reports.review.decide, { key, decision: "withdraw", seenPdfAt: (await row(world.t, key)).pdf!.at });
    const withdrawn = await page(world, { after, limit: 200 });
    expect(withdrawn.items).toMatchObject([{ key, state: "withdrawn", record: null }]);
    expect(withdrawn.items[0]!.digest).not.toBe(first!.digest);

    // A full read gives every report that is or was live, the draft left out, and a cursor that has run out.
    const all = await page(world, { all: true, cursor: null, limit: 200 });
    expect(all).toMatchObject({ done: true, cursor: null });
    expect(all.items.map((item) => item.key)).toEqual([key]);
    expect(Number.isInteger(all.seriesChangedAt)).toBe(true);
  });

  it("says when the series changed, which every record names", async () => {
    const world = await setup();
    await live(world);
    const before = (await page(world, { after: null, limit: 200 })).seriesChangedAt;
    await world.reviewer.mutation(api.reports.settings.update, { series: { issn: "2049-3630" } });
    const next = await page(world, { all: true, cursor: null, limit: 200 });
    expect(next.seriesChangedAt).toBeGreaterThan(before);
    expect(next.items[0]!.record).toMatchObject({ series: { issn: "2049-3630" } });
  });

  it("answers only the engine, and only the two requests it sends", async () => {
    const world = await setup();
    expect((await ask(world, { after: null, limit: 200 }, `els_${"b".repeat(43)}`)).status).toBe(401);
    expect((await world.t.fetch("/api/v1/search-index/reports", { method: "POST", body: JSON.stringify({ after: null, limit: 200 }) })).status).toBe(401);
    for (const body of [{ after: null, limit: 201 }, { after: null, limit: 200, contractVersion: 1 }, { all: false, cursor: null, limit: 200 }, { limit: 200 }]) {
      const response = await ask(world, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_request", retryable: false } });
    }
    // With no credential set on the deployment, none is the engine's.
    vi.stubEnv("SEARCH_INDEX_FEED_CREDENTIAL_DIGEST", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await ask(world, { after: null, limit: 200 })).status).toBe(401);
  });
});
