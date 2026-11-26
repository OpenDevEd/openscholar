// A passage is the sentence of an abstract a model relied on for one answer. The model is shown the
// abstract's sentences numbered and names one by its number, so a paper's answers stay a few tokens
// long. The page marks the same sentence, cut the same way: this is the one place an abstract is cut.

/**
 * An abstract cut into sentences: after a full stop, a question mark or an exclamation mark that a
 * space and the start of another sentence follow. An abbreviation can cut one in two, which costs
 * nothing: both sides cut alike, and the passage is still the words the model pointed at.
 */
export function sentencesOf(abstract: string): string[] {
  return abstract.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“(\[])/u).filter(Boolean);
}
