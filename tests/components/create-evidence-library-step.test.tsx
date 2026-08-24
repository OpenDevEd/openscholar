/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSetupDraft: vi.fn(),
  push: vi.fn(),
  query: vi.fn(),
  useOrganization: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => mocks.useOrganization(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.createSetupDraft,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      mutations: { createSetupDraft: "createSetupDraft" },
      queries: {
        getCurrentSetupDraft: "getCurrentSetupDraft",
        previewSetupDraftName: "previewSetupDraftName",
      },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    mocks.query(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ title }: { title?: string }) => <section>{title}</section>,
}));

import { CreateEvidenceLibraryStep } from "@/components/evidence-libraries/create-evidence-library-step";

const activeAdminOrganization = {
  isLoaded: true,
  membership: { role: "org:admin" },
  organization: { id: "org_climate", name: "Climate Team" },
};

describe("<CreateEvidenceLibraryStep>", () => {
  beforeEach(() => {
    mocks.createSetupDraft.mockReset();
    mocks.push.mockReset();
    mocks.query.mockReset();
    mocks.useOrganization.mockReset();
  });

  it("shows the active organization but no setup controls to a member", () => {
    mocks.useOrganization.mockReturnValue({
      ...activeAdminOrganization,
      membership: { role: "org:member" },
    });

    render(<CreateEvidenceLibraryStep />);

    expect(screen.getByText("Climate Team")).toBeVisible();
    expect(screen.queryByLabelText("libraryNameLabel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "continue" })).not.toBeInTheDocument();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("shows a server-checked read-only address and continues to configuration", async () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockImplementation((query: string, args: unknown) => {
      if (query === "getCurrentSetupDraft") return { data: null };
      if (query === "previewSetupDraftName" && args !== "skip") {
        return {
          data: {
            name: "Climate Evidence",
            publicAddress:
              "https://climate-evidence-2-lib.libraries.example.test",
            shortName: "Climate Evidence",
            slug: "climate-evidence-2",
          },
        };
      }
      return { data: undefined };
    });
    mocks.createSetupDraft.mockResolvedValue({ libraryId: "library_123" });
    const user = userEvent.setup();

    render(<CreateEvidenceLibraryStep />);
    await user.type(
      screen.getByLabelText("libraryNameLabel"),
      "Climate Evidence",
    );

    const address = screen.getByLabelText("publicAddressLabel");
    expect(address).toHaveValue(
      "https://climate-evidence-2-lib.libraries.example.test",
    );
    expect(address).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(mocks.createSetupDraft).toHaveBeenCalledWith({
        name: "Climate Evidence",
      });
      expect(mocks.push).toHaveBeenCalledWith(
        "/evidence-libraries/library_123/configuration",
      );
    });
  });

  it("renders the saved draft after the page mounts again", () => {
    mocks.useOrganization.mockReturnValue(activeAdminOrganization);
    mocks.query.mockImplementation((query: string) => {
      if (query === "getCurrentSetupDraft") {
        return {
          data: {
            draftId: "draft_123",
            libraryId: "library_123",
            name: "Saved Library",
            publicAddress:
              "https://saved-library-lib.libraries.example.test",
            shortName: "Saved Library",
            slug: "saved-library",
          },
        };
      }
      return { data: undefined };
    });

    render(<CreateEvidenceLibraryStep />);

    expect(screen.getByLabelText("libraryNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("shortNameLabel")).toHaveValue(
      "Saved Library",
    );
    expect(screen.getByLabelText("publicAddressLabel")).toHaveValue(
      "https://saved-library-lib.libraries.example.test",
    );
  });
});
