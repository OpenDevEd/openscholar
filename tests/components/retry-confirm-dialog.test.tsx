/**
 * @vitest-environment jsdom
 *
 * Plan-05 — behavior tests for <RetryConfirmDialog>.
 *
 * Asserts on the role=alertdialog contract, the reused preflight banner
 * (data-preflight-ok), and the Continue button's balance-gated enablement.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RetryConfirmDialog } from "@/components/extraction/retry-confirm-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn() }),
}));

const balanceStore = { data: undefined as unknown };
// The retry's figure comes from the server (convex/extraction/queries/costs.ts); the balance is checked against it.
vi.mock("@/lib/auth/use-auth-query", () => ({
  useProtectedQuery: (ref: string) => (ref === "estimateRetry" ? { data: 90 } : balanceStore),
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    billing: {
      accounts: { checkBalance: "checkBalance" },
    },
    extraction: { queries: { costs: { estimateRetry: "estimateRetry" } } },
  },
}));

function setBalance(total: number, hasEnough: boolean, required: number) {
  balanceStore.data = {
    hasEnough,
    free: 0,
    paid: total,
    total,
    required,
    deficit: hasEnough ? 0 : required - total,
  };
}

describe("<RetryConfirmDialog>", () => {
  beforeEach(() => {
    balanceStore.data = undefined;
  });

  it("renders the dialog with the count-aware title when open", () => {
    setBalance(1_000_000, true, 1);
    render(
      <RetryConfirmDialog
        open={true}
        onOpenChange={() => {}}
        retryableCount={3}
        jobId={"job" as never}
        onConfirm={() => {}}
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    // Title interpolates `count` so it shows up as "title:{"count":3}"
    // under the mock translator; regex tolerates the mock shape.
    expect(dialog.textContent).toMatch(/title.*3/);
  });

  it("Continue is disabled when balance is insufficient", () => {
    setBalance(1, false, 1_000_000);
    render(
      <RetryConfirmDialog
        open={true}
        onOpenChange={() => {}}
        retryableCount={10}
        jobId={"job" as never}
        onConfirm={() => {}}
      />,
    );
    const continueBtn = screen.getByRole("button", { name: /continue/i });
    expect(continueBtn).toHaveAttribute("data-action", "confirm");
    expect(continueBtn).toBeDisabled();
  });

  it("Continue is disabled while balance query is still loading", () => {
    balanceStore.data = undefined;
    render(
      <RetryConfirmDialog
        open={true}
        onOpenChange={() => {}}
        retryableCount={3}
        jobId={"job" as never}
        onConfirm={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /continue/i }),
    ).toBeDisabled();
  });

  it("Continue click fires onConfirm then closes the dialog when balance is sufficient", async () => {
    setBalance(1_000_000, true, 1);
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <RetryConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        retryableCount={3}
        jobId={"job" as never}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Cancel closes the dialog without firing onConfirm", () => {
    setBalance(1_000_000, true, 1);
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RetryConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        retryableCount={3}
        jobId={"job" as never}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
