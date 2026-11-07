/** @vitest-environment jsdom */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactElement } from "react";
import { renderWithTooltip } from "../../helpers/render-with-tooltip";
type Workspace = { kind: string; name: string; workspaceId: string; organizationId?: string; slug?: string };
const mocks = vi.hoisted(() => ({
  query: vi.fn(), pages: vi.fn(), respond: vi.fn(), restart: vi.fn(), creates: false,
  workspace: { kind: "personal", name: "Ada", workspaceId: "ws_own" } as Workspace,
  workspaces: [] as Workspace[],
}));
vi.mock("@/components/workspaces/parts", async (original) => ({ ...(await original<typeof import("@/components/workspaces/parts")>()), useCurrentWorkspace: () => mocks.workspace, useWorkspaces: () => ({ list: [mocks.workspace, ...mocks.workspaces] }) }));
vi.mock("@/lib/workspaces/href", async (original) => ({ ...(await original<typeof import("@/lib/workspaces/href")>()), useWorkspaceSlug: () => mocks.workspace.slug ?? null }));
vi.mock("@/lib/workspaces/use-workspace-features", () => ({ useWorkspaceFeatures: () => ({ data: { evidenceLibraries: mocks.creates, authors: mocks.creates, createsCommunities: mocks.creates } }) }));
vi.mock("next-intl", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<string, unknown>;
  const read = (path: string) => path.split(".").reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], messages);
  const fill = (text: string, values: Record<string, unknown> = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
  return {
    useTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) => { const found = read(`${namespace}.${key}`); return typeof found === "string" ? fill(found, values) : key; },
    useFormatter: () => ({ number: (value: number) => String(value) }),
  };
});
vi.mock("convex/react", () => ({ useMutation: () => mocks.restart, useAction: () => mocks.respond }));
vi.mock("@/convex/_generated/api", () => ({ api: {
  organizationFeatures: { opens: "opens" },
  evidenceLibraries: {
    teardown: { restartDevelopmentTeardown: "restart" },
    queries: { listLibraries: "libraries" },
    directory: { listPublic: "public" },
    invitations: { listInvitations: "invitations" }, invitationActions: { respond: "respond" },
  },
} }));
// Invitations arrive as one page; the tests give its rows.
vi.mock("@/lib/auth/use-auth-query", () => ({ useProtectedQuery: (name: string, args: unknown) => {
  const result = args === "skip" ? undefined : mocks.query(name);
  return !result?.data ? { data: undefined } : { ...result, data: { page: result.data, isDone: true, continueCursor: "" } };
} }));
// Every list arrives as one loaded page that has no page after it; the tests read what each was asked for.
vi.mock("@/lib/hooks/use-cursor-page", () => ({ useCursorPage: (name: string, args: unknown) => {
  mocks.pages(name, args);
  return { items: args === "skip" ? [] : mocks.query(name).data, isLoading: args === "skip", isStale: false, page: 1, offset: 0, hasPages: false, canPrevious: false, canNext: false, previous: vi.fn(), next: vi.fn() };
} }));
import { LibraryList } from "@/components/evidence-libraries/library-list";
const render = (ui: ReactElement, searchParams = "") => renderWithTooltip(<NuqsTestingAdapter searchParams={searchParams}>{ui}</NuqsTestingAdapter>);
const library = (role: string, extra: Record<string, unknown> = {}) => ({
  _id: role, name: `${role} library`, role, status: "active", publicAddress: `https://${role}.example.org`, faviconUrl: null, operation: null,
  organization: { name: `${role} organization`, imageUrl: null, kind: "organization" }, from: "organization", workspaceId: "ws_lab", ...extra,
});
const libraries = ["owner", "editor", "creator", "viewer"].map((role) => library(role));
const invitation = { invitationId: "invite_1", libraryId: "invited", name: "Invited library", role: "editor", organization: { id: "org_partner", name: "Partner organization", imageUrl: null } };
const sidebar = () => within(screen.getByRole("complementary", { name: "Your communities" }));
/** What the sidebar's list was last asked for. */
const askedFor = () => mocks.pages.mock.calls.filter(([name]) => name === "libraries").at(-1)?.[1];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workspace = { kind: "personal", name: "Ada", workspaceId: "ws_own" };
  mocks.workspaces = [{ kind: "organization", name: "Lab", workspaceId: "ws_lab", organizationId: "org_lab", slug: "lab" }];
  mocks.creates = false;
  mocks.query.mockImplementation((name: string) => ({ isReady: true, data: name === "libraries" ? libraries : name === "invitations" ? [invitation] : [] }));
});

describe("the Communities page", () => {
  it("lists every community the person can open in the sidebar, invitations first, each opening where its role lets it", async () => {
    render(<LibraryList />);
    const rows = sidebar().getAllByRole("listitem");
    expect(within(rows[0]).getByText("Invited library")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Invited as Editor")).toBeInTheDocument();
    // Every role opens its settings: owners change them, everyone else reads them (#653).
    for (const role of ["owner", "editor", "creator", "viewer"]) {
      expect(sidebar().getByRole("link", { name: `${role} library` })).toHaveAttribute("href", `/evidence-communities/${role}/configuration`);
    }
    await userEvent.setup().click(sidebar().getByRole("button", { name: "More actions for editor library" }));
    const admin = screen.getByRole("menuitem", { name: "Open admin" });
    expect(admin).toHaveAttribute("href", "https://editor.example.org/admin");
    expect(admin).toHaveAttribute("target", "_blank");
  });

  it("answers an invitation from its row", async () => {
    mocks.respond.mockResolvedValue(null);
    render(<LibraryList />);
    await userEvent.setup().click(sidebar().getByRole("button", { name: "Accept" }));
    expect(mocks.respond).toHaveBeenCalledWith({ invitationId: "invite_1", accept: true });
    expect(await screen.findByRole("status")).toHaveTextContent("Accepted Invited library.");
  });

  it("asks the server for one place's communities when the filter picks it, and keeps it in the address", () => {
    render(<LibraryList />, "?from=shared");
    expect(askedFor()).toEqual({ from: "shared" });
    render(<LibraryList />, "?from=ws_lab");
    expect(askedFor()).toEqual({ from: "ws_lab" });
    render(<LibraryList />);
    expect(askedFor()).toEqual({});
  });

  it("keeps setup and failed-deletion recovery in the owner row", async () => {
    mocks.query.mockImplementation((name: string) => ({ isReady: true, data: name === "libraries" ? [
      library("owner", { _id: "setup", name: "Setting up", status: "setup_failed" }),
      library("owner", { _id: "delete", name: "Deleting library", status: "deleting", teardownFailedStep: "database" }),
    ] : [] }));
    mocks.restart.mockResolvedValue({ status: "queued" });
    render(<LibraryList />);
    const user = userEvent.setup();
    await user.click(sidebar().getByRole("button", { name: "More actions for Setting up" }));
    expect(screen.getByRole("menuitem", { name: "View setup" })).toHaveAttribute("href", "/evidence-communities/setup/setup");
    await user.keyboard("{Escape}");
    await user.click(sidebar().getByRole("button", { name: "More actions for Deleting library" }));
    await user.click(screen.getByRole("menuitem", { name: "Retry deletion" }));
    expect(mocks.restart).toHaveBeenCalledWith({ libraryId: "delete" });
  });

  it("in an organization, lists its own without invitations, and offers New community only where the person may create one", () => {
    mocks.workspace = { kind: "organization", name: "Lab", workspaceId: "ws_lab", organizationId: "org_lab", slug: "lab" };
    render(<LibraryList />);
    expect(askedFor()).toEqual({ organization: "org_lab" });
    expect(sidebar().queryByText("Invited library")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New community" })).not.toBeInTheDocument();
    mocks.creates = true;
    render(<LibraryList />);
    expect(screen.getByRole("link", { name: "New community" })).toHaveAttribute("href", "/evidence-communities/new");
  });
});
