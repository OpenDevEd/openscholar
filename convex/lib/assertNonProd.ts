/**
 * Hard-stop for development / diagnostic helpers that must never run in
 * production. Every test/debug internal function in the extraction module
 * calls this at the top of its handler so a dashboard-triggered invocation
 * from a prod deploy fails fast instead of polluting prod metrics or
 * bypassing feature flags.
 */
export function assertNonProd(): void {
  if (process.env.CONVEX_CLOUD_ENV === "prod") {
    throw new Error("not-available-in-production");
  }
}
