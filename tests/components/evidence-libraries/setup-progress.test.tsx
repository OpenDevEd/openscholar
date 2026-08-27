/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), retrySetup: vi.fn() }));

vi.mock("convex/react", () => ({ useMutation: () => mocks.retrySetup }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    evidenceLibraries: {
      queries: { getSetupDraftSelection: "getSetupDraftSelection" },
      mutations: { retrySetup: "retrySetup" },
    },
  },
}));
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (query: unknown, args: unknown) => mocks.query(query, args),
}));
vi.mock("@/components/auth/auth-state-panel", () => ({
  AuthStatePanel: ({ variant }: { variant: string }) => <p>{variant}</p>,
}));

import { SetupProgress } from "@/components/evidence-libraries/setup-progress";

// The spinner inside a running step is also a status region; the page region carries the data attribute.
function pageStatus() {
  const region = screen.getAllByRole("status").find((el) => el.hasAttribute("data-setup-status"));
  if (!region) throw new Error("Setup status region not rendered");
  return region;
}

function setup(
  libraryState: "provisioning" | "active",
  operation: { status: string; stage: string; error?: { code: string; message: string; stage: string } },
) {
  return {
    library: { _id: "lib_1", state: libraryState },
    identity: { name: "Climate Evidence" },
    publicAddress: "https://climate-lib.example.test",
    setupOperation: {
      ...operation,
      setupReceipts: { database: { checkedAt: Date.UTC(2026, 7, 26, 10, 0, 0) } },
      updatedAt: Date.UTC(2026, 7, 26, 10, 5, 0),
    },
  };
}

describe("<SetupProgress>", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.retrySetup.mockReset();
  });

  it("shows the running step with the finished ones before it", () => {
    mocks.query.mockReturnValue({
      data: setup("provisioning", { status: "running", stage: "storage" }),
      isReady: true,
    });

    render(<SetupProgress libraryId="lib_1" />);

    expect(mocks.query).toHaveBeenCalledWith("getSetupDraftSelection", { libraryId: "lib_1" });
    const status = pageStatus();
    expect(status).toHaveAttribute("data-setup-status", "setting_up");
    expect(status).toHaveAttribute("data-setup-step", "storage");
    const items = within(status).getAllByRole("listitem");
    expect(items.map((item) => item.dataset.state)).toEqual([
      "done", "running", "waiting", "waiting", "waiting", "waiting",
    ]);
    expect(within(items[0]).getByText("2026-08-26T10:00:00.000Z")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "retry" })).not.toBeInTheDocument();
  });

  it("shows the failure as an alert with the saved error and retries the setup", async () => {
    const user = userEvent.setup();
    mocks.query.mockReturnValue({
      data: setup("provisioning", {
        status: "failed",
        stage: "storage",
        error: { code: "STORAGE_UNAVAILABLE", message: "Storage did not answer.", stage: "storage" },
      }),
      isReady: true,
    });
    mocks.retrySetup.mockResolvedValue({ operationId: "op_1", status: "running" });

    render(<SetupProgress libraryId="lib_1" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-setup-status", "setup_failed");
    expect(within(alert).getByText("Storage did not answer.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "retry" })[0]);
    await waitFor(() => expect(mocks.retrySetup).toHaveBeenCalledWith({ libraryId: "lib_1" }));
  });

  it("shows every step done and the admin link once the library is live", () => {
    mocks.query.mockReturnValue({
      data: setup("active", { status: "succeeded", stage: "completed" }),
      isReady: true,
    });

    render(<SetupProgress libraryId="lib_1" />);

    const status = pageStatus();
    expect(status).toHaveAttribute("data-setup-status", "active");
    expect(within(status).getAllByRole("listitem").every((item) => item.dataset.state === "done")).toBe(true);
    expect(screen.getByRole("link", { name: "openAdmin" })).toHaveAttribute("href", "/evidence-libraries/lib_1/admin");
    expect(screen.getByRole("link", { name: "openLibrary" })).toHaveAttribute("href", "https://climate-lib.example.test");
  });

  it("points a draft to the configuration page instead of starting setup here", () => {
    mocks.query.mockReturnValue({
      data: setup("provisioning", { status: "queued", stage: "queued" }),
      isReady: true,
    });

    render(<SetupProgress libraryId="lib_1" />);

    expect(pageStatus()).toHaveAttribute("data-setup-status", "draft");
    expect(screen.getAllByRole("link", { name: "configure" })[0]).toHaveAttribute(
      "href",
      "/evidence-libraries/lib_1/configuration",
    );
  });

  it("shows not found when the library is not in this organisation", () => {
    mocks.query.mockReturnValue({ data: null, isReady: true });

    render(<SetupProgress libraryId="lib_missing" />);

    expect(screen.getByRole("status")).toHaveAttribute("data-library-not-found");
  });
});
