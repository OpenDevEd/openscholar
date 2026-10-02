/**
 * Work ids. OpenAlex's are W and digits, https://openalex.org/W2741809807 in full; the
 * OpenScholar API's are OS and a Semantic Scholar corpus id, https://openscholar.ai/OS150911088
 * in full. Client safe.
 */

/** A work's short id, of either kind. */
export const SHORT_WORK_ID = /^(?:W|OS)\d+$/;

/** Either kind of id, short or in full on its own site only, in http or https. */
const WORK_ID = /^(?:(?:https?:\/\/openalex\.org\/)?(W\d+)|(?:https?:\/\/openscholar\.ai\/)?(OS\d+))$/;

/** The short id in a work's id ("https://openscholar.ai/OS1" as "OS1"); null when it is neither kind. */
export function shortWorkId(id: string): string | null {
  const match = WORK_ID.exec(id.trim());
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/** The work's page on OpenAlex; null for any other work, such as an OS one, which it has no page for. */
export function openAlexWorkPage(id: string): string | null {
  const short = shortWorkId(id);
  return short?.startsWith("W") ? `https://openalex.org/${short}` : null;
}

/**
 * A paper's OpenAlex ID as the app keeps it, https://openalex.org/W2741809807, from that, the
 * bare ID, or the address of its page. Null for anything else. The results page saves papers
 * under the first form; the assistant is given IDs in all three.
 */
export function workUrl(id: string): string | null {
  const bare = id.trim().match(/^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/i)?.[1];
  return bare ? `https://openalex.org/${bare.toUpperCase()}` : null;
}
