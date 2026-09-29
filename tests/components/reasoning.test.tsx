/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

function renderReasoning(isStreaming: boolean, defaultOpen?: boolean) {
  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={defaultOpen}>
      <ReasoningTrigger />
      <ReasoningContent>Weighing the papers.</ReasoningContent>
    </Reasoning>
  );
}

describe("<Reasoning>", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens while streaming and still lets the user collapse it", () => {
    render(renderReasoning(true));
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open when the user opens it after streaming ended collapsed", () => {
    vi.useFakeTimers();
    const { rerender } = render(renderReasoning(true, false));
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    rerender(renderReasoning(false, false));
    fireEvent.click(trigger);
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
