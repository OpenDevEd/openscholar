/**
 * @vitest-environment jsdom
 *
 * An export canceled while its papers load never downloads (#352).
 */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExportDialog } from "@/components/extraction/export-dialog";

const { exportToCSV } = vi.hoisted(() => ({ exportToCSV: vi.fn() }));
vi.mock("@/lib/extraction/export", () => ({ exportToCSV, exportToJSON: vi.fn(), exportToExcel: vi.fn() }));
vi.mock("@/lib/toast", () => ({ useAppToast: () => ({ io: { downloadFailed: vi.fn() } }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

function Harness({ loadPapers }: { loadPapers: () => Promise<never[]> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <ExportDialog open={open} onOpenChange={setOpen} loadPapers={loadPapers} paperCount={3} questions={[]} />
    </>
  );
}

describe("ExportDialog", () => {
  it("drops an export canceled while its papers load", async () => {
    let finish: (papers: never[]) => void = () => {};
    const loadPapers = vi.fn(() => new Promise<never[]>((resolve) => { finish = resolve; }));
    render(<Harness loadPapers={loadPapers} />);

    fireEvent.click(screen.getByRole("button", { name: /exportButton/ }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen", hidden: true }));
    finish([]);

    await waitFor(() => expect(loadPapers).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exportToCSV).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
