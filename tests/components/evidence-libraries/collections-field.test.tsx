/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({ listCollections: vi.fn() }));

vi.mock("convex/react", () => ({ useAction: () => mocks.listCollections }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { zotero: { runtimeReadActions: { listLibraryCollections: "listLibraryCollections" } } },
}));

import {
  CollectionsField,
  renumber,
  sortedEntries,
} from "@/components/evidence-libraries/configuration/sections/collections-field";

const libraryId = "library_1" as Id<"evidenceLibraries">;

describe("collection order helpers", () => {
  it("sorts by order and renumbers from zero", () => {
    expect(sortedEntries([{ id: "b", order: 5 }, { id: "a", order: 1 }]).map((e) => e.id)).toEqual(["a", "b"]);
    expect(renumber([{ id: "b", order: 5 }, { id: "a", order: 1 }])).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
  });
});

describe("<CollectionsField>", () => {
  beforeEach(() => mocks.listCollections.mockReset());

  it("explains that a draft library has no collections yet", async () => {
    mocks.listCollections.mockResolvedValue({ reason: "not-set-up", items: [], nextCursor: null });
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "evidenceLibraryCollections.add" }));
    expect(await screen.findByText("evidenceLibraryCollections.notSetUp")).toBeInTheDocument();
  });

  it("adds a collection from the library's catalogue with its title and next order", async () => {
    mocks.listCollections.mockResolvedValue({
      items: [
        { id: "COLL0001", title: "Climate", count: 12, source: "zotero-42", parentId: null },
        { id: "COLL0002", title: "Health", count: 3, source: "zotero-42", parentId: null },
      ],
      nextCursor: null,
    });
    const onChange = vi.fn();
    render(<CollectionsField libraryId={libraryId} value={[{ id: "COLL0002", order: 0 }]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "evidenceLibraryCollections.add" }));
    const list = await screen.findByRole("list", { name: "evidenceLibraryCollections.pickerTitle" });
    expect(within(list).getByRole("button", { name: /Health/ })).toBeDisabled();
    await userEvent.click(within(list).getByRole("button", { name: /Climate/ }));
    expect(onChange).toHaveBeenCalledWith([
      { id: "COLL0002", order: 0 },
      { id: "COLL0001", title: "Climate", enabled: true, order: 1 },
    ]);
    await waitFor(() =>
      expect(mocks.listCollections).toHaveBeenCalledWith({ libraryId, query: undefined, cursor: undefined }),
    );
  });

  it("searches the catalogue with the typed text", async () => {
    mocks.listCollections.mockResolvedValue({ items: [], nextCursor: null });
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "evidenceLibraryCollections.add" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "evidenceLibraryCollections.search" }), "cli{enter}");
    await waitFor(() =>
      expect(mocks.listCollections).toHaveBeenLastCalledWith({ libraryId, query: "cli", cursor: undefined }),
    );
    expect(await screen.findByText("evidenceLibraryCollections.empty")).toBeInTheDocument();
  });

  it("reorders, renames, hides and removes chosen collections", async () => {
    const onChange = vi.fn();
    const value = [{ id: "A", title: "First", order: 0 }, { id: "B", title: "Second", order: 1 }];
    render(<CollectionsField libraryId={libraryId} value={value} onChange={onChange} />);
    const rows = screen.getAllByRole("listitem");
    await userEvent.click(within(rows[1]).getByRole("button", { name: "evidenceLibraryCollections.moveUp" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "B", title: "Second", order: 0 },
      { id: "A", title: "First", order: 1 },
    ]);
    await userEvent.click(within(rows[0]).getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith([{ ...value[0], enabled: false }, value[1]]);
    await userEvent.click(within(rows[0]).getByRole("button", { name: "evidenceLibraryCollections.remove" }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: "B", title: "Second", order: 0 }]);
  });
});
