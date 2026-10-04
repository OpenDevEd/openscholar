/** @vitest-environment jsdom */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement } from "react";
import { renderWithTooltip } from "../../helpers/render-with-tooltip";
const mocks = vi.hoisted(() => ({ query: vi.fn(), respond: vi.fn(), restart: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.restart, useAction: () => mocks.respond }));
vi.mock("@/convex/_generated/api", () => ({ api: { organizationFeatures: {listLibraryOrganizations: "organizations"}, evidenceLibraries: {
  teardown: { restartDevelopmentTeardown: "restart" },
  queries: { listLibraries: "libraries", countLibraries: "count", listLibraryOwners: "owners" },
  invitations: { listInvitations: "invitations" }, invitationActions: { respond: "respond" },
} } }));
// Organizations and invitations arrive as one page each; the tests give their rows.
vi.mock("@/lib/auth/use-auth-query", () => ({ useProtectedQuery: (name: string) => {
  if (name === "count") return { isReady: true, data: mocks.query("libraries").data.length };
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
  mocks.query.mockImplementation((name: string) => ({ isReady: true, data: name === "libraries" ? libraries : name === "organizations" ? [{id: "org_1", name: "Research team"}] : [] }));
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
      if (role === "owner") expect(row.getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/evidence-libraries/owner/configuration");
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
    expect(screen.getByRole("link", {name: "View setup"})).toHaveAttribute("href", "/evidence-libraries/setup/setup");
    await userEvent.setup().click(screen.getByRole("button", {name: "Retry deletion"}));
    expect(mocks.restart).toHaveBeenCalledWith({libraryId: "delete"});
  });
  it("shows one status word per library, the running update or publish in place of Active", () => {
    const update = { from: "a", to: "b", fromImage: "a", toImage: "b" };
    const rows = [
      {...libraries[0], _id: "idle", name: "Idle library"},
      {...libraries[0], _id: "updating", name: "Updating library", operation: {stage: "deployment", runtimeUpdate: update}},
      {...libraries[0], _id: "applying", name: "Applying library", operation: {stage: "publishing"}},
      {...libraries[0], _id: "queued", name: "Queued library", operation: {stage: "queued"}},
    ];
    mocks.query.mockImplementation((name: string) => ({isReady: true, data: name === "libraries" ? rows : name === "organizations" ? [{id: "org_1", name: "Research team"}] : []}));
    render(<LibraryList />);
    const status = (name: string) => within(screen.getByText(name).closest("li")!);
    expect(status("Idle library").getByText("active")).toBeInTheDocument();
    for (const [name, word] of [["Updating library", "updating"], ["Applying library", "applying"], ["Queued library", "queued"]]) {
      expect(status(name).getByText(word)).toBeInTheDocument();
      expect(status(name).queryByText("active")).not.toBeInTheDocument();
    }
  });
  it("opens pending invitations from the invitation email link", () => {
    mocks.query.mockImplementation((name: string) => ({isReady: true, data: name === "libraries" ? libraries : name === "invitations" ? [{invitationId: "invite_1", libraryId: "invited", name: "Invited library", role: "editor", organization: {name: "Partner organization", imageUrl: null}}] : []}));
    render(<LibraryList />, "?view=invitations");
    expect(screen.getByText("Invited library")).toBeInTheDocument();
    expect(screen.queryByText("owner library")).not.toBeInTheDocument();
  });
  it("links New library to the creation page", () => {
    render(<LibraryList />);
    expect(screen.getByRole("link", { name: "New library" })).toHaveAttribute(
      "href", "/evidence-libraries/new",
    );
  });
});
