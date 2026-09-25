import {
  type OpenAlexImportExtras,
  type TopicLevel,
} from "@/lib/evidence-libraries/openalex-import-request";
import { type SearchParams } from "@/lib/search";

/** The search page params plus the import-only filters. */
export type ImportQuery = { params: SearchParams; extras: OpenAlexImportExtras };

export const SDGS = [
  "No poverty", "Zero hunger", "Good health and well-being", "Quality education",
  "Gender equality", "Clean water and sanitation", "Affordable and clean energy",
  "Decent work and economic growth", "Industry, innovation and infrastructure",
  "Reduced inequalities", "Sustainable cities and communities",
  "Responsible consumption and production", "Climate action", "Life below water",
  "Life on land", "Peace, justice and strong institutions", "Partnerships for the goals",
].map((name, index) => ({ id: String(index + 1), name: `${index + 1}. ${name}` }));

export const TOPIC_LEVEL_LABELS: Record<TopicLevel, string> = {
  domain: "Domain",
  field: "Field",
  subfield: "Subfield",
  topic: "Topic",
};
