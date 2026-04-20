export type StopPoller = () => void;

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

  const handle = setInterval(() => {
    if (fired || stopped) return;
    readFlag()
      .then((flag) => {
        if (flag && !fired && !stopped) {
          fired = true;
          onAbort();
        }
      })
      .catch(() => {
        // readFlag failures shouldn't abort the stream. The outer finally
        // + concurrency.cleanupZombieChatLocks sweep handles stale state.
      });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}
