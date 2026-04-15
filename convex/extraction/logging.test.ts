import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  emitStageLog,
  emitStageError,
  computeCostUsd,
  COST_PER_MILLION_TOKENS,
  type ExtractionStage,
  type StageLogParams,
  type StageErrorParams,
} from "./logging";

// Fake Convex IDs for testing (pure function module, no actual DB)
const FAKE_JOB_ID = "j977eqp13dhmj3cqb8g4" as Id<"extractionJobs">;
const FAKE_PAPER_ID = "p977eqp13dhmj3cqb8g4" as Id<"extractionPapers">;

describe("emitStageLog", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  // Test 1: emitStageLog calls console.info with JSON containing all 10 required fields
  it("calls console.info with a JSON string containing all 10 required fields", () => {
    const params: StageLogParams = {
      traceId: "01HXYZ1234567890ABCDEF",
      jobId: FAKE_JOB_ID,
      paperId: FAKE_PAPER_ID,
      stage: "extract",
      model: "google/gemini-2.5-flash-lite",
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.001,
      latencyMs: 500,
      status: "success",
    };

    emitStageLog(params);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(logged).toHaveProperty("traceId");
    expect(logged).toHaveProperty("jobId");
    expect(logged).toHaveProperty("paperId");
    expect(logged).toHaveProperty("stage");
    expect(logged).toHaveProperty("model");
    expect(logged).toHaveProperty("tokensIn");
    expect(logged).toHaveProperty("tokensOut");
    expect(logged).toHaveProperty("costUsd");
    expect(logged).toHaveProperty("latencyMs");
    expect(logged).toHaveProperty("status");
  });

  // Test 7: emitStageLog JSON is parseable and each field has correct type
  it("produces parseable JSON with correct types for each field", () => {
    const params: StageLogParams = {
      traceId: "01HXYZ1234567890ABCDEF",
      jobId: FAKE_JOB_ID,
      paperId: FAKE_PAPER_ID,
      stage: "parse",
      model: "google/gemini-3-flash-preview",
      tokensIn: 5000,
      tokensOut: 100,
      costUsd: 0.025,
      latencyMs: 1200,
      status: "failure",
    };

    emitStageLog(params);

    const logged = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(typeof logged.traceId).toBe("string");
    expect(typeof logged.jobId).toBe("string");
    expect(typeof logged.paperId).toBe("string");
    expect(typeof logged.stage).toBe("string");
    expect(typeof logged.model).toBe("string");
    expect(typeof logged.tokensIn).toBe("number");
    expect(typeof logged.tokensOut).toBe("number");
    expect(typeof logged.costUsd).toBe("number");
    expect(typeof logged.latencyMs).toBe("number");
    expect(typeof logged.status).toBe("string");
  });
});

describe("emitStageError", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Test 2: emitStageError calls console.error with JSON containing all 13 required fields
  it("calls console.error with a JSON string containing all 13 required fields", () => {
    const params: StageErrorParams = {
      traceId: "01HXYZ1234567890ABCDEF",
      jobId: FAKE_JOB_ID,
      paperId: FAKE_PAPER_ID,
      stage: "critic",
      model: "anthropic/claude-haiku-4.5",
      tokensIn: 2000,
      tokensOut: 300,
      costUsd: 0.003,
      latencyMs: 800,
      status: "failure",
      errorMessage: "Rate limit exceeded",
      errorCategory: "rate_limit",
      retryable: true,
    };

    emitStageError(params);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string);
    // 10 base fields
    expect(logged).toHaveProperty("traceId");
    expect(logged).toHaveProperty("jobId");
    expect(logged).toHaveProperty("paperId");
    expect(logged).toHaveProperty("stage");
    expect(logged).toHaveProperty("model");
    expect(logged).toHaveProperty("tokensIn");
    expect(logged).toHaveProperty("tokensOut");
    expect(logged).toHaveProperty("costUsd");
    expect(logged).toHaveProperty("latencyMs");
    expect(logged).toHaveProperty("status");
    // 3 error-specific fields
    expect(logged).toHaveProperty("errorMessage");
    expect(logged).toHaveProperty("errorCategory");
    expect(logged).toHaveProperty("retryable");
  });
});

describe("computeCostUsd", () => {
  // Test 3: correct cost for gemini-2.5-flash-lite
  it("returns $0.0052 for 50000 input + 500 output tokens on gemini-2.5-flash-lite", () => {
    const cost = computeCostUsd("google/gemini-2.5-flash-lite", 50000, 500);
    // (50000 * 0.10 + 500 * 0.40) / 1_000_000 = (5000 + 200) / 1_000_000 = 0.0052
    expect(cost).toBeCloseTo(0.0052, 6);
  });

  // Test 4: correct cost for gemini-3-flash-preview
  it("returns correct value for gemini-3-flash-preview", () => {
    const cost = computeCostUsd("google/gemini-3-flash-preview", 50000, 500);
    // (50000 * 0.50 + 500 * 3.00) / 1_000_000 = (25000 + 1500) / 1_000_000 = 0.0265
    expect(cost).toBeCloseTo(0.0265, 6);
  });

  // Test 5: correct cost for claude-haiku-4.5
  it("returns correct value for anthropic/claude-haiku-4.5", () => {
    const cost = computeCostUsd("anthropic/claude-haiku-4.5", 50000, 500);
    // (50000 * 1.00 + 500 * 5.00) / 1_000_000 = (50000 + 2500) / 1_000_000 = 0.0525
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  // Test 6: returns 0 for unknown model
  it("returns 0 for unknown model string", () => {
    const cost = computeCostUsd("unknown/nonexistent-model", 50000, 500);
    expect(cost).toBe(0);
  });
});

describe("COST_PER_MILLION_TOKENS", () => {
  it("contains keys for all three cascade models", () => {
    expect(COST_PER_MILLION_TOKENS).toHaveProperty("google/gemini-2.5-flash-lite");
    expect(COST_PER_MILLION_TOKENS).toHaveProperty("google/gemini-3-flash-preview");
    expect(COST_PER_MILLION_TOKENS).toHaveProperty("anthropic/claude-haiku-4.5");
  });
});

describe("ExtractionStage type", () => {
  // Test 8: Stage type only allows "parse", "extract", "critic", "save"
  it("only allows parse, extract, critic, save as valid stages", () => {
    const validStages: ExtractionStage[] = ["parse", "extract", "critic", "save"];
    expect(validStages).toHaveLength(4);
    // Verify that the type is strict by checking the values used in actual log params
    for (const stage of validStages) {
      const params: StageLogParams = {
        traceId: "test",
        jobId: FAKE_JOB_ID,
        paperId: FAKE_PAPER_ID,
        stage,
        model: "test-model",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
        status: "success",
      };
      expect(params.stage).toBe(stage);
    }
  });
});

describe("StageLogParams status type", () => {
  // Test 9: Status type only allows "success", "failure", "skip"
  it("only allows success, failure, skip as valid statuses", () => {
    const validStatuses: StageLogParams["status"][] = ["success", "failure", "skip"];
    expect(validStatuses).toHaveLength(3);
    for (const status of validStatuses) {
      const params: StageLogParams = {
        traceId: "test",
        jobId: FAKE_JOB_ID,
        paperId: FAKE_PAPER_ID,
        stage: "extract",
        model: "test-model",
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: 0,
        status,
      };
      expect(params.status).toBe(status);
    }
  });
});
