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
