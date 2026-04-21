export const MIN_BATCH_SIZE = 1;

export function normalizeBatchSize(size: number): number {
  if (!Number.isFinite(size)) {
    return MIN_BATCH_SIZE;
  }

  return Math.max(MIN_BATCH_SIZE, Math.floor(size));
}

export function resolveBoundedConcurrency(
  entitledConcurrency: number,
  infraClamp: number,
): number {
  return normalizeBatchSize(Math.min(entitledConcurrency, infraClamp));
}

export function chunk<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const batchSize = normalizeBatchSize(size);
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}
