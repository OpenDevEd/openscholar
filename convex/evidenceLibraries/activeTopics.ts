/** The Topics switch in a `topics` section payload. */
export function readTopicsEnabled(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as { enabled?: unknown }).enabled === true
  );
}
