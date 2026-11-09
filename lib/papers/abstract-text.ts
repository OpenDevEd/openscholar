import { convertAbstractArrayToString } from "@sickrin/openalex-sdk/dist/src/utils/helpers";

/**
 * A tag as publishers mark abstracts up (<jats:p>, <inline-formula>, <tex-math notation="LaTeX">): a name right after
 * `<`, then only attributes written name="value", so "p < 0.05" and "x<y and z>0" stay.
 */
const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s+[\w:.-]+="[^"]*")*\s*\/?>/g;

/** An abstract as words: its publisher's markup left out, its text kept. */
export const plainAbstract = (text: string) => text.replace(TAG, " ").replace(/\s{2,}/g, " ").trim();

/** An abstract from OpenAlex's index of its words, as words. */
export const abstractFromIndex = (index: Record<string, number[]>) => plainAbstract(convertAbstractArrayToString(index));
