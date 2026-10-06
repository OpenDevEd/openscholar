export type StopPoller = () => Promise<void>;

export type StartAbortPollerArgs = {
  readFlag: () => Promise<boolean>;
  onAbort: () => void;
  intervalMs?: number;
};

export function startAbortPoller({
  readFlag,
  onAbort,
  intervalMs = 500,
}: StartAbortPollerArgs): StopPoller {
  let fired = false;
  let stopped = false;
  let reading = false;
  let inFlight: Promise<void> | null = null;

  const handle = setInterval(() => {
    if (fired || stopped || reading) return;
    reading = true;
    inFlight = readFlag()
      .then((flag) => {
        if (flag && !fired && !stopped) {
          fired = true;
          onAbort();
        }
      })
      .catch(() => {
        // readFlag failures shouldn't abort the stream. The outer finally
        // + concurrency.cleanupZombieChatLocks sweep handles stale state.
      })
      .finally(() => {
        reading = false;
        inFlight = null;
      });
  }, intervalMs);

  return async () => {
    stopped = true;
    clearInterval(handle);
    await inFlight;
  };
}
