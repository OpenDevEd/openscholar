import { useFormatter } from "next-intl";

/** Dollars in the reader's own format, without cents when there are none: $5, $2.50. */
export function useMoney() {
  const format = useFormatter();
  return (amount: number) => format.number(amount, { style: "currency", currency: "USD", minimumFractionDigits: amount % 1 ? 2 : 0 });
}
