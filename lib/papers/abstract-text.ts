/**
 * A tag as publishers mark abstracts up (<jats:p>, <inline-formula>, <tex-math notation="LaTeX">): a name right after
 * `<`, then only attributes written name="value", so "p < 0.05" and "x<y and z>0" stay.
 */
const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s+[\w:.-]+="[^"]*")*\s*\/?>/g;

/** An abstract as words: its publisher's markup left out, its text kept. */
export const plainAbstract = (text: string) => text.replace(TAG, " ").replace(/\s{2,}/g, " ").trim();

/**
 * An abstract from OpenAlex's index of its words, as words: each word at each place it holds, read in order. Written
 * here rather than taken from the OpenAlex SDK, whose helpers module loads axios into every Convex function that
 * reads an abstract.
 */
export const abstractFromIndex = (index: Record<string, number[]>) =>
  plainAbstract(Object.entries(index).flatMap(([word, places]) => places.map((place) => [place, word] as const)).sort((a, b) => a[0] - b[0]).map(([, word]) => word).join(" "));
