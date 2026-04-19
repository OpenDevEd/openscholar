/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the chat-page keyboard shortcuts hook.
 * - ⌘K from page chrome focuses the composer textarea
 * - Esc on the empty composer blurs it
 * - ⌘K when the user is typing in *another* input is ignored (no hijack)
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, act } from "@testing-library/react";
import { useChatShortcuts } from "@/components/extraction/chat/use-chat-shortcuts";

function Harness() {
  useChatShortcuts();
  return (
    <div>
      <button type="button" data-testid="random-button">
        Other
      </button>
      <input data-testid="other-input" defaultValue="elsewhere" />
      <form data-chat-composer="true">
        <textarea data-testid="composer" />
      </form>
    </div>
  );
}

describe("useChatShortcuts", () => {
  it("⌘K focuses the composer textarea from anywhere on the page", () => {
    render(<Harness />);
    const button = document.querySelector(
      '[data-testid="random-button"]',
    ) as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      );
    });

    const composer = document.querySelector(
      '[data-testid="composer"]',
    ) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(composer);
  });

  it("Ctrl+K is treated the same on non-mac", () => {
    render(<Harness />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
      );
    });
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="composer"]'),
    );
  });

  it("⌘K does NOT hijack focus when user is typing in another input", () => {
    render(<Harness />);
    const otherInput = document.querySelector(
      '[data-testid="other-input"]',
    ) as HTMLInputElement;
    otherInput.focus();
    expect(document.activeElement).toBe(otherInput);

    fireEvent.keyDown(otherInput, { key: "k", metaKey: true });

    expect(document.activeElement).toBe(otherInput);
  });

  it("Esc on the empty composer blurs it", () => {
    render(<Harness />);
    const composer = document.querySelector(
      '[data-testid="composer"]',
    ) as HTMLTextAreaElement;
    composer.focus();
    expect(document.activeElement).toBe(composer);

    fireEvent.keyDown(composer, { key: "Escape" });

    expect(document.activeElement).not.toBe(composer);
  });

  it("Esc on the non-empty composer leaves it focused (no blur)", () => {
    render(<Harness />);
    const composer = document.querySelector(
      '[data-testid="composer"]',
    ) as HTMLTextAreaElement;
    composer.value = "draft";
    composer.focus();

    fireEvent.keyDown(composer, { key: "Escape" });

    expect(document.activeElement).toBe(composer);
  });
});
