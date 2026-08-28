/**
 * The rules that move a custom domain from one state to the next.
 *
 * Four gates, in order, each of them behaviour the owner can produce with
 * any domain host. A gate that could not run never advances and never
 * fails: it answers `check-failed`, the same rule the platform address
 * check follows in `addressActions.ts`.
 */

import type { TargetReading, TokenReading } from "./dnsClient";

export type DomainState =
  | "added"
  | "pointing"
  | "verified"
  | "active"
  | "failed";

export type DomainFailure =
  | "no-name"
  | "no-records"
  | "wrong-target"
  | "token-mismatch"
  | "host-taken"
  | "not-served"
  | "certificate"
  | "caa-blocked";

export type DomainOutcome =
  | { state: "pointing" | "verified" | "active" }
  | { state: "failed"; failure: DomainFailure };

/** What the two resolvers agreed the domain's records say. */
export type DomainRecordsReading = {
  target: TargetReading;
  caa: "ok" | "blocked";
  token: TokenReading;
};

/**
 * Gates 2 and 3. The address record decides first, because nothing else
 * matters until the name reaches us; then the certificate rules, because a
 * blocked authority cannot be worked around; then the ownership record.
 */
export function readDomainRecords(reading: DomainRecordsReading): DomainOutcome {
  if (reading.target === "no-name") {
    return { state: "failed", failure: "no-name" };
  }
  if (reading.target === "no-records") {
    return { state: "failed", failure: "no-records" };
  }
  if (reading.target === "wrong-target") {
    return { state: "failed", failure: "wrong-target" };
  }
  if (reading.caa === "blocked") {
    return { state: "failed", failure: "caa-blocked" };
  }
  if (reading.token === "mismatch") {
    return { state: "failed", failure: "token-mismatch" };
  }
  // The address record is right and the ownership record is not there yet.
  // That is a step forward, not a failure.
  if (reading.token === "missing") return { state: "pointing" };
  return { state: "verified" };
}

/** What the library itself answered on the custom domain. */
export type DomainAnswerReading = {
  /** Whose site answered: our runtime, someone else's, or nothing yet. */
  address: "ours" | "not-ours" | "unreachable";
  /** Whether the answer carried the revision the library is running. */
  liveRevision: boolean;
  certificate: "pending" | "active" | "failed";
};

/**
 * Gate 4b. The domain is only active once our own runtime answers on it
 * with the revision it is running and the certificate is in place.
 */
export function readDomainAnswer(reading: DomainAnswerReading): DomainOutcome {
  if (reading.certificate === "failed") {
    return { state: "failed", failure: "certificate" };
  }
  if (reading.address === "not-ours") {
    return { state: "failed", failure: "host-taken" };
  }
  if (reading.address === "unreachable" || !reading.liveRevision) {
    // The deployment that adds the domain has not finished, or the
    // certificate is still being issued. Both are waiting, not failing.
    return { state: "verified" };
  }
  if (reading.certificate === "pending") return { state: "verified" };
  return { state: "active" };
}

/**
 * The step "Check" takes next for one row.
 *
 * The three facts are kept apart on purpose. `attachedAt` says the proxy's
 * domain list holds the host. `deploymentPending` says that change has not
 * reached the running site yet. `removing` says the owner asked for the
 * domain to go. Collapsing them would let a crash between two steps look
 * like a finished one.
 */
export function nextDomainStep(row: {
  state: DomainState;
  attachedAt?: number;
  deploymentPending?: boolean;
  removing?: boolean;
}): "records" | "attach" | "deploy" | "answer" | "blocked" {
  // A domain on its way out is not checked or attached again: the removal
  // finishes on its own once its deployment is live.
  if (row.removing) {
    return row.deploymentPending ? "deploy" : "blocked";
  }
  // The proxy changed but the running site has not been given the change.
  if (row.deploymentPending) return "deploy";
  if (row.attachedAt !== undefined) return "answer";
  if (row.state === "verified") return "attach";
  return "records";
}
