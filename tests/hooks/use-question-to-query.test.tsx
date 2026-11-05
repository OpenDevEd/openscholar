import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQuestionToQuery } from "@/lib/ai/client/question-query";
import { AIApiKeyRequiredError, AIInsufficientCreditsError, AIKeyError } from "@/lib/ai/core/errors";

const { execute, flag, writeFree, enhance } = vi.hoisted(() => {
  const execute = vi.fn();
  return { execute, flag: { on: true }, writeFree: vi.fn(), enhance: { execute, isReady: true, isConfigured: false, isLoading: false, error: null } };
});

vi.mock("@/lib/ai/client/router", () => ({ useEnhanceSearchQuery: () => enhance }));
vi.mock("@/lib/feature-flags/hook", () => ({ useFeatureFlag: () => flag.on }));
vi.mock("@/app/actions/free-queries", () => ({ writeFreeQuery: writeFree }));

const write = () => renderHook(() => useQuestionToQuery()).result.current.write({ question: "does tutoring help?", language: "en" });
const convexError = (code: string) => Object.assign(new Error("failed"), { data: { code } });

describe("writing a query from a research question", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flag.on = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("stays on the paid path when it works, and never asks for the free one", async () => {
    execute.mockResolvedValue({ enhancedQuery: "paid query", explanation: "" });
    await expect(write()).resolves.toBe("paid query");
    expect(execute.mock.calls[0]![0]).toMatchObject({ query: "does tutoring help?", task: "questionToQuery" });
    expect(writeFree).not.toHaveBeenCalled();
  });

  it.each([
    ["signed out with no key", new AIApiKeyRequiredError()],
    ["short of credits in the browser", new AIInsufficientCreditsError()],
    ["short of credits on the server", convexError("AI_INSUFFICIENT_CREDITS")],
    ["billing can't be reached", convexError("BILLING_NETWORK_ERROR")],
    ["their own key failed", new AIKeyError("OpenRouter", "bad key")],
  ])("writes it free when %s", async (_why, error) => {
    execute.mockRejectedValue(error);
    writeFree.mockResolvedValue({ ok: true, query: "free query" });
    await expect(write()).resolves.toBe("free query");
    expect(writeFree).toHaveBeenCalledWith({ question: "does tutoring help?", language: "en" });
  });

  it("doesn't write it free when a model failed on credits they do have", async () => {
    const error = convexError("AI_PROVIDER_ERROR");
    execute.mockRejectedValue(error);
    await expect(write()).rejects.toBe(error);
    expect(writeFree).not.toHaveBeenCalled();
  });

  it("doesn't write it free while the switch is off", async () => {
    flag.on = false;
    const error = new AIApiKeyRequiredError();
    execute.mockRejectedValue(error);
    await expect(write()).rejects.toBe(error);
    expect(writeFree).not.toHaveBeenCalled();
  });

  it("says which limit ran out, for the message that goes with it", async () => {
    execute.mockRejectedValue(new AIApiKeyRequiredError());
    writeFree.mockResolvedValue({ ok: false, reason: "limitSignedOut" });
    await expect(write()).rejects.toMatchObject({ code: "AI_FREE_LIMIT_SIGNED_OUT" });

    execute.mockRejectedValue(convexError("AI_INSUFFICIENT_CREDITS"));
    writeFree.mockResolvedValue({ ok: false, reason: "limit" });
    await expect(write()).rejects.toMatchObject({ code: "AI_FREE_LIMIT" });
  });

  it("gives the paid path's reason when the server has the switch off", async () => {
    const error = new AIApiKeyRequiredError();
    execute.mockRejectedValue(error);
    writeFree.mockResolvedValue({ ok: false, reason: "off" });
    await expect(write()).rejects.toBe(error);
  });

  it("counts as set up when free writing is on, so no setup card shows", () => {
    expect(renderHook(() => useQuestionToQuery()).result.current.isConfigured).toBe(true);
    flag.on = false;
    expect(renderHook(() => useQuestionToQuery()).result.current.isConfigured).toBe(false);
  });
});
