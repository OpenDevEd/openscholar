/**
 * @vitest-environment jsdom
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it } from "vitest";
import {
  draftResult,
  fillField,
  harness,
  identityCard,
  mutationMock,
  queryMock,
  refuseNextSave,
  renderWorkspace,
  resetWorkspace,
  toastMock,
} from "./harness";

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    ({ saved, activated } = resetWorkspace());
  });

  it("shows a refused save inside the section that owns the value", async () => {
    const user = userEvent.setup();
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async () => {
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "/identity/name: This name is already taken.",
            pointer: "/identity/name",
          });
        };
      }
      return async () => null;
    });
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));

    const refusal = await waitFor(() => identityCard().getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefused");
    expect(refusal).toHaveTextContent("This name is already taken.");
    expect(refusal).not.toHaveTextContent("/identity/name");
    expect(toastMock.error).toHaveBeenCalledWith("This name is already taken.");
  });

  it("clears a refused save once the next save works", async () => {
    const user = userEvent.setup();
    let refuse = true;
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async (input: unknown) => {
          if (refuse) {
            throw new ConvexError({
              code: "VALIDATION_ERROR",
              message: "/identity/name: This name is already taken.",
              pointer: "/identity/name",
            });
          }
          saved.push(input);
          return { editVersion: 5 };
        };
      }
      return async () => null;
    });
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    refuse = false;
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a refused activation on screen after the save that came first", async () => {
    const user = userEvent.setup();
    // Activate saves first. That save raises the edit version, which restarts
    // the form from the newer rows. The refusal that follows must survive it.
    let editVersion = 4;
    let releaseActivate = () => {};
    const activateReached = new Promise<void>((resolve) => {
      releaseActivate = resolve;
    });
    queryMock.mockImplementation(() => draftResult({ editVersion }));
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async (input: unknown) => {
          saved.push(input);
          editVersion = 5;
          return { editVersion: 5 };
        };
      }
      if (reference === "activateConfiguration") {
        return async () => {
          await activateReached;
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "/identity/name: This name is already taken.",
            pointer: "/identity/name",
          });
        };
      }
      return async () => null;
    });
    const { reread } = await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "activate" }));
    await user.click(screen.getByRole("button", { name: "activateConfirm" }));
    await waitFor(() => expect(saved).toHaveLength(1));

    // The platform now has the newer draft, so the form starts again.
    await reread();
    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue(
      "Saved Library",
    );

    releaseActivate();
    const refusal = await waitFor(() => identityCard().getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefused");
    expect(refusal).toHaveTextContent("This name is already taken.");
  });

  it.each([
    ["update", true],
    ["current", false],
  ] as const)("says when activating also updates the library software: %s", async (answer, mentioned) => {
    const user = userEvent.setup();
    harness.publishRuntimeAnswer = answer;
    await renderWorkspace();
    await user.type(identityCard().getByLabelText("identity.nameLabel"), " 2");
    await user.click(screen.getByRole("button", { name: "activate" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("activateBody");
    if (mentioned) expect(dialog).toHaveTextContent("activateBodySoftware");
    else expect(dialog).not.toHaveTextContent("activateBodySoftware");
  });

  it("shows a refusal that belongs to no card above the sections", async () => {
    const user = userEvent.setup();
    mutationMock.mockImplementation((reference: unknown) => {
      if (reference === "saveDraftSections") {
        return async () => {
          throw new ConvexError({
            code: "VALIDATION_ERROR",
            message: "The library was changed somewhere else. Reload the page.",
          });
        };
      }
      return async () => null;
    });
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));

    const refusal = await waitFor(() => screen.getByRole("alert"));
    expect(refusal).toHaveTextContent("saveRefusedAll");
    expect(refusal).toHaveTextContent(
      "The library was changed somewhere else. Reload the page.",
    );
    expect(document.getElementById("sec-identity")).not.toContainElement(refusal);
  });

  it("clears a refused save when the owner opens another section", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(screen.getByRole("link", { name: /sections\.theme/ }));

    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a refused save when the owner uses Back to top", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(screen.getByRole("button", { name: "backToTop" }));

    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a refused save when the owner edits or resets the card", async () => {
    const user = userEvent.setup();
    await refuseNextSave();
    await renderWorkspace();

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await user.type(name, "Renamed Library");
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.type(identityCard().getByLabelText("identity.nameLabel"), "!");
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => identityCard().getByRole("alert"));

    await user.click(identityCard().getByRole("button", { name: "fields.reset" }));
    expect(identityCard().queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets a section back to the saved values", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");
    expect(identityCard().getByText("sectionState.edited")).toBeInTheDocument();

    await user.click(identityCard().getByRole("button", { name: "fields.reset" }));

    expect(identityCard().getByLabelText("identity.nameLabel")).toHaveValue("Saved Library");
    expect(identityCard().getByText("sectionState.complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
    expect(screen.queryByText("unsaved")).not.toBeInTheDocument();
  });
});
