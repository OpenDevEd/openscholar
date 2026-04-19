/**
 * @vitest-environment jsdom
 *
 * Behavioral test for the inline streaming cursor.
 * - Renders an aria-hidden span with the test id consumers can target
 *   (used by message-list to mark the in-flight assistant message)
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreamingCursor } from "@/components/extraction/chat/streaming-cursor";

describe("<StreamingCursor>", () => {
  it("renders an aria-hidden cursor element", () => {
    render(<StreamingCursor />);
    const cursor = screen.getByTestId("streaming-cursor");
    expect(cursor).toHaveAttribute("aria-hidden");
  });
});
