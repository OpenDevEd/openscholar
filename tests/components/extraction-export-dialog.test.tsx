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

function Harness({ loadExport }: { loadExport: () => Promise<{ papers: never[]; questions: never[] }> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <ExportDialog open={open} onOpenChange={setOpen} loadExport={loadExport} paperCount={3} />
    </>
  );
}

describe("ExportDialog", () => {
  it("drops an export canceled while its papers load", async () => {
    let finish: (data: { papers: never[]; questions: never[] }) => void = () => {};
    const loadExport = vi.fn(() => new Promise<{ papers: never[]; questions: never[] }>((resolve) => { finish = resolve; }));
    render(<Harness loadExport={loadExport} />);

    fireEvent.click(screen.getByRole("button", { name: /exportButton/ }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen", hidden: true }));
    finish({ papers: [], questions: [] });

    await waitFor(() => expect(loadExport).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(exportToCSV).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
