import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock executeAIOperation BEFORE importing batch functions
vi.mock("../lib/ai/core/execute", () => ({
  executeAIOperation: vi.fn(),
}));

import { executeAIOperation } from "../lib/ai/core/execute";
import {
  processBatch,
  processScreeningBatch,
  processTranslationBatch,
} from "../lib/ai/core/batch";
import {
  applyUnpaidBatchItemErrors,
  BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR,
} from "../lib/ai/core/batch-partial";
import type { BatchPaper } from "../lib/ai/core/batch-types";
import type { Usage } from "../lib/ai/core/types";
import type { LanguageModel } from "ai";
import type { OperationConfig } from "../lib/ai/core/configs";

const mockExecute = vi.mocked(executeAIOperation);

function createPaper(
  id: string,
  title = `Paper ${id}`,
  abstract = `Abstract for ${id}`
): BatchPaper {
  return { id, title, abstract };
}

function createUsage(input = 100, output = 50): Usage {
  return {
    promptTokens: input,
    completionTokens: output,
    inputTokens: input,
    outputTokens: output,
  };
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe("processBatch", () => {
  const makeConfig = () => ({
    model: {} as LanguageModel,
    toConfigInput: (paper: BatchPaper) => ({
      title: paper.title,
      abstract: paper.abstract,
    }),
    getOperationConfig: (input: { title: string; abstract: string }) =>
      ({
        input,
        temperature: 0.1,
        buildPrompts: () => ({ system: "test system", prompt: "test prompt" }),
      }) as unknown as OperationConfig<{ title: string; abstract: string }, { value: string }>,
    formatResult: (output: { value: string }) => output,
    getItemId: (paper: BatchPaper) => paper.id,
  });

  it("all-success returns all results with correct usageByItemId accumulation", async () => {
    const papers = [createPaper("p1"), createPaper("p2"), createPaper("p3")];
    const usage1 = createUsage(100, 50);
    const usage2 = createUsage(200, 75);
    const usage3 = createUsage(150, 60);

    mockExecute
      .mockResolvedValueOnce({ output: { value: "result1" }, usage: usage1 })
      .mockResolvedValueOnce({ output: { value: "result2" }, usage: usage2 })
      .mockResolvedValueOnce({ output: { value: "result3" }, usage: usage3 });

    const result = await processBatch(papers, makeConfig());

    expect(Object.keys(result.results)).toHaveLength(3);
    expect(result.results["p1"]).toEqual({ value: "result1" });
    expect(result.results["p2"]).toEqual({ value: "result2" });
    expect(result.results["p3"]).toEqual({ value: "result3" });
    expect(result.errors).toHaveLength(0);
    expect(result.usages).toHaveLength(3);
    expect(result.usageByItemId["p1"]).toEqual(usage1);
    expect(result.usageByItemId["p2"]).toEqual(usage2);
    expect(result.usageByItemId["p3"]).toEqual(usage3);
  });

  it("all-fail returns empty results with all errors captured", async () => {
    const papers = [createPaper("p1"), createPaper("p2")];

    mockExecute
      .mockRejectedValueOnce(new Error("API rate limit exceeded"))
      .mockRejectedValueOnce(new Error("Model not available"));

    const result = await processBatch(papers, makeConfig());

    expect(Object.keys(result.results)).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      paperId: "p1",
      error: "API rate limit exceeded",
    });
    expect(result.errors[1]).toEqual({
      paperId: "p2",
      error: "Model not available",
    });
    expect(result.usages).toHaveLength(0);
    expect(Object.keys(result.usageByItemId)).toHaveLength(0);
  });

  it("mixed-outcome returns successful results while capturing errors for failed items", async () => {
    const papers = [createPaper("p1"), createPaper("p2"), createPaper("p3")];
    const usage1 = createUsage(100, 50);
    const usage3 = createUsage(150, 60);

    mockExecute
      .mockResolvedValueOnce({ output: { value: "result1" }, usage: usage1 })
      .mockRejectedValueOnce(new Error("Timeout error"))
      .mockResolvedValueOnce({ output: { value: "result3" }, usage: usage3 });

    const result = await processBatch(papers, makeConfig());

    expect(Object.keys(result.results)).toHaveLength(2);
    expect(result.results["p1"]).toEqual({ value: "result1" });
    expect(result.results["p3"]).toEqual({ value: "result3" });
    expect(result.results["p2"]).toBeUndefined();

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      paperId: "p2",
      error: "Timeout error",
    });

    expect(result.usageByItemId["p1"]).toEqual(usage1);
    expect(result.usageByItemId["p3"]).toEqual(usage3);
    expect(result.usageByItemId["p2"]).toBeUndefined();
  });
});

describe("processScreeningBatch", () => {
  it("passes questions array through to each item via toConfigInput", async () => {
    const papers = [createPaper("p1")];
    const questions = ["Is the study randomized?", "Does it include humans?"];
    const usage = createUsage();

    mockExecute.mockResolvedValueOnce({
      output: {
        responses: {
          "Is the study randomized?": true,
          "Does it include humans?": false,
        },
        confidence: 0.9,
      },
      usage,
    });

    const result = await processScreeningBatch({
      model: {} as LanguageModel,
      papers,
      questions,
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          title: "Paper p1",
          abstract: "Abstract for p1",
          questions: ["Is the study randomized?", "Does it include humans?"],
        },
      })
    );

    expect(result.results["p1"]).toEqual({
      responses: {
        "Is the study randomized?": true,
        "Does it include humans?": false,
      },
      confidence: 0.9,
    });
  });
});

describe("processTranslationBatch", () => {
  it("passes targetLanguage through to each translation call", async () => {
    const papers = [createPaper("p1")];
    const usage = createUsage();

    mockExecute.mockResolvedValueOnce({
      output: {
        translatedTitle: "Titre du papier",
        translatedAbstract: "Resume du papier",
      },
      usage,
    });

    const result = await processTranslationBatch({
      model: {} as LanguageModel,
      papers,
      targetLanguage: "fr",
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          targetLanguage: "fr",
        }),
      })
    );

    expect(result.results["p1"]).toEqual({
      translatedTitle: "Titre du papier",
      translatedAbstract: "Resume du papier",
      noTranslationNeeded: false,
    });
  });

  it("omits targetLanguage from input when not provided", async () => {
    const papers = [createPaper("p1")];
    const usage = createUsage();

    mockExecute.mockResolvedValueOnce({
      output: {
        translatedTitle: "Translated Title",
        translatedAbstract: "Translated Abstract",
      },
      usage,
    });

    await processTranslationBatch({
      model: {} as LanguageModel,
      papers,
    });

    expect(mockExecute).toHaveBeenCalledOnce();
    const callArgs = mockExecute.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(callArgs.input).not.toHaveProperty("targetLanguage");
  });
});

describe("applyUnpaidBatchItemErrors", () => {
  it("returns paid results and marks unpaid items as errors", () => {
    const result = {
      results: {
        p1: { value: "paid" },
        p2: { value: "unpaid" },
        p3: { value: "also unpaid" },
      },
      errors: [{ paperId: "p4", error: "provider failed" }],
    };

    expect(applyUnpaidBatchItemErrors(result, ["p2", "p3"])).toEqual({
      results: {
        p1: { value: "paid" },
      },
      errors: [
        { paperId: "p4", error: "provider failed" },
        { paperId: "p2", error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR },
        { paperId: "p3", error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR },
      ],
    });
  });
});
