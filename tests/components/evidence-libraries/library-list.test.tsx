/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  organization: vi.fn(),
  query: vi.fn(),
  retrySetup: vi.fn(),
  requestTeardown: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  OrganizationSwitcher: () => <div data-testid="org-switcher" />,
  useOrganization: () => mocks.organization(),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) =>
    mutation === "retrySetup" ? mocks.retrySetup : mocks.requestTeardown,
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string>) =>
    `${namespace.replace("evidenceLibraries.", "")}.${key}${values?.name ? `:${values.name}` : ""}`,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString().slice(0, 10) }),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { listLibraryOverviews: "listLibraryOverviews" },
      mutations: { retrySetup: "retrySetup" },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
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

import { LibraryList } from "@/components/evidence-libraries/library-list";

const libraries = [
  {
    _id: "lib_active",
    name: "Climate Evidence",
    publicAddress: "https://climate-lib.example.test",
    status: "active",
    setupStage: null,
    teardownStage: null,
    lastActivatedAt: Date.UTC(2026, 7, 26),
    accentColor: "#005A9C",
  },
  {
    _id: "lib_failed",
    name: "Health Evidence",
    publicAddress: "https://health-lib.example.test",
    status: "setup_failed",
    setupStage: "storage",
    teardownStage: null,
    lastActivatedAt: null,
    accentColor: null,
  },
  {
    _id: "lib_deleting",
    name: "Old Evidence",
    publicAddress: "https://old-lib.example.test",
    status: "deleting",
    setupStage: null,
    teardownStage: "convex",
    lastActivatedAt: null,
    accentColor: null,
  },
];

function organization(role: "org:admin" | "org:member") {
  return {
    isLoaded: true,
    membership: { role },
    organization: { id: "org_1", name: "Climate Team" },
  };
}

describe("<LibraryList>", () => {
  beforeEach(() => {
    mocks.organization.mockReset();
    mocks.query.mockReset();
    mocks.retrySetup.mockReset();
    mocks.query.mockReturnValue({ data: libraries, isReady: true });
  });

  it("shows each library with its status and the owner's actions", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(organization("org:admin"));
    mocks.retrySetup.mockResolvedValue({ operationId: "op", status: "running" });

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.status)).toEqual(["active", "setup_failed", "deleting"]);

    const activeRow = within(rows[0]);
    expect(activeRow.getByRole("link", { name: "Climate Evidence" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_active/configuration",
    );
    expect(activeRow.getByRole("link", { name: "list.configure" })).toBeInTheDocument();
    expect(activeRow.getByRole("link", { name: "list.openAdmin" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_active/admin",
    );
    expect(activeRow.getByText("2026-08-26")).toBeInTheDocument();

    const failedRow = within(rows[1]);
    expect(failedRow.getByText("stages.storage")).toBeInTheDocument();
    await user.click(failedRow.getByRole("button", { name: "list.retry" }));
    await waitFor(() =>
      expect(mocks.retrySetup).toHaveBeenCalledWith({ libraryId: "lib_failed" }),
    );

    const deletingRow = within(rows[2]);
    expect(deletingRow.getByRole("progressbar", { name: "list.deleting" })).toBeInTheDocument();
    expect(deletingRow.queryByRole("button")).not.toBeInTheDocument();

    expect(screen.getAllByRole("link", { name: "list.newLibrary" }).length).toBeGreaterThan(0);
  });

  it("gives an editor only the admin link of live libraries", () => {
    mocks.organization.mockReturnValue(organization("org:member"));

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    const activeRow = within(rows[0]);
    expect(activeRow.getByRole("link", { name: "Climate Evidence" })).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_active/admin",
    );
    expect(activeRow.queryByRole("link", { name: "list.configure" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "list.newLibrary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "list.retry" })).not.toBeInTheDocument();
    expect(within(rows[1]).queryByRole("link")).not.toBeInTheDocument();
  });

  it("asks for an organisation before listing anything", () => {
    mocks.organization.mockReturnValue({ isLoaded: true, membership: undefined, organization: null });

    render(<LibraryList />);

    expect(screen.getByText("list.noOrganizationTitle")).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith("listLibraryOverviews", "skip");
  });
});
