import { Work } from "openalex-sdk/dist/src/types/work";

export type PaperResult = Work;

export interface DownloadHandlers {
  onDownloadItem: (item: PaperResult, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: PaperResult, format: 'json' | 'csv') => void;
}

export interface YearRangePreset {
  label: string;
  range: [number, number];
} 