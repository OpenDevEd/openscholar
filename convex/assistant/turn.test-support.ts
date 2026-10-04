// Model streams for the tests of replies (./turn.ts): the paper chat's and the assistant's.

/** A doStream that opens a minimal stream and blocks until the
 *  composed abortSignal fires, then closes cleanly. */
export function hangingDoStream(
  opts: { onStarted?: () => void } = {},
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        opts.onStarted?.();
        options.abortSignal?.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    }),
  });
}

/** A doStream that emits `deltas.length` text-delta chunks then hangs
 *  until abortSignal fires. Used to verify partial-delta persistence. */
export function partialDeltasThenHangDoStream(
  deltas: string[],
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        for (const d of deltas) {
          controller.enqueue({ type: "text-delta", id: "0", delta: d });
        }
        options.abortSignal?.addEventListener("abort", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    }),
  });
}

/** A doStream that paces text-delta chunks with `delayMs` between
 *  them, then hangs until abortSignal fires. Required for tests that
 *  need DeltaStreamer's throttled flush to actually persist multiple
 *  delta batches to the streamDeltas table — `partialDeltasThenHang
 *  DoStream` enqueues all chunks synchronously, so DeltaStreamer
 *  flushes the first batch and then has no further `addParts` calls
 *  to retrigger the throttle window, leaving subsequent text-deltas
 *  buffered in memory and never written. */
export function pacedDeltasThenHangDoStream(
  deltas: string[],
  delayMs: number,
): (options: {
  abortSignal?: AbortSignal;
}) => Promise<{ stream: ReadableStream<unknown> }> {
  return async (options) => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        let i = 0;
        const interval = setInterval(() => {
          if (i >= deltas.length) {
            clearInterval(interval);
            return;
          }
          try {
            controller.enqueue({
              type: "text-delta",
              id: "0",
              delta: deltas[i]!,
            });
          } catch {
            clearInterval(interval);
          }
          i++;
        }, delayMs);
        options.abortSignal?.addEventListener("abort", () => {
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    }),
  });
}

/**
 * A doStream as the deployed runtime behaves on Stop: it paces `deltas`, and when the
 * abortSignal fires the stream fails with the runtime's own error instead of ending.
 * With no deltas the request itself rejects, as it does before the first token.
 */
export function erroringOnAbortDoStream(
  deltas: string[],
  delayMs: number,
): (options: { abortSignal?: AbortSignal }) => Promise<{ stream: ReadableStream<unknown> }> {
  const aborted = () => new Error("The signal has been aborted");
  return (options) => {
    if (deltas.length === 0) return new Promise((_, reject) => options.abortSignal?.addEventListener("abort", () => reject(aborted())));
    return Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "0" });
          let i = 0;
          const interval = setInterval(() => {
            if (i >= deltas.length) return clearInterval(interval);
            controller.enqueue({ type: "text-delta", id: "0", delta: deltas[i++]! });
          }, delayMs);
          options.abortSignal?.addEventListener("abort", () => {
            clearInterval(interval);
            controller.error(aborted());
          });
        },
      }),
    });
  };
}

/** A doStream that emits a complete `deltas → finish` stream
 *  synchronously, so agent.streamText resolves the happy path. */
export function finishingDoStream(
  deltas: string[],
): () => Promise<{ stream: ReadableStream<unknown> }> {
  return async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "0" });
        for (const d of deltas) {
          controller.enqueue({ type: "text-delta", id: "0", delta: d });
        }
        controller.enqueue({ type: "text-end", id: "0" });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 3, text: 3, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  });
}

/** Poll helper: wait until a predicate returns true, or throw. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 2_000, intervalMs = 20 } = {},
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
