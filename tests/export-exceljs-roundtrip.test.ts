import { describe, it, expect } from 'vitest';

describe('ExcelJS round-trip export', () => {
  it('generates valid XLSX with correct Results sheet headers and data', async () => {
    const mod = await import('exceljs');
    const ExcelJSModule = 'default' in mod ? (mod as Record<string, typeof mod>).default : mod;

    // Generate workbook using same pattern as exportToExcel
    const workbook = new ExcelJSModule.Workbook();
    const resultsSheet = workbook.addWorksheet('Results');
    resultsSheet.addRow(['Title', 'DOI', 'Year', 'Authors', 'Open Access', 'PDF Used']);
    resultsSheet.addRow(['Test Paper One', '10.1234/test', 2024, 'Smith; Jones', 'Yes', 'No']);
    resultsSheet.addRow(['Second Paper', '', 2023, '', 'No', 'Yes']);

    // Write to buffer and parse back
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = new ExcelJSModule.Workbook();
    await parsed.xlsx.load(buffer as Buffer);

    // Assert Results sheet
    const sheet = parsed.getWorksheet('Results');
    expect(sheet).toBeDefined();
    expect(sheet!.rowCount).toBe(3); // header + 2 data rows

    // Assert headers
    const headerRow = sheet!.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Title');
    expect(headerRow.getCell(2).value).toBe('DOI');
    expect(headerRow.getCell(3).value).toBe('Year');

    // Assert data row 1
    const dataRow1 = sheet!.getRow(2);
    expect(dataRow1.getCell(1).value).toBe('Test Paper One');
    expect(dataRow1.getCell(2).value).toBe('10.1234/test');
    expect(dataRow1.getCell(3).value).toBe(2024);
    expect(dataRow1.getCell(4).value).toBe('Smith; Jones');

    // Assert data row 2 (empty DOI should round-trip as null for empty string)
    const dataRow2 = sheet!.getRow(3);
    expect(dataRow2.getCell(1).value).toBe('Second Paper');
    // Empty strings in ExcelJS may round-trip as null
    expect(dataRow2.getCell(2).value).toBeOneOf(['', null]);
    expect(dataRow2.getCell(3).value).toBe(2023);
  });

  it('generates valid Questions and Summary sheets', async () => {
    const mod = await import('exceljs');
    const ExcelJSModule = 'default' in mod ? (mod as Record<string, typeof mod>).default : mod;

    const workbook = new ExcelJSModule.Workbook();

    // Questions sheet
    const questionsSheet = workbook.addWorksheet('Questions');
    questionsSheet.addRow(['Key', 'Question', 'Type', 'Description']);
    questionsSheet.addRow(['q1', 'What is the sample size?', 'number', 'Total participants']);

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.addRow(['Question', 'Average Confidence', 'Completed', 'Total Papers', 'Completion Rate']);
    summarySheet.addRow(['What is the sample size?', 0.85, 8, 10, '80%']);

    // Write and parse back
    const buffer = await workbook.xlsx.writeBuffer();
    const parsed = new ExcelJSModule.Workbook();
    await parsed.xlsx.load(buffer as Buffer);

    // Assert Questions sheet
    const qSheet = parsed.getWorksheet('Questions');
    expect(qSheet).toBeDefined();
    expect(qSheet!.getRow(1).getCell(1).value).toBe('Key');
    expect(qSheet!.getRow(2).getCell(1).value).toBe('q1');
    expect(qSheet!.getRow(2).getCell(2).value).toBe('What is the sample size?');
    expect(qSheet!.getRow(2).getCell(3).value).toBe('number');
    expect(qSheet!.getRow(2).getCell(4).value).toBe('Total participants');

    // Assert Summary sheet
    const sSheet = parsed.getWorksheet('Summary');
    expect(sSheet).toBeDefined();
    expect(sSheet!.getRow(1).getCell(1).value).toBe('Question');
    expect(sSheet!.getRow(1).getCell(2).value).toBe('Average Confidence');
    expect(sSheet!.getRow(2).getCell(1).value).toBe('What is the sample size?');
    expect(sSheet!.getRow(2).getCell(2).value).toBe(0.85);
    expect(sSheet!.getRow(2).getCell(3).value).toBe(8);
    expect(sSheet!.getRow(2).getCell(4).value).toBe(10);
    expect(sSheet!.getRow(2).getCell(5).value).toBe('80%');
  });
});
