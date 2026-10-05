/** @vitest-environment jsdom */
import { useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TableView } from "@/components/extraction/results-views/table-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PaperWithResults } from "@/lib/extraction/filtering";
import type { Id } from "@/convex/_generated/dataModel";
import messages from "@/messages/en-US.json";

vi.hoisted(() => vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://selection-test.convex.cloud"));
afterEach(cleanup);

const papers: PaperWithResults[] = ["First paper", "Second paper"].map((title, i) => ({
  _id: `paper-${i}` as Id<"extractionPapers">,
  _creationTime: i,
  jobId: "job" as Id<"extractionJobs">,
  openalexId: `oa:${i}`,
  title,
  status: "completed",
  results: [],
}));

function SelectionTable() {
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [visible, setVisible] = useState(papers);
  return <NextIntlClientProvider locale="en-US" messages={messages}><TooltipProvider>
    <button onClick={() => setVisible(papers.slice(1))}>Filter</button>
    <button onClick={() => setVisible(papers)}>Show all</button>
    <button onClick={() => setVisible([])}>Show none</button>
    <TableView papers={visible} questions={[]} selectedIds={selectedIds}
      onSelectionChange={setSelectedIds} onOpenAnswer={() => {}} usePdfs={false} />
  </TooltipProvider></NextIntlClientProvider>;
}

it("selects and deselects visible papers without losing hidden selections", () => {
  render(<SelectionTable />);
  const row = (name: string) => screen.getByRole("checkbox", { name });
  const all = () => within(screen.getByRole("columnheader", { name: "Paper" })).getByRole("checkbox");
  fireEvent.click(row("First paper"));
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(all()).not.toBeChecked();
  fireEvent.click(all());
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(row("First paper")).toBeChecked();
  expect(row("Second paper")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(all());
  fireEvent.click(screen.getByRole("button", { name: "Show none" }));
  fireEvent.click(all());
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(row("First paper")).toBeChecked();
  expect(row("Second paper")).not.toBeChecked();
  expect(all()).toBePartiallyChecked();
});
