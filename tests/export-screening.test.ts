import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
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
  it('preserves long search provenance once per CSV part and across spreadsheet cells', async () => {
    const snapshot = { request: { oql: 'بحث😀'.repeat(12_000), sort: 'relevance_score:desc' } };
    const data = { ...mockData, job: { ...mockData.job, snapshot } };
    const sheet = await new ExcelJS.Workbook().csv.read(Readable.from([generateScreeningCSV(data)]));
    const headers = (sheet.getRow(1).values as string[]).slice(1);
    const columns = headers.flatMap((name, index) => name.startsWith('Run provenance') ? [index + 1] : []);
    const metadata = columns.map(column => String(sheet.getRow(2).getCell(column).value ?? ''));
    expect(metadata.every(cell => cell.length <= 32_000)).toBe(true);
    expect(JSON.parse(metadata.join('')).searchSnapshot).toEqual(snapshot);
    expect(JSON.parse(String(sheet.getRow(3).getCell(columns[0]).value))).toEqual({ jobId: mockData.job._id, revision: null });
    const workbook = await generateScreeningXLSXWorkbook(data);
    const saved = new ExcelJS.Workbook();
    await saved.xlsx.load(await workbook.xlsx.writeBuffer());
    const parts: string[] = [];
    saved.getWorksheet('Summary')!.eachRow(row => {
      if (String(row.getCell(1).value).startsWith('Search snapshot')) parts.push(String(row.getCell(2).value));
    });
    expect(parts.every(cell => cell.length <= 32_000)).toBe(true);
    expect(JSON.parse(parts.join(''))).toEqual(snapshot);
  });
  it('round-trips CSV and XLSX bytes with provenance, zero confidence and quoted Unicode authors', async () => {
    const data = { ...mockData, results: [{ ...mockData.results[0], title: 'بحث, "quoted"\nsecond line', modelAnswers: { q1: false, q2: null }, modelConfidences: { q1: 0 }, decisions: { q1: { by: 'person' as const, at: 1 } } }] };
    const csv = new ExcelJS.Workbook();
    const sheet = await csv.csv.read(Readable.from([generateScreeningCSV(data)]));
    const values = (sheet.getRow(1).values as string[]).slice(1);
    const read = (name: string) => sheet.getRow(2).getCell(values.indexOf(name) + 1).value;
    expect(read('Title')).toBe(data.results[0].title);
    expect(read('q1: model confidence')).toBe(0);
    expect(read('q1: decided by')).toBe('person');
    expect(JSON.parse(String(read('Run provenance')))).toMatchObject({ jobId: mockData.job._id, scoringConfig: { minimumScore: 1 } });
    expect(sheet.getRow(2).cellCount).toBe(sheet.getRow(1).cellCount);
    const original = await generateScreeningXLSXWorkbook(data);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await original.xlsx.writeBuffer());
    expect(workbook.getWorksheet('Results')!.getRow(2).getCell(1).value).toBe(data.results[0].title);
    const summary = workbook.getWorksheet('Summary')!;
    const metadata = new Map<unknown, unknown>();
    summary.eachRow((row) => metadata.set(row.getCell(1).value, row.getCell(2).value));
    expect(metadata.get('Minimum score')).toBe(1);
    expect(metadata.get('Job ID')).toBe(mockData.job._id);
  });
  describe('formatScreeningAnswer', () => {
    it('returns Yes for true', () => {
      expect(formatScreeningAnswer(true)).toBe('Yes');
    });

    it('returns No for false', () => {
      expect(formatScreeningAnswer(false)).toBe('No');
    });

    it('distinguishes unclear answers from missing ones', () => {
      expect(formatScreeningAnswer(null)).toBe('Unclear');
    });

    it('labels an absent answer', () => {
      expect(formatScreeningAnswer(undefined)).toBe('Not answered');
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

    it('formats answers as Yes, No or Unclear', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      // First result: q1=true -> Yes, q2=false -> No
      expect(lines[1]).toContain('Yes');
      expect(lines[1]).toContain('No');
      expect(lines[2]).toContain('Unclear');
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

    it('keeps failed results distinct from unclear decisions', () => {
      const csv = generateScreeningCSV(mockData);
      const lines = csv.split('\n');
      const failedLine = lines[3];
      expect(failedLine).toContain('Failed Paper');
      expect(failedLine).toContain('failed');
      expect(failedLine).not.toContain('Unclear');
      expect(failedLine).toContain('Not answered,Not answered,,,,failed');
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

    it('writes answer keys in one order, however the answers were read', () => {
      const answers = Object.fromEntries(['q2', 'q10', 'q0', 'q1'].map((key) => [key, true]));
      const parsed = JSON.parse(generateScreeningJSON({ ...mockData, results: [{ ...mockData.results[0], answers }] }));
      expect(Object.keys(parsed.results[0].answers)).toEqual(['q0', 'q1', 'q10', 'q2']);
    });

    it('is the whole export printed at once, and valid with no results', () => {
      // One export, read twice: a second export would carry a later time.
      const whole = generateScreeningJSON(mockData);
      expect(whole).toBe(JSON.stringify(JSON.parse(whole), null, 2));
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
      expect(headers).toContain('q1: Is this a clinical trial?');
      expect(headers).toContain('q2: Sample size > 100?');
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
