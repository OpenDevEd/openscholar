/** @vitest-environment jsdom */
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";
import type { Id } from "@/convex/_generated/dataModel";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), invite: vi.fn(), organizations: [] as object[] }));
vi.mock("next-intl", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<string, Record<string, string>>;
  return { useLocale: () => "en-US", useTranslations: (namespace: string) => (key: string, values: Record<string, string> = {}) => (messages[namespace]?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "") };
});
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: { id: "user_me" } }) }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.mutate, useAction: () => mocks.invite, useConvex: () => ({ query: vi.fn() }) }));
vi.mock("@/lib/hooks/use-cursor-page", () => ({ useCursorPage: () => ({ items: [], isLoading: false }) }));
vi.mock("@/convex/_generated/api", () => ({ api: { evidenceLibraries: {
 queries: { listTeam: "team", listOrganizationPeople: "people", isOrganizationPerson: "isPerson" }, team: { addOrganizationMember: "add", changeRole: "change", removeMember: "remove" }, invitations: { change: "invitation" }, invitationActions: { invite: "invite" },
 organizationGrants: { grant: "grantOrganization", changeRole: "changeOrganization", remove: "removeOrganization", grantable: "grantable" },
} } }));
vi.mock("@/lib/auth/use-auth-query", () => ({ useProtectedQuery: () => ({ data: {
 owners: [{ clerkUserId: "owner", name: "Ada", email: "ada@example.org" }],
 editors: [], creators: [{ clerkUserId: "creator", name: "Grace", email: "grace@example.org" }],
 invitations: [],
 organizations: mocks.organizations,
} }) }));
// The workspace the page is in: the library's organization, whose other members view it.
vi.mock("@/components/workspaces/parts", async (original) => ({
  ...(await original<typeof import("@/components/workspaces/parts")>()),
  useCurrentWorkspace: () => ({ kind: "organization", name: "Test Org", members: 3 }),
}));
import { TeamSection } from "@/components/evidence-libraries/configuration/sections/team-section";
const libraryId = "library_1" as Id<"evidenceLibraries">;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.organizations.length = 0;
  for (const method of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"]) {
    if (!(method in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, method, { configurable: true, value: () => false });
  }
});
describe("Library Team", () => {
 it("protects inherited owners and sends role changes to the selected library", async () => {
   let resolve!: () => void;
   mocks.mutate.mockReturnValue(new Promise<void>(yes => { resolve = yes; }));
   render(<TeamSection libraryId={libraryId} />);
   expect(screen.queryByRole("combobox", { name: "Role for Ada" })).not.toBeInTheDocument();
   // The organization's other members view the library, with nothing to change on their row.
   expect(screen.getByText("Everyone in Test Org")).toBeInTheDocument();
   const user = userEvent.setup();
   await user.click(screen.getByRole("combobox", { name: "Role for Grace" }));
   await user.click(screen.getByRole("option", { name: /Editor/ }));
   expect(mocks.mutate).toHaveBeenCalledWith({ libraryId, clerkUserId: "creator", role: "editor" });
   expect(screen.getByRole("combobox", { name: "Role for Grace" })).toBeDisabled();
   await act(async () => resolve());
   expect(screen.getByRole("combobox", { name: "Role for Grace" })).toBeEnabled();
 });
 it("requires confirmation before removing a library assignment", async () => {
   mocks.mutate.mockResolvedValue(null);
   render(<TeamSection libraryId={libraryId} />);
   const user = userEvent.setup();
   await user.click(screen.getByRole("button", { name: "Actions for Grace" }));
   await user.click(screen.getByRole("menuitem", { name: "Remove from community" }));
   expect(mocks.mutate).not.toHaveBeenCalled();
   await user.click(screen.getByRole("button", { name: "Remove from community" }));
   expect(mocks.mutate).toHaveBeenCalledWith({ libraryId, clerkUserId: "creator" });
 });
  // Everyone but its owners sees who works on it, and changes nothing.
  it("shows the team read-only to someone who doesn't own it: names and roles, with nothing to add, change or remove", () => {
    render(<TeamSection libraryId={libraryId} readOnly />);
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for Grace" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Grace/ })).toBeNull();
  });
 // #1091: an organization it's shared with is one row, and removing it takes the organization's access, not a person's.
 it("lists an organization it's shared with as one row, and removes the organization", async () => {
   mocks.organizations.push({ organizationId: "org_partners", workspaceId: null, name: "Partners", imageUrl: null, colour: null, role: "creator" });
   mocks.mutate.mockResolvedValue(null);
   render(<TeamSection libraryId={libraryId} />);
   const user = userEvent.setup();
   await user.click(screen.getByRole("button", { name: "Actions for Partners" }));
   await user.click(screen.getByRole("menuitem", { name: "Remove from community" }));
   await user.click(screen.getByRole("button", { name: "Remove from community" }));
   expect(mocks.mutate).toHaveBeenCalledWith({ libraryId, organizationId: "org_partners" });
 });
});
