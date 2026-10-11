/**
 * @vitest-environment jsdom
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  draftResult,
  fillField,
  identityCard,
  mutationMock,
  queryMock,
  renderWorkspace,
  resetWorkspace,
  savedIdentity,
  savedRows,
} from "./harness";

const rowsWith = (sectionKey: string, payload: unknown) =>
  savedRows.map((row) => (row.sectionKey === sectionKey ? { sectionKey, payload } : row));
const footerCard = () => within(document.getElementById("sec-footer")!);

describe("<ConfigurationWorkspace> when the draft is saved somewhere else", () => {
  beforeEach(() => {
    resetWorkspace();
  });

  it("keeps the section being edited and takes the saved values for the others", async () => {
    const user = userEvent.setup();
    const { reread } = await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "My name");

    // Another tab saves the footer.
    queryMock.mockReturnValue(draftResult({ editVersion: 5, sections: rowsWith("footer", { disclaimer: "Saved in the other tab" }) }));
    await reread();

    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("My name");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(footerCard().getByDisplayValue("Saved in the other tab")).toBeInTheDocument();
    expect(identityCard().queryByRole("status")).not.toBeInTheDocument();
  });

  it("says so in a section that was changed here and saved there, until it is reset", async () => {
    const user = userEvent.setup();
    const { reread } = await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "My name");

    queryMock.mockReturnValue(draftResult({ editVersion: 5, sections: rowsWith("identity", { ...savedIdentity, name: "Their name" }) }));
    await reread();

    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("My name");
    expect(identityCard().getByRole("status")).toHaveTextContent("savedElsewhere");

    await user.click(identityCard().getByRole("button", { name: "fields.reset" }));
    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("Their name");
    expect(identityCard().queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps what is typed between a save's answer and the rows that follow it", async () => {
    const user = userEvent.setup();
    const { reread } = await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "My name");
    // The save is answered, and the page still holds the rows from before it.
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "save" })).toBeEnabled());
    const disclaimer = footerCard().getByRole("textbox", { name: /disclaimer/ });
    await fillField(user, disclaimer, "Typed since");

    queryMock.mockReturnValue(draftResult({ editVersion: 5, sections: rowsWith("identity", { ...savedIdentity, name: "My name" }) }));
    await reread();

    expect(footerCard().getByDisplayValue("Typed since")).toBeInTheDocument();
    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("My name");
    expect(document.getElementById("sec-identity")).toHaveAttribute("data-section-state", "complete");
    expect(document.querySelector("[data-saved-elsewhere]")).not.toBeInTheDocument();
  });

  it("takes this page's own save without a word, whatever the platform made of it", async () => {
    const user = userEvent.setup();
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async () => {
          // The platform stores the name its own way.
          queryMock.mockReturnValue(draftResult({ editVersion: 5, sections: rowsWith("identity", { ...savedIdentity, name: "My Name" }) }));
          return { editVersion: 5 };
        };
      }
      return async () => null;
    });
    const { reread } = await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "my name");
    await user.click(screen.getByRole("button", { name: "save" }));
    await reread();

    await waitFor(() => expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("My Name"));
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
    expect(identityCard().queryByRole("status")).not.toBeInTheDocument();
  });
});
