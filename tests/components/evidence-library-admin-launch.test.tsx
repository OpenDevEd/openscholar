/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueCode: vi.fn(),
  navigate: vi.fn(),
  query: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: () => mocks.issueCode,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      adminLoginCodeActions: { issueAdminLoginCode: "issueAdminLoginCode" },
      queries: { getAdminLaunchState: "getAdminLaunchState" },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    mocks.query(query, args),
}));

vi.mock("@/lib/evidence-libraries/open-admin-launch", () => ({
  openAdminLaunchUrl: mocks.navigate,
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { EvidenceLibraryAdminLaunch } from "@/components/evidence-libraries/evidence-library-admin-launch";

describe("<EvidenceLibraryAdminLaunch>", () => {
  beforeEach(() => {
    mocks.issueCode.mockReset();
    mocks.navigate.mockReset();
    mocks.query.mockReset();
  });

  it("does not show the launch action while the library is not ready", () => {
    mocks.query.mockReturnValue({
      data: {
        libraryId: "library_123",
        libraryName: "Climate Evidence",
        status: "not_ready",
      },
      isReady: true,
    });

    render(<EvidenceLibraryAdminLaunch libraryId="library_123" />);

    expect(mocks.query).toHaveBeenCalledWith("getAdminLaunchState", {
      libraryId: "library_123",
    });
    expect(
      screen.queryByRole("button", { name: "openAdmin" }),
    ).not.toBeInTheDocument();
  });

  it("opens the exact launch URL issued for the ready library", async () => {
    const user = userEvent.setup();
    const launchUrl =
      "https://climate.example.test/api/admin/session?code=elc_test";
    mocks.query.mockReturnValue({
      data: {
        libraryId: "library_123",
        libraryName: "Climate Evidence",
        status: "ready",
      },
      isReady: true,
    });
    mocks.issueCode.mockResolvedValue({ launchUrl });

    render(<EvidenceLibraryAdminLaunch libraryId="library_123" />);
    await user.click(screen.getByRole("button", { name: "openAdmin" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(launchUrl));
  });

  it("shows an alert and allows retry after issuing a code fails", async () => {
    const user = userEvent.setup();
    mocks.query.mockReturnValue({
      data: {
        libraryId: "library_123",
        libraryName: "Climate Evidence",
        status: "ready",
      },
      isReady: true,
    });
    mocks.issueCode.mockRejectedValue(new Error("Connection failed"));

    render(<EvidenceLibraryAdminLaunch libraryId="library_123" />);
    await user.click(screen.getByRole("button", { name: "openAdmin" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "openAdmin" })).toBeEnabled();
  });
});
