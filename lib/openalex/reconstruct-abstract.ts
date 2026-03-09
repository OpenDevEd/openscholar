/**
 * Reconstruct an abstract from an OpenAlex inverted index.
 *
 * OpenAlex stores abstracts as an inverted index mapping each word
 * to an array of positions. This function reverses that mapping to
 * produce the original plain-text abstract.
 *
 * Pure function -- works in both client and server contexts.
 */
export function reconstructAbstract(
  invertedIndex: Record<string, number[]>
): string {
  if (!invertedIndex || Object.keys(invertedIndex).length === 0) {
    return "";
  }

  const positionMap: Map<number, string> = new Map();

  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      positionMap.set(pos, word);
    }
  }

  const sortedPositions = Array.from(positionMap.keys()).sort((a, b) => a - b);
  return sortedPositions.map((pos) => positionMap.get(pos)).join(" ");
}
