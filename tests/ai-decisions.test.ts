import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { decideYesNo, JEV_MODEL, paperState } from "../lib/ai/decisions";
import { processScreeningBatch } from "../lib/ai/core/batch";

afterEach(() => vi.unstubAllGlobals());

/** OpenRouter's Decisions API answering each question with the given choice. */
function decisions(choices: string[], cost = 0.00002) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((key, i) => [
        key,
        { type: "choice", choice: choices[i], confidence: 0.5, probabilities: { yes: 0.1, no: 0.1, unclear: 0.1, [choices[i]!]: 0.9 } },
      ]),
    );
    return new Response(JSON.stringify({ model: JEV_MODEL, answers, usage: { input_tokens: 400, output_tokens: 20, cost } }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("decideYesNo", () => {
  it("asks every question in one call and maps yes, no and unclear to true, false and null", async () => {
    const fetch = decisions(["yes", "no", "unclear"]);
    const { answers, usage } = await decideYesNo({ apiKey: "sk-or", model: JEV_MODEL, state: { title: "T" }, questions: ["a?", "b?", "c?"] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([
      { answer: true, confidence: 0.9 },
      { answer: false, confidence: 0.9 },
      { answer: null, confidence: 0.9 },
    ]);
    expect(usage).toMatchObject({ inputTokens: 400, costUsd: 0.00002 });
  });

  it("reports the status and body when OpenRouter refuses, with the status the error classifier reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"no credits"}}', { status: 402 })));
    const failure = decideYesNo({ apiKey: "sk-or", model: JEV_MODEL, state: {}, questions: ["a?"] });
    await expect(failure).rejects.toThrow(/402.*no credits/);
    await expect(failure).rejects.toMatchObject({ status: 402 });
  });

  it("treats a missing answer as a failed call, not an unclear one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      answers: { q0: { type: "choice", choice: "yes", probabilities: { yes: 1 } } },
      usage: { input_tokens: 10, output_tokens: 1, cost: 0 },
    }))));
    await expect(decideYesNo({ apiKey: "sk-or", model: JEV_MODEL, state: {}, questions: ["a?", "b?"] })).rejects.toMatchObject({ status: 502 });
  });

  it("keeps a paper within Jev's context, trimming full text first", () => {
    const state = paperState({ title: "T", abstract: "a".repeat(10), fullText: "f".repeat(200_000) }, ["q?"]);
    expect(state.abstract).toHaveLength(10);
    expect(state.title.length + state.abstract!.length + state.fullText!.length + "q?".length).toBe(100_000);
  });
});

describe("screening with Jev", () => {
  it("screens each paper in one call, keyed by question text, and keeps other papers when one fails", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      calls++;
      const { state } = JSON.parse(String(init?.body)) as { state: { title: string } };
      if (state.title === "broken") return new Response("upstream error", { status: 502 });
      return new Response(JSON.stringify({
        answers: { q0: { type: "choice", choice: "yes", probabilities: { yes: 0.8 } }, q1: { type: "choice", choice: "unclear", probabilities: { unclear: 0.6 } } },
        usage: { input_tokens: 300, output_tokens: 10, cost: 0.00001 },
      }));
    }));
    const model = { provider: "openrouter", modelId: JEV_MODEL } as unknown as LanguageModel;
    const out = await processScreeningBatch({
      model,
      decisionsKey: "sk-or",
      questions: ["Primary study?", "In Africa?"],
      papers: [{ id: "p1", title: "ok", abstract: "..." }, { id: "p2", title: "broken", abstract: "..." }],
    });
    expect(calls).toBe(2);
    expect(out.results.p1).toEqual({ responses: { "Primary study?": true, "In Africa?": null }, confidence: 0.7 });
    expect(out.errors).toEqual([{ paperId: "p2", error: expect.stringContaining("502") }]);
    expect(out.usageByItemId.p1).toMatchObject({ costUsd: 0.00001 });
  });
});
