/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueCode: vi.fn(),
  navigate: vi.fn(),
  organization: vi.fn(),
  query: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({ useOrganization: () => mocks.organization() }));
vi.mock("convex/react", () => ({ useAction: () => mocks.issueCode }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: mocks.toastError }) }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      adminLoginCodeActions: { issueAdminLoginCode: "issueAdminLoginCode" },
      queries: { getAdminLaunchState: "getAdminLaunchState" },
    },
  },
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) => mocks.query(query, args),
}));
vi.mock("@/lib/evidence-libraries/open-admin-launch", () => ({
  openAdminLaunchUrl: mocks.navigate,
}));
vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { AdminLaunch } from "@/components/evidence-libraries/admin-launch";

function launchState(status: "ready" | "not_ready") {
  return {
    libraryId: "library_123",
    libraryName: "Climate Evidence",
    publicAddress: "https://climate.example.test",
    libraryStatus: status === "ready" ? "active" : "setting_up",
    activeRevisionKey: status === "ready" ? "rev-3" : null,
    status,
  };
}

describe("<AdminLaunch>", () => {
  beforeEach(() => {
    mocks.issueCode.mockReset();
    mocks.navigate.mockReset();
    mocks.organization.mockReset();
    mocks.query.mockReset();
    mocks.toastError.mockReset();
    mocks.organization.mockReturnValue({ membership: { role: "org:admin" } });
  });

  it("does not offer the launch while the library is not ready, but links an owner to the setup", () => {
    mocks.query.mockReturnValue({ data: launchState("not_ready"), isReady: true });

    render(<AdminLaunch libraryId="library_123" />);

    expect(mocks.query).toHaveBeenCalledWith("getAdminLaunchState", { libraryId: "library_123" });
    expect(screen.queryByRole("button", { name: "openAdmin" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "viewSetup" })).toHaveAttribute(
      "href",
      "/evidence-libraries/library_123/setup",
    );
  });

  it("opens the exact launch URL issued for the ready library", async () => {
    const user = userEvent.setup();
    const launchUrl = "https://climate.example.test/api/admin/session?code=elc_test";
    mocks.query.mockReturnValue({ data: launchState("ready"), isReady: true });
    mocks.issueCode.mockResolvedValue({ launchUrl });

    render(<AdminLaunch libraryId="library_123" />);
    expect(screen.getByText("https://climate.example.test/admin")).toBeInTheDocument();
    expect(screen.getByText("rev-3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "openAdmin" }));

    await waitFor(() => expect(mocks.issueCode).toHaveBeenCalledWith({ libraryId: "library_123" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(launchUrl));
  });

  it("reports the failure and allows another try when issuing a code fails", async () => {
    const user = userEvent.setup();
    mocks.query.mockReturnValue({ data: launchState("ready"), isReady: true });
    mocks.issueCode.mockRejectedValue(new Error("Connection failed"));

    render(<AdminLaunch libraryId="library_123" />);
    await user.click(screen.getByRole("button", { name: "openAdmin" }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "openAdmin" })).toBeEnabled();
  });

  it("gives an editor the launch without the owner links", () => {
    mocks.organization.mockReturnValue({ membership: { role: "org:member" } });
    mocks.query.mockReturnValue({ data: launchState("ready"), isReady: true });

    render(<AdminLaunch libraryId="library_123" />);

    expect(screen.getByRole("button", { name: "openAdmin" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "configure" })).not.toBeInTheDocument();
  });
});
