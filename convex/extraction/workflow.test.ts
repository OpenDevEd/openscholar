import { describe, expect, it, vi } from "vitest";

import { classifyWorkerSkip, runBoundedBatches } from "./workflow";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("convex/extraction/workflow batching", () => {
  it("keeps multiple papers in flight within the same batch", async () => {
    const first = deferred<"completed" | "halted">();
    const second = deferred<"completed" | "halted">();
    const third = deferred<"completed" | "halted">();
    const workByPaper = new Map([
      ["paper-1", first],
      ["paper-2", second],
      ["paper-3", third],
    ]);
    const started: string[] = [];
    const waitForNextBatch = vi
      .fn<() => Promise<{ status: string | null; runEpoch: number } | null>>()
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 7,
      }))
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 8,
      }));

    const running = runBoundedBatches({
      items: ["paper-1", "paper-2", "paper-3"],
      batchSize: 2,
      waitForNextBatch,
      runItem: async (paper, control) => {
        started.push(`${paper}:${control.runEpoch}`);
        return await workByPaper.get(paper)!.promise;
      },
    });

    await flushPromises();
    expect(started).toEqual(["paper-1:7", "paper-2:7"]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(1);

    first.resolve("completed");
    second.resolve("completed");

    await flushPromises();
    expect(started).toEqual(["paper-1:7", "paper-2:7", "paper-3:8"]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(2);

    third.resolve("completed");

    await expect(running).resolves.toBe("completed");
  });

  it("keeps the next paper batch blocked until the gate opens", async () => {
    const secondBatchGate = deferred<{
      status: string | null;
      runEpoch: number;
    } | null>();
    const started: string[] = [];
    const waitForNextBatch = vi
      .fn<() => Promise<{ status: string | null; runEpoch: number } | null>>()
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 3,
      }))
      .mockImplementationOnce(async () => secondBatchGate.promise);

    const running = runBoundedBatches({
      items: ["paper-1", "paper-2", "paper-3"],
      batchSize: 2,
      waitForNextBatch,
      runItem: async (paper) => {
        started.push(paper);
        return "completed";
      },
    });

    await flushPromises();
    expect(started).toEqual(["paper-1", "paper-2"]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(2);

    secondBatchGate.resolve({
      status: "extracting",
      runEpoch: 4,
    });

    await expect(running).resolves.toBe("completed");
    expect(started).toEqual(["paper-1", "paper-2", "paper-3"]);
  });

  it("does not start another batch after a paper halts the current batch", async () => {
    const started: string[] = [];

    const result = await runBoundedBatches({
      items: ["paper-1", "paper-2", "paper-3"],
      batchSize: 2,
      waitForNextBatch: async () => ({
        status: "extracting",
        runEpoch: 9,
      }),
      runItem: async (paper) => {
        started.push(paper);
        return paper === "paper-1" ? "halted" : "completed";
      },
    });

    expect(result).toBe("halted");
    expect(started).toEqual(["paper-1", "paper-2"]);
  });

  it("keeps multiple questions in flight within a paper-sized batch", async () => {
    const first = deferred<"completed" | "halted">();
    const second = deferred<"completed" | "halted">();
    const third = deferred<"completed" | "halted">();
    const workByQuestion = new Map([
      ["q1", first],
      ["q2", second],
      ["q3", third],
    ]);
    const started: string[] = [];

    const running = runBoundedBatches({
      items: ["q1", "q2", "q3"],
      batchSize: 2,
      waitForNextBatch: async () => ({
        status: "extracting",
        runEpoch: 11,
      }),
      runItem: async (question, control) => {
        started.push(`${question}:${control.runEpoch}`);
        return await workByQuestion.get(question)!.promise;
      },
    });

    await flushPromises();
    expect(started).toEqual(["q1:11", "q2:11"]);

    first.resolve("completed");
    second.resolve("completed");
    await flushPromises();
    expect(started).toEqual(["q1:11", "q2:11", "q3:11"]);

    third.resolve("completed");
    await expect(running).resolves.toBe("completed");
  });

  it("retries only parked items after the next gate opens", async () => {
    const callsByItem = new Map<string, number>();
    const startedSequence: string[] = [];
    const itemBehavior: Record<
      string,
      ("completed" | "halted" | "park")[]
    > = {
      "paper-1": ["park", "completed"],
      "paper-2": ["completed"],
      "paper-3": ["completed"],
    };

    const waitForNextBatch = vi
      .fn<
        () => Promise<{ status: string | null; runEpoch: number } | null>
      >()
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 1,
      }))
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 2,
      }))
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 3,
      }));

    const result = await runBoundedBatches({
      items: ["paper-1", "paper-2", "paper-3"],
      batchSize: 2,
      waitForNextBatch,
      runItem: async (paper, control) => {
        const callIndex = callsByItem.get(paper) ?? 0;
        callsByItem.set(paper, callIndex + 1);
        startedSequence.push(`${paper}:${control.runEpoch}`);
        return itemBehavior[paper][callIndex];
      },
    });

    expect(result).toBe("completed");
    expect(callsByItem.get("paper-1")).toBe(2);
    expect(callsByItem.get("paper-2")).toBe(1);
    expect(callsByItem.get("paper-3")).toBe(1);
    expect(startedSequence).toEqual([
      "paper-1:1",
      "paper-2:1",
      "paper-1:2",
      "paper-3:3",
    ]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(3);
  });

  it("halts immediately even when a sibling parks in the same batch", async () => {
    const startedSequence: string[] = [];
    const waitForNextBatch = vi
      .fn<
        () => Promise<{ status: string | null; runEpoch: number } | null>
      >()
      .mockResolvedValue({ status: "extracting", runEpoch: 5 });

    const result = await runBoundedBatches({
      items: ["a", "b", "c"],
      batchSize: 2,
      waitForNextBatch,
      runItem: async (item) => {
        startedSequence.push(item);
        if (item === "a") return "park";
        if (item === "b") return "halted";
        return "completed";
      },
    });

    expect(result).toBe("halted");
    expect(startedSequence).toEqual(["a", "b"]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(1);
  });

  describe("classifyWorkerSkip", () => {
    it.each([
      ["already_billed", "completed"],
      ["cancelled", "halted"],
      ["job_terminal", "halted"],
      ["paused", "park"],
      ["credits_exhausted", "park"],
      ["stale_epoch", "park"],
    ] as const)("routes %s to %s", (reason, expected) => {
      expect(classifyWorkerSkip(reason)).toBe(expected);
    });
  });

  it("halts when the gate refuses to reopen during a park retry", async () => {
    const startedSequence: string[] = [];
    const waitForNextBatch = vi
      .fn<
        () => Promise<{ status: string | null; runEpoch: number } | null>
      >()
      .mockImplementationOnce(async () => ({
        status: "extracting",
        runEpoch: 9,
      }))
      .mockImplementationOnce(async () => null);

    const itemBehavior: Record<string, "park" | "completed"> = {
      "paper-1": "park",
      "paper-2": "completed",
    };

    const result = await runBoundedBatches({
      items: ["paper-1", "paper-2"],
      batchSize: 2,
      waitForNextBatch,
      runItem: async (item) => {
        startedSequence.push(item);
        return itemBehavior[item];
      },
    });

    expect(result).toBe("halted");
    expect(startedSequence).toEqual(["paper-1", "paper-2"]);
    expect(waitForNextBatch).toHaveBeenCalledTimes(2);
  });
});
