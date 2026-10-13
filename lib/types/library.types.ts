export interface TrimmedPaperData {
  /** The paper by its key or OpenAlex ID (lib/papers/paper-ref.ts). */
  paper: string;
  title: string;
  authors: string[] | undefined;
  doi: string | undefined;
  abstract: string | undefined;
  publicationYear: number | undefined;
  journal: string | undefined;
  citedByCount: number | undefined;
  workType: string | undefined;
  isOpenAccess: boolean | undefined;
  oaStatus: string | undefined;
  oaUrl?: string;
  pdfUrl?: string;
}
