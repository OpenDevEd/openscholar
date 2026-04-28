import type { Id } from "@/convex/_generated/dataModel";
import type { ChatSourceRow } from "@/convex/chat/chatPapers";
import type { ChatSourceType } from "@/lib/chat/source-type";

// Deterministic 32-bit LCG. Keeps bench outputs reproducible across runs
// so median/p95 numbers reflect code changes, not fixture churn.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const TITLE_NOUNS = [
  "photosynthesis",
  "marine algae",
  "forest canopy",
  "soil carbon",
  "ocean circulation",
  "cellular respiration",
  "neural plasticity",
  "climate feedback",
  "arctic permafrost",
  "coral bleaching",
  "nitrogen cycle",
  "microbial ecology",
];
const TITLE_PREFIX = [
  "A study of",
  "Toward understanding",
  "The role of",
  "Dynamics of",
  "Evolution of",
  "Evidence for",
  "Observations of",
  "Modeling",
  "Revisiting",
  "Long-term trends in",
];
const TITLE_SUFFIX = [
  "in coastal wetlands",
  "across temperate forests",
  "under warming scenarios",
  "during the Holocene",
  "at global scale",
  "in tropical ecosystems",
  "with remote sensing",
  "from satellite observations",
  "in the Pacific basin",
];

const SURNAMES = [
  "Smith",
  "García",
  "Chen",
  "Kumar",
  "Nguyen",
  "Johnson",
  "Müller",
  "Tanaka",
  "O'Connor",
  "Rossi",
  "Kowalski",
  "Andersen",
];
const INITIALS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M"];

const ABSTRACT_SENTENCES = [
  "We measured photosynthesis rates across a latitudinal gradient.",
  "Our results show significant variability in carbon flux.",
  "These findings support the hypothesis that temperature drives the observed patterns.",
  "The dataset spans three decades of continuous monitoring.",
  "Marine algae communities shifted in response to warming.",
  "We apply a novel Bayesian framework to quantify uncertainty.",
  "Soil respiration was measured at 200 plots over 5 years.",
  "Model-data comparisons reveal systematic biases at high latitudes.",
];

const SOURCE_TYPE_DISTRIBUTION: ReadonlyArray<ChatSourceType> = [
  "openalex",
  "openalex",
  "openalex",
  "openalex",
  "openalex",
  "openalex",
  "openalex",
  "zotero",
  "zotero",
  "unknown",
];

function pick<T>(arr: ReadonlyArray<T>, rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function makeTitle(rand: () => number): string {
  return `${pick(TITLE_PREFIX, rand)} ${pick(TITLE_NOUNS, rand)} ${pick(TITLE_SUFFIX, rand)}`;
}

function makeAuthors(rand: () => number): string[] {
  const n = 1 + Math.floor(rand() * 5);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(`${pick(SURNAMES, rand)}, ${pick(INITIALS, rand)}`);
  }
  return out;
}

function makeAbstract(rand: () => number): string | null {
  if (rand() < 0.15) return null;
  const n = 2 + Math.floor(rand() * 4);
  const sentences: string[] = [];
  for (let i = 0; i < n; i += 1) sentences.push(pick(ABSTRACT_SENTENCES, rand));
  return sentences.join(" ");
}

export function makeFakeRows(n: number, seed = 0xC0FFEE): ChatSourceRow[] {
  const rand = lcg(seed);
  const rows: ChatSourceRow[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const sourceType = pick(SOURCE_TYPE_DISTRIBUTION, rand);
    const hasDoi = sourceType !== "unknown" && rand() < 0.85;
    const hasOpenalex = sourceType === "openalex" && rand() < 0.95;
    const hasPdf = rand() < 0.6;
    const hasYear = rand() < 0.92;

    rows[i] = {
      chatPaperId: `cp_${i.toString(36).padStart(6, "0")}` as unknown as Id<"chatPapers">,
      sourceId: `src_${i.toString(36).padStart(6, "0")}` as unknown as Id<"extractionJobSources">,
      jobId: "job_bench" as unknown as Id<"extractionJobs">,
      position: i,
      included: rand() < 0.35,
      title: makeTitle(rand),
      authors: makeAuthors(rand),
      year: hasYear ? 1980 + Math.floor(rand() * 46) : null,
      abstract: makeAbstract(rand),
      doi: hasDoi ? `10.1234/fake.${i}` : null,
      pdfUrl: hasPdf ? `https://example.com/pdf/${i}.pdf` : null,
      openalexId: hasOpenalex ? `W${2000000000 + i}` : null,
      citedByCount: null,
      venueName: null,
      workType: null,
      bucketKey:
        sourceType === "openalex"
          ? `openalex:W${2000000000 + i}`
          : sourceType === "zotero"
            ? `zotero:${i}`
            : `unknown:${i}`,
      sourceType,
    };
  }
  return rows;
}
