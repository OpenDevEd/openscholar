/**
 * X-Generation-Id capture must be abort-safe: the header lands on the
 * initial HTTP response, before any SSE body is parsed or a client
 * AbortSignal can fire. These tests pin the contract of the wrapper so
 * the fix for stopped-turn billing can rely on it.
 */
import { describe, expect, it, vi } from "vitest";
import { withGenerationIdCapture } from "./openrouterFetch";

function mockFetchResponding(headers: Record<string, string>) {
  return vi.fn<typeof fetch>(async () =>
    new Response("", { status: 200, headers }),
  );
}

describe("withGenerationIdCapture", () => {
  it("calls the sink with the lowercased X-Generation-Id when present", async () => {
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(
      sink,
      mockFetchResponding({ "x-generation-id": "gen_abc123" }),
    );

    const response = await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("gen_abc123");
    expect(response.status).toBe(200);
  });

  it("does not invoke the sink when the header is missing", async () => {
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(
      sink,
      mockFetchResponding({}),
    );

    await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(sink).not.toHaveBeenCalled();
  });

  it("does not invoke the sink when the header is empty", async () => {
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(
      sink,
      mockFetchResponding({ "x-generation-id": "" }),
    );

    await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(sink).not.toHaveBeenCalled();
  });

  it("returns the underlying fetch's Response unchanged", async () => {
    const underlyingResponse = new Response("body", {
      status: 201,
      headers: { "x-generation-id": "gen_ok" },
    });
    const inner = vi.fn<typeof fetch>(async () => underlyingResponse);
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(sink, inner);

    const response = await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(response).toBe(underlyingResponse);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
