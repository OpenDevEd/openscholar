/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
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

describe("institution pickers", () => {
  beforeEach(() => {
    mocks.listInstitutions.mockReset();
    // cmdk needs these in jsdom.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("lists names from records and picks one", async () => {
    mocks.listInstitutions.mockResolvedValue({
      items: [{ name: "University of Nairobi", count: 4 }, { name: "Makerere University", count: 2 }],
    });
    const onChange = vi.fn();
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /Makerere University/ }));
    expect(onChange).toHaveBeenCalledWith("Makerere University");
    expect(mocks.listInstitutions).toHaveBeenCalledWith({ libraryId });
  });

  it("lets the owner type a new name for an institution row", async () => {
    mocks.listInstitutions.mockResolvedValue({ items: [{ name: "University of Nairobi", count: 4 }] });
    const onChange = vi.fn();
    render(<InstitutionNamePicker libraryId={libraryId} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(await screen.findByPlaceholderText("evidenceLibraryInstitutions.picker.search"), "Strathmore");
    await userEvent.click(await screen.findByRole("option", { name: /Strathmore/ }));
    expect(onChange).toHaveBeenCalledWith("Strathmore");
  });

  it("explains a draft library has no names yet and lets the featured value be cleared", async () => {
    mocks.listInstitutions.mockResolvedValue({ reason: "not-set-up", items: [] });
    const onChange = vi.fn();
    render(<FeaturedInstitutionPicker libraryId={libraryId} value="Old" onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Old");
    await userEvent.click(trigger);
    expect(await screen.findByText("evidenceLibraryInstitutions.picker.notSetUp")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "evidenceLibraryInstitutions.picker.none" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
