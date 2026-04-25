import type { BatchError } from './batch-types'

export const BATCH_ITEM_INSUFFICIENT_CREDITS_ERROR =
  'Insufficient credits to return this item'

type BatchResultLike = {
  results: Record<string, unknown>
  errors: BatchError[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBatchError(value: unknown): value is BatchError {
  if (!isRecord(value)) return false
  return typeof value.paperId === 'string' && typeof value.error === 'string'
}

function isBatchResultLike(value: unknown): value is BatchResultLike {
  if (!isRecord(value)) return false
  if (!isRecord(value.results)) return false
  if (!Array.isArray(value.errors)) return false
  return value.errors.every(isBatchError)
}

export function applyUnpaidBatchItemErrors<T>(
  result: T,
  unpaidItemIds: Iterable<string>,
): T {
  const uniqueUnpaidIds = Array.from(new Set(unpaidItemIds))
  if (uniqueUnpaidIds.length === 0 || !isBatchResultLike(result)) {
    return result
  }

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
