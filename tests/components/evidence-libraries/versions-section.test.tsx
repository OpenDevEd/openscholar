/**
 * @vitest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  startRuntimeUpdate: vi.fn(),
  startAddressMove: vi.fn(),
  restoreRevision: vi.fn(),
  setDomainPrimary: vi.fn(),
  listVersions: vi.fn(),
  listDomains: vi.fn(),
  addressNotices: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      addressActions: { moveLibraryAddress: "moveLibraryAddress" },
      domains: { listDomains: "listDomains" },
      updates: {
        check: "check",
        listAddressNotices: "listAddressNotices",
      },
      versions: {
        listVersions: "listVersions",
        startRuntimeUpdate: "startRuntimeUpdate",
        restoreRevision: "restoreRevision",
        setDomainPrimary: "setDomainPrimary",
      },
    },
  },
}));

// One action callback per test, as Convex gives one per mounted section; the
// section caches its update check by that callback.
let checkAction: (args: unknown) => unknown;

vi.mock("convex/react", () => ({
  useAction: (reference: string) =>
    reference === "moveLibraryAddress" ? mocks.startAddressMove : checkAction,
  useMutation: (reference: string) =>
    reference === "startRuntimeUpdate"
      ? mocks.startRuntimeUpdate
      : reference === "setDomainPrimary"
        ? mocks.setDomainPrimary
        : mocks.restoreRevision,
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (reference: string) => ({
    data:
      reference === "listAddressNotices"
        ? mocks.addressNotices()
        : reference === "listDomains"
          ? mocks.listDomains()
          : mocks.listVersions(),
    isReady: true,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
  useFormatter: () => ({
    dateTime: (date: Date) => date.toISOString(),
  }),
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

import { VersionsSection } from "@/components/evidence-libraries/configuration/sections/versions-section";

const rows = [
  {
    operationId: "op_3",
    revisionId: "rev_3",
    revisionKey: "r3",
    revisionNumber: 3,
    createdAt: Date.UTC(2026, 7, 26, 10, 0),
    by: "Ada Lovelace",
    changedSections: ["identity", "email"],
    status: "live",
    kind: "config",
  },
  {
    operationId: "op_2",
    revisionId: "rev_2",
    revisionKey: "r2",
    revisionNumber: 2,
    createdAt: Date.UTC(2026, 7, 25, 10, 0),
    by: "Ada Lovelace",
    changedSections: [],
    status: "failed",
    kind: "runtime",
    runtimeCommit: "bbbbbbb1234",
  },
  {
    operationId: "op_1",
    revisionId: "rev_1",
    revisionKey: "r1",
    revisionNumber: 1,
    createdAt: Date.UTC(2026, 7, 24, 10, 0),
    by: "Ada Lovelace",
    changedSections: [],
    status: "previous",
    kind: "config",
  },
];

/**
 * The software panel suspends until the update check answers. React retries a
 * suspended tree only inside an awaited act, so render and settle there.
 */
async function renderSection(props: Partial<Parameters<typeof VersionsSection>[0]> = {}) {
  await act(async () => {
    render(
      <VersionsSection
        libraryId={"library_123" as never}
        live
        operationRunning={false}
        refreshKey="base"
        {...props}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function row(revisionKey: string) {
  const element = document.querySelector(`[data-revision="${revisionKey}"]`);
  if (!element) throw new Error(`No row ${revisionKey}`);
  return within(element as HTMLElement);
}

describe("<VersionsSection>", () => {
  beforeEach(() => {
    checkAction = (args) => mocks.check(args);
    mocks.check.mockReset();
    mocks.startRuntimeUpdate.mockReset();
    mocks.startAddressMove.mockReset();
    mocks.restoreRevision.mockReset();
    mocks.setDomainPrimary.mockReset();
    mocks.listDomains.mockReturnValue({
      platformAddress: "https://climate-lib.example.test",
      domains: [],
    });
    mocks.listVersions.mockReset();
    mocks.addressNotices.mockReset();
    mocks.addressNotices.mockReturnValue([]);
    mocks.toast.mockReset();
    mocks.toast.error.mockReset();
    mocks.check.mockResolvedValue({
      running: "aaaaaaa1234",
      latest: "bbbbbbb1234",
      changes: [{ sha: "bbbbbbb1234", message: "Faster search" }],
      releases: [],
      checkedAt: Date.UTC(2026, 7, 26, 12, 0),
    });
    mocks.listVersions.mockReturnValue(rows);
  });

  it("offers Update when newer software exists and starts it after confirming", async () => {
    const user = userEvent.setup();
    mocks.startRuntimeUpdate.mockResolvedValue({ from: "aaaaaaa1234", to: "bbbbbbb1234" });
    await renderSection();

    const update = screen.getByRole("button", { name: "versions.update" });
    expect(screen.getByText("Faster search")).toBeInTheDocument();
    expect(
      document.querySelector('[data-runtime-state="update-available"]'),
    ).not.toBeNull();

    await user.click(update);
    await user.click(screen.getByRole("button", { name: "versions.updateConfirm" }));

    await waitFor(() =>
      expect(mocks.startRuntimeUpdate).toHaveBeenCalledWith({ libraryId: "library_123" }),
    );
    expect(mocks.toast).toHaveBeenCalledWith("versions.updateStarted", {
      description: "versions.updateStartedDescription:bbbbbbb",
    });
  });

  it("shows each release's notes with its area, and keeps the commits behind a disclosure", async () => {
    mocks.check.mockResolvedValue({
      running: "aaaaaaa1234",
      latest: "bbbbbbb1234",
      changes: [{ sha: "bbbbbbb1234", message: "feat: faster search index" }],
      releases: [
        {
          commit: "bbbbbbb1234",
          summary: "Search is faster.",
          notes: ["Speed: Search results load faster on large libraries."],
        },
      ],
      checkedAt: Date.UTC(2026, 7, 26, 12, 0),
    });
    await renderSection();

    expect(screen.getByText("Search is faster.")).toBeInTheDocument();
    expect(screen.getByText("Search results load faster on large libraries.")).toBeInTheDocument();
    expect(document.querySelector('[data-area="speed"]')).toHaveTextContent("versions.areas.speed");
    const disclosure = screen.getByRole("button", { name: "versions.technicalChanges" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("feat: faster search index")).toBeNull();
    await userEvent.setup().click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("feat: faster search index")).toBeInTheDocument();
  });

  it("disables Update and Restore while an operation runs", async () => {
    await renderSection({ operationRunning: true });
    expect(screen.getByRole("button", { name: "versions.update" })).toBeDisabled();
    for (const button of screen.getAllByRole("button", { name: "versions.restore" })) {
      expect(button).toBeDisabled();
    }
  });

  it("hides Update when the library runs the latest software", async () => {
    mocks.check.mockResolvedValue({
      running: "aaaaaaa1234",
      latest: "aaaaaaa1234",
      changes: [],
      releases: [],
      checkedAt: Date.UTC(2026, 7, 26, 12, 0),
    });
    await renderSection();
    expect(screen.getByText("versions.upToDate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "versions.update" })).toBeNull();
  });

  it("keeps the previous release visible and blocks actions until a fresh check settles", async () => {
    await renderSection();
    expect(mocks.check).toHaveBeenCalledWith({ libraryId: "library_123", refresh: false });
    const next = {
      running: "aaaaaaa1234",
      latest: "ccccccc1234",
      changes: [{ sha: "ccccccc1234", message: "Updated search" }],
      releases: [],
      checkedAt: Date.UTC(2026, 7, 26, 13, 0),
    };
    let resolve!: (value: typeof next) => void;
    mocks.check.mockReturnValueOnce(new Promise((done) => { resolve = done; }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "versions.checkAgain" }));
    });

    expect(screen.getByText("Faster search")).toBeVisible();
    expect(screen.queryByText("versions.checking")).toBeNull();
    expect(screen.getByRole("button", { name: "versions.checkAgain" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "versions.update" })).toBeDisabled();
    expect(mocks.check).toHaveBeenLastCalledWith({ libraryId: "library_123", refresh: true });
    expect(mocks.check).toHaveBeenCalledTimes(2);

    await act(async () => { resolve(next); });

    expect(screen.getByText("Updated search")).toBeVisible();
    expect(screen.queryByText("Faster search")).toBeNull();
    expect(screen.getByRole("button", { name: "versions.checkAgain" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "versions.update" })).toBeEnabled();
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });

  it("shows the loading panel only before the first release result arrives", async () => {
    const state = {
      running: "aaaaaaa1234",
      latest: "aaaaaaa1234",
      changes: [],
      releases: [],
      checkedAt: 1,
    };
    let resolve!: (value: typeof state) => void;
    mocks.check.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await renderSection();
    expect(screen.getByText("versions.checking")).toBeVisible();

    await act(async () => { resolve(state); });

    expect(screen.getByText("versions.upToDate")).toBeVisible();
    expect(screen.queryByText("versions.checking")).toBeNull();
  });

  it("marks the live row and offers Restore only on previous and failed rows", async () => {
    await renderSection();
    const live = document.querySelector('[data-version-status="live"]');
    expect(live).not.toBeNull();
    expect(live).toHaveAttribute("data-revision", "r3");
    expect(row("r3").getByText("versions.status.live")).toBeInTheDocument();
    expect(row("r3").queryByRole("button", { name: "versions.restore" })).toBeNull();
    expect(row("r2").getByRole("button", { name: "versions.restore" })).toBeInTheDocument();
    expect(row("r1").getByRole("button", { name: "versions.restore" })).toBeInTheDocument();
    // Changed rows name their page cards; a software update names the commit.
    expect(row("r3").getByText("sections.identity")).toBeInTheDocument();
    expect(row("r3").getByText("sections.contact")).toBeInTheDocument();
    expect(row("r2").getByText("versions.softwareUpdate")).toBeInTheDocument();
    expect(row("r2").getByText("bbbbbbb")).toBeInTheDocument();
  });

  it("restores a version after confirming", async () => {
    const user = userEvent.setup();
    mocks.restoreRevision.mockResolvedValue({ revisionKey: "r4" });
    await renderSection();

    await user.click(row("r1").getByRole("button", { name: "versions.restore" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("versions.restoreTitle:r1");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "versions.restore" }));

    await waitFor(() =>
      expect(mocks.restoreRevision).toHaveBeenCalledWith({
        libraryId: "library_123",
        revisionId: "rev_1",
      }),
    );
    expect(mocks.toast).toHaveBeenCalledWith("versions.restoreStarted", {
      description: "versions.restoreStartedDescription:r1,r4",
    });
  });

  it("says nothing about the address while the library answers at it", async () => {
    await renderSection();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "versions.addressMove" })).toBeNull();
  });

  it("offers a move when another site answers the address", async () => {
    const user = userEvent.setup();
    mocks.addressNotices.mockReturnValue([
      {
        libraryId: "library_123",
        address: "https://climate-lib.example.test",
        movedFrom: null,
        addressState: "not-ours",
      },
    ]);
    mocks.startAddressMove.mockResolvedValue({
      status: "moving",
      movedFrom: "https://climate-lib.example.test",
      movedTo: "https://climate-2-lib.example.test",
    });
    await renderSection();

    expect(
      screen.getByText("versions.addressTaken:climate-lib.example.test"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-address-state="not-ours"]'),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "versions.addressMove" }));
    await user.click(
      screen.getByRole("button", { name: "versions.addressMoveConfirm" }),
    );

    await waitFor(() =>
      expect(mocks.startAddressMove).toHaveBeenCalledWith({
        libraryId: "library_123",
      }),
    );
    expect(mocks.toast).toHaveBeenCalledWith("versions.addressMoveStarted", {
      description:
        "versions.addressMoveStartedDescription:climate-2-lib.example.test",
    });
  });

  it("names the silent address when nothing answers there", async () => {
    mocks.addressNotices.mockReturnValue([
      {
        libraryId: "library_123",
        address: "https://climate-lib.example.test",
        movedFrom: null,
        addressState: "unreachable",
      },
    ]);
    await renderSection();
    expect(
      screen.getByText("versions.addressSilent:climate-lib.example.test"),
    ).toBeInTheDocument();
  });

  it("sends the library back to its platform address when its custom domain went silent", async () => {
    const user = userEvent.setup();
    mocks.addressNotices.mockReturnValue([
      {
        libraryId: "library_123",
        address: "https://evidence.example.org",
        movedFrom: null,
        addressState: "unreachable",
      },
    ]);
    mocks.listDomains.mockReturnValue({
      platformAddress: "https://climate-lib.example.test",
      domains: [
        { domainId: "domain_1", host: "evidence.example.org", role: "primary" },
      ],
    });
    mocks.setDomainPrimary.mockResolvedValue({
      address: "https://climate-lib.example.test",
    });
    await renderSection();

    // Moving the platform address cannot bring a dead custom domain back.
    expect(
      screen.queryByRole("button", { name: "versions.addressMove" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "versions.addressBack" }));
    await user.click(screen.getByRole("button", { name: "domain.confirmAction" }));

    await waitFor(() =>
      expect(mocks.setDomainPrimary).toHaveBeenCalledWith({
        libraryId: "library_123",
        domainId: "domain_1",
        primary: false,
      }),
    );
    expect(mocks.startAddressMove).not.toHaveBeenCalled();
  });

  it("does not offer a move while an operation runs", async () => {
    mocks.addressNotices.mockReturnValue([
      {
        libraryId: "library_123",
        address: "https://climate-lib.example.test",
        movedFrom: null,
        addressState: "unreachable",
      },
    ]);
    await renderSection({ operationRunning: true });
    expect(
      screen.getByRole("button", { name: "versions.addressMove" }),
    ).toBeDisabled();
  });

  it("does not check software for a library that is not live", async () => {
    await renderSection({ live: false });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(screen.getByText("versions.notRunning")).toBeInTheDocument();
  });

  it("keeps the release and disabled actions through an update and its final check", async () => {
    const updated = {
      running: "bbbbbbb1234",
      latest: "bbbbbbb1234",
      changes: [],
      releases: [],
      checkedAt: 2,
    };
    const props = {
      libraryId: "library_123" as never,
      live: true,
      operationRunning: true,
      refreshKey: "base",
    };
    let rerender!: ReturnType<typeof render>["rerender"];
    await act(async () => {
      ({ rerender } = render(<VersionsSection {...props} />));
    });
    expect(screen.getByText("Faster search")).toBeVisible();
    expect(screen.getByRole("button", { name: "versions.update" })).toBeDisabled();

    let resolve!: (value: typeof updated) => void;
    mocks.check.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => {
      rerender(<VersionsSection {...props} operationRunning={false} refreshKey="runtime-update-succeeded" />);
    });

    expect(screen.getByText("Faster search")).toBeVisible();
    expect(screen.queryByText("versions.checking")).toBeNull();
    expect(screen.getByRole("button", { name: "versions.update" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "versions.checkAgain" })).toBeDisabled();

    await act(async () => { resolve(updated); });

    expect(screen.getByText("versions.upToDate")).toBeVisible();
    expect(screen.queryByRole("button", { name: "versions.update" })).toBeNull();
    expect(screen.getByRole("button", { name: "versions.checkAgain" })).toBeEnabled();
  });

});
