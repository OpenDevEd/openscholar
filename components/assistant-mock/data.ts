// Mock data for the assistant design. Papers, queries and result counts are real
// OpenAlex data (title-and-abstract search, 2026-09-30); screening decisions and
// credit figures are made up for the mock.

import type { ComponentType } from "react";
import { FolderPlus, ListChecks, PenLine, Search, TableProperties, TestTubes } from "lucide-react";

export type Paper = {
  id: string;
  title: string;
  year: number;
  authors: string[];
  venue: string;
  cites: number;
};

export type Decision = "include" | "exclude" | "unsure";

export const ORIGINAL_QUERY = "structured pedagogy early grade reading";
export const ORIGINAL_COUNT = 215;

/** The tightened query, in parts, so the page can highlight what the assistant added. */
export const TIGHT_QUERY: Array<{ text: string; added?: boolean }> = [
  { text: "(" },
  { text: "structured pedagogy" },
  { text: " OR teacher guides OR scripted lessons OR coaching", added: true },
  { text: ") AND (" },
  { text: "early grade reading" },
  { text: " OR foundational literacy OR early literacy", added: true },
  { text: ")" },
  { text: " AND (Africa OR Kenya OR Uganda OR Liberia OR South Africa …)", added: true },
];
export const TIGHT_FILTERS = ["2015 to 2026", "Articles"];
export const TIGHT_COUNT = 24;

/** The versions the assistant tried, with their real counts. */
export const VERSIONS = [
  { label: "Add synonyms", count: 43 },
  { label: "Articles since 2015", count: 28 },
  { label: "African countries", count: 24 },
];

export const ORIGINAL_PAPERS: Paper[] = [
  { id: "W4392908153", title: "How do structured pedagogy programmes affect reading instruction in African early grade classrooms?", year: 2024, authors: ["Ursula Hoadley"], venue: "International Journal of Educational Development", cites: 20 },
  { id: "W2026873121", title: "Using Early Literacy Monitoring to Prevent Reading Failure", year: 2007, authors: ["Elizabeth A. Sloat", "Joan F. Beswick", "J. Douglas Willms"], venue: "Phi Delta Kappan", cites: 38 },
  { id: "W2070917794", title: "Assessing the Content and Quality of Commercially Available Reading Software Programs: Do They Have the Fundamental Structures to Promote the Development of Early Reading Skills in Children?", year: 2012, authors: ["Amy Grant", "Eileen Wood", "Alexandra Gottardo"], venue: "NHSA Dialog", cites: 33 },
  { id: "W2973550490", title: "Identifying mechanisms of change in the Early Grade Reading Study in South Africa", year: 2019, authors: ["Brahm Fleisch", "Kerryn Dixon"], venue: "South African Journal of Education", cites: 11 },
  { id: "W2996984896", title: "What works to improve early grade literacy in Latin America and the Caribbean? A systematic review and meta-analysis", year: 2019, authors: ["Rebecca Stone", "Thomas de Hoop", "Andrea Coombes"], venue: "Campbell Systematic Reviews", cites: 42 },
  { id: "W1604924327", title: "What Works in Middle-Grades School Reform.", year: 1997, authors: ["Joan Scheff Lipsitz"], venue: "Phi Delta Kappan", cites: 33 },
];

export const TIGHT_PAPERS: Array<Paper & { decision: Decision }> = [
  { id: "W2795178671", title: "Identifying the essential ingredients to literacy and numeracy improvement: Teacher professional development and coaching, student textbooks, and structured teachers’ guides", year: 2018, authors: ["Benjamin Piper", "Stephanie Simmons Zuilkowski", "Margaret M. Dubeck"], venue: "World Development", cites: 170, decision: "include" },
  { id: "W2973550490", title: "Identifying mechanisms of change in the Early Grade Reading Study in South Africa", year: 2019, authors: ["Brahm Fleisch", "Kerryn Dixon"], venue: "South African Journal of Education", cites: 11, decision: "unsure" },
  { id: "W3158464575", title: "Building back better to avert a learning catastrophe: Estimating learning loss from COVID-19 school shutdowns in Africa and facilitating short-term and long-term learning recovery", year: 2021, authors: ["Noam Angrist", "Andreas de Barros", "Radhika Bhula"], venue: "International Journal of Educational Development", cites: 135, decision: "exclude" },
  { id: "W4392908153", title: "How do structured pedagogy programmes affect reading instruction in African early grade classrooms?", year: 2024, authors: ["Ursula Hoadley"], venue: "International Journal of Educational Development", cites: 20, decision: "exclude" },
  { id: "W4414186757", title: "Comparing Teacher Attitudes Toward Early Grade Reading Reform in Northern and Central Uganda", year: 2025, authors: ["Jonathan Marino", "Medadi Erisa Ssentanda"], venue: "Nordic Journal of Comparative and International Education", cites: 1, decision: "exclude" },
  { id: "W2789743020", title: "Implementing large-scale instructional technology in Kenya: Changing instructional practice and developing accountability in a National Education System", year: 2017, authors: ["Benjamin Piper", "Arbogast Oyanga", "Jessica Mejía"], venue: "International Journal of Education and Development using ICT", cites: 21, decision: "include" },
  { id: "W4210654187", title: "The Challenge of Sustaining Effective Teaching: Spillovers, Fade-out, and the Cost-effectiveness of Teacher Development Programs", year: 2022, authors: ["Jacobus Cilliers", "Brahm Fleisch", "Janeli Kotzé"], venue: "Economics of Education Review", cites: 22, decision: "include" },
  { id: "W7168244385", title: "Time to read: A critical review of early grade reading curriculum policy and enactment in South Africa", year: 2026, authors: ["Colleen Boyd"], venue: "Journal of Education", cites: 0, decision: "exclude" },
];

/** Totals across all 24, of which the page shows the first 8. */
export const SCREEN_TOTALS = { include: 9, exclude: 11, unsure: 4 };
export const SCREEN_CREDITS = 36;
export const BALANCE = 1884;
export const COLLECTION_NAME = "Structured pedagogy trials, sub-Saharan Africa";

export type Ico = ComponentType<{ className?: string }>;

/** One tint per kind of work, the way the model map gives each provider one. */
export const KIND: Record<string, { icon: Ico; tint: string }> = {
  search: { icon: Search, tint: "#60a5fa" },
  versions: { icon: TestTubes, tint: "#60a5fa" },
  write: { icon: PenLine, tint: "var(--primary)" },
  screening: { icon: ListChecks, tint: "#a78bfa" },
  extraction: { icon: TableProperties, tint: "#fb923c" },
  collection: { icon: FolderPlus, tint: "#2dd4bf" },
};
