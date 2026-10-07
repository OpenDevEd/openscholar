// @vitest-environment jsdom
// A large screening job downloads as several workbooks, each a part of its results (#635).
import { afterEach, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { ConvexReactClient } from 'convex/react';
import type { Id } from '../convex/_generated/dataModel';
import { exportScreeningToXLSX } from '../lib/screening/export';

afterEach(() => vi.restoreAllMocks());

it('downloads a 4,500-paper job as three workbooks holding every result once', async () => {
  const total = 4_500;
  const job = {
    _id: 'j1', status: 'completed', revision: 3, totalPapers: total, qualifiedPapers: 0, createdAt: 1, label: 'Big',
    questions: [{ key: 'q1', question: 'Randomized?' }],
    scoringConfig: { rules: [{ questionKey: 'q1', yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [], minimumScore: 1 },
  };
  // Results pages by cursor, a number for where the next starts.
  const convex = {
    query: vi.fn(async (_ref: unknown, args: { paginationOpts?: { cursor: string | null; numItems: number } }) => {
      if (!args.paginationOpts) return job;
      const from = Number(args.paginationOpts.cursor ?? 0);
      const to = Math.min(total, from + args.paginationOpts.numItems);
      const page = Array.from({ length: to - from }, (_, i) => ({ openalexId: `W${from + i}`, title: `Paper ${from + i}`, status: 'completed', answers: { q1: true }, score: 1, stars: 1, qualified: true }));
      return { page, isDone: to >= total, continueCursor: String(to) };
    }),
  } as unknown as ConvexReactClient;
  const files: Array<{ name: string; blob: Blob }> = [];
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((made: Blob) => ((blob = made), 'blob:x'));
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { files.push({ name: this.download, blob: blob! }); });

  await exportScreeningToXLSX(convex, 'j1' as Id<'screeningJobs'>);

  expect(files.map((file) => file.name)).toEqual([1, 2, 3].map((part) => expect.stringContaining(`(part ${part}).xlsx`)));
  const ids: string[] = [];
  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.blob.arrayBuffer());
    workbook.getWorksheet('Results')!.eachRow((row, at) => { if (at > 1) ids.push(String(row.getCell(1).value)); });
  }
  expect(ids).toHaveLength(total);
  expect(new Set(ids).size).toBe(total);
}, 120_000);
