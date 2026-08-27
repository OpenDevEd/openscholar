import { describe, expect, it } from "vitest";
import { setupSteps, setupPercent } from "./steps";

const receipts = {
  database: { checkedAt: 1000 },
  storage: { checkedAt: 2000 },
};

describe("setupSteps", () => {
  it("marks every step waiting while the setup is queued", () => {
    const steps = setupSteps({ status: "queued", stage: "queued", receipts: undefined, updatedAt: 0 });
    expect(steps.map((s) => s.status)).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting", "waiting"]);
    expect(setupPercent(steps)).toBe(0);
  });

  it("marks finished steps done with their time, the current one running, the rest waiting", () => {
    const steps = setupSteps({ status: "running", stage: "application", receipts, updatedAt: 5000 });
    expect(steps).toEqual([
      { key: "database", status: "done", at: 1000 },
      { key: "storage", status: "done", at: 2000 },
      { key: "application", status: "running", at: null },
      { key: "deployment", status: "waiting", at: null },
      { key: "readiness", status: "waiting", at: null },
      { key: "active", status: "waiting", at: null },
    ]);
    expect(setupPercent(steps)).toBe(40);
  });

  it("marks the failed step failed at the time the operation stopped", () => {
    const steps = setupSteps({ status: "failed", stage: "storage", receipts: { database: { checkedAt: 1000 } }, updatedAt: 7000 });
    expect(steps[1]).toEqual({ key: "storage", status: "failed", at: 7000 });
    expect(steps[2].status).toBe("waiting");
  });

  it("marks everything done, including live, once the setup succeeded", () => {
    const steps = setupSteps({ status: "succeeded", stage: "completed", receipts, updatedAt: 9000 });
    expect(steps.every((s) => s.status === "done")).toBe(true);
    expect(steps[5].at).toBe(9000);
    expect(setupPercent(steps)).toBe(100);
  });
});
