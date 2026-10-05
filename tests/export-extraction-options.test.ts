import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Papa from "papaparse";
import { exportToCSV, exportToJSON } from "../lib/extraction/export";
import { exportJob, exportPapers, exportQuestions } from "./fixtures/extraction-export";

let downloaded: Blob;
beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL: (blob: Blob) => { downloaded = blob; return "blob:export"; }, revokeObjectURL: vi.fn() });
  vi.stubGlobal("document", { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } });
});
afterEach(() => vi.unstubAllGlobals());

describe("researcher export contents", () => {
  it("CSV preserves identifiers, zero, false, Unicode arrays and exact evidence", async () => {
    exportToCSV(exportPapers, exportQuestions, { job: exportJob });
    const parsed = Papa.parse<Record<string, string>>(await downloaded.text(), { header: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toHaveLength(1);
    const row = parsed.data[0];
    expect(row["Paper ID"]).toBe(exportPapers[0]._id);
    expect(row["Paper Source Type"]).toBe("screening");
    expect(row["Paper Source ID"]).toBe("screening-origin");
    expect(row["Screening Decision Revision"]).toBe("2:completed:3");
    expect(row["OpenAlex ID"]).toBe("https://openalex.org/W123");
    expect(row["Paper Title"]).toBe(exportPapers[0].title);
    expect(row["[zero] Reported outcome"]).toBe("0");
    expect(row["[false] Reported outcome"]).toBe("No");
    expect(row["[zero] Reported outcome (Confidence)"]).toBe("0");
    expect(row["[zero] Reported outcome (Model confidence)"]).toBe("0.95");
    expect(row["[zero] Reported outcome (Reasoning)"]).toBe(exportPapers[0].results[0].reasoning);
    expect(JSON.parse(row["[zero] Reported outcome (Citations)"])).toEqual(exportPapers[0].results[0].citations);
    expect(JSON.parse(row["[names] Languages"])).toEqual(exportPapers[0].results[2].answer);
    expect(JSON.parse(row.Authors)).toEqual(exportPapers[0].authors);
    expect(row["PDF Used"]).toBe("Unknown");
    expect(row["PDF Enabled"]).toBe("No");
    expect(row["[zero] Reported outcome (Model)"]).toBe("openai/gpt-6-luna");
  });

  it("JSON includes every question, with separate missing, null and failed results", async () => {
    exportToJSON(exportPapers, exportQuestions, { job: exportJob });
    const data = JSON.parse(await downloaded.text());
    expect(data.format).toBe("openscholar.extraction");
    expect(data.version).toBe(2);
    expect(data.papers[0]).toMatchObject({ sourceType: "screening", sourceId: "screening-origin", screeningRevision: "2:completed:3" });
    expect(data.job).toMatchObject({ id: exportJob._id, runEpoch: 2, pdfEnabled: false });
    expect(data.papers[0].results.map((r: { questionKey: string }) => r.questionKey)).toEqual(exportQuestions.map(q => q.key));
    expect(data.papers[0].results[0]).toMatchObject({ answer: 0, confidence: 0, modelConfidence: 0.95, source: "abstract", model: "openai/gpt-6-luna", citations: exportPapers[0].results[0].citations });
    expect(data.papers[0].results[1].answer).toBe(false);
    expect(data.papers[0].results[2].answer).toEqual(exportPapers[0].results[2].answer);
    expect(data.papers[0].results[3]).toMatchObject({ answer: null, status: "completed", modelConfidence: null });
    expect(data.papers[0].results[4]).toMatchObject({ answer: null, status: "failed" });
    expect(data.papers[0].results[5]).toMatchObject({ answer: null, status: "missing" });
    expect(data.papers[0]).toMatchObject({ openAccess: null, pdfUsed: null });
  });

  it("leaves an uncited source unknown when PDF evidence was not used", async () => {
    const papers = exportPapers.map(paper => ({ ...paper, results: paper.results.map(result => ({ ...result, citations: [], pdfContentUsed: false })) }));
    exportToJSON(papers, exportQuestions);
    const data = JSON.parse(await downloaded.text());
    expect(data.papers[0].results.map((r: { source: unknown }) => r.source)).toEqual(exportQuestions.map(() => null));
  });

  it.each(["csv", "json"] as const)("%s honors every exclusion option", async format => {
    const options = { job: exportJob, includeMetadata: false, includeConfidence: false, includeReasoning: false, includeCitations: false };
    if (format === "csv") exportToCSV(exportPapers, exportQuestions, options);
    else exportToJSON(exportPapers, exportQuestions, options);
    if (format === "csv") {
      const parsed = Papa.parse(await downloaded.text(), { header: true });
      expect(parsed.meta.fields).not.toContain("Authors");
      expect(parsed.meta.fields?.filter(h => /\((?:Confidence|Model confidence|Reasoning|Citations)\)$/.test(h))).toEqual([]);
    } else {
      const data = JSON.parse(await downloaded.text());
      expect(data.papers[0]).not.toHaveProperty("authors");
      for (const key of ["confidence", "modelConfidence", "reasoning", "citations"]) expect(data.papers[0].results[0]).not.toHaveProperty(key);
      expect(data.papers[0].results[0].citationStatus).toBe("grounded");
    }
  });
});
