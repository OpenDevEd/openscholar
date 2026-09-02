/**
 * @vitest-environment jsdom
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithTooltip as render } from "../../helpers/render-with-tooltip";

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
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, string>) =>
      `${namespace.replace("evidenceLibraries.", "")}.${key}${values?.name ? `:${values.name}` : ""}`,
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: {
        listLibraryOverviews: "listLibraryOverviews",
        getEvidenceLibrariesAccess: "getEvidenceLibrariesAccess",
      },
      updates: { listAddressNotices: "listAddressNotices" },
      mutations: { retrySetup: "retrySetup" },
      teardown: { requestDevelopmentTeardown: "requestDevelopmentTeardown" },
    },
  },
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) =>
    mocks.query(query, args),
}));

vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({
    variant,
    title,
    description,
  }: {
    variant: string;
    title?: string;
    description?: string;
  }) => (
    <div>
      <p>{title ?? variant}</p>
      {description ? <p>{description}</p> : null}
    </div>
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
    faviconUrl: "https://assets.example.test/favicon.ico",
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
    faviconUrl: null,
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
    faviconUrl: null,
  },
];

function organization(role: "org:admin" | "org:member") {
  return {
    isLoaded: true,
    membership: { role },
    organization: { id: "org_1", name: "Climate Team" },
  };
}

/** Answers each query the list opens; address notices default to none. */
function answerQueries(addressNotices: unknown[] = [], enabled = true) {
  mocks.query.mockImplementation((query: unknown) => {
    if (query === "listAddressNotices") {
      return { data: addressNotices, isReady: true };
    }
    if (query === "getEvidenceLibrariesAccess") {
      return { data: { enabled }, isReady: true };
    }
    return { data: libraries, isReady: true };
  });
}

describe("<LibraryList>", () => {
  beforeEach(() => {
    mocks.organization.mockReset();
    mocks.query.mockReset();
    mocks.retrySetup.mockReset();
    answerQueries();
  });

  it("shows each library with its status and the owner's actions", async () => {
    const user = userEvent.setup();
    mocks.organization.mockReturnValue(organization("org:admin"));
    mocks.retrySetup.mockResolvedValue({
      operationId: "op",
      status: "running",
    });

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.status)).toEqual([
      "active",
      "setup_failed",
      "deleting",
    ]);

    const activeRow = within(rows[0]);
    expect(
      activeRow.getByRole("link", { name: "Climate Evidence" }),
    ).toHaveAttribute("href", "/evidence-libraries/lib_active/configuration");
    expect(
      activeRow.getByRole("link", { name: "list.configure" }),
    ).toBeInTheDocument();
    expect(
      activeRow.getByRole("link", { name: "list.openAdmin" }),
    ).toHaveAttribute("href", "/evidence-libraries/lib_active/admin");
    expect(activeRow.getByText("2026-08-26")).toBeInTheDocument();
    // The library's favicon fills the tile; without one the OpenScholar icon does.
    expect(rows[0].querySelector("[data-library-image]")).toHaveAttribute(
      "src",
      "https://assets.example.test/favicon.ico",
    );
    expect(rows[1].querySelector("[data-library-image]")).toHaveAttribute(
      "src",
      "/icon.svg",
    );

    const failedRow = within(rows[1]);
    expect(failedRow.getByText("stages.storage")).toBeInTheDocument();
    await user.click(failedRow.getByRole("button", { name: "list.retry" }));
    await waitFor(() =>
      expect(mocks.retrySetup).toHaveBeenCalledWith({
        libraryId: "lib_failed",
      }),
    );

    const deletingRow = within(rows[2]);
    expect(
      deletingRow.getByRole("progressbar", { name: "list.deleting" }),
    ).toBeInTheDocument();
    expect(
      deletingRow.queryByRole("button", { name: "list.deleteRetry" }),
    ).not.toBeInTheDocument();

    expect(
      screen.getAllByRole("link", { name: "list.newLibrary" }).length,
    ).toBeGreaterThan(0);
  });

  it("gives an editor only the admin link of live libraries", () => {
    mocks.organization.mockReturnValue(organization("org:member"));

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    const activeRow = within(rows[0]);
    expect(
      activeRow.getByRole("link", { name: "Climate Evidence" }),
    ).toHaveAttribute("href", "/evidence-libraries/lib_active/admin");
    expect(
      activeRow.queryByRole("link", { name: "list.configure" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "list.newLibrary" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "list.retry" }),
    ).not.toBeInTheDocument();
    expect(
      within(rows[1]).getByText("health-lib.example.test").closest("a"),
    ).toHaveAttribute("href", "https://health-lib.example.test");
    expect(
      within(rows[1]).queryByRole("link", { name: "list.openAdmin" }),
    ).not.toBeInTheDocument();
  });

  it("tells the owner which address a library was moved away from", () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    answerQueries([
      {
        libraryId: "lib_failed",
        address: "https://health-lib.example.test",
        movedFrom: "https://health-old-lib.example.test",
        addressState: null,
      },
    ]);

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    expect(
      within(rows[1]).getByText("list.movedFromLabel"),
    ).toBeInTheDocument();
    expect(
      within(rows[1]).getByText("health-old-lib.example.test"),
    ).toBeInTheDocument();
    expect(
      within(rows[0]).queryByText("list.movedFromLabel"),
    ).not.toBeInTheDocument();
  });

  it("tells the owner when another site answers a live library's address", () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    answerQueries([
      {
        libraryId: "lib_active",
        address: "https://climate-lib.example.test",
        movedFrom: null,
        addressState: "not-ours",
      },
    ]);

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("list.addressTaken")).toBeInTheDocument();
    expect(
      rows[0].querySelector('[data-address-state="not-ours"]'),
    ).not.toBeNull();
    expect(
      within(rows[1]).queryByText("list.addressTaken"),
    ).not.toBeInTheDocument();
  });

  it("says plainly when nothing answers a live library's address", () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    answerQueries([
      {
        libraryId: "lib_active",
        address: "https://climate-lib.example.test",
        movedFrom: null,
        addressState: "unreachable",
      },
    ]);

    render(<LibraryList />);

    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("list.addressSilent")).toBeInTheDocument();
    expect(
      within(rows[0]).queryByText("list.addressTaken"),
    ).not.toBeInTheDocument();
  });

  it("asks for an organisation before listing anything", () => {
    mocks.organization.mockReturnValue({
      isLoaded: true,
      membership: undefined,
      organization: null,
    });

    render(<LibraryList />);

    expect(screen.getByText("list.noOrganizationTitle")).toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledWith("listLibraryOverviews", "skip");
  });

  it("shows one plain panel when the organisation is not switched on", () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    answerQueries([], false);

    render(<LibraryList />);

    expect(screen.getByText("gate.title")).toBeInTheDocument();
    expect(screen.getByText("gate.description")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "list.newLibrary" }),
    ).not.toBeInTheDocument();
  });
  it("shows which part of a deletion is running", () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    answerQueries();
    render(<LibraryList />);

    // The bar carries the part being removed, so a library part-way through
    // is not drawn as if it had only just started.
    const deletingRow = within(screen.getAllByRole("listitem")[2]);
    expect(
      deletingRow.getByRole("progressbar", { name: "list.deleting" }),
    ).toHaveAttribute("data-teardown-stage", "convex");
    // Nothing has gone wrong, so no message and no way to start it again.
    expect(
      deletingRow.queryByRole("button", { name: "list.deleteRetry" }),
    ).toBeNull();
  });

  it("says which part stopped when a deletion cannot finish", async () => {
    mocks.organization.mockReturnValue(organization("org:admin"));
    mocks.query.mockImplementation((query: unknown) => {
      if (query === "listAddressNotices") return { data: [], isReady: true };
      if (query === "getEvidenceLibrariesAccess") {
        return { data: { enabled: true }, isReady: true };
      }
      return {
        data: libraries.map((library) =>
          library._id === "lib_deleting"
            ? {
                ...library,
                teardownStage: "storage",
                teardownFailedStep: "files",
              }
            : library,
        ),
        isReady: true,
      };
    });
    render(<LibraryList />);

    // The message names the part that stopped, and the owner can start the
    // deletion again.
    const deletingRow = within(screen.getAllByRole("listitem")[2]);
    expect(deletingRow.getByRole("status")).toHaveTextContent(
      "list.deleteFailed.files",
    );
    expect(
      deletingRow.getByRole("button", { name: "list.deleteRetry" }),
    ).toBeInTheDocument();
    // A deletion that stopped shows no progress, which would suggest it was
    // still going.
    expect(
      deletingRow.queryByRole("progressbar", { name: "list.deleting" }),
    ).toBeNull();
  });
});
