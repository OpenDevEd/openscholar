/**
 * @vitest-environment jsdom
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  draftResult,
  fillField,
  harness,
  identityCard,
  queryMock,
  renderWorkspace,
  resetWorkspace,
  savedIdentity,
  savedRows,
  savedTheme,
  toastMock,
} from "./harness";

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    ({ saved, activated } = resetWorkspace());
  });

  it.each([undefined, false, true])("shows manual digest sending only after access is granted: %s", async (available) => {
    harness.manualDigestAvailable = available;
    queryMock.mockReturnValue(draftResult({
      sections: savedRows.map(row => row.sectionKey === "notifications"
        ? { sectionKey: "notifications", payload: { enabled: true } }
        : row),
    }));
    await renderWorkspace();
    const button = screen.queryByRole("button", { name: "Send digest now" });
    if (available === true) expect(button).toBeEnabled();
    else expect(button).toBeNull();
  });

  it("shows the admin link only while an active library is idle", async () => {
    const { unmount } = await renderWorkspace();
    expect(
      screen.getByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toHaveAttribute("href", "https://saved-library.example.test/admin");

    unmount();
    queryMock.mockReturnValue(draftResult({ state: "provisioning" }));
    const draftWorkspace = await renderWorkspace();
    expect(
      screen.queryByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toBeNull();

    draftWorkspace.unmount();
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_123",
          kind: "configuration",
          status: "running",
          stage: "deployment",
          updatedAt: 1,
        },
      }),
    );
    await renderWorkspace();
    expect(
      screen.queryByRole("link", { name: "evidenceLibraries.list.openAdmin" }),
    ).toBeNull();
  });

  it("shows the library's one status word in the header, the running publish in place of Active", async () => {
    const { unmount } = await renderWorkspace();
    expect(screen.getByText("evidenceLibraries.status.active")).toBeInTheDocument();

    unmount();
    queryMock.mockReturnValue(
      draftResult({
        operation: { _id: "operation_123", kind: "configuration", status: "running", stage: "deployment", updatedAt: 1 },
      }),
    );
    await renderWorkspace();
    expect(screen.getByText("evidenceLibraries.operation.applying")).toBeInTheDocument();
    expect(screen.queryByText("evidenceLibraries.status.active")).toBeNull();
  });

  it("puts Domain in the rail beside Versions, with its own card", async () => {
    await renderWorkspace();
    const rail = within(
      screen.getByRole("navigation", { name: "rail.aria" }),
    );
    const domain = rail.getByRole("link", { name: /sections\.domain/ });
    expect(domain).toHaveAttribute("href", "#sec-domain");
    // Domain is not a configuration section, so it carries no saved-state dot.
    expect(within(domain).queryByRole("img")).toBeNull();
    expect(document.getElementById("sec-domain")).toBeInTheDocument();
  });

  it("saves only the sections that changed", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    expect(queryMock).toHaveBeenCalledWith("getDraft", { libraryId: "library_123" });

    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(saved).toEqual([
        {
          libraryId: "library_123",
          expectedEditVersion: 4,
          sections: [
            {
              sectionKey: "identity",
              payload: { ...savedIdentity, name: "Renamed Library" },
            },
          ],
        },
      ]),
    );
  });

  it("writes the navigation bar choice to theme.layout", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("radio", { name: /theme\.layout\.wide/ }));
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    const request = saved[0] as { sections: { sectionKey: string; payload: unknown }[] };
    expect(request.sections.map((row) => row.sectionKey)).toEqual(["theme"]);
    expect(request.sections[0]?.payload).toEqual({ ...savedTheme, layout: "wide" });
  });

  it("restores background and card colours with a preset and saves the complete palette", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const theme = within(document.getElementById("sec-theme")!);
    const sunrise = theme.getByRole("button", { name: "theme.presets.sunrise" });
    expect(sunrise).toHaveAttribute("aria-pressed", "true");
    await user.click(theme.getByRole("button", { name: "theme.advanced" }));

    for (const key of ["backgroundDark", "backgroundLight", "cardDark", "cardLight"]) {
      const field = theme.getByLabelText(`theme.advancedColour.${key}`);
      await user.clear(field);
      await fillField(user, field, "#123456");
    }
    expect(sunrise).toHaveAttribute("aria-pressed", "false");

    const ocean = theme.getByRole("button", { name: "theme.presets.ocean" });
    await user.click(ocean);
    expect(ocean).toHaveAttribute("aria-pressed", "true");
    for (const [key, value] of Object.entries({
      backgroundDark: "#0f0f0f",
      backgroundLight: "#F4F2EE",
      cardDark: "#141414",
      cardLight: "#FFFFFF",
    })) {
      expect(theme.getByLabelText(`theme.advancedColour.${key}`)).toHaveValue(value);
    }
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      libraryId: "library_123",
      expectedEditVersion: 4,
      sections: [{
        sectionKey: "theme",
        payload: {
          ...savedTheme,
          colors: { ...savedTheme.colors, accent: "#2563eb", tertiary: "#1e293b", link: "#1d4ed8" },
        },
      }],
    });
  });

  it("shows Needs attention for a section with a problem and blocks Activate and Save", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.clear(identityCard().getByLabelText("identity.nameLabel"));

    expect(identityCard().getByText("sectionState.attention")).toBeInTheDocument();
    expect(identityCard().getByRole("alert")).toHaveTextContent("identity.nameError");
    expect(screen.getByRole("img", { name: "sectionState.attention" })).toHaveAttribute(
      "data-state",
      "attention",
    );
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "save" }));
    expect(saved).toEqual([]);
    expect(toastMock.error).toHaveBeenCalledWith("fixFirstToast", expect.anything());
  });

  it("enables Activate only for a saved or local change", async () => {
    const user = userEvent.setup();
    const { unmount } = await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeDisabled();

    await user.clear(identityCard().getByLabelText("identity.nameLabel"));
    await fillField(
      user,
      identityCard().getByLabelText("identity.nameLabel"),
      "Renamed Library",
    );
    expect(screen.getByRole("button", { name: "activate" })).toBeEnabled();

    unmount();
    queryMock.mockReturnValue(draftResult({ hasUnpublishedChanges: true }));
    await renderWorkspace();
    expect(screen.getByRole("button", { name: "activate" })).toBeEnabled();
  });
});
