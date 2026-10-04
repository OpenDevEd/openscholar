/**
 * Runs a mutation call again when Convex refuses it for a write conflict after its own
 * retries. A refused write committed nothing, so running it again can't apply it twice.
 * Many workers writing one job's results at once still collide on a counter shard now and
 * then (#351); without this, the paper worker would lose that batch of answers.
 */
export async function retryOnConflict<T>(write: () => Promise<T>, attempts = 5, wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (attempt >= attempts || !isWriteConflict(error)) throw error;
      // Jittered, so writers that collided don't collide again.
      await wait(50 * 2 ** attempt * (0.5 + Math.random()));
    }
  }
}

export function isWriteConflict(error: unknown): boolean {
  return String((error as Error | undefined)?.message ?? error).includes("OptimisticConcurrencyControlFailure");
}
