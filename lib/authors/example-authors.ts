import "server-only";
import { authorRecordSchema, readPairedRecords } from "@/lib/openalex/author-record";
import { openAlexFetch } from "@/lib/openalex/fetch";
import { wholePerson } from "@/lib/openalex/whole-person";
import { searchUrl } from "@/lib/openalex/request-url";
import { activeSearchSource } from "@/lib/search/active-source";
import type { SearchSource } from "@/lib/search/source";

/** A row of the author list, as the source's search or this list reads it. */
export type IndexAuthor = { id: string; name: string; institution: string | null; country: string | null; works: number; citations: number; largest: number };

/** Researchers under the empty search box. Their names are written here because a source's largest record can spell one oddly. */
const EXAMPLES = [
  { id: "A5015565298", name: "Esther Duflo" },
  { id: "A5035981377", name: "John Hattie" },
  { id: "A5075388625", name: "Linda Darling-Hammond" },
  { id: "A5067184382", name: "Jennifer Doudna" },
  { id: "A5108093963", name: "Geoffrey Hinton" },
];

/** The same few requests for everyone, so they're kept a day and count against no one's limit. */
const KEPT = { next: { revalidate: 86_400 } } as RequestInit;

async function readRecord(id: string, source: SearchSource) {
  if (source === "openscholar") {
    const records = await readPairedRecords(id, KEPT);
    return records.length ? wholePerson(records) : null;
  }
  const response = await openAlexFetch(searchUrl(source, `authors/${id}`, {}), { timeoutMs: 10_000, ...KEPT } as RequestInit & { timeoutMs: number });
  if (!response.ok) throw new Error(`Author ${id} returned ${response.status}`);
  return authorRecordSchema.parse(await response.json());
}

/** How long the page waits for them. The reads go on, so a later visit finds them kept. */
const WAIT_MS = 1_500;

/** The examples as the active source has them. One it can't read is left out, and the page stands without any: the search is what it's for. */
export async function readExampleAuthors(): Promise<IndexAuthor[]> {
  const late = new Promise<IndexAuthor[]>((resolve) => setTimeout(resolve, WAIT_MS, []));
  return await Promise.race([readAll(), late]);
}

async function readAll(): Promise<IndexAuthor[]> {
  const source = await activeSearchSource();
  const authors = await Promise.all(EXAMPLES.map(async ({ id, name }) => {
    const record = await readRecord(id, source).catch((error) => {
      console.error("[authors] couldn't read an example author", id, error);
      return null;
    });
    if (!record) return null;
    const institution = record.last_known_institutions?.[0];
    const works = record.works_count ?? 0;
    return { id, name, institution: institution?.display_name ?? null, country: institution?.country_code ?? null, works, citations: record.cited_by_count ?? 0, largest: works };
  }));
  return authors.filter((author) => author !== null);
}
