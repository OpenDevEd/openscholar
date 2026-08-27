/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkAddress: vi.fn(),
  organization: vi.fn(),
  push: vi.fn(),
  reserveAddress: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useOrganization: () => mocks.organization() }));
vi.mock("convex/react", () => ({
  useAction: (name: string) =>
    name === "checkAddress" ? mocks.checkAddress : mocks.reserveAddress,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      addressActions: {
        checkAddress: "checkAddress",
        reserveAddress: "reserveAddress",
      },
    },
  },
}));
vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant, title }: { variant: string; title?: string }) => (
    <p>{title ?? variant}</p>
  ),
}));

import { NewLibraryForm } from "@/components/evidence-libraries/new-library-form";

const owner = {
  isLoaded: true,
  membership: { role: "org:admin" },
  organization: { id: "org_1", name: "Climate Team" },
};

describe("<NewLibraryForm>", () => {
  beforeEach(() => {
    mocks.checkAddress.mockReset();
    mocks.checkAddress.mockResolvedValue({
      status: "available",
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence",
      publicAddress: "https://climate-evidence-lib.example.test",
    });
    mocks.organization.mockReset();
    mocks.push.mockReset();
    mocks.reserveAddress.mockReset();
  });

  it("shows Checking…, then the address the server found, and reserves it", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockResolvedValue({
      status: "reserved",
      libraryId: "lib_1",
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence",
      publicAddress: "https://climate-evidence-lib.example.test",
    });

    render(<NewLibraryForm />);

    expect(screen.getByRole("button", { name: "continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "reserve" })).toBeDisabled();

    const shortNameField = screen.getByRole("textbox", { name: "shortNameLabel" });
    const addressField = screen.getByRole("textbox", { name: "addressLabel" });
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    // The short name follows the typing; the address waits for the server.
    expect(shortNameField).toHaveTextContent("Climate Evidence");
    expect(addressField).toHaveTextContent("checkingAddress");
    expect(screen.getByRole("button", { name: "reserve" })).toBeDisabled();

    await waitFor(() =>
      expect(mocks.checkAddress).toHaveBeenCalledWith({ name: "Climate Evidence" }),
    );
    // One answer for one pause in the typing.
    expect(mocks.checkAddress).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(addressField).toHaveTextContent("climate-evidence-lib.example.test"),
    );

    await user.click(screen.getByRole("button", { name: "reserve" }));
    await waitFor(() =>
      expect(mocks.reserveAddress).toHaveBeenCalledWith({ name: "Climate Evidence" }),
    );
    expect(await screen.findByRole("status")).toHaveAttribute("data-address-state", "reserved");
    expect(addressField).toHaveTextContent("climate-evidence-lib.example.test");
    expect(screen.getByRole("textbox", { name: "nameLabel" })).toHaveAttribute("aria-readonly", "true");
    expect(screen.queryByRole("button", { name: "reserve" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "continue" }));
    expect(mocks.push).toHaveBeenCalledWith("/evidence-libraries/lib_1/configuration");
  });

  it("shows the numbered address the server chose, not the one the name suggests", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.checkAddress.mockResolvedValue({
      status: "available",
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence-2",
      publicAddress: "https://climate-evidence-2-lib.example.test",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveTextContent(
        "climate-evidence-2-lib.example.test",
      ),
    );
  });

  it("points at the library that already has the name and reserves nothing", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.checkAddress.mockResolvedValue({
      status: "name-taken",
      libraryId: "lib_existing",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("nameTaken");
    expect(screen.getByRole("link", { name: "openExisting" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_existing/configuration",
    );
    expect(screen.getByRole("button", { name: "reserve" })).toBeDisabled();
    // A name is typed, so the box shows a dash, not the "type a name" hint.
    const addressField = screen.getByRole("textbox", { name: "addressLabel" });
    expect(addressField).toHaveTextContent("—");
    expect(addressField).not.toHaveTextContent("addressPending");
    expect(mocks.reserveAddress).not.toHaveBeenCalled();
  });

  it("offers Try again when the address could not be checked", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.checkAddress.mockResolvedValueOnce({
      status: "unavailable",
      reason: "check-failed",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");

    expect(await screen.findByRole("alert")).toHaveTextContent("checkFailed");
    expect(screen.queryByRole("button", { name: "reserve" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "tryAgain" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveTextContent(
        "climate-evidence-lib.example.test",
      ),
    );
    expect(screen.getByRole("button", { name: "reserve" })).toBeEnabled();
  });

  it("says when no address is free for the name", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.checkAddress.mockResolvedValue({
      status: "unavailable",
      reason: "no-address",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");

    expect(await screen.findByRole("alert")).toHaveTextContent("noAddress");
  });

  it("keeps the form when the reservation itself fails", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockRejectedValue(new Error("offline"));

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "reserve" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "reserve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("checkFailed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });


  it("says so when someone else took the address just now", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockResolvedValue({ status: "address-taken" });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "reserve" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "reserve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("addressTaken");
    expect(screen.getByRole("button", { name: "tryAgain" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a long address readable on hover", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveAttribute(
        "title",
        "climate-evidence-lib.example.test",
      ),
    );
  });

  it("does not offer the form to an editor", () => {
    mocks.organization.mockReturnValue({ ...owner, membership: { role: "org:member" } });

    render(<NewLibraryForm />);

    expect(screen.getByText("ownerOnlyTitle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "reserve" })).not.toBeInTheDocument();
  });
});
