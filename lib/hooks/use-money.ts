import { useFormatter } from "next-intl";

/**
 * An amount for inside a sentence: isolate marks keep it left to right, as <bdi dir="ltr"> keeps one that stands
 * alone. An Arabic sentence splits "US$" around its number otherwise.
 */
export const inSentence = (amount: string) => `\u2066${amount}\u2069`;

/** Dollars in the reader's own format, without cents when there are none: $5, $2.50. */
export function useMoney() {
  const format = useFormatter();
  return (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: amount % 1 ? 2 : 0 });
}
