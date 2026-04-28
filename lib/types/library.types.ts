export interface TrimmedPaperData {
  openalexId: string;
  title: string;
  authors: string | undefined;
  doi: string | undefined;
  abstract: string | undefined;
  publicationYear: number | undefined;
  journal: string | undefined;
  citedByCount: number | undefined;
  workType: string | undefined;
  isOpenAccess: boolean | undefined;
  oaStatus: string | undefined;
}
