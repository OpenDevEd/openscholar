/**
 * @vitest-environment jsdom
 */
import { act, screen, within } from "@testing-library/react";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkDraft } from "@/lib/evidence-libraries/configuration/links";

const mocks = vi.hoisted(() => ({ resolveCollections: vi.fn() }));

let actions: Record<string, (args: unknown) => unknown>;

vi.mock("convex/react", () => ({ useAction: (ref: string) => actions[ref] }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    zotero: { runtimeReadActions: { resolveLibraryCollections: "resolveLibraryCollections" } },
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

import { CollectionFactsProvider } from "@/components/evidence-libraries/configuration/sections/collection-facts";
import { LinkEditor } from "@/components/evidence-libraries/configuration/sections/link-editor";
import type { Id } from "@/convex/_generated/dataModel";

const ns = "evidenceLibraryConfiguration.links";
const pickerNs = "evidenceLibraryConfiguration.picker";

const link: LinkDraft = {
  id: "nav_1",
  label: "Climate",
  target: { kind: "collection", collectionId: "" },
  icon: "",
  newTab: false,
  visible: true,
  children: [],
};

const libraryId = "library_1" as Id<"evidenceLibraries">;

// The owner renamed one collection for the site and left the other alone.
const SITE_TITLE = "Weather stories";
const collections = [{ id: "COLL0001", title: SITE_TITLE }, { id: "COLL0002" }];

async function renderEditor(props: {
  link?: typeof link;
  collections?: { id: string; title?: string }[];
  onChange?: (link: unknown) => void;
}) {
  const ids = (props.collections ?? collections).map((collection) => collection.id);
  await act(async () => {
    render(
      <CollectionFactsProvider libraryId={libraryId} ids={ids}>
        <LinkEditor
          link={props.link ?? link}
          collections={props.collections ?? collections}
          onChange={props.onChange ?? vi.fn()}
        />
      </CollectionFactsProvider>,
    );
  });
}

describe("<LinkEditor> collection target", () => {
  beforeEach(() => {
    mocks.resolveCollections.mockReset();
    mocks.resolveCollections.mockResolvedValue({
      items: [
        { id: "COLL0001", title: "Climate change", source: "zotero-42", count: 12 },
        { id: "COLL0002", title: "Health", source: "zotero-42", count: 3 },
      ],
    });
    actions = { resolveLibraryCollections: (args) => mocks.resolveCollections(args) };
  });

  it("opens the picker and writes the chosen collection id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    await renderEditor({ onChange });
    await user.click(screen.getByRole("combobox", { name: `${ns}.collectionLabel` }));
    await user.click(await screen.findByText("Health"));
    expect(onChange).toHaveBeenCalledWith({
      ...link,
      target: { kind: "collection", collectionId: "COLL0002" },
    });
  });

  it("names every collection from the library, with its source and record count", async () => {
    const user = userEvent.setup();
    await renderEditor({});
    await user.click(screen.getByRole("combobox", { name: `${ns}.collectionLabel` }));
    const table = screen.getByRole("table", { name: `${ns}.collectionPicker.title` });
    // The database name leads, even for the one the owner renamed, and the
    // site title is shown beside it.
    expect(await within(table).findByText("Climate change")).toBeInTheDocument();
    expect(within(table).getByText(new RegExp(SITE_TITLE))).toBeInTheDocument();
    expect(within(table).getByText("Health")).toBeInTheDocument();
    expect(within(table).getAllByText("zotero-42")).toHaveLength(2);
    expect(within(table).getByText("12")).toBeInTheDocument();
    expect(within(table).getByText("3")).toBeInTheDocument();
    expect(mocks.resolveCollections).toHaveBeenCalledWith({
      libraryId,
      ids: ["COLL0001", "COLL0002"],
    });
  });

  it("shows the chosen collection on the button and searches the list", async () => {
    const user = userEvent.setup();
    await renderEditor({
      link: { ...link, target: { kind: "collection", collectionId: "COLL0001" } },
    });
    const trigger = screen.getByRole("combobox", { name: `${ns}.collectionLabel` });
    expect(trigger).toHaveTextContent("Climate change");
    await user.click(trigger);
    await user.type(
      await screen.findByRole("textbox", { name: `${ns}.collectionPicker.search` }),
      "heal",
    );
    const table = screen.getByRole("table", { name: `${ns}.collectionPicker.title` });
    expect(await within(table).findByText("Health")).toBeInTheDocument();
    expect(within(table).queryByText("Climate change")).not.toBeInTheDocument();
  });

  it("pages a long list of collections", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `COLL${index}`,
      title: `Collection ${index}`,
    }));
    await renderEditor({ collections: many });
    await user.click(screen.getByRole("combobox", { name: `${ns}.collectionLabel` }));
    expect(await screen.findByText("Collection 0")).toBeInTheDocument();
    expect(screen.queryByText("Collection 55")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${pickerNs}.loadMore` }));
    expect(await screen.findByText("Collection 55")).toBeInTheDocument();
  });

  it("cannot be opened when no collection is shown on the site", async () => {
    await renderEditor({ collections: [] });
    expect(screen.getByRole("combobox", { name: `${ns}.collectionLabel` })).toBeDisabled();
    expect(screen.getByText(`${ns}.noCollections`)).toBeInTheDocument();
  });
});
