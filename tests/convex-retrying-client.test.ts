import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { RetryingConvexClient } from "@/lib/convex-client";

const list = makeFunctionReference<"query", Record<string, never>, number[]>("records:list");
const TIMED_OUT = "[Request ID: 1] Server Error\nFunction execution timed out (maximum duration: 1s)";

type Modification = { type: "Add" | "Remove"; queryId: number };

/** The deployment's side of the WebSocket: records what the client asks for, and answers with transitions. */
function fakeDeployment() {
  const changes: Modification[] = [];
  let socket: { onmessage?: (event: { data: string }) => void } | undefined;
  let querySet = 0;
  let version = { querySet: 0, ts: 0 };
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    onerror?: () => void;
    constructor() {
      socket = this;
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      const message = JSON.parse(data);
      if (message.type !== "ModifyQuerySet") return;
      querySet = message.newVersion;
      changes.push(...message.modifications);
    }
    close() {
      queueMicrotask(() => this.onclose?.());
    }
  }
  const ts = (n: number) => {
    const bytes = Buffer.alloc(8);
    bytes.writeBigUInt64LE(BigInt(n));
    return bytes.toString("base64");
  };
  const transition = (modifications: object[]) => {
    const startVersion = { querySet: version.querySet, identity: 0, ts: ts(version.ts) };
    version = { querySet, ts: version.ts + 1 };
    const endVersion = { querySet, identity: 0, ts: ts(version.ts) };
    socket!.onmessage!({ data: JSON.stringify({ type: "Transition", startVersion, endVersion, modifications }) });
  };
  const added = () => changes.filter((change) => change.type === "Add").map((change) => change.queryId);
  const current = () => added().at(-1)!;
  return {
    WebSocket: Socket as unknown as typeof WebSocket,
    added,
    /** The query's latest run succeeds with `value`, after the removals the client asked for. */
    succeed: (value: number[]) => transition([...removed(), { type: "QueryUpdated", queryId: current(), value, logLines: [], journal: null }]),
    /** The query's latest run fails with the backend's `errorMessage`. */
    fail: (errorMessage: string) => transition([...removed(), { type: "QueryFailed", queryId: current(), errorMessage, logLines: [], journal: null }]),
  };
  function removed() {
    const gone = changes.filter((change) => change.type === "Remove").map((change) => ({ type: "QueryRemoved", queryId: change.queryId }));
    changes.splice(0, changes.length, ...changes.filter((change) => change.type === "Add"));
    return gone;
  }
}

describe("RetryingConvexClient", () => {
  let deployment: ReturnType<typeof fakeDeployment>;
  let client: RetryingConvexClient;
  beforeEach(() => {
    vi.useFakeTimers();
    deployment = fakeDeployment();
    client = new RetryingConvexClient("https://happy-otter-123.convex.cloud", { webSocketConstructor: deployment.WebSocket });
  });
  afterEach(async () => {
    await client.close();
    vi.useRealTimers();
  });

  async function subscribe() {
    const watch = client.watchQuery(list, {});
    const stop = watch.onUpdate(() => {});
    await vi.advanceTimersByTimeAsync(0);
    return { watch, stop };
  }

  it("runs a query the backend timed out again, showing what it had until a run succeeds", async () => {
    const { watch } = await subscribe();
    deployment.fail(TIMED_OUT);
    // Never loaded: still loading, not an error.
    expect(watch.localQueryResult()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deployment.added()).toHaveLength(2);
    deployment.succeed([1]);
    expect(watch.localQueryResult()).toEqual([1]);

    // A later run times out: the last result stays up while it runs again.
    deployment.fail(TIMED_OUT);
    expect(watch.localQueryResult()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deployment.added()).toHaveLength(3);
    expect(watch.localQueryResult()).toEqual([1]);
    deployment.succeed([1, 2]);
    expect(watch.localQueryResult()).toEqual([1, 2]);
  });

  it("lets the failure through once the retries run out", async () => {
    const { watch } = await subscribe();
    for (const wait of [1_000, 2_000, 4_000]) {
      deployment.fail(TIMED_OUT);
      expect(watch.localQueryResult()).toBeUndefined();
      await vi.advanceTimersByTimeAsync(wait);
    }
    // The last retry is still running: Convex holds the previous timeout until it answers.
    expect(watch.localQueryResult()).toBeUndefined();
    deployment.fail(TIMED_OUT);
    expect(() => watch.localQueryResult()).toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deployment.added()).toHaveLength(4);
  });

  it("throws an error from the function's own code at once, without running it again", async () => {
    const { watch } = await subscribe();
    deployment.fail("[Request ID: 2] Server Error\nUncaught Error: Function execution timed out waiting for OpenAlex");
    expect(() => watch.localQueryResult()).toThrow(/waiting for OpenAlex/);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(deployment.added()).toHaveLength(1);
  });

  it("runs the query again for every component showing it, by dropping all their subscriptions first", async () => {
    const first = await subscribe();
    const second = await subscribe();
    deployment.fail(TIMED_OUT);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(deployment.added()).toHaveLength(2);
    deployment.succeed([3]);
    expect(first.watch.localQueryResult()).toEqual([3]);
    expect(second.watch.localQueryResult()).toEqual([3]);
  });

  it("keeps a one-shot read waiting through a timeout for the run that answers", async () => {
    const result = client.query(list, {});
    await vi.advanceTimersByTimeAsync(0);
    deployment.fail(TIMED_OUT);
    await vi.advanceTimersByTimeAsync(1_000);
    deployment.succeed([4]);
    await expect(result).resolves.toEqual([4]);
  });

  it("drops a waiting retry when a run succeeds first, or when no one shows the query", async () => {
    const { stop } = await subscribe();
    deployment.fail(TIMED_OUT);
    // A write made the backend run it again, and this run finished in time.
    deployment.succeed([5]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deployment.added()).toHaveLength(1);

    deployment.fail(TIMED_OUT);
    stop();
    // Remounted before the backend confirmed the removal: the old timeout isn't this run's.
    const again = client.watchQuery(list, {});
    expect(again.localQueryResult()).toBeUndefined();
    again.onUpdate(() => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deployment.added()).toHaveLength(2);
  });
});
