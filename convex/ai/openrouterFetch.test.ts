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

  it("accepts the header under its capitalized form", async () => {
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(
      sink,
      mockFetchResponding({ "X-Generation-Id": "gen_capitalized" }),
    );

    await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(sink).toHaveBeenCalledWith("gen_capitalized");
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

  it("forwards request input and init unchanged to the underlying fetch", async () => {
    const inner = vi.fn<typeof fetch>(async () =>
      new Response("", { status: 200 }),
    );
    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(sink, inner);
    const init: RequestInit = {
      method: "POST",
      headers: { authorization: "Bearer test" },
      body: JSON.stringify({ model: "m" }),
    };

    await wrapped("https://example/chat", init);

    expect(inner).toHaveBeenCalledWith("https://example/chat", init);
  });

  it("defaults to globalThis.fetch when no inner fetch is provided", async () => {
    // Mock globalThis.fetch via a top-level vi.stubGlobal scoped to this test.
    const stub = vi.fn<typeof fetch>(async () =>
      new Response("", {
        status: 200,
        headers: { "x-generation-id": "gen_default" },
      }),
    );
    vi.stubGlobal("fetch", stub);

    const sink = vi.fn<(id: string) => void>();
    const wrapped = withGenerationIdCapture(sink);

    await wrapped("https://openrouter.ai/api/v1/chat/completions");

    expect(stub).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("gen_default");

    vi.unstubAllGlobals();
  });
});
