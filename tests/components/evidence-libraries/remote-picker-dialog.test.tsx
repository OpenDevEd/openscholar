/**
 * @vitest-environment jsdom
 */
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

import {
  localPickerSource,
  type PickerPage,
  type PickerRow,
  RemotePickerDialog,
} from "@/components/evidence-libraries/configuration/sections/remote-picker-dialog";
import { Button } from "@/components/ui/button";

const ns = "evidenceLibraryConfiguration.picker";

const labels = {
  title: "Add collections",
  description: "Pick from the library",
  searchLabel: "Search",
  columns: { title: "Collection", meta: "Source", count: "Records" },
  loadingLabel: "Loading rows",
  failedLabel: "Could not load the rows",
  emptyLabel: "Nothing here",
  noMatchLabel: "No match",
  notSetUpLabel: "Not set up yet",
};

function row(id: string, title: string, count = 1): PickerRow {
  return { id, title, meta: "Big group", count };
}

type PickerProps = Parameters<typeof RemotePickerDialog>[0];

function renderPicker(overrides: Record<string, unknown> = {}) {
  const user = userEvent.setup();
  const props = {
    ...labels,
    trigger: <Button type="button">Open</Button>,
    mode: "multi" as const,
    confirmLabel: (count: number) => `Add ${count}`,
    onConfirm: vi.fn(),
    source: vi.fn(async () => ({ items: [row("A", "Alpha")], nextCursor: null }) satisfies PickerPage),
    ...overrides,
  } as unknown as PickerProps;
  render(<RemotePickerDialog {...props} />);
  return { user, props };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByRole("dialog");
}

describe("<RemotePickerDialog>", () => {
  it("asks the server for the first page when it opens, without a search", async () => {
    const source = vi.fn(async () => ({ items: [row("A", "Alpha")], nextCursor: null }));
    const { user } = renderPicker({ source });
    expect(source).not.toHaveBeenCalled();
    await open(user);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith({ query: "", cursor: null, sort: null, direction: null });
  });

  it("sends the typed text to the server once typing stops", async () => {
    const source = vi.fn(async ({ query }: { query: string }) => ({
      items: query ? [row("B", "Beta")] : [row("A", "Alpha")],
      nextCursor: null,
    }));
    const { user } = renderPicker({ source });
    await open(user);
    await user.type(screen.getByRole("textbox", { name: "Search" }), "bet");
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    // Only the finished word reaches the server, never "b" or "be".
    expect(source.mock.calls.map(([input]) => input.query)).toEqual(["", "bet"]);
  });

  it("loads the next page with the cursor and keeps the rows already shown", async () => {
    const source = vi.fn(async ({ cursor }: { cursor: string | null }) =>
      cursor
        ? { items: [row("B", "Beta")], nextCursor: null }
        : { items: [row("A", "Alpha")], nextCursor: "page-2" },
    );
    const { user } = renderPicker({ source });
    await open(user);
    await user.click(screen.getByRole("button", { name: `${ns}.loadMore` }));
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(source).toHaveBeenLastCalledWith({
      query: "",
      cursor: "page-2",
      sort: null,
      direction: null,
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${ns}.loadMore` })).not.toBeInTheDocument();
  });

  it("confirms the ticked rows and closes", async () => {
    const onConfirm = vi.fn();
    const source = vi.fn(async () => ({
      items: [row("A", "Alpha"), row("B", "Beta")],
      nextCursor: null,
    }));
    const { user } = renderPicker({ source, onConfirm });
    await open(user);
    await user.click(await screen.findByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    expect(screen.getByText(`${ns}.pickedCount {"count":2}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add 2" }));
    expect(onConfirm).toHaveBeenCalledWith([row("A", "Alpha"), row("B", "Beta")]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("ticks every row at once and leaves rows already used alone", async () => {
    const onConfirm = vi.fn();
    const source = vi.fn(async () => ({
      items: [row("A", "Alpha"), row("B", "Beta")],
      nextCursor: null,
    }));
    const { user } = renderPicker({ source, onConfirm, usedIds: ["A"], usedLabel: "Shown" });
    await open(user);
    expect(await screen.findByRole("checkbox", { name: "Alpha" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: `${ns}.selectAll` }));
    await user.click(screen.getByRole("button", { name: "Add 1" }));
    expect(onConfirm).toHaveBeenCalledWith([row("B", "Beta")]);
  });

  it("keeps a ticked row that a later search hides", async () => {
    const onConfirm = vi.fn();
    const source = vi.fn(async ({ query }: { query: string }) => ({
      items: query === "beta" ? [row("B", "Beta")] : [row("A", "Alpha")],
      nextCursor: null,
    }));
    const { user } = renderPicker({ source, onConfirm });
    await open(user);
    await user.click(await screen.findByRole("checkbox", { name: "Alpha" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "beta");
    await user.click(await screen.findByRole("checkbox", { name: "Beta" }));
    expect(screen.getByText(`${ns}.pickedCount {"count":2}`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add 2" }));
    expect(onConfirm).toHaveBeenCalledWith([row("A", "Alpha"), row("B", "Beta")]);
  });

  it("chooses one row and closes in single mode", async () => {
    const onChoose = vi.fn();
    const source = vi.fn(async () => ({ items: [row("A", "Alpha")], nextCursor: null }));
    const { user } = renderPicker({
      source,
      mode: "single",
      value: "",
      onChoose,
      confirmLabel: undefined,
      onConfirm: undefined,
    });
    await open(user);
    await user.click(await screen.findByText("Alpha"));
    expect(onChoose).toHaveBeenCalledWith(row("A", "Alpha"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers the typed name only when no row matches it", async () => {
    const onChoose = vi.fn();
    const source = vi.fn(async ({ query }: { query: string }) => ({
      items: query === "alpha" ? [row("A", "Alpha")] : [],
      nextCursor: null,
    }));
    const { user } = renderPicker({
      source,
      mode: "single",
      value: "",
      onChoose,
      newLabel: (typed: string) => `Use ${typed}`,
      confirmLabel: undefined,
      onConfirm: undefined,
    });
    await open(user);
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.type(search, "alpha");
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Use alpha")).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "Strathmore");
    await user.click(await screen.findByText("Use Strathmore"));
    expect(onChoose).toHaveBeenCalledWith({ id: "Strathmore", title: "Strathmore" });
  });

  it("says when the list is empty, when nothing matches and when the library is not set up", async () => {
    const source = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { user } = renderPicker({ source });
    await open(user);
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search" }), "gone");
    expect(await screen.findByText("No match")).toBeInTheDocument();
  });

  it("shows the not-set-up answer", async () => {
    const source = vi.fn(async () => ({ items: [], nextCursor: null, reason: "not-set-up" as const }));
    const { user } = renderPicker({ source });
    await open(user);
    expect(await screen.findByText("Not set up yet")).toBeInTheDocument();
  });

  it("offers to try again after a failure", async () => {
    let fail = true;
    const source = vi.fn(async () => {
      if (fail) throw new Error("down");
      return { items: [row("A", "Alpha")], nextCursor: null };
    });
    const { user } = renderPicker({ source });
    await open(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the rows");
    fail = false;
    await user.click(screen.getByRole("button", { name: `${ns}.tryAgain` }));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("moves between rows with the arrow keys and closes on Escape", async () => {
    const source = vi.fn(async () => ({
      items: [row("A", "Alpha"), row("B", "Beta")],
      nextCursor: null,
    }));
    const { user } = renderPicker({ source });
    await open(user);
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-picker-id", "A");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-picker-id", "B");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveAttribute("data-picker-id", "A");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("keeps ticked rows that could not be added and stays open", async () => {
    const source = vi.fn(async () => ({
      items: [row("A", "Alpha"), row("B", "Beta")],
      nextCursor: null,
    }));
    const onConfirm = vi.fn(async () => ["B"]);
    const { user } = renderPicker({ source, onConfirm });
    await open(user);
    await user.click(await screen.findByRole("checkbox", { name: "Alpha" }));
    await user.click(screen.getByRole("checkbox", { name: "Beta" }));
    await user.click(screen.getByRole("button", { name: "Add 2" }));
    expect(await screen.findByText(`${ns}.pickedCount {"count":1}`)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
  });
});

describe("<RemotePickerDialog> and slow answers", () => {
  /** A source whose pages are released by hand. */
  function deferredSource() {
    const waiting = new Map<string, (page: PickerPage) => void>();
    const source = vi.fn(
      ({ query }: { query: string }) =>
        new Promise<PickerPage>((resolve) => {
          waiting.set(query, resolve);
        }),
    );
    return {
      source,
      release: (query: string, page: PickerPage) => {
        const resolve = waiting.get(query);
        if (!resolve) throw new Error(`nothing waiting for "${query}"`);
        act(() => resolve(page));
      },
    };
  }

  it("never shows the answer to text the owner has moved on from", async () => {
    const { source, release } = deferredSource();
    const user = userEvent.setup();
    render(
      <RemotePickerDialog
        {...({
          ...labels,
          trigger: <Button type="button">Open</Button>,
          mode: "multi",
          confirmLabel: (count: number) => `Add ${count}`,
          onConfirm: vi.fn(),
          source,
        } as unknown as PickerProps)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    release("", { items: [row("A", "Alpha")], nextCursor: null });
    expect(await screen.findByText("Alpha")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search" }), "be");
    await waitFor(() => expect(source).toHaveBeenCalledTimes(2));
    // The owner keeps typing while "be" is still in the air.
    await user.type(screen.getByRole("textbox", { name: "Search" }), "ta");
    release("be", { items: [row("OLD", "Stale row")], nextCursor: "old-page-2" });
    expect(screen.queryByText("Stale row")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${ns}.loadMore` })).not.toBeInTheDocument();

    await waitFor(() => expect(source).toHaveBeenCalledTimes(3));
    release("beta", { items: [row("B", "Beta")], nextCursor: null });
    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Stale row")).not.toBeInTheDocument();
  });

  it("never asks for the next page of an older search", async () => {
    const { source, release } = deferredSource();
    const user = userEvent.setup();
    render(
      <RemotePickerDialog
        {...({
          ...labels,
          trigger: <Button type="button">Open</Button>,
          mode: "multi",
          confirmLabel: (count: number) => `Add ${count}`,
          onConfirm: vi.fn(),
          source,
        } as unknown as PickerProps)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    release("", { items: [row("A", "Alpha")], nextCursor: "page-2" });
    expect(await screen.findByRole("button", { name: `${ns}.loadMore` })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search" }), "beta");
    // While the new text is being answered there is nothing to page.
    expect(screen.queryByRole("button", { name: `${ns}.loadMore` })).not.toBeInTheDocument();
    await waitFor(() => expect(source).toHaveBeenCalledTimes(2));
    release("beta", { items: [row("B", "Beta")], nextCursor: "beta-2" });
    await user.click(await screen.findByRole("button", { name: `${ns}.loadMore` }));
    expect(source).toHaveBeenLastCalledWith({
      query: "beta",
      cursor: "beta-2",
      sort: null,
      direction: null,
    });
  });
});

describe("<RemotePickerDialog> in single mode", () => {
  const single = {
    ...labels,
    trigger: <Button type="button">Open</Button>,
    mode: "single" as const,
    value: "",
    noneLabel: "None",
    newLabel: (typed: string) => `Use ${typed}`,
  };

  it("still offers None and the typed name when the library cannot be read", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <RemotePickerDialog
        {...({
          ...single,
          onChoose,
          source: vi.fn(async () => {
            throw new Error("down");
          }),
        } as unknown as PickerProps)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the rows");
    expect(screen.getByText("None")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search" }), "Strathmore");
    await user.click(await screen.findByText("Use Strathmore"));
    expect(onChoose).toHaveBeenCalledWith({ id: "Strathmore", title: "Strathmore" });
  });

  it("still offers None and the typed name when the library is not set up", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <RemotePickerDialog
        {...({
          ...single,
          onChoose,
          source: vi.fn(async () => ({ items: [], nextCursor: null, reason: "not-set-up" as const })),
        } as unknown as PickerProps)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Not set up yet")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Search" }), "Strathmore");
    await user.click(await screen.findByText("Use Strathmore"));
    expect(onChoose).toHaveBeenCalledWith({ id: "Strathmore", title: "Strathmore" });

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(await screen.findByText("None"));
    expect(onChoose).toHaveBeenLastCalledWith(null);
  });

  it("offers the typed name only once the server answered that text with nothing", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <RemotePickerDialog
        {...({
          ...single,
          onChoose,
          source: vi.fn(async ({ query }: { query: string }) => ({
            items: query === "nairobi" ? [row("A", "University of Nairobi")] : [],
            nextCursor: null,
          })),
        } as unknown as PickerProps)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.type(screen.getByRole("textbox", { name: "Search" }), "nairobi");
    expect(await screen.findByText("University of Nairobi")).toBeInTheDocument();
    // A near match is still a match, so the typed name is not offered.
    expect(screen.queryByText("Use nairobi")).not.toBeInTheDocument();
  });
});

describe("localPickerSource", () => {
  const rows = Array.from({ length: 120 }, (_, index) => row(`ID${index}`, `Row ${index}`));

  it("pages fifty at a time and searches the title", async () => {
    const source = localPickerSource(rows);
    const first = await source({ query: "", cursor: null, sort: null, direction: null });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toBe("50");
    const second = await source({ query: "", cursor: first.nextCursor, sort: null, direction: null });
    expect(second.items[0]?.id).toBe("ID50");
    const found = await source({ query: "row 11", cursor: null, sort: null, direction: null });
    expect(found.items.map((item) => item.id)).toEqual([
      "ID11",
      "ID110",
      "ID111",
      "ID112",
      "ID113",
      "ID114",
      "ID115",
      "ID116",
      "ID117",
      "ID118",
      "ID119",
    ]);
    expect(found.nextCursor).toBeNull();
  });
});
