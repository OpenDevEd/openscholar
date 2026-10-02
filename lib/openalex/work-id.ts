/**
 * Work ids. OpenAlex's are W and digits, https://openalex.org/W2741809807 in full; the
 * OpenScholar API's are OS and a Semantic Scholar corpus id, https://openscholar.ai/OS150911088
 * in full. Client safe.
 */

/** A work's short id, of either kind. */
export const SHORT_WORK_ID = /^(?:W|OS)\d+$/;

/** What a work's full id starts with: OpenAlex's site, or the OpenScholar API's. */
const WORK_SITES = ["https://openalex.org/", "https://openscholar.ai/"];

/** A work's id without its site: "https://openscholar.ai/OS1" as "OS1"; any other text as it is. */
export function withoutWorkSite(id: string): string {
  const site = WORK_SITES.find((prefix) => id.startsWith(prefix));
  return site ? id.slice(site.length) : id;
}

/** The work's page on OpenAlex; null for any other work, such as an OS one, which it has no page for. */
export function openAlexWorkPage(id: string): string | null {
  const short = withoutWorkSite(id);
  return /^W\d+$/.test(short) ? `https://openalex.org/${short}` : null;
}
