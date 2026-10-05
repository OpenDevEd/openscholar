import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { exportToExcel } from "../lib/extraction/export";
import { exportJob, exportPapers, exportQuestions } from "./fixtures/extraction-export";

let downloaded: Blob;
const click = vi.fn();
beforeEach(() => {
  click.mockClear();
  vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { downloaded = blob; return "blob:export"; }, revokeObjectURL: vi.fn() });
  vi.stubGlobal("document", { createElement: () => ({ click }), body: { appendChild() {}, removeChild() {} } });
});
afterEach(() => vi.unstubAllGlobals());

it("downloads the production workbook with complete results, evidence and job metadata", async () => {
  await exportToExcel(exportPapers, exportQuestions, { job: exportJob });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloaded.arrayBuffer());
  const sheet = workbook.getWorksheet("Results")!;
  const headers = sheet.getRow(1).values as string[];
  const value = (name: string) => sheet.getRow(2).getCell(headers.indexOf(name)).value;
  expect(sheet.rowCount).toBe(2);
  expect(value("Paper ID")).toBe(exportPapers[0]._id);
  expect(value("Paper Source Type")).toBe("screening");
  expect(value("Paper Source ID")).toBe("screening-origin");
  expect(value("Screening Decision Revision")).toBe("2:completed:3");
  expect(value("[zero] Reported outcome")).toBe(0);
  expect(value("[zero] Reported outcome (Confidence)")).toBe(0);
  expect(value("[zero] Reported outcome (Model confidence)")).toBe(0.95);
  expect(value("[false] Reported outcome")).toBe("No");
  expect(JSON.parse(String(value("[names] Languages")))).toEqual(exportPapers[0].results[2].answer);
  const evidence = workbook.getWorksheet("Evidence")!;
  expect(evidence.rowCount).toBe(2);
  expect(evidence.getRow(2).values).toEqual([undefined, exportPapers[0]._id, "zero", "abstract", "abstract-fixture", "a".repeat(64), "", 0, 32, "No adverse events were reported."]);
  expect(workbook.getWorksheet("Questions")!.rowCount).toBe(7);
  expect(workbook.getWorksheet("Job")!.getRow(2).values).toContain(exportJob._id);
  const summary = workbook.getWorksheet("Summary")!;
  const summaryHeaders = summary.getRow(1).values as string[];
  expect(summary.getRow(2).getCell(summaryHeaders.indexOf("Completed")).value).toBe(1);
  expect(summary.getRow(2).getCell(summaryHeaders.indexOf("Average Confidence")).value).toBe(0);
});

it("omits optional workbook contents and stops a canceled download after encoding", async () => {
  await exportToExcel(exportPapers, exportQuestions, { job: exportJob, includeMetadata: false, includeConfidence: false, includeReasoning: false, includeCitations: false });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloaded.arrayBuffer());
  expect(workbook.getWorksheet("Evidence")).toBeUndefined();
  const headers = workbook.getWorksheet("Results")!.getRow(1).values as string[];
  expect(headers).not.toContain("Authors");
  expect(headers.filter(h => /\((?:Confidence|Model confidence|Reasoning|Citations)\)$/.test(h))).toEqual([]);
  click.mockClear();
  const controller = new AbortController();
  const pending = exportToExcel(exportPapers, exportQuestions, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(click).not.toHaveBeenCalled();
});

it("keeps long citation lists in the Evidence sheet instead of overflowing a Results cell", async () => {
  const result = exportPapers[0].results[0];
  const citations = Array.from({ length: 50 }, (_, i) => ({ ...result.citations[0], evidenceId: `evidence-${i}`, quote: "تعليم ".repeat(150) }));
  const papers = [{ ...exportPapers[0], results: [{ ...result, citations }] }];
  await exportToExcel(papers, [exportQuestions[0]]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await downloaded.arrayBuffer());
  const evidence = workbook.getWorksheet("Evidence")!;
  expect(evidence.rowCount).toBe(51);
  for (let i = 0; i < citations.length; i++) {
    expect(evidence.getRow(i + 2).getCell(4).value).toBe(citations[i].evidenceId);
    expect(evidence.getRow(i + 2).getCell(9).value).toBe(citations[i].quote);
  }
});

it("refuses an oversized Excel field without downloading truncated text", async () => {
  const papers = [{ ...exportPapers[0], title: "ع".repeat(32768) }];
  await expect(exportToExcel(papers, exportQuestions)).rejects.toMatchObject({ code: "excelCellLimit" });
  expect(click).not.toHaveBeenCalled();
});

it("refuses more evidence than an Excel sheet can hold before building the workbook", async () => {
  const result = exportPapers[0].results[0];
  const results = Array.from({ length: 21 }, (_, i) => ({ ...result, questionKey: `q${i}`, citations: Array(50).fill(result.citations[0]) }));
  const questions = results.map(r => ({ ...exportQuestions[0], key: r.questionKey }));
  const papers = Array(1000).fill({ ...exportPapers[0], results });
  await expect(exportToExcel(papers, questions)).rejects.toMatchObject({ code: "excelRowLimit" });
  expect(click).not.toHaveBeenCalled();
});
