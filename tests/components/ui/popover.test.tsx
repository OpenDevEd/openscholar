/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

afterEach(cleanup);

// An open popover is a dialog, and a dialog needs a name (axe's aria-dialog-name): it is named after what opened it.
it("names an open popover after its trigger, unless it names itself", () => {
  render(
    <>
      <Popover>
        <PopoverTrigger>Cite</PopoverTrigger>
        <PopoverContent>APA 7</PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger>Share</PopoverTrigger>
        <PopoverContent aria-label="Share this paper">Link</PopoverContent>
      </Popover>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cite" }));
  expect(screen.getByRole("dialog", { name: "Cite" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(screen.getByRole("dialog", { name: "Share this paper" })).toBeTruthy();
});
