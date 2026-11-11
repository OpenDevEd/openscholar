/** @vitest-environment jsdom */
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

afterEach(cleanup);

// A picker whose search runs elsewhere lists the words as typed as a row of their own. cmdk scored that row against
// the same pasted words even with filtering off, and 2,000 characters never finished: this test then times out.
function Picker() {
  const [search, setSearch] = useState("");
  return (
    <Command shouldFilter={false}>
      <CommandInput onValueChange={setSearch} />
      <CommandList>
        <CommandItem value={`typed:${search}`}>{search || "nothing typed"}</CommandItem>
      </CommandList>
    </Command>
  );
}

it("lists a long pasted search at once when the list doesn't filter", () => {
  const pasted = `😀 باحث 10.5555/test ${"I".repeat(2000)}`;
  render(<Picker />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: pasted } });
  expect(screen.getByRole("option").textContent).toBe(pasted);
});

// A list holds only options (axe's aria-required-children): its "type to search" line is one that can't be picked.
it("gives an empty list's message to screen readers as an option that can't be picked", () => {
  render(
    <Command shouldFilter={false}>
      <CommandInput />
      <CommandList>
        <CommandEmpty>Type to search</CommandEmpty>
      </CommandList>
    </Command>,
  );
  const message = screen.getByRole("option", { name: "Type to search" });
  expect(message.getAttribute("aria-disabled")).toBe("true");
});
