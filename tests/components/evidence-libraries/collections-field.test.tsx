/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({ listCollections: vi.fn() }));

// One action callback per test, as Convex gives one per mounted section; the
// field caches its catalogue by that callback.
let listAction: (args: unknown) => unknown;

vi.mock("convex/react", () => ({ useAction: () => listAction }));
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

// The field suspends on its catalogue, so rendering must be awaited.
async function renderField(props: Parameters<typeof CollectionsField>[0]) {
  await act(async () => {
    render(<CollectionsField {...props} />);
  });
}

const catalogue = [
  { id: "COLL0001", title: "Climate", count: 12, source: "Climate group", parentId: null },
  { id: "COLL0002", title: "Health", count: 3, source: "Health group", parentId: null },
  { id: "COLL0003", title: "Water", count: 7, source: "Climate group", parentId: null },
];

describe("collection order helpers", () => {
  it("sorts by order and renumbers from zero", () => {
    expect(sortedEntries([{ id: "b", order: 5 }, { id: "a", order: 1 }]).map((e) => e.id)).toEqual(["a", "b"]);
    expect(renumber([{ id: "b", order: 5 }, { id: "a", order: 1 }])).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
  });
});

describe("<CollectionsField> with a truncated catalogue", () => {
  beforeEach(() => {
    mocks.listCollections.mockReset();
    listAction = (args) => mocks.listCollections(args);
  });

  function truncatedCatalogue() {
    // Every page reports another page, so the loader stops at its cap.
    mocks.listCollections.mockImplementation(async (args: { query?: string; cursor?: string }) => {
      if (args.query === "amber") {
        if (!args.cursor) {
          return {
            items: [
              { id: "FOUND1", title: "Amber studies", count: 4, source: "Amber group", parentId: null },
              { id: "FOUND2", title: "Amber maps", count: 2, source: "Amber group", parentId: null },
            ],
            nextCursor: "amber-2",
          };
        }
        return {
          items: [{ id: "FOUND1", title: "Amber studies", count: 4, source: "Amber group", parentId: null }],
          nextCursor: null,
        };
      }
      if (args.query === "broken") throw new Error("down");
      const page = Number(args.cursor ?? "0");
      return {
        items: [{ id: `PAGE${page}`, title: `Page ${page}`, count: 1, source: "Big group", parentId: null }],
        nextCursor: String(page + 1),
      };
    });
  }

  it("offers the whole-library search, merges its results once, and adds from them", async () => {
    truncatedCatalogue();
    const onChange = vi.fn();
    await renderField({ libraryId, value: [], onChange });
    await userEvent.click(await screen.findByRole("button", { name: `${ns}.picker.open` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
    expect(screen.queryByRole("button", { name: `${ns}.picker.searchAll` })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: `${ns}.picker.search` }), "amber");
    const searchAll = screen.getByRole("button", { name: `${ns}.picker.searchAll` });
    await userEvent.click(searchAll);
    expect(await within(table).findByText("Amber studies")).toBeInTheDocument();
    // The second page's duplicate id and a repeated click both stay single rows.
    expect(within(table).getByText("Amber maps")).toBeInTheDocument();
    expect(mocks.listCollections).toHaveBeenLastCalledWith({ libraryId, query: "amber", cursor: "amber-2" });
    await userEvent.click(searchAll);
    expect(within(table).getAllByText("Amber studies")).toHaveLength(1);
    await userEvent.click(within(table).getByRole("checkbox", { name: "Amber studies" }));
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":1}` }));
    expect(onChange).toHaveBeenCalledWith([{ id: "FOUND1", enabled: true, order: 0 }]);
  });

  it("says when the whole-library search fails", async () => {
    truncatedCatalogue();
    await renderField({ libraryId, value: [], onChange: vi.fn() });
    await userEvent.click(await screen.findByRole("button", { name: `${ns}.picker.open` }));
    await userEvent.type(await screen.findByRole("textbox", { name: `${ns}.picker.search` }), "broken");
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.searchAll` }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`${ns}.picker.searchAllFailed`);
  });
});

describe("<CollectionsField>", () => {
  beforeEach(() => {
    mocks.listCollections.mockReset();
    listAction = (args) => mocks.listCollections(args);
  });

  it("explains that a draft library has no collections yet and keeps the picker closed", async () => {
    mocks.listCollections.mockResolvedValue({ reason: "not-set-up", items: [], nextCursor: null });
    await renderField({ libraryId, value: [], onChange: vi.fn() });
    expect(await screen.findByText(`${ns}.notSetUp`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${ns}.picker.open` })).toBeDisabled();
  });

  it("reads every catalogue page once and shows the chosen collections with their database facts", async () => {
    mocks.listCollections
      .mockResolvedValueOnce({ items: catalogue.slice(0, 2), nextCursor: "page-2" })
      .mockResolvedValueOnce({ items: catalogue.slice(2), nextCursor: null });
    await renderField({ libraryId, value: [{ id: "COLL0003", order: 0 }], onChange: vi.fn() });
    expect(await screen.findByText("Water")).toBeInTheDocument();
    expect(screen.getByText(`${ns}.records {"count":7}`)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `${ns}.titleLabel` })).toHaveAttribute("placeholder", "Water");
    expect(mocks.listCollections).toHaveBeenCalledTimes(2);
    expect(mocks.listCollections).toHaveBeenLastCalledWith({ libraryId, cursor: "page-2" });
  });

  it("ticks several collections in the picker, hides ones already shown, and adds them in order", async () => {
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    const onChange = vi.fn();
    await renderField({ libraryId, value: [{ id: "COLL0002", order: 0 }], onChange });
    await userEvent.click(await screen.findByRole("button", { name: `${ns}.picker.open` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
    expect(within(table).queryByText("Health")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: `${ns}.picker.hideShown` }));
    expect(within(table).getByText(`${ns}.picker.shown`)).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("checkbox", { name: "Climate" }));
    await userEvent.click(within(table).getByRole("checkbox", { name: "Water" }));
    expect(screen.getByText(`${ns}.picker.pickedCount {"count":2}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.addPicked {"count":2}` }));
    expect(onChange).toHaveBeenCalledWith([
      { id: "COLL0002", order: 0 },
      { id: "COLL0001", enabled: true, order: 1 },
      { id: "COLL0003", enabled: true, order: 2 },
    ]);
  });

  it("filters the picker by source and by search text", async () => {
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    await renderField({ libraryId, value: [], onChange: vi.fn() });
    await userEvent.click(await screen.findByRole("button", { name: `${ns}.picker.open` }));
    const table = await screen.findByRole("table", { name: `${ns}.picker.title` });
    await userEvent.click(screen.getByRole("button", { name: "Health group" }));
    expect(within(table).queryByText("Climate")).not.toBeInTheDocument();
    expect(within(table).getByText("Health")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: `${ns}.picker.allSources` }));
    await userEvent.type(screen.getByRole("textbox", { name: `${ns}.picker.search` }), "wat");
    expect(within(table).getByText("Water")).toBeInTheDocument();
    expect(within(table).queryByText("Climate")).not.toBeInTheDocument();
  });

  it("renames and removes chosen collections", async () => {
    mocks.listCollections.mockResolvedValue({ items: catalogue, nextCursor: null });
    const onChange = vi.fn();
    const value = [{ id: "COLL0001", order: 0 }, { id: "COLL0002", order: 1 }];
    await renderField({ libraryId, value, onChange });
    const titles = await screen.findAllByRole("textbox", { name: `${ns}.titleLabel` });
    await userEvent.type(titles[0], "O");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "COLL0001", order: 0, title: "O" }, value[1]]);
    await userEvent.click(screen.getAllByRole("button", { name: `${ns}.remove` })[0]);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([{ id: "COLL0002", order: 0 }]));
  });
});
