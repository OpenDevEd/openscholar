import { describe, expect, it, vi } from "vitest";

import { runPapersInBatches } from "./workflow";

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

    const running = runPapersInBatches({
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

    const running = runPapersInBatches({
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

    const result = await runPapersInBatches({
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
});
