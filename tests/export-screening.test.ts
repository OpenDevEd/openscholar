import { describe, it, expect } from 'vitest';
import {
  generateScreeningXLSXWorkbook as buildWorkbook,
  formatScreeningAnswer,
  screeningExportFiles,
  type ScreeningExportJob,
  type ScreeningExportResult,
} from '../lib/screening/export';

type ScreeningExportData = { job: ScreeningExportJob & { _id: string }; results: ScreeningExportResult[] };

// Each file put together as the server streams it: a start, each result, an end.
function generateScreeningCSV({ job, results }: ScreeningExportData) {
  const file = screeningExportFiles(job).csv;
  return file.start() + results.map(file.item).join('') + file.end();
}
function generateScreeningJSON({ job, results }: ScreeningExportData) {
  const file = screeningExportFiles(job).json;
  return file.start(new Date()) + results.map(file.item).join('') + file.end(results.length);
}
// The workbook takes its results a page at a time.
const generateScreeningXLSXWorkbook = ({ job, results }: ScreeningExportData) =>
  buildWorkbook(job, (async function* () { yield results.slice(0, 1); yield results.slice(1); })());

const mockData: ScreeningExportData = {
  job: {
    _id: 'j_test123' as string,
    status: 'completed',
    questions: [
      { key: 'q1', question: 'Is this a clinical trial?' },
      { key: 'q2', question: 'Sample size > 100?' },
    ],
    scoringConfig: {
      rules: [
        { questionKey: 'q1', yesPoints: 2, noPoints: 0, nullPoints: 0 },
        { questionKey: 'q2', yesPoints: 1, noPoints: 0, nullPoints: 0 },
      ],
      starThresholds: [
        { minScore: 0, stars: 1 },
        { minScore: 2, stars: 2 },
      ],
      minimumScore: 1,
    },
    totalPapers: 3,
    qualifiedPapers: 1,
    createdAt: 1709913600000, // 2024-03-08T16:00:00Z
    completedAt: 1709917200000,
  },
  results: [
    {
      openalexId: 'W123',
      title: 'A Great Paper',
      authors: ['Smith, J.', 'Jones, K.'],
      publicationYear: 2024,
      doi: '10.1234/test',
      status: 'completed',
      answers: { q1: true, q2: false },
      score: 2,
      stars: 2,
      qualified: true,
    },
    {
      openalexId: 'W456',
      title: 'Paper with, comma',
      authors: ['Lee, M.'],
      publicationYear: 2023,
      doi: undefined,
      status: 'completed',
      answers: { q1: false, q2: null },
      score: 0,
      stars: 1,
      qualified: false,
    },
    {
      openalexId: 'W789',
      title: 'Failed Paper',
      status: 'failed',
      // No authors, publicationYear, doi, answers, score, stars, qualified
    },
  ],
};

describe('Screening Export', () => {
  describe('formatScreeningAnswer', () => {
    it('returns Yes for true', () => {
      expect(formatScreeningAnswer(true)).toBe('Yes');
    });

    it('returns No for false', () => {
      expect(formatScreeningAnswer(false)).toBe('No');
    });

    it('returns N/A for null', () => {
      expect(formatScreeningAnswer(null)).toBe('N/A');
    });

    it('returns N/A for undefined', () => {
      expect(formatScreeningAnswer(undefined)).toBe('N/A');
    });
  });

  describe('generateScreeningCSV', () => {
    it('has correct headers with dynamic question columns', () => {
      const csv = generateScreeningCSV(mockData);
      const headerLine = csv.split('\n')[0];
      expect(headerLine).toContain('Title');
      expect(headerLine).toContain('Authors');
      expect(headerLine).toContain('Year');
      expect(headerLine).toContain('DOI');
      expect(headerLine).toContain('OpenAlex ID');
      expect(headerLine).toContain('Is this a clinical trial?');
      expect(headerLine).toContain('Sample size > 100?');
      expect(headerLine).toContain('Score');
      expect(headerLine).toContain('Stars');
      expect(headerLine).toContain('Qualified');
      expect(headerLine).toContain('Status');
    });

    it('formats answers as Yes/No/N/A', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      // First result: q1=true -> Yes, q2=false -> No
      expect(lines[1]).toContain('Yes');
      expect(lines[1]).toContain('No');
      // Second result: q1=false -> No, q2=null -> N/A
      expect(lines[2]).toContain('N/A');
    });

    it('includes scoring columns', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      // First result: score=2, stars=2, qualified=true
      expect(lines[1]).toContain('2');
      expect(lines[1]).toContain('completed');
    });

    it('escapes fields with commas', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      // Second result has title "Paper with, comma" -- should be quoted
      expect(lines[2]).toContain('"Paper with, comma"');
    });

    it('handles failed/skipped results with N/A and empty scoring', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      // Third result (failed): answers -> N/A, score/stars/qualified -> empty
      const failedLine = lines[3];
      expect(failedLine).toContain('Failed Paper');
      expect(failedLine).toContain('failed');
      // Should have N/A for both question answers
      const naCounts = (failedLine.match(/N\/A/g) || []).length;
      expect(naCounts).toBe(2);
    });
  });

  describe('generateScreeningJSON', () => {
    it('has envelope structure with job metadata', () => {
      const json = generateScreeningJSON(mockData);
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('exportedAt');
      expect(parsed).toHaveProperty('job');
      expect(parsed).toHaveProperty('results');
      expect(parsed.job).toHaveProperty('status', 'completed');
      expect(parsed.job).toHaveProperty('totalPapers', 3);
      expect(parsed.job).toHaveProperty('qualifiedPapers', 1);
      expect(parsed.job).toHaveProperty('questions');
      expect(parsed.job).toHaveProperty('scoringConfig');
    });

    it('formats dates as ISO strings', () => {
      const json = generateScreeningJSON(mockData);
      const parsed = JSON.parse(json);
      expect(parsed.job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.job.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('uses explicit nulls for missing fields', () => {
      const json = generateScreeningJSON(mockData);
      const parsed = JSON.parse(json);
      // Failed result should have explicit nulls
      const failedResult = parsed.results.find(
        (r: { openalexId: string }) => r.openalexId === 'W789'
      );
      expect(failedResult.answers).toBeNull();
      expect(failedResult.score).toBeNull();
      expect(failedResult.stars).toBeNull();
      expect(failedResult.qualified).toBeNull();
      expect(failedResult.publicationYear).toBeNull();
      expect(failedResult.doi).toBeNull();
    });

    it('defaults authors to empty array when undefined', () => {
      const json = generateScreeningJSON(mockData);
      const parsed = JSON.parse(json);
      const failedResult = parsed.results.find(
        (r: { openalexId: string }) => r.openalexId === 'W789'
      );
      expect(failedResult.authors).toEqual([]);
    });

    it('is the whole export printed at once, and valid with no results', () => {
      const parsed = JSON.parse(generateScreeningJSON(mockData));
      expect(generateScreeningJSON(mockData)).toBe(JSON.stringify(parsed, null, 2));
      const empty = generateScreeningJSON({ ...mockData, results: [] });
      expect(empty).toBe(JSON.stringify(JSON.parse(empty), null, 2));
      expect(JSON.parse(empty).results).toEqual([]);
    });

    it('uses 2-space indentation', () => {
      const json = generateScreeningJSON(mockData);
      // Check that lines are indented with 2 spaces
      expect(json).toContain('\n  ');
    });
  });

  describe('generateScreeningXLSXWorkbook', () => {
    it('creates Results sheet with correct headers and data', async () => {
      const workbook = await generateScreeningXLSXWorkbook(mockData);
      const resultsSheet = workbook.getWorksheet('Results');
      expect(resultsSheet).toBeDefined();

      // Check headers
      const headerRow = resultsSheet!.getRow(1);
      const headers = headerRow.values as (string | undefined)[];
      // ExcelJS row values are 1-indexed (index 0 is undefined)
      expect(headers).toContain('Title');
      expect(headers).toContain('Authors');
      expect(headers).toContain('Year');
      expect(headers).toContain('DOI');
      expect(headers).toContain('OpenAlex ID');
      expect(headers).toContain('Is this a clinical trial?');
      expect(headers).toContain('Sample size > 100?');
      expect(headers).toContain('Score');
      expect(headers).toContain('Stars');
      expect(headers).toContain('Qualified');
      expect(headers).toContain('Status');

      // Check first data row
      const dataRow = resultsSheet!.getRow(2);
      const values = dataRow.values as (string | number | undefined)[];
      expect(values).toContain('A Great Paper');
      expect(values).toContain('W123');
    });

    it('creates Summary sheet with job info section', async () => {
      const workbook = await generateScreeningXLSXWorkbook(mockData);
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();

      // Job Info header
      const firstRow = summarySheet!.getRow(1);
      expect(firstRow.values).toContain('Job Info');
    });

    it('creates Summary sheet with scoring rules and star thresholds', async () => {
      const workbook = await generateScreeningXLSXWorkbook(mockData);
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();

      // Find scoring rules section by scanning rows
      let foundScoringRules = false;
      let foundStarThresholds = false;
      summarySheet!.eachRow((row) => {
        const vals = row.values as (string | number | undefined)[];
        if (vals?.includes('Scoring Rules')) foundScoringRules = true;
        if (vals?.includes('Star Thresholds')) foundStarThresholds = true;
      });
      expect(foundScoringRules).toBe(true);
      expect(foundStarThresholds).toBe(true);
    });

    it('creates Summary sheet with statistics', async () => {
      const workbook = await generateScreeningXLSXWorkbook(mockData);
      const summarySheet = workbook.getWorksheet('Summary');
      expect(summarySheet).toBeDefined();

      let foundStatistics = false;
      summarySheet!.eachRow((row) => {
        const vals = row.values as (string | number | undefined)[];
        if (vals?.includes('Statistics')) foundStatistics = true;
      });
      expect(foundStatistics).toBe(true);
    });

    it('handles failed/skipped results without crashing', async () => {
      const dataWithSkipped: ScreeningExportData = {
        ...mockData,
        results: [
          {
            openalexId: 'W999',
            title: 'Skipped Paper',
            status: 'skipped',
          },
          {
            openalexId: 'W789',
            title: 'Failed Paper',
            status: 'failed',
          },
        ],
      };
      // Should not throw
      const workbook = await generateScreeningXLSXWorkbook(dataWithSkipped);
      const resultsSheet = workbook.getWorksheet('Results');
      expect(resultsSheet).toBeDefined();
      // Should have header + 2 data rows
      expect(resultsSheet!.rowCount).toBe(3);
    });
  });
});
