/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RefusedId } from "@/components/refused-id";

// What Convex's client throws when an argument's validator refuses a value.
const refusal = () =>
  new Error('[CONVEX Q(library/queries:getLibraryFilteredCount)] [Request ID: 1] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .collectionId\nValue: "abc"\nValidator: v.id("collections")');

function Reads({ id, fails }: { id: string | null; fails: () => Error }) {
  if (id) throw fails();
  return <p>The whole library</p>;
}

/** A page that drops the ID from its address once the server has refused it. */
function Page({ fails, onRefused }: { fails: () => Error; onRefused: () => void }) {
  const [id, setId] = useState<string | null>("abc");
  return (
    <RefusedId
      id={id}
      onRefused={() => {
        onRefused();
        setId(null);
      }}
    >
      <Reads id={id} fails={fails} />
    </RefusedId>
  );
}

describe("<RefusedId>", () => {
  it("tells the page of an ID the server refused, and shows the page once it has dropped it", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onRefused = vi.fn();
    render(<Page fails={refusal} onRefused={onRefused} />);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(screen.getByText("The whole library")).toBeTruthy();
  });

  it("lets any other error through to the boundary above", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onRefused = vi.fn();
    expect(() => render(<Page fails={() => new Error("Server Error")} onRefused={onRefused} />)).toThrow("Server Error");
    expect(onRefused).not.toHaveBeenCalled();
  });
});
