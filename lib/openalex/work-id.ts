/**
 * A paper's OpenAlex ID as the app keeps it, https://openalex.org/W2741809807, from that, the
 * bare ID, or the address of its page. Null for anything else. The results page saves papers
 * under the first form; the assistant is given IDs in all three.
 */
export function workUrl(id: string): string | null {
  const bare = id.trim().match(/^(?:https?:\/\/openalex\.org\/(?:works\/)?)?(W\d+)$/i)?.[1];
  return bare ? `https://openalex.org/${bare.toUpperCase()}` : null;
}
