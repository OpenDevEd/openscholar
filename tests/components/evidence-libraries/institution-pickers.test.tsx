/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({ listInstitutions: vi.fn() }));

vi.mock("convex/react", () => ({ useAction: () => mocks.listInstitutions }));
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));
vi.mock("@/convex/_generated/api", () => ({
  api: { zotero: { runtimeReadActions: { listInstitutions: "listInstitutions" } } },
}));

import {
  FeaturedInstitutionPicker,
  InstitutionNamePicker,
} from "@/components/evidence-libraries/configuration/sections/institution-pickers";

const libraryId = "library_1" as Id<"evidenceLibraries">;
const ns = "evidenceLibraryInstitutions.picker";
const pickerNs = "evidenceLibraryConfiguration.picker";

/** One page as the library's reads answer it. */
const pageOf = <Item,>(page: Item[], next: string | null = null) => ({ page, isDone: next === null, continueCursor: next ?? "" });

describe("institution pickers", () => {
  beforeEach(() => {
    mocks.listInstitutions.mockReset();
  });

  it("reads nothing until the dialog opens, then picks a name from the records", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockResolvedValue(pageOf(
      [
        { name: "University of Nairobi", count: 4 },
        { name: "Makerere University", count: 2 },
      ],
    ));
    const onChange = vi.fn();
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={onChange} />);
    expect(mocks.listInstitutions).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Makerere University"));
    expect(onChange).toHaveBeenCalledWith("Makerere University");
    expect(mocks.listInstitutions).toHaveBeenCalledWith({
      libraryId,
      query: undefined,
      paginationOpts: { cursor: null, numItems: 50 },
      sort: "count",
      direction: "desc",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends the typed text and the next page to the library", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockImplementation(
      async ({ query, paginationOpts: { cursor } }: { query?: string; paginationOpts: { cursor: string | null } }) => {
        if (query) return pageOf([{ name: "Strathmore University", count: 1 }]);
        if (cursor) return pageOf([{ name: "Makerere University", count: 2 }]);
        return pageOf([{ name: "University of Nairobi", count: 4 }], "page-2");
      },
    );
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("University of Nairobi")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${pickerNs}.loadMore` }));
    expect(await screen.findByText("Makerere University")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: `${ns}.search` }), "strath");
    expect(await screen.findByText("Strathmore University")).toBeInTheDocument();
    expect(mocks.listInstitutions).toHaveBeenLastCalledWith({
      libraryId,
      query: "strath",
      paginationOpts: { cursor: null, numItems: 50 },
      sort: "count",
      direction: "desc",
    });
  });

  it("offers a typed name for an institution row only when the page has no match", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockImplementation(async ({ query }: { query?: string }) => (pageOf(
      query ? [] : [{ name: "University of Nairobi", count: 4 }],
    )));
    const onChange = vi.fn();
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("University of Nairobi")).toBeInTheDocument();
    expect(screen.queryByText(`${ns}.useTyped {"name":"Strathmore"}`)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: `${ns}.search` }), "Strathmore");
    await user.click(await screen.findByText(`${ns}.useTyped {"name":"Strathmore"}`));
    expect(onChange).toHaveBeenCalledWith("Strathmore");
  });

  it("orders by name, then turns that order around", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockResolvedValue(pageOf(
      [{ name: "University of Nairobi", count: 4 }],
    ));
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={vi.fn()} />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("University of Nairobi")).toBeInTheDocument();
    // Records lead the list, most first, until another header is chosen.
    expect(screen.getByRole("columnheader", { name: `${ns}.colRecords` })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    await user.click(screen.getByRole("button", { name: `${ns}.colName` }));
    await waitFor(() =>
      expect(mocks.listInstitutions).toHaveBeenLastCalledWith({
        libraryId,
        query: undefined,
        paginationOpts: { cursor: null, numItems: 50 },
        sort: "name",
        direction: "asc",
      }),
    );
    expect(screen.getByRole("columnheader", { name: `${ns}.colName` })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await user.click(screen.getByRole("button", { name: `${ns}.colName` }));
    await waitFor(() =>
      expect(mocks.listInstitutions).toHaveBeenLastCalledWith({
        libraryId,
        query: undefined,
        paginationOpts: { cursor: null, numItems: 50 },
        sort: "name",
        direction: "desc",
      }),
    );
    expect(screen.getByRole("columnheader", { name: `${ns}.colName` })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("explains a draft library has no names yet and lets the featured value be cleared", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockResolvedValue({ reason: "not-set-up", ...pageOf([]) });
    const onChange = vi.fn();
    render(<FeaturedInstitutionPicker libraryId={libraryId} value="Old" onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Old");
    await user.click(trigger);
    expect(await screen.findByText(`${ns}.notSetUp`)).toBeInTheDocument();
    await user.keyboard("{Escape}");

    mocks.listInstitutions.mockResolvedValue(pageOf(
      [{ name: "University of Nairobi", count: 4 }],
    ));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText(`${ns}.none`));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
