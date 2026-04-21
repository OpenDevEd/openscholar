import type { BillingType, TransactionType } from "./presentation";

interface SearchTextInput {
  description?: string | null;
  metadata?: Record<string, string> | null;
  billingType?: BillingType | null;
  type: TransactionType;
}

/**
 * Produce the indexed search string for a `creditTransactions` row — backs
 * the `search_transactions` search index declared in `convex/schema.ts`.
 *
 * Tokens included:
 *   - description (free-form text from the mutation)
 *   - metadata.model (LLM model id, drives "gpt-4o" / "claude" searches)
 *   - metadata.openalexId (paper-id lookup without requiring the paper join)
 *   - billingType literal (drives "embedding" / "screening" / "chat" search)
 *   - type literal (drives "purchase" / "refund" search)
 *
 * Deliberately NOT included:
 *   - paperTitle / jobName — those live on other tables; indexing them here
 *     would require a join-on-write and would drift if the parent renames.
 *     Cross-table search is a future enhancement.
 */
export function computeSearchableText(input: SearchTextInput): string {
  const parts: string[] = [];
  if (input.description) parts.push(input.description);
  const model = input.metadata?.model;
  if (model) parts.push(model);
  const openalexId = input.metadata?.openalexId;
  if (openalexId) parts.push(openalexId);
  if (input.billingType) parts.push(input.billingType);
  parts.push(input.type);
  return parts.join(" ").toLowerCase();
}
