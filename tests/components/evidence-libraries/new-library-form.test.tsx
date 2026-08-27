/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  push: vi.fn(),
  reserveAddress: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useOrganization: () => mocks.organization() }));
vi.mock("convex/react", () => ({ useAction: () => mocks.reserveAddress }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => mocks.toastError(...args),
    success: vi.fn(),
  }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      addressActions: { reserveAddress: "reserveAddress" },
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
    mocks.organization.mockReset();
    mocks.push.mockReset();
    mocks.reserveAddress.mockReset();
    mocks.toastError.mockReset();
  });

  it("shows the address the server reserved, then continues to the configuration", async () => {
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
    expect(addressField).toHaveTextContent("addressPending");

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

  it("reserves nothing when the organisation already has that name", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockResolvedValue({
      status: "name-taken",
      libraryId: "lib_existing",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await user.click(screen.getByRole("button", { name: "reserve" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("nameTaken"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "reserve" })).toBeEnabled();
  });

  it("keeps the form when the address could not be checked", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockResolvedValue({
      status: "unavailable",
      reason: "check-failed",
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await user.click(screen.getByRole("button", { name: "reserve" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("checkFailed"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps the form after a failed reservation so the owner can retry", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.reserveAddress.mockRejectedValue(new Error("offline"));

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await user.click(screen.getByRole("button", { name: "reserve" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "reserve" })).toBeEnabled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not offer the form to an editor", () => {
    mocks.organization.mockReturnValue({ ...owner, membership: { role: "org:member" } });

    render(<NewLibraryForm />);

    expect(screen.getByText("ownerOnlyTitle")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "reserve" })).not.toBeInTheDocument();
  });
});
