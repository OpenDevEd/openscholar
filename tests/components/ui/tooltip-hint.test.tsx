/**
 * @vitest-environment jsdom
 */
import { act, screen } from "@testing-library/react";
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

  it("shows a label the control holds and doesn't draw at this width", async () => {
    render(
      <TooltipHint label="Keyboard shortcuts" onlyWhenClipped>
        <button type="button">
          <span style={{ display: "none" }}>Keyboard shortcuts</span>
        </button>
      </TooltipHint>,
    );

    await userEvent.hover(screen.getByRole("button"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Keyboard shortcuts");
  });
});

describe("<TooltipHint> on focus", () => {
  function renderButton() {
    render(
      <TooltipHint label="Settings">
        <button type="button">S</button>
      </TooltipHint>,
    );
    return screen.getByRole("button");
  }

  async function tap() {
    await userEvent.pointer({ keys: "[TouchA]", target: document.body });
  }

  // A phone's sheet focuses its first button as it opens, and a menu gives focus back as it closes.
  // Nothing on a touch screen would close a hint opened then.
  it("stays shut when a script moves focus after a tap", async () => {
    const button = renderButton();

    await tap();
    act(() => button.focus());

    expect(button).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens when the keyboard moves focus to its button after a tap", async () => {
    renderButton();

    await tap();
    await userEvent.tab();

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Settings");
  });

  // Safari moves focus to buttons with Option+Tab.
  it("opens when Option+Tab moves focus to its button after a tap", async () => {
    const button = renderButton();

    await tap();
    await userEvent.keyboard("{Alt>}{Tab}{/Alt}");
    act(() => button.focus());

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Settings");
  });

  // A screen reader can move focus without sending a key or pointer event.
  it("opens when focus arrives with no key press or tap before it", async () => {
    const button = renderButton();

    act(() => button.focus());

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Settings");
  });
});
