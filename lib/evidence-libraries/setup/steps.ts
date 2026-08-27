/**
 * Turns a setup operation into the six rows the setup page shows. The first
 * five are the build steps; "active" is the result row and only completes
 * when the operation succeeded.
 */
export const SETUP_STEP_KEYS = [
  "database",
  "storage",
  "application",
  "deployment",
  "readiness",
  "active",
] as const;

export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];
export type SetupStepStatus = "waiting" | "running" | "done" | "failed";
export type SetupStep = { key: SetupStepKey; status: SetupStepStatus; at: number | null };

/** The operation stage each build step corresponds to. */
const STAGE_FOR_STEP: Record<Exclude<SetupStepKey, "active">, string> = {
  database: "database",
  storage: "storage",
  application: "application",
  deployment: "deployment",
  readiness: "health_check",
};

/** Build steps only; the result row never counts toward progress. */
const BUILD_STEPS = SETUP_STEP_KEYS.length - 1;

export type SetupOperationView = {
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  receipts: Partial<Record<string, { checkedAt: number }>> | undefined;
  updatedAt: number;
};

export function setupSteps(operation: SetupOperationView): SetupStep[] {
  if (operation.status === "succeeded") {
    return SETUP_STEP_KEYS.map((key) => ({
      key,
      status: "done",
      at:
        key === "active"
          ? operation.updatedAt
          : (operation.receipts?.[STAGE_FOR_STEP[key]]?.checkedAt ?? null),
    }));
  }
  const currentIndex =
    operation.status === "queued"
      ? -1
      : SETUP_STEP_KEYS.findIndex(
          (key) => key !== "active" && STAGE_FOR_STEP[key] === operation.stage,
        );
  return SETUP_STEP_KEYS.map((key, index) => {
    if (key === "active" || index > currentIndex) {
      return { key, status: "waiting", at: null };
    }
    if (index < currentIndex) {
      return {
        key,
        status: "done",
        at: operation.receipts?.[STAGE_FOR_STEP[key]]?.checkedAt ?? null,
      };
    }
    return operation.status === "failed"
      ? { key, status: "failed", at: operation.updatedAt }
      : { key, status: "running", at: null };
  });
}

export function setupPercent(steps: SetupStep[]): number {
  if (steps.every((step) => step.status === "done")) return 100;
  const done = steps.filter((step) => step.key !== "active" && step.status === "done").length;
  return Math.round((done / BUILD_STEPS) * 100);
}
