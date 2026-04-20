import type { TransactionViewModel } from "./transaction-view-model";

export type SortField = "date" | "amount" | "type";
export type SortDirection = "asc" | "desc";

export function sortRows(
  rows: readonly TransactionViewModel[],
  field: SortField,
  dir: SortDirection,
): TransactionViewModel[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    let cmp = 0;
    if (field === "date") cmp = a.createdAt - b.createdAt;
    else if (field === "amount") cmp = a.signedAmount - b.signedAmount;
    else if (field === "type") cmp = a.type.localeCompare(b.type);
    return dir === "asc" ? cmp : -cmp;
  });
  return copy;
}
