/** @vitest-environment jsdom */
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
const mocks = vi.hoisted(() => ({ query: vi.fn(), reserve: vi.fn(), respond: vi.fn(), push: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@clerk/nextjs", () => ({ useOrganization: () => ({ organization: { name: "Research team" } }) }));
vi.mock("convex/react", () => ({ useAction: (name: string) => name === "reserve" ? mocks.reserve : mocks.respond }));
vi.mock("@/convex/_generated/api", () => ({ api: { evidenceLibraries: {
  queries: { listLibraryOverviews: "libraries", getEvidenceLibrariesAccess: "access" },
  invitations: { listMine: "invitations" }, invitationActions: { respond: "respond" }, addressActions: { reserveAddress: "reserve" },
} } }));
vi.mock("@/lib/auth/use-auth-query", () => ({ useProtectedQuery: (name: string) => mocks.query(name) }));
import { LibraryList } from "@/components/evidence-libraries/library-list";
const libraries = ["owner", "editor", "creator"].map(role => ({ _id: role, name: `${role} library`, role, status: "active", publicAddress: `https://${role}.example.org`, organization: { name: `${role} organization` } }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation((name: string) => ({ data: name === "libraries" ? libraries : name === "access" ? { enabled: true, canCreate: true } : [] }));
});
describe("Library access list", () => {
  it("uses each library role for configuration access and each library id for admin navigation", () => {
    render(<LibraryList />);
    for (const role of ["owner", "editor", "creator"]) {
      const row = within(screen.getByText(`${role} library`).closest("li")!);
      expect(row.getByRole("link", { name: "Open admin" })).toHaveAttribute("href", `/evidence-libraries/${role}/admin`);
      if (role === "owner") expect(row.getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/evidence-libraries/owner/configuration");
      else expect(row.queryByRole("link", { name: "Configure" })).not.toBeInTheDocument();
    }
  });
  it("prevents repeated creation while pending and exposes failure inside the still-open dialog", async () => {
    let reject!: (reason: Error) => void;
    mocks.reserve.mockReturnValue(new Promise((_, no) => { reject = no; }));
    render(<LibraryList />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New library" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Library name"), "Learning evidence");
    const submit = within(dialog).getByRole("button", { name: "Create library" });
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(mocks.reserve).toHaveBeenCalledWith({ name: "Learning evidence" });
    await act(async () => { reject(new Error("Internal service failure")); });
    expect(within(dialog).getByRole("alert")).toBeVisible();
    expect(submit).toBeEnabled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
