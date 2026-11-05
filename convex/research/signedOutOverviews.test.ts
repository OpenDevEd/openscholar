import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { SIGNED_OUT_PER_ADDRESS } from "./overviewValidators";
import { SIGNED_OUT_OVERVIEWS_FLAG } from "./signedOutOverviews";

const SECRET = "test-free-queries-secret";
const ADDRESS = "a".repeat(64);

async function setup() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    // The default preset's overview entry, which a visitor's overview runs on.
    await ctx.db.insert("models", {
      modelId: "acme/cheap", name: "Cheap", provider: "acme", inputPricePerMillion: 1, outputPricePerMillion: 5,
      isServed: false, costMarkup: 1, sortOrder: 0, syncedAt: 1, createdAt: 1, updatedAt: 1,
      supportedParameters: ["tools", "reasoning"], reasoningEfforts: ["low", "medium"], defaultEffort: "medium",
    });
    await ctx.db.insert("aiModelConfig", { key: "preset.balanced.overview", modelId: "acme/cheap", effort: "medium", updatedAt: 1 });
  });
  const claim = (address = ADDRESS) => t.mutation(internal.research.signedOutOverviews.claim, { address });
  const prepare = (params: string) => t.query(internal.research.signedOutOverviews.prepare, { params });
  const post = (body: object, secret = SECRET) =>
    t.fetch("/overviews/signed-out", { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { t, claim, prepare, post };
}

beforeEach(() => {
  vi.stubEnv("FREE_QUERIES_SECRET", SECRET);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("signed-out overviews", () => {
  it("gives an address its day's overviews, and all of them again the next UTC day", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 5, 0, 5) });
    const { claim } = await setup();
    for (let i = 0; i < SIGNED_OUT_PER_ADDRESS; i += 1) expect((await claim()).kind).toBe("go");
    expect((await claim()).kind).toBe("limit");
    // Another visitor still has theirs.
    expect((await claim("b".repeat(64))).kind).toBe("go");
    vi.setSystemTime(Date.UTC(2026, 10, 6, 0, 1));
    expect((await claim()).kind).toBe("go");
  });

  it("runs on the default preset's model for overviews, and not at all while switched off", async () => {
    const { t, claim } = await setup();
    expect(await claim()).toMatchObject({ kind: "go", effort: "medium" });
    await t.run((ctx) => ctx.db.insert("featureFlags", { key: SIGNED_OUT_OVERVIEWS_FLAG, enabled: false, updatedAt: 1 }));
    expect((await claim()).kind).toBe("off");
  });

  it("writes none for a search written in OQL or filtered by ratings, which a visitor's overview can't count", async () => {
    const { prepare } = await setup();
    expect((await prepare("q=peer+tutoring")) as { request: { filter: string } }).toMatchObject({ request: { filter: expect.stringContaining("search:peer tutoring") } });
    expect(await prepare("q=title.search:tutoring&field=oql")).toEqual({ reason: "oql" });
    expect(await prepare("q=peer+tutoring&rated=true&rmin=3")).toEqual({ reason: "ratings" });
  });

  it("answers only the Next app, and says in a line why it writes none", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 5, 9) });
    const { claim, post } = await setup();
    const ask = { address: ADDRESS, params: "q=peer+tutoring", lens: "overview", locale: "en-US" };
    expect((await post(ask, "wrong")).status).toBe(401);
    expect((await post({ ...ask, lens: "someone's own" })).status).toBe(400);
    expect((await post({ ...ask, address: "an address unhashed" })).status).toBe(400);
    expect(await (await post({ ...ask, params: "q=peer+tutoring&rated=true&rmin=3" })).text()).toBe('{"unavailable":"ratings"}\n');
    for (let i = 0; i < SIGNED_OUT_PER_ADDRESS; i += 1) await claim();
    expect(await (await post(ask)).text()).toBe('{"limit":true}\n');
  });

  it("calls a model nobody can run a failure the visitor can try again, not a search without an overview", async () => {
    const { t, post } = await setup();
    await t.run(async (ctx) => {
      const config = await ctx.db.query("aiModelConfig").first();
      await ctx.db.delete("aiModelConfig", config!._id);
    });
    expect(await (await post({ address: ADDRESS, params: "q=peer+tutoring", lens: "overview", locale: "en-US" })).text()).toBe('{"failed":true}\n');
  });
});
