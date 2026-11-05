import { openalexWork } from "../papers/paper-ref";

/**
 * A paper's OpenAlex ID as the app keeps it, https://openalex.org/W2741809807, from that, the
 * bare ID, or the address of its page. Null for anything else. The results page saves papers
 * under the first form; the assistant is given IDs in all three.
 */
export function workUrl(id: string): string | null {
  const work = openalexWork(id);
  return work ? `https://openalex.org/${work}` : null;
}

/** `select` with what `appWork` reads, where it names a work's ID. */
export const selectWithIds = (select: string) => (select.split(",").includes("id") && !select.split(",").includes("ids") ? `${select},ids` : select);

/**
 * A work as the app keeps it, whichever source gave it. Our index names every work by its own ID and gives the OpenAlex ID
 * beside it. A paper OpenAlex knows keeps that ID as its own, so what's saved under it, ratings and screenings included,
 * is still that paper. A paper only our index has keeps our ID.
 */
export function appWork<Work extends { id?: string }>(given: Work): Work {
  const work = withPlainJournalName(given);
  const openalex = (work as { ids?: { openalex?: unknown } | null }).ids?.openalex;
  // The ID our index knows it by goes with it, for what only our index can do with it.
  return typeof openalex === "string" && openalex ? { ...work, id: openalex, openscholar_id: work.id } : work;
}

/** Some journal names come escaped for a web page, such as Children &amp; Society. */
function withPlainJournalName<Work>(work: Work): Work {
  const location = (work as { primary_location?: { source?: { display_name?: unknown } | null } | null }).primary_location;
  const name = location?.source?.display_name;
  if (typeof name !== "string" || !name.includes("&amp;")) return work;
  return { ...work, primary_location: { ...location, source: { ...location!.source, display_name: name.replaceAll("&amp;", "&") } } };
}
