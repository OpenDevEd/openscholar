import { describe, expect, it } from "vitest";
import {
  getQueueCapacity,
  isTerminalQueueStatus,
  selectLeaseableQueueIds,
  type QueueSelectionRow,
} from "./status";

describe("extraction queue status helpers", () => {
  it("selects only current-epoch pending rows up to available capacity", () => {
    const rows: QueueSelectionRow[] = [
      { id: "p0", runEpoch: 0, status: "pending", priority: 0, createdAt: 10 },
      { id: "p1", runEpoch: 0, status: "pending", priority: 1, createdAt: 11 },
      { id: "stale", runEpoch: 1, status: "pending", priority: 0, createdAt: 12 },
      { id: "leased", runEpoch: 0, status: "leased", priority: 0, createdAt: 13 },
      { id: "done", runEpoch: 0, status: "completed", priority: 0, createdAt: 14 },
    ];

    expect(
      selectLeaseableQueueIds(rows, {
        activeCount: 1,
        expectedEpoch: 0,
        paperConcurrency: 2,
      }),
    ).toEqual(["p0"]);
  });

  it("orders pending rows by priority then creation time", () => {
    const rows: QueueSelectionRow[] = [
      { id: "slow", runEpoch: 0, status: "pending", priority: 10, createdAt: 0 },
      { id: "new-high", runEpoch: 0, status: "pending", priority: 0, createdAt: 10 },
      { id: "old-high", runEpoch: 0, status: "pending", priority: 0, createdAt: 5 },
    ];

    expect(
      selectLeaseableQueueIds(rows, {
        activeCount: 0,
        expectedEpoch: 0,
        paperConcurrency: 3,
      }),
    ).toEqual(["old-high", "new-high", "slow"]);
  });

  it("normalizes exhausted capacity to zero", () => {
    expect(getQueueCapacity({ activeCount: 4, paperConcurrency: 3 })).toBe(0);
    expect(getQueueCapacity({ activeCount: 1, paperConcurrency: 3 })).toBe(2);
  });

  it("identifies terminal queue statuses", () => {
    expect(isTerminalQueueStatus("completed")).toBe(true);
    expect(isTerminalQueueStatus("failed")).toBe(true);
    expect(isTerminalQueueStatus("cancelled")).toBe(true);
    expect(isTerminalQueueStatus("pending")).toBe(false);
    expect(isTerminalQueueStatus("parked")).toBe(false);
  });
});
