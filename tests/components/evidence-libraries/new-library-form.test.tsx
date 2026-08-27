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
      queries: { previewSetupIdentity: "previewSetupIdentity" },
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
    mocks.query.mockImplementation((_query, args) =>
      args === "skip"
        ? { data: undefined, isReady: true }
        : {
            data: {
              name: "Climate Evidence",
              shortName: "Climate Evidence",
              slug: "climate-evidence",
              publicAddress: "https://climate-evidence-lib.example.test",
            },
            isReady: true,
          },
    );
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
    expect(mocks.query).toHaveBeenLastCalledWith("previewSetupIdentity", { name: "Climate Evidence" });
    expect(screen.getByRole("textbox", { name: "addressLabel" })).toHaveTextContent(
      "https://climate-evidence-lib.example.test",
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
