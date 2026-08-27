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
const ns = "evidenceLibraryConfiguration.collections";
const pickerNs = "evidenceLibraryConfiguration.picker";

const catalogue = [
  { id: "COLL0001", title: "Climate", count: 12, source: "Climate group", parentId: null },
  { id: "COLL0002", title: "Health", count: 3, source: "Health group", parentId: null },
  { id: "COLL0003", title: "Water", count: 7, source: "Climate group", parentId: null },
];

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: `${ns}.picker.open` }));
  return await screen.findByRole("table", { name: `${ns}.picker.title` });
}

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
  beforeEach(() => {
    mocks.listCollections.mockReset();
  });

  it("reads nothing until the picker opens, then asks for one page", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    expect(mocks.listCollections).not.toHaveBeenCalled();
    const table = await openPicker(user);
    expect(await within(table).findByText("Climate")).toBeInTheDocument();
    expect(mocks.listCollections).toHaveBeenCalledTimes(1);
    expect(mocks.listCollections).toHaveBeenCalledWith({
      libraryId,
      query: undefined,
      cursor: undefined,
    });
  });

  it("sends the typed text to the library and adds what it finds", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockImplementation(async ({ query }: { query?: string }) => ({
      items: query
        ? [{ id: "FOUND1", title: "Amber studies", count: 4, source: "Amber group", parentId: null }]
        : catalogue,
      nextCursor: null,
    }));
    const onChange = vi.fn();
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={onChange} />);
    const table = await openPicker(user);
    await user.type(screen.getByRole("textbox", { name: `${ns}.picker.search` }), "amber");
    expect(await within(table).findByText("Amber studies")).toBeInTheDocument();
    expect(mocks.listCollections).toHaveBeenLastCalledWith({
      libraryId,
      query: "amber",
      cursor: undefined,
    });
    await user.click(within(table).getByRole("checkbox", { name: "Amber studies" }));
    await user.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":1}` }));
    expect(onChange).toHaveBeenCalledWith([{ id: "FOUND1", enabled: true, order: 0 }]);
  });

  it("loads the next page with the library's cursor", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockImplementation(async ({ cursor }: { cursor?: string }) =>
      cursor
        ? { items: catalogue.slice(2), nextCursor: null }
        : { items: catalogue.slice(0, 2), nextCursor: "page-2" },
    );
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    const table = await openPicker(user);
    expect(await within(table).findByText("Climate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${pickerNs}.loadMore` }));
    expect(await within(table).findByText("Water")).toBeInTheDocument();
    expect(mocks.listCollections).toHaveBeenLastCalledWith({
      libraryId,
      query: undefined,
      cursor: "page-2",
    });
  });

  it("explains that a draft library has no collections yet", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ reason: "not-set-up", items: [], nextCursor: null });
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: `${ns}.picker.open` }));
    expect(await screen.findByText(`${ns}.notSetUp`)).toBeInTheDocument();
  });

  it("ticks several collections, hides ones already shown, and adds them in order", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    const onChange = vi.fn();
    render(
      <CollectionsField libraryId={libraryId} value={[{ id: "COLL0002", order: 0 }]} onChange={onChange} />,
    );
    const table = await openPicker(user);
    expect(await within(table).findByText("Climate")).toBeInTheDocument();
    expect(within(table).queryByText("Health")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: `${ns}.picker.hideShown` }));
    expect(within(table).getByText(`${ns}.picker.shown`)).toBeInTheDocument();
    await user.click(within(table).getByRole("checkbox", { name: "Climate" }));
    await user.click(within(table).getByRole("checkbox", { name: "Water" }));
    expect(screen.getByText(`${pickerNs}.pickedCount {"count":2}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":2}` }));
    expect(onChange).toHaveBeenCalledWith([
      { id: "COLL0002", order: 0 },
      { id: "COLL0001", enabled: true, order: 1 },
      { id: "COLL0003", enabled: true, order: 2 },
    ]);
  });

  it("filters the loaded page by source", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    render(<CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />);
    const table = await openPicker(user);
    expect(await within(table).findByText("Climate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Health group" }));
    expect(within(table).queryByText("Climate")).not.toBeInTheDocument();
    expect(within(table).getByText("Health")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${ns}.picker.allSources` }));
    expect(within(table).getByText("Climate")).toBeInTheDocument();
  });

  it("shows the database name and record count of a collection the picker read", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    const { rerender } = render(
      <CollectionsField libraryId={libraryId} value={[]} onChange={vi.fn()} />,
    );
    const table = await openPicker(user);
    expect(await within(table).findByText("Water")).toBeInTheDocument();
    await user.click(within(table).getByRole("checkbox", { name: "Water" }));
    await user.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":1}` }));
    rerender(
      <CollectionsField libraryId={libraryId} value={[{ id: "COLL0003", order: 0 }]} onChange={vi.fn()} />,
    );
    expect(await screen.findByText("Water")).toBeInTheDocument();
    expect(screen.getByText(`${ns}.records {"count":7}`)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `${ns}.titleLabel` })).toHaveAttribute("placeholder", "Water");
  });

  it("renames and removes chosen collections", async () => {
    const user = userEvent.setup();
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    const onChange = vi.fn();
    const value = [{ id: "COLL0001", order: 0 }, { id: "COLL0002", order: 1 }];
    render(<CollectionsField libraryId={libraryId} value={value} onChange={onChange} />);
    const titles = await screen.findAllByRole("textbox", { name: `${ns}.titleLabel` });
    await user.type(titles[0], "O");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "COLL0001", order: 0, title: "O" }, value[1]]);
    await user.click(screen.getAllByRole("button", { name: `${ns}.remove` })[0]);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([{ id: "COLL0002", order: 0 }]));
  });
});
