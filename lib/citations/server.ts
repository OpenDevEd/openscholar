import { z } from "zod";
import type { CitationData } from "./formats";
import { normalizeCitationType } from "./paper-data";

const text = z.string().trim().min(1).max(10000);
const identifiers = z.union([text, z.array(text).min(1)]).transform((value) => Array.isArray(value) ? value.join(", ") : value);
const name = z.union([z.object({ literal: text }), z.object({ family: text, given: text.optional() })]);
const metadataSchema = z.object({
  type: z.enum(["article", "article-journal", "article-magazine", "article-newspaper", "book", "chapter", "dataset", "document", "entry-encyclopedia", "paper-conference", "report", "standard", "thesis"]),
  title: text,
  author: z.array(name).max(5000).optional(), editor: z.array(name).max(5000).optional(),
  issued: z.object({ "date-parts": z.array(z.array(z.number().int()).min(1).max(3)).min(1).max(2) }).optional(),
  DOI: text.optional(), URL: text.optional(), ISBN: identifiers.optional(), ISSN: identifiers.optional(),
  "container-title": text.optional(), publisher: text.optional(), "publisher-place": text.optional(),
  volume: text.optional(), issue: text.optional(), page: text.optional(), edition: text.optional(), language: text.optional(),
});
const inputSchema = metadataSchema.extend({ id: z.string().regex(/^(?:W|OS|R)\d+$/), "citation-key": z.string().regex(/^os_(?:W|OS|R)\d+$/) });

export async function getPaperCitationMetadata(input: unknown) {
  const data: CitationData = inputSchema.parse(input);
  // A report published here is its own record: what its registrars hold is a copy of it, and can be a correction behind.
  const doi = !data.id.startsWith("R") && typeof data.DOI === "string" && /^10\.\d{4,9}\/\S+$/i.test(data.DOI) ? data.DOI : null;
  let record = data;
  if (doi) {
    try {
      // DOI content negotiation works with Crossref and DataCite. The locally
      // loaded record remains usable if a publisher's metadata is unavailable.
      // `next` caches it on the Next server for a day; Convex's citations (convex/research/citationFormat.ts) read it each time.
      const init: RequestInit & { next?: { revalidate: number } } = {
        headers: { Accept: "application/vnd.citationstyles.csl+json" },
        signal: AbortSignal.timeout(4000), next: { revalidate: 86400 },
      };
      const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, init);
      if (response.ok) {
        const metadata: unknown = await response.json();
        if (typeof metadata === "object" && metadata !== null && "type" in metadata && typeof metadata.type === "string") {
          metadata.type = normalizeCitationType(metadata.type);
        }
        const parsed = metadataSchema.partial().safeParse(metadata);
        if (parsed.success && parsed.data.DOI?.toLowerCase() === doi.toLowerCase() && sameWork(data.title, parsed.data.title)) {
          record = { ...data, ...parsed.data, id: data.id, "citation-key": data["citation-key"] };
        } else {
          // Another work's DOI isn't this one's: the citation goes without it rather than point at that work.
          if (parsed.success && parsed.data.DOI?.toLowerCase() === doi.toLowerCase()) record = { ...data, DOI: undefined };
          console.warn("Citation DOI metadata rejected", { doi, reason: !parsed.success ? parsed.error.issues : parsed.data.DOI?.toLowerCase() !== doi.toLowerCase() ? "DOI mismatch" : "another work's title", title: data.title, theirs: parsed.success ? parsed.data.title : undefined });
        }
      } else {
        console.warn("Citation DOI metadata unavailable", { doi, status: response.status });
      }
    } catch (error) {
      // An optional metadata lookup must not prevent citation copying.
      console.warn("Citation DOI metadata lookup failed", { doi, error });
    }
  }
  return record;
}

/**
 * Whether a DOI's metadata is of the work the page shows: at least half the words of the two titles are shared. A record
 * can carry another work's DOI (one paper's page held an encyclopedia entry's), and its citation is then the page's own.
 */
export function sameWork(ours: string, theirs: string | undefined) {
  if (!theirs) return true;
  const words = (title: string) => new Set(title.toLowerCase().normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean));
  const a = words(ours);
  const b = words(theirs);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(a.size, b.size, 1) >= 0.5;
}
