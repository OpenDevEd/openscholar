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

  const handle = setInterval(() => {
    if (fired) return;
    void readFlag().then((flag) => {
      if (flag && !fired) {
        fired = true;
        onAbort();
      }
    });
  }, intervalMs);

  return () => {
    clearInterval(handle);
  };
}
