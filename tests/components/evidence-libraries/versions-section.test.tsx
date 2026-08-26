/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  startRuntimeUpdate: vi.fn(),
  restoreRevision: vi.fn(),
  listVersions: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      updates: { check: "check" },
      versions: {
        listVersions: "listVersions",
        startRuntimeUpdate: "startRuntimeUpdate",
        restoreRevision: "restoreRevision",
      },
    },
  },
}));

vi.mock("convex/react", () => ({
  useAction: () => mocks.check,
  useMutation: (reference: string) =>
    reference === "startRuntimeUpdate"
      ? mocks.startRuntimeUpdate
      : mocks.restoreRevision,
}));

vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: () => ({ data: mocks.listVersions(), isReady: true }),
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
    mocks.check.mockReset();
    mocks.startRuntimeUpdate.mockReset();
    mocks.restoreRevision.mockReset();
    mocks.listVersions.mockReset();
    mocks.toast.mockReset();
    mocks.toast.error.mockReset();
    mocks.check.mockResolvedValue({
      running: "aaaaaaa1234",
      latest: "bbbbbbb1234",
      changes: [{ sha: "bbbbbbb1234", message: "Faster search" }],
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
      checkedAt: Date.UTC(2026, 7, 26, 12, 0),
    });
    await renderSection();
    expect(screen.getByText("versions.upToDate")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "versions.update" })).toBeNull();
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
    // Changed rows are named by their page card; a software update names the commit.
    expect(row("r3").getByText("sections.identity, sections.contact")).toBeInTheDocument();
    expect(row("r2").getByText("versions.softwareUpdate bbbbbbb")).toBeInTheDocument();
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

  it("does not check software for a library that is not live", async () => {
    await renderSection({ live: false });
    expect(mocks.check).not.toHaveBeenCalled();
    expect(screen.getByText("versions.notRunning")).toBeInTheDocument();
  });
});
