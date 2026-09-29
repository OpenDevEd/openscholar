import { afterEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { runDecisionQuestions, type PaperExtractionContext } from "./workpoolActions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const question = (key: string, text: string) =>
  ({ _id: key as Id<"extractionQuestions">, key, question: text, type: "boolean" }) as unknown as Doc<"extractionQuestions">;

function context(overrides: Partial<PaperExtractionContext> = {}): PaperExtractionContext {
  return {
    job: { _id: "job1", status: "running", runEpoch: 1 } as unknown as Doc<"extractionJobs">,
    paper: { _id: "paper1", title: "School meals in Kenya", abstract: "A randomized evaluation of school meals in 25 preschools, measuring attendance." } as unknown as Doc<"extractionPapers">,
    user: { _id: "user1", clerkId: "clerk1" } as unknown as Doc<"users">,
    pdfEnabled: false,
    questions: [],
    results: [],
    evidenceUnits: [],
    ...overrides,
  };
}

describe("yes/no extraction questions on Jev", () => {
  it("answers every question in one call and charges it once, on the first answer", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or");
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      answers: {
        q0: { type: "choice", choice: "yes", probabilities: { yes: 0.9 } },
        q1: { type: "choice", choice: "unclear", probabilities: { unclear: 0.8 } },
      },
      usage: { input_tokens: 500, output_tokens: 10, cost: 0.00002 },
    })));
    vi.stubGlobal("fetch", fetch);

    const outcomes = await runDecisionQuestions({
      context: context(),
      questions: [question("rct", "Is it an RCT?"), question("africa", "Is it in Africa?")],
      expectedEpoch: 1,
      modelSlug: "typesafe/jev-1.13",
      pricing: { input: 0.042, output: 0 },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcomes).toMatchObject([
      { status: "completed", questionKey: "rct", result: { answer: true, confidence: 0.9, citationStatus: "grounded" }, creditsUsed: 1 },
      { status: "completed", questionKey: "africa", result: { answer: null, citationStatus: "insufficient_evidence" }, creditsUsed: 0 },
    ]);
  });

  it("skips questions already charged and fails the rest when Jev errors", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const billed = { questionKey: "rct", billed: true } as unknown as Doc<"extractionResults">;

    const outcomes = await runDecisionQuestions({
      context: context({ results: [billed] }),
      questions: [question("rct", "Is it an RCT?"), question("africa", "Is it in Africa?")],
      expectedEpoch: 1,
      modelSlug: "typesafe/jev-1.13",
      pricing: { input: 0.042, output: 0 },
    });

    expect(outcomes).toMatchObject([
      { status: "skipped", questionKey: "rct", reason: "already_billed" },
      { status: "failed", questionKey: "africa" },
    ]);
  });
});
