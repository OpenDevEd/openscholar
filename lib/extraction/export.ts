import type { PaperWithResults, Question } from './filtering';
import * as XLSX from 'xlsx';

/**
 * Downloads a file with the given content
 */
function downloadFile(content: string | Blob, filename: string, mimeType: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Formats answer for CSV export
 */
export function formatAnswerForCSV(answer: any, type: string): string {
  if (answer === null || answer === undefined) return '';

  if (type === 'boolean') {
    return answer ? 'Yes' : 'No';
  }

  if (Array.isArray(answer)) {
    return answer.join('; ');
  }

  return String(answer);
}

/**
 * Formats answer for Excel export
 */
export function formatAnswerForExcel(answer: any, type: string): any {
  if (answer === null || answer === undefined) return '';

  if (type === 'boolean') {
    return answer ? 'Yes' : 'No';
  }

  if (Array.isArray(answer)) {
    return answer.join('; ');
  }

  if (type === 'number') {
    return Number(answer);
  }

  return String(answer);
}

export interface ExportOptions {
  includeMetadata?: boolean;
  includeConfidence?: boolean;
  includeReasoning?: boolean;
  includeCitations?: boolean;
}

/**
 * Exports papers to CSV format
 */
export function exportToCSV(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): void {
  const {
    includeMetadata = true,
    includeConfidence = true,
  } = options;

  const headers: string[] = [
    'Paper Title',
    'DOI',
    'Year',
  ];

  if (includeMetadata) {
    headers.push('Authors', 'Open Access', 'PDF Used');
  }

  // Add question columns
  questions.forEach(q => {
    headers.push(q.question);
  });

  // Add confidence columns
  if (includeConfidence) {
    questions.forEach(q => {
      headers.push(`${q.question} (Confidence)`);
    });
  }

  const rows = papers.map(paper => {
    const row: string[] = [
      paper.title,
      paper.doi || '',
      paper.publicationYear?.toString() || '',
    ];

    if (includeMetadata) {
      row.push(
        paper.authors?.join('; ') || '',
        paper.isOpenAccess ? 'Yes' : 'No',
        paper.pdfContentUsed ? 'Yes' : 'No'
      );
    }

    // Add answers
    questions.forEach(q => {
      const result = paper.results.find(r => r.questionKey === q.key);
      const answer = (result as any)?.correctedAnswer ?? result?.answer;
      row.push(formatAnswerForCSV(answer, q.type));
    });

    // Add confidence scores
    if (includeConfidence) {
      questions.forEach(q => {
        const result = paper.results.find(r => r.questionKey === q.key);
        row.push(result?.confidence ? `${Math.round(result.confidence * 100)}%` : '');
      });
    }

    return row;
  });

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  downloadFile(csv, `extraction-results-${Date.now()}.csv`, 'text/csv');
}

/**
 * Exports papers to JSON format
 */
export function exportToJSON(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): void {
  const {
    includeReasoning = true,
    includeCitations = true,
  } = options;

  const data = {
    exportedAt: new Date().toISOString(),
    totalPapers: papers.length,
    questions: questions.map(q => ({
      key: q.key,
      question: q.question,
      type: q.type,
      description: q.description,
    })),
    papers: papers.map(paper => ({
      id: paper._id,
      title: paper.title,
      doi: paper.doi,
      year: paper.publicationYear,
      authors: paper.authors,
      openAccess: paper.isOpenAccess,
      pdfUsed: paper.pdfContentUsed,
      results: paper.results.map(r => ({
        questionKey: r.questionKey,
        answer: (r as any).correctedAnswer ?? r.answer,
        confidence: r.confidence,
        ...(includeReasoning && { reasoning: r.reasoning }),
        ...(includeCitations && {
          citations: (r as any).citations ?? [],
          citationStatus: (r as any).citationStatus,
          reviewState: (r as any).reviewState,
        }),
      })),
    })),
  };

  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `extraction-results-${Date.now()}.json`, 'application/json');
}

/**
 * Exports papers to Excel format
 */
export function exportToExcel(
  papers: PaperWithResults[],
  questions: Question[],
  options: ExportOptions = {}
): void {
  const {
    includeMetadata = true,
    includeConfidence = true,
    includeReasoning = false,
  } = options;

  const workbook = XLSX.utils.book_new();

  // Sheet 1: Results
  const resultsData = papers.map(paper => {
    const row: any = {
      'Title': paper.title,
      'DOI': paper.doi || '',
      'Year': paper.publicationYear || '',
    };

    if (includeMetadata) {
      row['Authors'] = paper.authors?.join('; ') || '';
      row['Open Access'] = paper.isOpenAccess ? 'Yes' : 'No';
      row['PDF Used'] = paper.pdfContentUsed ? 'Yes' : 'No';
    }

    questions.forEach(q => {
      const result = paper.results.find(r => r.questionKey === q.key);
      const answer = (result as any)?.correctedAnswer ?? result?.answer;
      row[q.question] = formatAnswerForExcel(answer, q.type);

      if (includeConfidence) {
        row[`${q.question} (Confidence)`] = result?.confidence
          ? Math.round(result.confidence * 100) / 100
          : '';
      }

      if (includeReasoning && result?.reasoning) {
        row[`${q.question} (Reasoning)`] = result.reasoning;
      }
    });

    return row;
  });

  const resultsSheet = XLSX.utils.json_to_sheet(resultsData);
  XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Results');

  // Sheet 2: Questions
  const questionsSheet = XLSX.utils.json_to_sheet(
    questions.map(q => ({
      Key: q.key,
      Question: q.question,
      Type: q.type,
      Description: q.description || '',
    }))
  );
  XLSX.utils.book_append_sheet(workbook, questionsSheet, 'Questions');

  // Sheet 3: Summary statistics
  const totalPapers = papers.length;
  const avgConfidences = questions.map(q => {
    const results = papers.map(p => p.results.find(r => r.questionKey === q.key));
    const validResults = results.filter(r => r?.confidence !== undefined);
    const avg = validResults.reduce((sum, r) => sum + (r!.confidence || 0), 0) / (validResults.length || 1);
    return {
      Question: q.question,
      'Average Confidence': Math.round(avg * 100) / 100,
      'Completed': validResults.length,
      'Total Papers': totalPapers,
      'Completion Rate': `${Math.round((validResults.length / totalPapers) * 100)}%`,
    };
  });

  const summarySheet = XLSX.utils.json_to_sheet(avgConfidences);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  XLSX.writeFile(workbook, `extraction-results-${Date.now()}.xlsx`);
}
