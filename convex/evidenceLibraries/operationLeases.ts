/**
 * When a setup or a publish still holds its attempt, and when it has stalled
 * and may be reclaimed.
 *
 * Each pipeline decides this once, here, so the reclaim check and anything
 * else that has to know — such as the guard that keeps the AI key still while
 * a library is publishing — can never drift apart. The two rules differ on
 * purpose: the publish reads a zero lease as no lease and therefore held, the
 * setup reads it as expired. Both are the behaviour their pipeline has today.
 */

type LeasedOperation = {
  status: "queued" | "running" | "succeeded" | "failed";
  setupLeaseExpiresAt?: number;
  configurationLeaseExpiresAt?: number;
};

/** A configuration deployment nobody else may claim. */
export function isDeploymentLeaseHeld(
  operation: LeasedOperation,
  now: number,
): boolean {
  return (
    operation.status === "running" &&
    (!operation.configurationLeaseExpiresAt ||
      operation.configurationLeaseExpiresAt > now)
  );
}

/** A setup attempt nobody else may claim. */
export function isSetupLeaseHeld(
  operation: LeasedOperation,
  now: number,
): boolean {
  return (
    operation.status === "running" &&
    (operation.setupLeaseExpiresAt === undefined ||
      operation.setupLeaseExpiresAt > now)
  );
}
