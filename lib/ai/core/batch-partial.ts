import type { BatchError } from './batch-types'

export const BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR =
  'Insufficient credits to return this item'

type BatchResultLike = {
  results: Record<string, unknown>
  errors: BatchError[]
}

export function applyUnpaidBatchItemErrors<T extends BatchResultLike>(
  result: T,
  unpaidItemIds: Iterable<string>,
): T {
  const uniqueUnpaidIds = Array.from(new Set(unpaidItemIds))
  if (uniqueUnpaidIds.length === 0) return result

  const paidResults = { ...result.results }
  for (const itemId of uniqueUnpaidIds) {
    delete paidResults[itemId]
  }

  const existingErrorIds = new Set(result.errors.map((error) => error.paperId))
  const unpaidErrors = uniqueUnpaidIds
    .filter((paperId) => !existingErrorIds.has(paperId))
    .map((paperId) => ({
      paperId,
      error: BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR,
    }))

  return {
    ...result,
    results: paidResults,
    errors: [...result.errors, ...unpaidErrors],
  }
}
