export const extractionQueueStatuses = [
  "pending",
  "leased",
  "running",
  "parked",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ExtractionQueueStatus = (typeof extractionQueueStatuses)[number];

const terminalQueueStatuses = new Set<ExtractionQueueStatus>([
  "completed",
  "failed",
  "cancelled",
]);

const activeQueueStatuses = new Set<ExtractionQueueStatus>([
  "leased",
  "running",
]);

const leaseClearingStatuses = new Set<ExtractionQueueStatus>([
  "pending",
  "parked",
  "completed",
  "failed",
  "cancelled",
]);

export type QueueSelectionRow<IdValue extends string = string> = {
  id: IdValue;
  runEpoch: number;
  status: ExtractionQueueStatus;
  priority: number;
  createdAt: number;
};

export function isTerminalQueueStatus(
  status: ExtractionQueueStatus,
): boolean {
  return terminalQueueStatuses.has(status);
}

export function isActiveQueueStatus(status: ExtractionQueueStatus): boolean {
  return activeQueueStatuses.has(status);
}

export function shouldClearQueueLease(
  status: ExtractionQueueStatus,
): boolean {
  return leaseClearingStatuses.has(status);
}

export function getQueueCapacity({
  activeCount,
  paperConcurrency,
}: {
  activeCount: number;
  paperConcurrency: number;
}): number {
  const normalizedConcurrency = Math.max(0, Math.floor(paperConcurrency));
  const normalizedActive = Math.max(0, Math.floor(activeCount));
  return Math.max(0, normalizedConcurrency - normalizedActive);
}

export function selectLeaseableQueueIds<IdValue extends string>(
  rows: ReadonlyArray<QueueSelectionRow<IdValue>>,
  {
    activeCount,
    expectedEpoch,
    paperConcurrency,
  }: {
    activeCount: number;
    expectedEpoch: number;
    paperConcurrency: number;
  },
): IdValue[] {
  const capacity = getQueueCapacity({ activeCount, paperConcurrency });
  if (capacity === 0) return [];

  return rows
    .filter(
      (row) =>
        row.runEpoch === expectedEpoch && row.status === "pending",
    )
    .sort((left, right) => {
      const priorityDelta = left.priority - right.priority;
      if (priorityDelta !== 0) return priorityDelta;
      return left.createdAt - right.createdAt;
    })
    .slice(0, capacity)
    .map((row) => row.id);
}
