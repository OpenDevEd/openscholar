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
  mutationMock,
  pushMock,
  queryMock,
  renderWorkspace,
  resetWorkspace,
  savedIdentity,
} from "./harness";

describe("<ConfigurationWorkspace>", () => {
  let saved: unknown[];
  let activated: unknown[];

  beforeEach(() => {
    ({ saved, activated } = resetWorkspace());
  });

  it("keeps the short name and public address read-only", async () => {
    await renderWorkspace();
    const shortName = identityCard().getByRole("textbox", { name: "identity.shortNameLabel" });
    const address = identityCard().getByRole("textbox", { name: "identity.addressLabel" });
    expect(shortName).toHaveAttribute("aria-readonly", "true");
    expect(shortName).toHaveTextContent("saved-library");
    expect(address).toHaveAttribute("aria-readonly", "true");
    expect(address).toHaveTextContent(savedIdentity.baseUrl);
  });

  it("saves unsaved changes first, then activates with the new edit version", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    const name = identityCard().getByLabelText("identity.nameLabel");
    await user.clear(name);
    await fillField(user, name, "Renamed Library");

    await user.click(screen.getByRole("button", { name: "activate" }));
    await user.click(screen.getByRole("button", { name: "activateConfirm" }));

    await waitFor(() =>
      expect(activated).toEqual([{ libraryId: "library_123", expectedEditVersion: 5 }]),
    );
    expect(saved).toHaveLength(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("checks the software before publishing, and publishes even when the check fails", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    harness.checkAction = async () => {
      order.push("check");
      throw new Error("GitHub cannot be reached");
    };
    mutationMock.mockImplementation((reference: unknown) =>
      reference === "activateConfiguration"
        ? async () => {
            order.push("activate");
            return { editVersion: 6, kind: "publish", revisionKey: "r2", status: "queued" };
          }
        : async () => ({ editVersion: 5 }),
    );
    await renderWorkspace();
    await fillField(user, identityCard().getByLabelText("identity.nameLabel"), " again");
    order.length = 0;

    await user.click(screen.getByRole("button", { name: "activate" }));
    await user.click(screen.getByRole("button", { name: "activateConfirm" }));

    await waitFor(() => expect(order).toEqual(["check", "activate"]));
  });

  it("sends a new library to the setup page after activation", async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(draftResult({ state: "provisioning" }));
    mutationMock.mockImplementation((reference: unknown) =>
      reference === "activateConfiguration"
        ? async () => ({ editVersion: 5, kind: "setup", revisionKey: "r1", status: "queued" })
        : async () => ({ editVersion: 5 }),
    );
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "setUpAndActivate" }));
    await user.click(screen.getByRole("button", { name: "activateDraftConfirm" }));

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith("/evidence-libraries/library_123/setup"),
    );
  });

  it("lists assembly issues from the failed operation with a link to the section", async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_1",
          kind: "publish",
          status: "failed",
          stage: "assembling",
          retryable: false,
          error: { code: "VALIDATION_ERROR", message: "The configuration is not valid", stage: "assembling" },
          issues: [
            { pointer: "/theme/colors/accent", message: "Value must match the pattern." },
            { pointer: "/identity/name", message: "Value must match the pattern." },
            { pointer: "/localization/locales", message: "Choose at least one language." },
          ],
        },
      }),
    );
    await renderWorkspace();

    const notice = screen.getByText("operationFailed").closest("[data-operation-issues]")!;
    expect(notice).toHaveTextContent("The configuration is not valid");
    expect(within(notice as HTMLElement).getByText("/localization/locales")).toBeInTheDocument();
    expect(notice).toHaveTextContent("Choose at least one language.");
    expect(
      within(notice as HTMLElement).getAllByText("Value must match the pattern."),
    ).toHaveLength(2);
    const link = within(notice as HTMLElement).getByRole("link", { name: "/theme/colors/accent" });
    expect(link).toHaveAttribute("href", "#sec-theme");
    await user.click(link);
    expect(screen.getByRole("link", { name: /sections\.theme/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("does not show Retry for a failed operation the server marked non-retryable", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_old",
          kind: "publish",
          status: "failed",
          stage: "publishing",
          retryable: false,
          error: {
            code: "CONFIGURATION_DEPLOYMENT_STALLED",
            message: "The publish stopped answering. Try again.",
            stage: "publishing",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(
      within(notice as HTMLElement).queryByRole("button", { name: "retry" }),
    ).toBeNull();
  });

  it("does not name the hosting provider in a failed activation", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_hosting",
          kind: "publish",
          status: "failed",
          stage: "deployment",
          retryable: true,
          error: {
            code: "INVALID_COOLIFY_CONFIG",
            message: "EL_COOLIFY_URL is not configured",
            stage: "deployment",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(notice).toHaveTextContent("activationError");
    expect(notice).not.toHaveTextContent(/Coolify/i);
  });

  it("shows Retry for a failed operation the server marked retryable", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_current",
          kind: "publish",
          status: "failed",
          stage: "publishing",
          retryable: true,
          error: {
            code: "CONFIGURATION_DEPLOYMENT_STALLED",
            message: "The publish stopped answering. Try again.",
            stage: "publishing",
          },
        },
      }),
    );
    await renderWorkspace();

    const notice = screen
      .getByText("operationFailed")
      .closest("[data-operation-issues]")!;
    expect(
      within(notice as HTMLElement).getByRole("button", { name: "retry" }),
    ).toBeInTheDocument();
  });

  it("lets a new library be set up while its setup operation waits for the owner", async () => {
    queryMock.mockReturnValue(
      draftResult({
        state: "provisioning",
        operation: { _id: "operation_1", kind: "setup", status: "queued", stage: "queued" },
      }),
    );
    await renderWorkspace();
    expect(document.querySelector("[data-operation-stage]")).toBeNull();
    expect(screen.getByRole("button", { name: "setUpAndActivate" })).toBeEnabled();
  });

  it("shows the running stage and blocks Activate while an operation runs", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: { _id: "operation_1", kind: "publish", status: "running", stage: "deployment" },
      }),
    );
    await renderWorkspace();
    const activate = screen.getByRole("button", {
      name: /applying · stages\.deployment/,
    });
    expect(activate).toBeDisabled();
    expect(within(activate).getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "applying · stages.deployment" }),
    ).toHaveAttribute("data-operation-stage", "deployment");
  });

  it("names the software update while it runs and blocks Activate", async () => {
    queryMock.mockReturnValue(
      draftResult({
        operation: {
          _id: "operation_123",
          kind: "publish",
          status: "running",
          stage: "deployment",
          revisionId: "revision_123",
          runtimeUpdate: { from: "aaaaaaa1234", to: "bbbbbbb1234" },
        },
      }),
    );
    await renderWorkspace();
    const activate = screen.getByRole("button", {
      name: /updatingSoftware · stages\.deployment/,
    });
    expect(activate).toBeDisabled();
    expect(within(activate).getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "updatingSoftware · stages.deployment",
      }),
    ).toHaveAttribute("data-operation-stage", "deployment");
    expect(screen.getByRole("link", { name: "sections.versions" })).toHaveAttribute(
      "href",
      "#sec-versions",
    );
  });

  it("requires the exact library name before queuing development teardown", async () => {
    const user = userEvent.setup();
    const teardowns: unknown[] = [];
    mutationMock.mockImplementation((reference: unknown) =>
      reference === "requestDevelopmentTeardown"
        ? async (input: unknown) => {
            teardowns.push(input);
            return { operationId: "operation_123", status: "queued" };
          }
        : async () => ({}),
    );
    await renderWorkspace();

    await user.click(screen.getByRole("button", { name: "danger.deleteButton" }));
    const confirm = screen.getByRole("button", { name: "deleteDialog.confirm" });
    expect(confirm).toBeDisabled();
    await fillField(user, screen.getByLabelText("deleteDialog.typeToConfirm"), "Saved Library");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(teardowns).toEqual([{ libraryId: "library_123", confirmationName: "Saved Library" }]),
    );
    expect(pushMock).toHaveBeenCalledWith("/evidence-libraries");
  });
});
