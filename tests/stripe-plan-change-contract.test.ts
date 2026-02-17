import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ACTIONS_FILE = "convex/subscriptions/actions.ts";

function readSource(relativeFilePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativeFilePath), "utf8");
}

describe("stripe plan-change contract", () => {
  it("exposes changePlan and removes deprecated flow exports", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/export const changePlan = action/);
    expect(source).not.toMatch(/export const cancelImmediately = action/);
    expect(source).not.toMatch(/export const scheduleDowngrade = action/);
  });

  it("uses immediate proration for upgrades and schedule for downgrades", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/proration_behavior:\s*["']create_prorations["']/);
    expect(source).toMatch(/stripe\.subscriptionSchedules\.update/);
    expect(source).toMatch(/stripe\.subscriptionSchedules\.release/);
    expect(source).not.toMatch(/start_date:\s*["']now["']/);
  });

  it("releases active schedules before immediate upgrades", () => {
    const source = readSource(ACTIONS_FILE);
    const upgradedBlock = source.match(
      /if \(changeType === "upgraded_immediately"\) \{([\s\S]*?)return \{/,
    )?.[1];

    expect(upgradedBlock).toBeDefined();
    expect(upgradedBlock).toMatch(/subscriptionSchedules\.release/);
    expect(upgradedBlock).toMatch(/subscriptions\.update/);

    const releaseIndex = upgradedBlock!.indexOf("subscriptionSchedules.release");
    const updateIndex = upgradedBlock!.indexOf("subscriptions.update");
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeLessThan(updateIndex);
  });

  it("returns explicit changeType outcomes for callers", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/changeType/);
    expect(source).toMatch(/upgraded_immediately/);
    expect(source).toMatch(/downgrade_scheduled/);
    expect(source).toMatch(/pending_change_cleared/);
    expect(source).toMatch(/no_change/);
  });

  it("supports clearing pending same-tier schedule changes", () => {
    const source = readSource(ACTIONS_FILE);
    const clearBlock = source.match(
      /if \(changeType === "pending_change_cleared"\) \{([\s\S]*?)return \{/,
    )?.[1];

    expect(clearBlock).toBeDefined();
    expect(clearBlock).toMatch(/subscriptionSchedules\.release/);
    expect(source).toMatch(/pending_change_cleared/);
  });

  it("keeps checkout as subscription-only", () => {
    const source = readSource(ACTIONS_FILE);

    expect(source).toMatch(/mode:\s*["']subscription["']/);
    expect(source).not.toMatch(/mode:\s*v\.union\(v\.literal\(["']subscription["']\),\s*v\.literal\(["']payment["']\)\)/);
  });
});
