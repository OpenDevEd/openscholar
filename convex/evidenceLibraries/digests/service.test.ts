/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import schema from "../../schema";
const modules = import.meta.glob("/convex/**/*.ts");
const token = "els_" + "a".repeat(43);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const libraryId = await t.run(async ctx => {
    const organizationId = await ctx.db.insert("organizations", {clerkOrganizationId: "digest-org", evidenceLibrariesEnabled: true, name: "Library", slug: "library", state: "active", clerkCreatedAt: 1, clerkUpdatedAt: 1, createdAt: 1, updatedAt: 1});
    const libraryId = await ctx.db.insert("evidenceLibraries", {organizationId, name: "Library", slug: "library", state: "active", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1});
    await ctx.db.insert("evidenceLibraryCredentials", {libraryId, credentialKey: "library-service", encryptedValue: "unused", credentialDigest: createHash("sha256").update(token).digest("hex"), validationState: "valid", createdByClerkUserId: "owner", updatedByClerkUserId: "owner", createdAt: 1, updatedAt: 1});
    return libraryId;
  });
  const body = {libraryId, editionId: "5e9558ce-ed55-4dc4-a44b-d1cbd3f9af64", locale: "en-GB", periodStart: "2026-09-01T09:00:00Z", periodEnd: "2026-09-08T09:00:00Z", publications: [{key: "ABCD2345", title: "Attention in classrooms", creators: ["Caitlin Mills"], date: "2026", abstract: "A framework for examining attention in learning.", publicationType: "Report", doi: null}]};
  const request = (patch: Record<string, unknown> = {}, credential = token) => t.fetch("/api/v1/evidence-libraries/digests/generate", {method: "POST", headers: {Authorization: `Bearer ${credential}`, "Content-Type": "application/json"}, body: JSON.stringify({...body, ...patch})});
  return {t, libraryId, request};
}

it("authenticates a library and enforces the digest model without a wallet", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request, t} = await setup();
  let captured: Record<string, unknown> | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({id: "generation", model: "openai/gpt-6-luna", created: 1, choices: [{index: 0, finish_reason: "stop", message: {role: "assistant", content: JSON.stringify({title: "Attention in learning", summary: "A new framework for classroom attention.", markdown: "The framework examines classroom attention. [Mills, 2026](/lib/ABCD2345)"})}}], usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}), {headers: {"Content-Type": "application/json"}});
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect(captured).toMatchObject({model: "openai/gpt-6-luna", reasoning: {effort: "max"}, provider: {require_parameters: true, allow_fallbacks: false}});
  expect(captured).not.toHaveProperty("tools");
  expect(await response.json()).toMatchObject({digest: {model: "openai/gpt-6-luna", reasoning: "max", markdown: expect.stringContaining("/lib/ABCD2345")}});
  expect(await t.run(ctx => ctx.db.query("users").collect())).toEqual([]);
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

it("returns a retryable failure when the fixed model is unavailable", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "provider-test-key");
  const {request} = await setup();
  const provider = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({error: {message: "Model unavailable", code: 503}}), {status: 503, headers: {"Content-Type": "application/json"}}));
  expect((await request()).status).toBe(503);
  expect(provider).toHaveBeenCalledTimes(1);
});
