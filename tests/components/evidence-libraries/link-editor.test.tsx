/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LinkDraft } from "@/lib/evidence-libraries/configuration/links";

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

import { LinkEditor } from "@/components/evidence-libraries/configuration/sections/link-editor";

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

const collections = [
  { id: "COLL0001", title: "Climate" },
  { id: "COLL0002", title: "Health" },
];

describe("<LinkEditor> collection target", () => {
  it("opens the picker and writes the chosen collection id", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LinkEditor link={link} collections={collections} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: `${ns}.collectionLabel` }));
    await user.click(await screen.findByText("Health"));
    expect(onChange).toHaveBeenCalledWith({
      ...link,
      target: { kind: "collection", collectionId: "COLL0002" },
    });
  });

  it("shows the chosen collection on the button and searches the list", async () => {
    const user = userEvent.setup();
    render(
      <LinkEditor
        link={{ ...link, target: { kind: "collection", collectionId: "COLL0001" } }}
        collections={collections}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: `${ns}.collectionLabel` });
    expect(trigger).toHaveTextContent("Climate");
    await user.click(trigger);
    await user.type(
      await screen.findByRole("textbox", { name: `${ns}.collectionPicker.search` }),
      "heal",
    );
    const table = screen.getByRole("table", { name: `${ns}.collectionPicker.title` });
    await waitFor(() => expect(within(table).queryByText("Climate")).not.toBeInTheDocument());
    expect(within(table).getByText("Health")).toBeInTheDocument();
  });

  it("pages a long list of collections", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `COLL${index}`,
      title: `Collection ${index}`,
    }));
    render(<LinkEditor link={link} collections={many} onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox", { name: `${ns}.collectionLabel` }));
    expect(await screen.findByText("Collection 0")).toBeInTheDocument();
    expect(screen.queryByText("Collection 55")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${pickerNs}.loadMore` }));
    expect(await screen.findByText("Collection 55")).toBeInTheDocument();
  });

  it("cannot be opened when no collection is shown on the site", () => {
    render(<LinkEditor link={link} collections={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: `${ns}.collectionLabel` })).toBeDisabled();
    expect(screen.getByText(`${ns}.noCollections`)).toBeInTheDocument();
  });
});
