export type StopPoller = () => void;

export type StartAbortPollerArgs = {
  readFlag: () => Promise<boolean>;
  onAbort: () => void;
  intervalMs?: number;
};

export function startAbortPoller(_: StartAbortPollerArgs): StopPoller {
  return () => {};
}
