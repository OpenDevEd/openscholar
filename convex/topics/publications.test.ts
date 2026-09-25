/// <reference types="vite/client" />
import {convexTest} from "convex-test";
import {afterEach, expect, it, vi} from "vitest";
import schema from "../schema";
import {api, internal} from "../_generated/api";
import {seedTopicLibrary} from "../../tests/helpers/topic-library-fixture";
import {digestOpaqueToken} from "../lib/opaqueTokenDigest";
import type {TopicAssociationRequest} from "../../lib/topics/contract";
import {readTopicPublications} from "../../app/actions/topic-publications";
const {fetchQueryMock} = vi.hoisted(() => ({fetchQueryMock: vi.fn()}));
vi.mock("convex/nextjs", () => ({fetchQuery: fetchQueryMock}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({unstable_cache: (fn: (...args: unknown[]) => unknown) => fn}));
import {CATALOG_REVISION} from "../../lib/topics/catalog";
const modules = import.meta.glob("/convex/**/*.ts");
const credential = `els_${"a".repeat(43)}`;
const topicId = "T12260";
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks();});
async function fixture() {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://openscholar.example.test");
  const t = convexTest(schema, modules);
  const digest = await digestOpaqueToken(credential);
  const a = await t.run(ctx => seedTopicLibrary(ctx, "first", digest, "https://first.example.test"));
  const b = await t.run(ctx => seedTopicLibrary(ctx, "second", "second-credential", "https://second.example.test"));
  await t.run(async ctx => {
    await ctx.db.insert("topicCatalog", {id: topicId, name: "Educational research", parent: "subfields/3304", level: "topic", path: ["Social Sciences", "Education", "Education", "Educational research"], ancestors: ["domains/2", "fields/33", "subfields/3304"], childCount: 0, revision: CATALOG_REVISION, searchText: "Educational research", domainId: "domains/2", fieldId: "fields/33", subfieldId: "subfields/3304"});
    await ctx.db.insert("topicCatalogState", {revision: CATALOG_REVISION, complete: true});
  });
  const request = (libraryId = a.libraryId, extra: Partial<TopicAssociationRequest> = {}): TopicAssociationRequest => ({contractVersion: 1, libraryId, itemKey: "ABCD1234", generation: 1, publishedRevision: 1, idempotencyKey: "first", state: "published", topicIds: [topicId], doi: "https://doi.org/10.1234/ABC", openalexId: "W1234", metadata: {title: "Learning", date: "2026", itemType: "journalArticle", creators: ["A Researcher"], abstract: null}, ...extra});
  const send = (input: TopicAssociationRequest, credentialDigest = digest) => t.mutation(internal.topics.publications.replaceFromLibrary, {body: JSON.stringify(input), credentialDigest});
  return {t, a, b, digest, request, send};
}
it("authenticates HTTP delivery, preserves receipts, and rejects stale replay after a tombstone", async () => {
  const {t, a, b, request, send} = await fixture();
  const http = (body: unknown, token = credential) => t.fetch("/api/v1/evidence-libraries/topic-associations", {method: "POST", headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});
  expect((await http(request(), `els_${"x".repeat(43)}`)).status).toBe(401);
  expect((await http(request(b.libraryId))).status).toBe(403);
  expect((await http({...request(), topicIds: ["fields/33"]})).status).toBe(400);
  expect((await http(request())).status).toBe(200);
  await expect(send(request())).resolves.toMatchObject({status: "applied", generation: 1});
  await expect(send(request(a.libraryId, {metadata: {...request().metadata!, title: "Changed"}}))).rejects.toThrow("Idempotency");
  await send(request(a.libraryId, {generation: 3, idempotencyKey: "remove", state: "unpublished", topicIds: [], metadata: null}));
  await expect(send(request(a.libraryId, {generation: 2, idempotencyKey: "late"}))).resolves.toMatchObject({status: "superseded"});
  await expect(send(request())).resolves.toMatchObject({status: "applied", generation: 1});
  expect((await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).groups).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("topicLocations").first())).toMatchObject({generation: 3, state: "unpublished"});
});
it("groups DOI variants, returns all enabled public locations, and retains private assignments", async () => {
  const {t, a, b, request, send} = await fixture();
  await send(request());
  await send(request(b.libraryId, {doi: "doi:10.1234/abc", topicIds: [], openalexId: null}), "second-credential");
  const page = await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10});
  expect(page.groups).toEqual([{key: "doi:10.1234/abc"}]);
  const read = () => t.query(api.topics.publications.locations, {groupKey: page.groups[0].key, paginationOpts: {cursor: null, numItems: 100}});
  expect((await read()).locations.map(row => row.library.name).sort()).toEqual(["first", "second"]);
  await t.run(ctx => ctx.db.patch("evidenceLibraryConfigSections", a.sectionId, {payload: {enabled: false}}));
  expect((await read()).locations.map(row => row.library.name)).toEqual(["second"]);
  expect((await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).groups).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("topicLocations").withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", a.libraryId).eq("itemKey", "ABCD1234")).unique())).toMatchObject({topicIds: [topicId]});
  await t.run(ctx => ctx.db.patch("evidenceLibraryConfigSections", a.sectionId, {payload: {enabled: true}}));
  expect((await read()).locations).toHaveLength(2);
});
it("does not bridge conflicting DOIs through an OpenAlex-only location and keeps manual records separate", async () => {
  const {t, a, b, request, send} = await fixture();
  await send(request());
  await send(request(a.libraryId, {itemKey: "NODOI001", idempotencyKey: "without-doi", doi: null}));
  expect((await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).groups).toHaveLength(1);
  await send(request(b.libraryId, {doi: "10.1234/conflict"}), "second-credential");
  await send(request(a.libraryId, {itemKey: "MANUAL01", idempotencyKey: "manual-a", doi: null, openalexId: null}));
  await send(request(b.libraryId, {itemKey: "MANUAL01", idempotencyKey: "manual-b", doi: null, openalexId: null}), "second-credential");
  const groups = (await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).groups;
  expect(groups.map(row => row.key)).toEqual(["doi:10.1234/abc", "doi:10.1234/conflict", "openalex:W1234", `record:${a.libraryId}:MANUAL01`, `record:${b.libraryId}:MANUAL01`].sort());
  const isolated = await t.query(api.topics.publications.locations, {groupKey: "openalex:W1234", paginationOpts: {cursor: null, numItems: 100}});
  expect(isolated.locations.map(row => row.itemKey)).toEqual(["NODOI001"]);
});
it("paginates unique publications and keeps a cursor valid across later deliveries", async () => {
  const {t, a, b, request, send} = await fixture();
  await send(request());
  await send(request(b.libraryId), "second-credential");
  await send(request(a.libraryId, {itemKey: "MANUAL01", idempotencyKey: "manual", doi: null, openalexId: null}));
  const first = await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 1});
  const second = await t.query(api.topics.publications.list, {topicId, cursor: first.nextCursor, limit: 1});
  expect([...first.groups, ...second.groups].map(row => row.key)).toEqual(["doi:10.1234/abc", `record:${a.libraryId}:MANUAL01`]);
  expect(second.nextCursor).toBeNull();
  await send(request(a.libraryId, {generation: 2, idempotencyKey: "update"}));
  expect((await t.query(api.topics.publications.list, {topicId, cursor: first.nextCursor, limit: 1})).groups).toEqual(second.groups);
});
it("serves bounded authenticated catalog pages and rejects unknown topic details", async () => {
  const {t, a} = await fixture();
  const response = await t.fetch("/api/v1/evidence-libraries/topics/catalog", {method: "POST", headers: {Authorization: `Bearer ${credential}`}, body: JSON.stringify({contractVersion: 1, libraryId: a.libraryId, ids: [topicId]})});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({nodes: [{id: topicId, level: "topic"}], revision: CATALOG_REVISION, nextCursor: null, publicBaseUrl: "https://openscholar.example.test"});
  await expect(t.action(api.topics.details.get, {id: "T999999999"})).rejects.toThrow("Unknown topic");
});

it("revalidates cards, keeps available library links on timeout, and drops missing assignments", async () => {
  const {t, b, request, send} = await fixture();
  await send(request());
  await send(request(b.libraryId, {topicIds: []}), "second-credential");
  fetchQueryMock.mockImplementation((reference, args) => t.query(reference, args));
  const card = {key: "ABCD1234", title: "Live card title", itemType: "journalArticle", date: "2026", numPages: null, PDFCoverPageImage: null, creators: [{name: "Live author"}]};
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
    if (url.hostname === "second.example.test") throw new Error("Timeout");
    return Response.json({item: card});
  }));
  const partial = await readTopicPublications(topicId, "", null);
  expect(partial).toMatchObject({unavailableCount: 1, complete: false, papers: [{title: "Live card title", authors: "Live author", locations: [{name: "first", url: "https://first.example.test/lib/ABCD1234"}]}]});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({item: card})));
  const complete = await readTopicPublications(topicId, "", null);
  expect(complete).toMatchObject({unavailableCount: 0, complete: true});
  expect(complete.papers[0].locations).toHaveLength(2);
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.hostname === "first.example.test" ? new Response(null, {status: 404}) : Response.json({item: card})));
  expect((await readTopicPublications(topicId, "", null)).papers).toEqual([]);
});
it("uses fresh durable details, bounded stale data on provider failure, then returns unavailable", async () => {
  const {t} = await fixture();
  const fetchMock = vi.fn(async () => {throw new Error("Provider unavailable");});
  vi.stubGlobal("fetch", fetchMock);
  const saved = {id: topicId, description: "Saved description", keywords: ["learning"], worksCount: 123, fetchedAt: Date.now(), revision: CATALOG_REVISION};
  await t.mutation(internal.topics.details.save, saved);
  expect(await t.action(api.topics.details.get, {id: topicId})).toMatchObject({description: "Saved description", worksCount: 123});
  expect(fetchMock).not.toHaveBeenCalled();
  await t.run(async ctx => {const row = await ctx.db.query("topicDetails").first(); await ctx.db.patch("topicDetails", row!._id, {fetchedAt: Date.now() - 2 * 86400000});});
  expect(await t.action(api.topics.details.get, {id: topicId})).toMatchObject({description: "Saved description"});
  await t.run(async ctx => {const row = await ctx.db.query("topicDetails").first(); await ctx.db.patch("topicDetails", row!._id, {fetchedAt: Date.now() - 8 * 86400000});});
  await expect(t.action(api.topics.details.get, {id: topicId})).rejects.toThrow("unavailable");
});
it("stores the full catalog and filters exact ancestors with cursor paging", async () => {
  const t = convexTest(schema, modules);
  await t.action(api.topics.catalog.initialize, {});
  const domains = await t.query(api.topics.catalog.directory, {parent: null, cursor: null, limit: 100});
  expect(domains.nodes).toHaveLength(4);
  const first = await t.query(api.topics.catalog.directory, {ancestor: "subfields/1702", cursor: null, limit: 2});
  const second = await t.query(api.topics.catalog.directory, {ancestor: "subfields/1702", cursor: first.nextCursor, limit: 2});
  expect(first.nodes).toHaveLength(2);
  expect(second.nodes).toHaveLength(2);
  expect(first.nodes.every(node => node.parent === "subfields/1702")).toBe(true);
  expect(new Set([...first.nodes, ...second.nodes].map(node => node.id)).size).toBe(4);
  expect((await t.query(api.topics.catalog.resolve, {ids: ["T12260"]}))[0]).toMatchObject({id: "T12260", level: "topic"});
});
it("finishes a bounded identity rebuild without reporting incomplete groups as a total", async () => {
  vi.useFakeTimers();
  try {
    const {t, a, request, send} = await fixture();
    for (let index = 0; index < 22; index++) {
      await send(request(a.libraryId, {itemKey: `TEST${String(index).padStart(4, "0")}`, idempotencyKey: `no-doi-${index}`, doi: null}));
    }
    await send(request());
    expect((await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).updating).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const groups = await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10});
    expect(groups).toMatchObject({groups: [{key: "doi:10.1234/abc"}], updating: false, nextCursor: null});
    const page = await t.query(api.topics.publications.locations, {groupKey: groups.groups[0].key, paginationOpts: {cursor: null, numItems: 10}});
    const next = await t.query(api.topics.publications.locations, {groupKey: groups.groups[0].key, paginationOpts: {cursor: page.nextCursor, numItems: 100}});
    expect([...page.locations, ...next.locations]).toHaveLength(23);
  } finally {vi.useRealTimers();}
});

it("tears down topic records in batches and rebuilds surviving DOI and OpenAlex groups", async () => {
  vi.useFakeTimers();
  vi.stubEnv("EL_ALLOW_DEVELOPMENT_TEARDOWN", "true");
  vi.stubEnv("EL_COOLIFY_ENVIRONMENT", "development");
  try {
    const {t, a, b, request, send} = await fixture();
    await send(request());
    await send(request(b.libraryId, {doi: "10.1234/surviving"}), "second-credential");
    for (let index = 0; index < 22; index++) {
      await send(request(b.libraryId, {itemKey: `TEST${String(index).padStart(4, "0")}`, idempotencyKey: `surviving-${index}`, doi: null}), "second-credential");
    }
    await send(request(a.libraryId, {itemKey: "SHARED01", idempotencyKey: "shared", doi: "10.1234/surviving", topicIds: []}));
    await send(request(a.libraryId, {itemKey: "ANCHOR02", idempotencyKey: "only-anchor", doi: "10.1234/only", openalexId: "W5678"}));
    await send(request(b.libraryId, {itemKey: "NODOI002", idempotencyKey: "fallback", doi: null, openalexId: "W5678"}), "second-credential");
    await send(request(a.libraryId, {itemKey: "REMOVED1", idempotencyKey: "tombstone", state: "unpublished", topicIds: [], metadata: null}));
    for (let index = 0; index < 22; index++) {
      await send(request(a.libraryId, {itemKey: `TEST${String(index).padStart(4, "0")}`, idempotencyKey: `manual-${index}`, doi: null, openalexId: null}));
    }
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const args = await t.run(async ctx => {
      await ctx.db.patch("evidenceLibraries", a.libraryId, {state: "disabled"});
      const operationId = await ctx.db.insert("evidenceLibraryConfigOperations", {
        libraryId: a.libraryId, kind: "teardown", status: "running", stage: "convex",
        idempotencyKey: "topic-teardown", attemptCount: 1, requestedByClerkUserId: "topic-test",
        teardownAttemptToken: "topic-teardown", createdAt: Date.now(), updatedAt: Date.now(),
      });
      return {libraryId: a.libraryId, operationId, attemptToken: "topic-teardown"};
    });
    const remainingLocations = () => t.run(ctx => ctx.db.query("topicLocations").withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", a.libraryId)).take(100));
    const originalCount = (await remainingLocations()).length;
    let complete = false;
    let sawPartialTopicBatch = false;
    for (let batch = 0; batch < 30 && !complete; batch++) {
      ({complete} = await t.mutation(internal.evidenceLibraries.teardown.deleteDevelopmentTeardownBatch, args));
      const count = (await remainingLocations()).length;
      sawPartialTopicBatch ||= count > 0 && count < originalCount;
    }
    expect(complete).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await remainingLocations()).toEqual([]);
    expect(sawPartialTopicBatch).toBe(true);
    expect(await t.run(ctx => ctx.db.get("evidenceLibraries", a.libraryId))).toBeNull();
    expect(await t.run(ctx => ctx.db.query("topicDeliveryReceipts").withIndex("by_libraryId_and_idempotencyKey", q => q.eq("libraryId", a.libraryId)).take(100))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("topicOpenAlexDois").withIndex("by_openalexId_and_doi", q => q.eq("openalexId", "W1234")).take(10))).toMatchObject([{doi: "10.1234/surviving", count: 1}]);
    expect(await t.run(ctx => ctx.db.query("topicOpenAlexDois").withIndex("by_openalexId_and_doi", q => q.eq("openalexId", "W5678")).take(10))).toEqual([]);
    expect(await t.run(ctx => ctx.db.query("topicPublicationGroups").withIndex("by_topicId_and_groupKey", q => q.eq("topicId", topicId)).take(100))).toMatchObject([
      {groupKey: "doi:10.1234/surviving", count: 23},
      {groupKey: "openalex:W5678", count: 1},
    ]);
    expect(await t.query(api.topics.publications.list, {topicId, cursor: null, limit: 10})).toMatchObject({groups: [{key: "doi:10.1234/surviving"}, {key: "openalex:W5678"}], updating: false, nextCursor: null});
    const locations = await t.query(api.topics.publications.locations, {groupKey: "doi:10.1234/surviving", paginationOpts: {cursor: null, numItems: 100}});
    expect(locations.locations).toHaveLength(23);
    expect(locations.locations.every(row => row.library.id === b.libraryId)).toBe(true);
  } finally {vi.useRealTimers();}
});
