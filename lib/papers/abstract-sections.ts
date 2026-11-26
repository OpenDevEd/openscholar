/** Headings a structured abstract runs together, as journals print them. */
const HEADINGS = ["Background", "Introduction", "Context", "Objectives?", "Aims?", "Purpose", "Methods", "Methodology", "Design", "Setting", "Participants", "Interventions", "Measurements", "Results", "Findings", "Conclusions?", "Interpretation", "Discussion", "Implications", "Significance", "Limitations", "Funding", "Trial registration"];
/** A heading at the start or after a sentence, then an optional colon and a sentence starting with a capital or a digit. */
const HEADING = new RegExp(`(?:^|(?<=[.!?)]\\s))(${HEADINGS.join("|")})\\s*:?\\s+(?=[\\p{Lu}\\d])`, "gu");

/** A heading run into the words around it with no space, as some indexes hand a structured abstract over: "grant.MethodsUsing". */
const GLUED = new RegExp(`(^|[.!?)])\\s*(${HEADINGS.join("|")})(?=\\p{Lu}\\p{Ll})`, "gu");

/** An abstract with its headings set apart from the words they were run into, so it reads, and is cut into sentences, as it was written. */
export const unglued = (abstract: string) => abstract.replace(GLUED, (_, before: string, heading: string) => `${before}${before ? " " : ""}${heading} `);

/**
 * A structured abstract as its parts, each with its heading; null for an abstract written as prose. It needs three
 * headings, so a sentence that happens to start with "Results" doesn't split one.
 */
export function abstractSections(abstract: string): { heading: string; text: string }[] | null {
  const text = abstract.replace(/^(?:Summary|Abstract)\s*:?\s+/, "").trim();
  const found = [...text.matchAll(HEADING)];
  if (found.length < 3 || found[0]!.index !== 0) return null;
  return found.map((match, index) => ({
    heading: match[1]!,
    text: text.slice(match.index! + match[0].length, found[index + 1]?.index ?? text.length).trim(),
  })).filter((section) => section.text);
}
