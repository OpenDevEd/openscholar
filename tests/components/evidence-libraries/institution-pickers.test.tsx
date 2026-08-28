/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
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
  api: { zotero: { runtimeReadActions: { listRecordInstitutions: "listRecordInstitutions" } } },
}));

import {
  FeaturedInstitutionPicker,
  InstitutionNamePicker,
} from "@/components/evidence-libraries/configuration/sections/institution-pickers";

const libraryId = "library_1" as Id<"evidenceLibraries">;
const ns = "evidenceLibraryInstitutions.picker";
const pickerNs = "evidenceLibraryConfiguration.picker";

describe("institution pickers", () => {
  beforeEach(() => {
    mocks.listInstitutions.mockReset();
  });

  it("reads nothing until the dialog opens, then picks a name from the records", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockResolvedValue({
      items: [
        { name: "University of Nairobi", count: 4 },
        { name: "Makerere University", count: 2 },
      ],
      nextCursor: null,
    });
    const onChange = vi.fn();
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={onChange} />);
    expect(mocks.listInstitutions).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Makerere University"));
    expect(onChange).toHaveBeenCalledWith("Makerere University");
    expect(mocks.listInstitutions).toHaveBeenCalledWith({
      libraryId,
      query: undefined,
      cursor: undefined,
      sort: "count",
      direction: "desc",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends the typed text and the next page to the library", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockImplementation(
      async ({ query, cursor }: { query?: string; cursor?: string }) => {
        if (query) return { items: [{ name: "Strathmore University", count: 1 }], nextCursor: null };
        if (cursor) return { items: [{ name: "Makerere University", count: 2 }], nextCursor: null };
        return { items: [{ name: "University of Nairobi", count: 4 }], nextCursor: "page-2" };
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
      cursor: undefined,
      sort: "count",
      direction: "desc",
    });
  });

  it("offers a typed name for an institution row only when the page has no match", async () => {
    const user = userEvent.setup();
    mocks.listInstitutions.mockImplementation(async ({ query }: { query?: string }) => ({
      items: query ? [] : [{ name: "University of Nairobi", count: 4 }],
      nextCursor: null,
    }));
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
    mocks.listInstitutions.mockResolvedValue({
      items: [{ name: "University of Nairobi", count: 4 }],
      nextCursor: null,
    });
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
        cursor: undefined,
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
        cursor: undefined,
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
    mocks.listInstitutions.mockResolvedValue({ reason: "not-set-up", items: [], nextCursor: null });
    const onChange = vi.fn();
    render(<FeaturedInstitutionPicker libraryId={libraryId} value="Old" onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Old");
    await user.click(trigger);
    expect(await screen.findByText(`${ns}.notSetUp`)).toBeInTheDocument();
    await user.keyboard("{Escape}");

    mocks.listInstitutions.mockResolvedValue({
      items: [{ name: "University of Nairobi", count: 4 }],
      nextCursor: null,
    });
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText(`${ns}.none`));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
