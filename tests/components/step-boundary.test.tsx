/**
 * @vitest-environment jsdom
 *
 * U4 — <StepBoundary /> visibility heuristic.
 *
 * Visible iff: previous part is a tool-* in output-available AND
 * next part is a text part. Otherwise renders null.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StepBoundary } from "@/components/ai-elements/step-boundary";
import type { ToolUIPart, UIMessagePart } from "ai";

type AnyPart = UIMessagePart<Record<string, never>, Record<string, never>>;

const text: AnyPart = { type: "text", text: "x" };
const tStreaming: ToolUIPart = {
  type: "tool-web_search",
  toolCallId: "c",
  state: "input-streaming",
  input: undefined,
} as ToolUIPart;
const tAvailable: ToolUIPart = {
  type: "tool-web_search",
  toolCallId: "c",
  state: "input-available",
  input: { query: "q" },
} as ToolUIPart;
const tOutput: ToolUIPart = {
  type: "tool-web_search",
  toolCallId: "c",
  state: "output-available",
  input: { query: "q" },
  output: { sources: [] },
} as ToolUIPart;
const stepStart: AnyPart = { type: "step-start" };

describe("<StepBoundary>", () => {
  it("renders an <hr data-step-boundary> when sandwiched between tool output-available and following text", () => {
    const { container } = render(
      <StepBoundary prevPart={tOutput} nextPart={text} />,
    );
    const hr = container.querySelector("hr");
    expect(hr).not.toBeNull();
    expect(hr).toHaveAttribute("data-step-boundary", "true");
  });

  it("renders nothing when prev is a tool but not in output-available", () => {
    const { container: a } = render(
      <StepBoundary prevPart={tStreaming} nextPart={text} />,
    );
    expect(a.firstChild).toBeNull();
    const { container: b } = render(
      <StepBoundary prevPart={tAvailable} nextPart={text} />,
    );
    expect(b.firstChild).toBeNull();
  });

  it("renders nothing when next is not a text part", () => {
    const { container } = render(
      <StepBoundary prevPart={tOutput} nextPart={stepStart} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when prev is undefined (start of message)", () => {
    const { container } = render(
      <StepBoundary prevPart={undefined} nextPart={text} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when next is undefined (end of message)", () => {
    const { container } = render(
      <StepBoundary prevPart={tOutput} nextPart={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when prev is a non-tool part", () => {
    const { container } = render(
      <StepBoundary prevPart={text} nextPart={text} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
