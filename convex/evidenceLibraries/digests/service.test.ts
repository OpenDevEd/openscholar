/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../schema";
import { organizationWorkspaceOf } from "../../workspaces/personal";
import { grantPlanFeaturesForTest } from "../../billing/billing.test-support";
import { EVIDENCE_LIBRARIES_FEATURE } from "../../../lib/billing/plans";
const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "a".repeat(43);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", {clerkOrganizationId: "digest-org", name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
    await grantPlanFeaturesForTest(ctx, organizationId, [EVIDENCE_LIBRARIES_FEATURE]);
    const libraryId = await ctx.db.insert("evidenceLibraries", {workspaceId: await organizationWorkspaceOf(ctx, organizationId), name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1});
    await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1});
    return libraryId;
  });
  const body = {libraryId, editionId: "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64", locale: "en-GB", periodStart: "2026-09-01T09:00:00Z", periodEnd: "2026-09-08T09:00:00Z", publicationCount: 40, publications: [{key: "ABCD2345", title: "Attention in classrooms", creators: ["Caitlin Mills"], date: "2026", abstract: "A framework for examining attention in learning.", publicationType: "Report", doi: null}]};
  const request = (patch: Record<string, unknown> = {}, credential = token) => t.fetch("/api/v1/evidence-libraries/digests/generate", {method: "POST", headers: {Authorization: `Bearer ${credential}`, "Content-Type": "application/json"}, body: JSON.stringify({...body, ...patch})});
  // Runs the job that was just queued, leaving its one-day expiry pending.
  const finishGeneration = async () => { vi.advanceTimersByTime(1); await t.finishInProgressScheduledFunctions(); };
  const saved = () => t.run(async ctx => ({jobs: await ctx.db.query("evidenceLibraryDigestJobs").collect(), files: await ctx.db.system.query("_storage").collect()}));
  return {t, libraryId, request, finishGeneration, saved};
}

const REVIEWER = "anthropic/claude-haiku-5.5";
const answer = (model: string, content: unknown) => new Response(JSON.stringify({id: "generation", model, created: 1, choices: [{index: 0, finish_reason: "stop", message: {role: "assistant", content: JSON.stringify(content)}}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}), {headers: {"Content-Type": "application/json"}});
/**
 * Stands in for OpenRouter: the writer's answers in order, then the reviewer's, which flags nothing unless told to.
 * `jev` answers what kind of publication a title is; a title it does not know gets a failed request.
 */
function stubModels(writer: unknown[], reviewer: unknown[] = [], jev: Record<string, string> = {}) {
  const sent = {writer: [] as Record<string, unknown>[], reviewer: [] as Record<string, unknown>[], jev: [] as string[]};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url) === "https://openrouter.ai/api/alpha/decisions") {
      const title = /^Title: (.*)$/m.exec(String(body.state))?.[1] ?? "";
      sent.jev.push(title);
      return jev[title] ? Response.json({answers: {k: {choice: jev[title]}}}) : new Response("unavailable", {status: 500});
    }
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    const role = body.model === REVIEWER ? "reviewer" : "writer";
    sent[role].push(body);
    const given = (role === "writer" ? writer : reviewer)[sent[role].length - 1];
    return answer(String(body.model), given ?? (role === "reviewer" ? {issues: []} : writer.at(-1)));
  });
  return sent;
}

it("writes the digest in the background and returns it on every request until it expires, without a wallet", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, t, finishGeneration, saved} = await setup();
  const sent = stubModels([{title: "Attention in learning", summary: "A new framework for classroom attention.", markdown: "The framework examines classroom attention. [Mills, 2026](/lib/ABCD2345)"}]);
  expect((await request()).status).toBe(202);
  // Checking back while it is written neither restarts it nor spends the hourly limit.
  for (let poll = 0; poll < 4; poll++) expect((await request()).status).toBe(202);
  expect((await saved()).jobs).toMatchObject([{status: "pending"}]);
  await finishGeneration();
  expect(sent.writer).toHaveLength(1);
  expect(sent.writer[0]).toMatchObject({model: "openai/gpt-6-luna", reasoning: {effort: "max"}, provider: {require_parameters: true, allow_fallbacks: false}});
  expect(sent.writer[0]).not.toHaveProperty("tools");
  // A library that marks no likely reviews leaves telling them apart to the writer, and nothing is read by Jev.
  expect(JSON.stringify(sent.writer[0])).toContain("Tell them from the title and abstract");
  expect(sent.jev).toEqual([]);
  // A second model reads the finished digest against the records it cites.
  expect(sent.reviewer).toMatchObject([{model: REVIEWER}]);
  const response = await request();
  expect(response.status).toBe(200);
  const {digest} = await response.json() as {digest: unknown};
  expect(digest).toMatchObject({model: "openai/gpt-6-luna", reasoning: "max", markdown: expect.stringContaining("/lib/ABCD2345")});
  // A retry after a lost response gets the same digest without writing it again.
  const retry = await request();
  expect(retry.status).toBe(200);
  expect(await retry.json()).toEqual({digest});
  expect(sent.writer).toHaveLength(1);
  expect(await saved()).toMatchObject({jobs: [{status: "succeeded"}], files: []});
  // The library rewrote the edition: its changed request is written again, not answered with the old digest.
  expect((await request({publicationCount: 41})).status).toBe(202);
  await finishGeneration();
  expect(sent.writer).toHaveLength(2);
  expect((await request({publicationCount: 41})).status).toBe(200);
  expect((await saved()).jobs).toHaveLength(1);
  vi.advanceTimersByTime(86_400_000);
  await t.finishInProgressScheduledFunctions();
  expect(await saved()).toEqual({jobs: [], files: []});
  expect(await t.run(ctx => ctx.db.query("users").collect())).toEqual([]);
});

it("has the likely reviews a library marks read once, tells the writer what each is, and hands the answers back", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, finishGeneration} = await setup();
  const publication = (key: string, title: string, marks: object = {}) => ({key, title, creators: ["Ada Mills"], date: "2026", abstract: null, publicationType: "journalArticle", doi: null, ...marks});
  const publications = [
    publication("ABCD2345", "Attention in classrooms"),
    publication("BBBB2345", "Drought: a systematic review", {candidate: true}),
    // Read for an earlier digest: its answer comes with the request and it is not read again.
    publication("CCCC2345", "Adaptation, pooled", {candidate: true, kind: "meta-analysis"}),
    publication("DDDD2345", "A review of my summer", {candidate: true}),
    publication("EEEE2345", "Unreadable today", {candidate: true}),
  ];
  const sent = stubModels([{title: "Attention", summary: "One framework.", markdown: "A framework. [Mills, 2026](/lib/ABCD2345)"}], [], {"Drought: a systematic review": "review", "A review of my summer": "study"});
  expect((await request({publications})).status).toBe(202);
  await finishGeneration();
  expect(sent.jev.sort()).toEqual(["A review of my summer", "Drought: a systematic review", "Unreadable today"]);
  const prompt = JSON.stringify(sent.writer[0]);
  expect(prompt).toContain("its library had it read");
  expect(prompt).not.toContain("candidate");
  // The writer is told only what is a meta-analysis or a review.
  const supplied = (/\{\\"libraryId.*\}\]\}/.exec(prompt)?.[0] ?? "").replaceAll("\\\"", "\"");
  expect((JSON.parse(supplied) as {publications: {key: string; kind?: string}[]}).publications.map(entry => [entry.key, entry.kind ?? null])).toEqual([
    ["ABCD2345", null], ["BBBB2345", "review"], ["CCCC2345", "meta-analysis"], ["DDDD2345", null], ["EEEE2345", null],
  ]);
  const response = await request({publications});
  expect(response.status).toBe(200);
  // What could not be read is left out, so the library asks again; what it already knew is not repeated.
  expect((await response.json() as {digest: {kinds: unknown}}).digest.kinds).toEqual({BBBB2345: "review", DDDD2345: "study"});
});

it("repairs a mistyped citation, straightens curly quotes and levels headings instead of rejecting the digest", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, finishGeneration} = await setup();
  const sent = stubModels([{title: "Attention\u2019s place in learning", summary: "A new framework for classroom attention.", markdown: "### Attention\n\nThe framework examines classroom attention. [Mills, 2026](/lib/ABCD2354)"}]);
  expect((await request()).status).toBe(202);
  await finishGeneration();
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({digest: {title: "Attention's place in learning", markdown: "## Attention\n\nThe framework examines classroom attention. [Mills, 2026](/lib/ABCD2345)"}});
  expect(sent.writer).toHaveLength(1);
});

it("has a second model check the digest, the writer correct what it flags once, and drops what is flagged again", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, finishGeneration} = await setup();
  const flag = (quote: string) => ({quote, key: "ABCD2345", problem: "contradicts_record", record_says: "The record gives a framework and no sample."});
  const sent = stubModels(
    [
      {title: "Attention in learning", summary: "A new framework for classroom attention.", markdown: "## Attention\n\nThe study surveyed 400 teachers. [Mills, 2026](/lib/ABCD2345) It also tested 12 schools."},
      {summary: "A framework for classroom attention.", markdown: "## Attention\n\nThe report sets out a framework. [Mills, 2026](/lib/ABCD2345) It also tested 12 schools.\n\n## Schools\n\nIt also tested 12 schools."},
    ],
    [{issues: [flag("The study surveyed 400 teachers."), flag("It also tested 12 schools.")]}, {issues: [flag("It also tested 12 schools.")]}],
  );
  expect((await request()).status).toBe(202);
  await finishGeneration();
  // The sentence flagged twice is gone from both places it stood, and so is the section it left empty.
  expect(await (await request()).json()).toMatchObject({digest: {summary: "A framework for classroom attention.", markdown: "## Attention\n\nThe report sets out a framework. [Mills, 2026](/lib/ABCD2345)"}});
  // The writer is asked once to write and once to correct; the correction carries the flagged sentences and the locale.
  expect(String((sent.writer[1]!.messages as {content: unknown}[]).at(-1)!.content)).toContain("en-GB");
  expect(sent.writer).toHaveLength(2);
  expect(String((sent.writer[1]!.messages as {content: unknown}[]).at(-1)!.content)).toContain("The study surveyed 400 teachers.");
  expect(sent.reviewer).toHaveLength(2);
});

it.each([
  {failing: "the review", writer: [] as unknown[], reviewer: [{nonsense: true}], markdown: "## Attention\n\nThe study surveyed 400 teachers. [Mills, 2026](/lib/ABCD2345) It sets out a framework."},
  {failing: "the correction", writer: [{nonsense: true}], reviewer: [{issues: [{quote: "The study surveyed 400 teachers.", key: "ABCD2345", problem: "not_in_record", record_says: "The record gives no sample."}]}], markdown: "## Attention\n\n[Mills, 2026](/lib/ABCD2345) It sets out a framework."},
])("keeps the digest when $failing fails, without a sentence already flagged", async ({writer, reviewer, markdown}) => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, finishGeneration} = await setup();
  stubModels([{title: "Attention in learning", summary: "A new framework for classroom attention.", markdown: "## Attention\n\nThe study surveyed 400 teachers. [Mills, 2026](/lib/ABCD2345) It sets out a framework."}, ...writer], reviewer);
  expect((await request()).status).toBe(202);
  await finishGeneration();
  expect(await (await request()).json()).toMatchObject({digest: {markdown}});
});

it("removes a flagged sentence when the correction keeps its claim and drops its citation", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, finishGeneration} = await setup();
  const publications = [
    {key: "ABCD2345", title: "Attention in classrooms", creators: ["Caitlin Mills"], date: "2026", abstract: "A framework for examining attention in learning.", publicationType: "Report", doi: null},
    {key: "QWER7890", title: "School meals and attendance", creators: ["Joy Okafor"], date: "2025", abstract: "Meals raised attendance.", publicationType: "Report", doi: null},
  ];
  stubModels(
    [
      {title: "Attention and meals", summary: "Two reports.", markdown: "## Schools\n\nThe study surveyed 400 teachers. [Mills, 2026](/lib/ABCD2345) Meals raised attendance. [Okafor, 2025](/lib/QWER7890)"},
      // The claim is still there, with nothing left to check it against.
      {summary: "Two reports.", markdown: "## Schools\n\nThe study surveyed 400 teachers. Meals raised attendance. [Okafor, 2025](/lib/QWER7890)"},
    ],
    [{issues: [{quote: "The study surveyed 400 teachers.", key: "ABCD2345", problem: "not_in_record", record_says: "The record gives no sample."}]}],
  );
  expect((await request({publications})).status).toBe(202);
  await finishGeneration();
  expect(await (await request({publications})).json()).toMatchObject({digest: {markdown: "## Schools\n\n[Mills, 2026](/lib/ABCD2345) Meals raised attendance. [Okafor, 2025](/lib/QWER7890)"}});
});

it("rejects foreign credentials, disabled libraries and arbitrary prompt or PDF input before generation", async () => {
  const {request, t, libraryId} = await setup();
  const provider = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Provider must not be called"));
  expect((await request({}, "els_" + "b".repeat(43))).status).toBe(403);
  expect((await request({libraryId: "another-library"})).status).toBe(403);
  expect((await request({messages: [{role: "user", content: "Write something else"}]})).status).toBe(400);
  expect((await request({pdf: "file bytes"})).status).toBe(400);
  await t.run(ctx => ctx.db.patch("evidenceLibraries", libraryId, {state: "disabled"}));
  expect((await request()).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});

it("reports a failed generation once, then starts again on the next request", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {t, request, finishGeneration, saved} = await setup();
  const provider = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({error: {message: "Model unavailable", code: 503}}), {status: 503, headers: {"Content-Type": "application/json"}}));
  expect((await request()).status).toBe(202);
  await finishGeneration();
  expect(provider).toHaveBeenCalledTimes(1);
  expect((await request()).status).toBe(503);
  expect(await saved()).toEqual({jobs: [], files: []});
  expect((await request()).status).toBe(202);
  expect((await saved()).jobs).toMatchObject([{status: "pending"}]);
  // A job nobody collects is removed with its stored request after a day.
  await finishGeneration();
  vi.advanceTimersByTime(86_400_000);
  await t.finishInProgressScheduledFunctions();
  expect(await saved()).toEqual({jobs: [], files: []});
});
