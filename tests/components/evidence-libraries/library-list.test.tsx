/** @vitest-environment jsdom */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement } from "react";
import { renderWithTooltip } from "../../helpers/render-with-tooltip";
const mocks = vi.hoisted(() => ({ query: vi.fn(), respond: vi.fn(), restart: vi.fn(), creates: false, workspace: { kind: "personal" } as { kind: string; name?: string; organizationId?: string } }));
vi.mock("@/lib/workspaces/use-workspace-features", () => ({ useWorkspaceFeatures: () => ({ data: { evidenceLibraries: mocks.creates, authors: mocks.creates, createsCommunities: mocks.creates } }) }));
vi.mock("@/components/workspaces/parts", () => ({ useCurrentWorkspace: () => mocks.workspace }));
vi.mock("next-intl", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<string, Record<string, string>>;
  return { useTranslations: (namespace: string) => (key: string) => messages[namespace]?.[key] ?? key };
});
vi.mock("convex/react", () => ({ useMutation: () => mocks.restart, useAction: () => mocks.respond }));
vi.mock("@/convex/_generated/api", () => ({ api: { evidenceLibraries: {
  teardown: { restartDevelopmentTeardown: "restart" },
  queries: { listLibraries: "libraries" },
  invitations: { listInvitations: "invitations" }, invitationActions: { respond: "respond" },
} } }));
// Organizations and invitations arrive as one page each; the tests give their rows.
vi.mock("@/lib/auth/use-auth-query", () => ({ useProtectedQuery: (name: string) => {
  const result = mocks.query(name);
  return !result?.data ? result : { ...result, data: { page: result.data, isDone: true, continueCursor: "" } };
} }));
// The libraries arrive as one loaded page that has no page after it.
vi.mock("@/lib/hooks/use-cursor-page", () => ({ useCursorPage: (name: string) => ({
  items: mocks.query(name).data, isLoading: false, isStale: false, page: 1, offset: 0, hasPages: false, canPrevious: false, canNext: false, previous: vi.fn(), next: vi.fn(),
}) }));
import { LibraryList } from "@/components/evidence-libraries/library-list";
const render = (ui: ReactElement, searchParams = "") => renderWithTooltip(<NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>);
const libraries = ["owner", "editor", "creator"].map(role => ({ _id: role, name: `${role} library`, role, status: "active", publicAddress: `https://${role}.example.org`, organization: { name: `${role} organization` } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = { kind: "personal" };
  mocks.creates = false;
  mocks.query.mockImplementation((name: string) => ({ isReady: true, data: name === "libraries" ? libraries : [] }));
});
describe("Library access list", () => {
  it("uses each library role for configuration access and sends admin links to the library itself", () => {
    render(<LibraryList />);
    for (const role of ["owner", "editor", "creator"]) {
      const row = within(screen.getByText(`${role} library`).closest("li")!);
      const admin = row.getByRole("link", { name: "Open admin" });
      expect(admin).toHaveAttribute("href", `https://${role}.example.org/admin`);
      // Links out to a library open a new tab and leave OpenScholar where it was.
      expect(admin).toHaveAttribute("target", "_blank");
      if (role === "owner") expect(row.getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/evidence-communities/owner/configuration");
      else expect(row.queryByRole("link", { name: "Configure" })).not.toBeInTheDocument();
    }
  });
  it("keeps setup and failed-deletion recovery in the owner row", async () => {
    const rows = [
      {...libraries[0], _id: "setup", name: "Setting up", status: "setup_failed"},
      {...libraries[0], _id: "delete", name: "Deleting library", status: "deleting", teardownFailedStep: "database"},
    ];
    mocks.query.mockImplementation((name: string) => ({isReady: true, data: name === "libraries" ? rows : name === "organizations" ? [{id: "org_1", name: "Research team"}] : []}));
    mocks.restart.mockResolvedValue({status: "queued"});
    render(<LibraryList />);
    expect(screen.getByRole("link", {name: "View setup"})).toHaveAttribute("href", "/evidence-communities/setup/setup");
    await userEvent.setup().click(screen.getByRole("button", {name: "Retry deletion"}));
    expect(mocks.restart).toHaveBeenCalledWith({libraryId: "delete"});
  });
  it("in an organization, lists its libraries without invitations, and offers New community only where you may create one", () => {
    mocks.workspace = { kind: "organization", name: "Research team", organizationId: "org_1" };
    render(<LibraryList />, "?view=invitations");
    // Invitations are yours, in your own workspace: an organization shows its libraries.
    expect(screen.queryByRole("tab", { name: /Invitations/ })).not.toBeInTheDocument();
    expect(screen.getByText("owner library")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New community" })).not.toBeInTheDocument();
    mocks.creates = true;
    render(<LibraryList />);
    expect(screen.getByRole("link", { name: "New community" })).toHaveAttribute("href", "/evidence-communities/new");
  });
  it("opens pending invitations from the invitation email link", () => {
    mocks.query.mockImplementation((name: string) => ({isReady: true, data: name === "libraries" ? libraries : name === "invitations" ? [{invitationId: "invite_1", libraryId: "invited", name: "Invited library", role: "editor", organization: {name: "Partner organization", imageUrl: null}}] : []}));
    render(<LibraryList />, "?view=invitations");
    expect(screen.getByText("Invited library")).toBeInTheDocument();
    expect(screen.queryByText("owner library")).not.toBeInTheDocument();
  });
});
