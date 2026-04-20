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
  const handle = setInterval(() => {
    void readFlag().then((flag) => {
      if (flag) onAbort();
    });
  }, intervalMs);

  return () => {
    clearInterval(handle);
  };
}
