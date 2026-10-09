/**
 * @vitest-environment jsdom
 *
 * #688: a typed range end moves the range once it's a paper the range can end on, and snaps into
 * the range when the field is left or Enter is pressed, never on each keystroke.
 */
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RangeFields } from "@/components/screening/source-row";

const LABELS = { slider: "Papers", from: "Papers", to: "to", of: "of 500", first: "First paper", last: "Last paper" };

function Range({ start, seen }: { start: [number, number]; seen: [number, number][] }) {
  const [value, setValue] = useState(start);
  return (
    <RangeFields
      value={value}
      onChange={(next) =>
        setValue((current) => {
          const range = typeof next === "function" ? next(current) : next;
          seen.push(range);
          return range;
        })
      }
      total={500}
      labels={LABELS}
    />
  );
}

describe("a screening's range fields", () => {
  it("take the number typed into To, past one under From on the way", async () => {
    const seen: [number, number][] = [];
    render(<Range start={[100, 300]} seen={seen} />);
    const to = screen.getByRole("spinbutton", { name: "Last paper" });

    await userEvent.clear(to);
    await userEvent.type(to, "120");

    expect(to).toHaveValue(120);
    // "1" and "12" end before From's 100, so the range waited for "120".
    expect(seen).toEqual([[100, 120]]);
  });

  it("leave a cleared From as it is while typing, and snap a number past To into the range on Enter", async () => {
    const seen: [number, number][] = [];
    render(<Range start={[1, 50]} seen={seen} />);
    const from = screen.getByRole("spinbutton", { name: "First paper" });

    await userEvent.clear(from);
    expect(from).toHaveValue(null);
    expect(seen).toEqual([]);

    await userEvent.type(from, "80{Enter}");
    expect(seen.at(-1)).toEqual([50, 50]);
    expect(from).toHaveValue(50);
  });

  it("keep a From snapped as the slider is pressed, moving To from there", async () => {
    const seen: [number, number][] = [];
    const { container } = render(<Range start={[1, 50]} seen={seen} />);
    const from = screen.getByRole("spinbutton", { name: "First paper" });
    await userEvent.clear(from);
    await userEvent.type(from, "80");

    // Pressing the track at paper 90 takes focus from From, which snaps to 50, and moves To in the same moment.
    const slider = container.querySelector<HTMLElement>("[data-slot=slider]")!;
    slider.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 499, height: 20, right: 499, bottom: 20, toJSON() {} });
    // jsdom has no pointer capture, which the slider takes on a press.
    Object.assign(slider, { setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} });
    fireEvent.pointerDown(slider, { clientX: 89, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(slider, { clientX: 89, clientY: 5, pointerId: 1, button: 0 });

    expect(seen.at(-1)).toEqual([50, 90]);
    expect(from).toHaveValue(50);
  });

  it("snap an emptied To to the range's first paper when it's left", async () => {
    const seen: [number, number][] = [];
    render(<Range start={[10, 40]} seen={seen} />);
    const to = screen.getByRole("spinbutton", { name: "Last paper" });

    await userEvent.clear(to);
    await userEvent.tab();

    expect(seen).toEqual([[10, 10]]);
    expect(to).toHaveValue(10);
  });
});
