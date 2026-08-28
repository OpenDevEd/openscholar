import { describe, expect, it } from "vitest";
import {
  nextDomainStep,
  readDomainAnswer,
  readDomainRecords,
} from "./domainGates";

describe("readDomainRecords", () => {
  it("verifies when both records are right", () => {
    expect(
      readDomainRecords({ target: "pointing", caa: "ok", token: "match" }),
    ).toEqual({ state: "verified" });
  });

  it("stops at pointing while the ownership record is missing", () => {
    expect(
      readDomainRecords({ target: "pointing", caa: "ok", token: "missing" }),
    ).toEqual({ state: "pointing" });
  });

  it("names a wrong ownership record", () => {
    expect(
      readDomainRecords({ target: "pointing", caa: "ok", token: "mismatch" }),
    ).toEqual({ state: "failed", failure: "token-mismatch" });
  });

  it("names a missing address record before anything else", () => {
    expect(
      readDomainRecords({ target: "no-records", caa: "blocked", token: "match" }),
    ).toEqual({ state: "failed", failure: "no-records" });
  });

  it("names an address record that points somewhere else", () => {
    expect(
      readDomainRecords({ target: "wrong-target", caa: "ok", token: "match" }),
    ).toEqual({ state: "failed", failure: "wrong-target" });
  });

  it("refuses a domain whose certificate rules block every authority", () => {
    expect(
      readDomainRecords({ target: "pointing", caa: "blocked", token: "match" }),
    ).toEqual({ state: "failed", failure: "caa-blocked" });
  });
});

describe("readDomainAnswer", () => {
  it("activates when our library answers with its live version", () => {
    expect(
      readDomainAnswer({ address: "ours", liveRevision: true, certificate: "active" }),
    ).toEqual({ state: "active" });
  });

  it("waits while the deployment has not reached the domain", () => {
    expect(
      readDomainAnswer({ address: "unreachable", liveRevision: false, certificate: "pending" }),
    ).toEqual({ state: "verified" });
  });

  it("waits while the certificate is still being issued", () => {
    expect(
      readDomainAnswer({ address: "ours", liveRevision: true, certificate: "pending" }),
    ).toEqual({ state: "verified" });
  });

  it("waits while the library answers an older version", () => {
    expect(
      readDomainAnswer({ address: "ours", liveRevision: false, certificate: "active" }),
    ).toEqual({ state: "verified" });
  });

  it("fails when another site answers the domain", () => {
    expect(
      readDomainAnswer({ address: "not-ours", liveRevision: false, certificate: "active" }),
    ).toEqual({ state: "failed", failure: "host-taken" });
  });

  it("fails when the certificate could not be issued", () => {
    expect(
      readDomainAnswer({ address: "ours", liveRevision: true, certificate: "failed" }),
    ).toEqual({ state: "failed", failure: "certificate" });
  });
});

describe("nextDomainStep", () => {
  it("reads the records until the domain is verified", () => {
    expect(nextDomainStep({ state: "added" })).toBe("records");
    expect(nextDomainStep({ state: "pointing" })).toBe("records");
    expect(nextDomainStep({ state: "failed" })).toBe("records");
  });

  it("attaches a verified domain that the proxy does not serve yet", () => {
    expect(nextDomainStep({ state: "verified" })).toBe("attach");
  });

  it("asks the domain itself once it is attached", () => {
    expect(nextDomainStep({ state: "verified", attachedAt: 1 })).toBe("answer");
    expect(nextDomainStep({ state: "active", attachedAt: 1 })).toBe("answer");
    expect(nextDomainStep({ state: "failed", attachedAt: 1 })).toBe("answer");
  });
});
