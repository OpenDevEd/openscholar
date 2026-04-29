/**
 * @vitest-environment jsdom
 *
 * U3 — <ToolStep /> renders one tool-* UIMessagePart per state.
 * Tested contract: data-tool-state, data-tool-name, role/aria-live,
 * shimmered query during streaming, cost label, error and aborted
 * variants.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToolStep } from "@/components/ai-elements/tool-step";
import type { ToolUIPart } from "ai";

vi.mock("motion/react", async () => {
  const actual = await vi.importActual<typeof import("motion/react")>(
    "motion/react",
  );
  return {
    ...actual,
    useReducedMotion: () => true,
  };
});

type AnyToolPart = ToolUIPart;

const callId = "call_test";
const baseTool = {
  type: "tool-web_search" as const,
  toolCallId: callId,
};

const makeStreaming = (input: { query?: string } = {}): AnyToolPart =>
  ({
    ...baseTool,
    state: "input-streaming",
    input,
  }) as AnyToolPart;

const makeAvailable = (query: string): AnyToolPart =>
  ({
    ...baseTool,
    state: "input-available",
    input: { query },
  }) as AnyToolPart;

const makeOutput = (
  query: string,
  output: { sources?: Array<{ url: string }>; creditsUsed?: number },
): AnyToolPart =>
  ({
    ...baseTool,
    state: "output-available",
    input: { query },
    output,
  }) as AnyToolPart;

const makeError = (errorText: string, query?: string): AnyToolPart =>
  ({
    ...baseTool,
    state: "output-error",
    input: query ? { query } : undefined,
    errorText,
  }) as AnyToolPart;

describe("<ToolStep>", () => {
  it("renders shimmered 'Searching the web…' during input-streaming with role=status and aria-live=polite", () => {
    render(<ToolStep part={makeStreaming({ query: "RNA editing" })} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-tool-state", "input-streaming");
    expect(region).toHaveAttribute("data-tool-name", "web_search");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent(/searching the web/i);
  });

  it("renders 'Searching: <query>' on input-available with role=status (no shimmer/aria-live)", () => {
    render(<ToolStep part={makeAvailable("base editors")} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-tool-state", "input-available");
    expect(region).toHaveTextContent(/searching:/i);
    expect(region).toHaveTextContent("base editors");
    expect(region).not.toHaveAttribute("aria-live", "polite");
  });

  it("renders 'Found N results for: <query>' on output-available (no role=status — terminal state)", () => {
    render(
      <ToolStep
        part={makeOutput("CRISPR off-target", {
          sources: [{ url: "https://a" }, { url: "https://b" }],
          creditsUsed: 2,
        })}
      />,
    );
    const region = screen.getByTestId("tool-step");
    expect(region).toHaveAttribute("data-tool-state", "output-available");
    expect(region).toHaveTextContent(/found 2 results for/i);
    expect(region).toHaveTextContent("CRISPR off-target");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders the credits-used cost label when output carries creditsUsed", () => {
    render(
      <ToolStep
        part={makeOutput("q", {
          sources: [{ url: "https://x" }],
          creditsUsed: 3,
        })}
      />,
    );
    expect(screen.getByTestId("tool-step")).toHaveTextContent("3 credits");
  });

  it("renders the Tavily-basic credit estimate during input-available when webSearchSource=tavily-basic", () => {
    render(
      <ToolStep part={makeAvailable("q")} webSearchSource="tavily-basic" />,
    );
    expect(screen.getByTestId("tool-step")).toHaveTextContent(/~104 credits/);
  });

  it("renders the OpenRouter-server-tool credit estimate when webSearchSource=openrouter-server-tool", () => {
    render(
      <ToolStep
        part={makeAvailable("q")}
        webSearchSource="openrouter-server-tool"
      />,
    );
    expect(screen.getByTestId("tool-step")).toHaveTextContent(/~260 credits/);
  });

  it("renders the OpenRouter-native credit estimate from modelWebSearchPriceUsd when webSearchSource=openrouter-native", () => {
    render(
      <ToolStep
        part={makeAvailable("q")}
        webSearchSource="openrouter-native"
        modelWebSearchPriceUsd={0.01}
      />,
    );
    // 0.01 × 1.3 × 10_000 = 130 credits.
    expect(screen.getByTestId("tool-step")).toHaveTextContent(/~130 credits/);
  });

  it("renders an empty cost label when webSearchSource is unsupported / omitted", () => {
    render(<ToolStep part={makeAvailable("q")} />);
    const region = screen.getByTestId("tool-step");
    expect(region).not.toHaveTextContent(/credits/);
    expect(region).not.toHaveTextContent(/\$/);
  });

  it("renders error variant with role=alert text and data-tool-state=output-error", () => {
    render(<ToolStep part={makeError("Tavily 401: bad key", "q")} />);
    const region = screen.getByTestId("tool-step");
    expect(region).toHaveAttribute("data-tool-state", "output-error");
    expect(region).toHaveTextContent(/web search failed/i);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Tavily 401: bad key");
  });

  it("flips to data-tool-state=aborted when the message is aborted while still input-streaming", () => {
    render(
      <ToolStep
        part={makeStreaming({ query: "q" })}
        messageStatus="failed"
        aborted
      />,
    );
    expect(screen.getByTestId("tool-step")).toHaveAttribute(
      "data-tool-state",
      "aborted",
    );
  });

  it("flips to aborted when the tool is in input-available but the message aborted", () => {
    render(
      <ToolStep
        part={makeAvailable("q")}
        messageStatus="failed"
        aborted
      />,
    );
    expect(screen.getByTestId("tool-step")).toHaveAttribute(
      "data-tool-state",
      "aborted",
    );
  });

  it("does not flip to aborted when the tool already reached output-available", () => {
    render(
      <ToolStep
        part={makeOutput("q", {
          sources: [{ url: "https://x" }],
          creditsUsed: 1,
        })}
        messageStatus="failed"
        aborted
      />,
    );
    expect(screen.getByTestId("tool-step")).toHaveAttribute(
      "data-tool-state",
      "output-available",
    );
  });
});
