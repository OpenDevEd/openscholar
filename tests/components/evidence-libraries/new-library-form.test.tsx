/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSetupDraft: vi.fn(),
  organization: vi.fn(),
  push: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useOrganization: () => mocks.organization() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.createSetupDraft }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      mutations: { createSetupDraft: "createSetupDraft" },
      queries: {
        previewSetupIdentity: "previewSetupIdentity",
        readSetupPlatformDomain: "readSetupPlatformDomain",
      },
    },
  },
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) => mocks.query(query, args),
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
    mocks.createSetupDraft.mockReset();
    mocks.organization.mockReset();
    mocks.push.mockReset();
    mocks.query.mockReset();
    mocks.query.mockImplementation((query, args) => {
      if (query === "readSetupPlatformDomain") {
        return { data: args === "skip" ? undefined : "example.test", isReady: true };
      }
      return args === "skip"
        ? { data: undefined, isReady: true }
        : {
            data: {
              name: args.name,
              shortName: args.name,
              slug: "climate-evidence",
              publicAddress: "https://climate-evidence-lib.example.test",
            },
            isReady: true,
          };
    });
  });

  it("previews the address for the typed name, reserves it, then continues to the configuration", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.createSetupDraft.mockResolvedValue({
      libraryId: "lib_1",
      name: "Climate Evidence",
      shortName: "Climate Evidence",
      slug: "climate-evidence",
      publicAddress: "https://climate-evidence-lib.example.test",
    });

    render(<NewLibraryForm />);

    expect(screen.getByRole("button", { name: "continue" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "reserve" })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveTextContent(
      "climate-evidence-lib.example.test",
    );
    // The availability check waits for typing to pause.
    await waitFor(() =>
      expect(mocks.query).toHaveBeenLastCalledWith("previewSetupIdentity", {
        name: "Climate Evidence",
      }),
    );

    await user.click(screen.getByRole("button", { name: "reserve" }));
    await waitFor(() =>
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({ name: "Climate Evidence" }),
    );
    expect(await screen.findByRole("status")).toHaveAttribute("data-address-state", "reserved");
    expect(screen.getByRole("textbox", { name: "nameLabel" })).toHaveAttribute("aria-readonly", "true");
    expect(screen.queryByRole("button", { name: "reserve" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "continue" }));
    expect(mocks.push).toHaveBeenCalledWith("/evidence-libraries/lib_1/configuration");
  });

  it("shows the short name and address from the typed name and keeps them while the availability check loads", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    // The availability query never answers, like Convex between keystrokes.
    mocks.query.mockImplementation((query, args) => {
      if (query === "readSetupPlatformDomain") {
        return { data: args === "skip" ? undefined : "example.test", isReady: true };
      }
      return { data: undefined, isReady: false };
    });

    render(<NewLibraryForm />);
    const shortNameField = screen.getByRole("textbox", { name: "shortNameLabel" });
    const addressField = screen.getByRole("textbox", { name: "addressLabel" });
    expect(shortNameField).toHaveTextContent("addressPending");
    expect(addressField).toHaveTextContent("addressPending");

    const nameInput = screen.getByRole("textbox", { name: "nameLabel" });
    for (const [index, character] of Array.from("Climate Evidence").entries()) {
      await user.type(nameInput, character);
      const typed = "Climate Evidence".slice(0, index + 1).trim();
      expect(shortNameField).toHaveTextContent(typed);
      expect(shortNameField).not.toHaveTextContent("addressPending");
      expect(addressField).not.toHaveTextContent("addressPending");
    }
    expect(addressField).toHaveTextContent("climate-evidence-lib.example.test");
    // The same box stays mounted the whole time; only its text changes.
    expect(screen.getByRole("textbox", { name: "shortNameLabel" })).toBe(shortNameField);
    expect(screen.getByRole("textbox", { name: "addressLabel" })).toBe(addressField);

    await user.clear(nameInput);
    expect(shortNameField).toHaveTextContent("addressPending");
    expect(addressField).toHaveTextContent("addressPending");
  });

  it("uses the server address when the name is already taken", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.query.mockImplementation((query, args) => {
      if (query === "readSetupPlatformDomain") {
        return { data: "example.test", isReady: true };
      }
      if (args === "skip") return { data: undefined, isReady: true };
      return {
        data: {
          name: args.name,
          shortName: args.name,
          slug: "climate-evidence-2",
          publicAddress: "https://climate-evidence-2-lib.example.test",
        },
        isReady: true,
      };
    });

    render(<NewLibraryForm />);
    await user.type(screen.getByRole("textbox", { name: "nameLabel" }), "Climate Evidence");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveTextContent(
        "climate-evidence-2-lib.example.test",
      ),
    );
  });

  it("keeps the form after a failed reservation so the owner can retry", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(owner);
    mocks.createSetupDraft.mockRejectedValue(new Error("offline"));

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
