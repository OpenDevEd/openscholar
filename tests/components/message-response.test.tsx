/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";

describe("<MessageResponse>", () => {
  it("rerenders when markdown renderer props change for the same text", () => {
    const markdown =
      'The <mention user_id="abc">custom source</mention> should render.';

    const { rerender } = render(<MessageResponse>{markdown}</MessageResponse>);
    expect(screen.queryByTestId("custom-source")).toBeNull();

    rerender(
      <MessageResponse
        allowedTags={{ mention: ["user_id"] }}
        components={{
          mention: ({ children, user_id }) => (
            <span data-source-id={String(user_id)} data-testid="custom-source">
              {children as ReactNode}
            </span>
          ),
        }}
      >
        {markdown}
      </MessageResponse>,
    );

    expect(screen.getByTestId("custom-source")).toHaveAttribute(
      "data-source-id",
      "abc",
    );
    expect(screen.getByTestId("custom-source")).toHaveTextContent(
      "custom source",
    );
  });
});
