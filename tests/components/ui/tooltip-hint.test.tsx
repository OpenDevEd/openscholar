/**
 * @vitest-environment jsdom
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TooltipHint } from "@/components/ui/tooltip";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";

function renderTitle() {
  render(
    <TooltipHint label="A long paper title" onlyWhenClipped>
      <p>A long paper title</p>
    </TooltipHint>,
  );
  return screen.getByText("A long paper title");
}

describe("<TooltipHint onlyWhenClipped>", () => {
  it("stays closed while the text fits", async () => {
    await userEvent.hover(renderTitle());

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows the full text once it is cut off", async () => {
    const title = renderTitle();
    // jsdom has no layout, so give the text a box narrower than its content.
    Object.defineProperty(title, "scrollWidth", { configurable: true, value: 300 });
    Object.defineProperty(title, "clientWidth", { configurable: true, value: 100 });

    await userEvent.hover(title);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("A long paper title");
  });
});
