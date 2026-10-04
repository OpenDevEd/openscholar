export type ActivityPhase = "idle" | "thinking" | "searching" | "writing" | "waiting" | "stopping" | "complete" | "failed" | "stopped";
export type Activity = { phase: ActivityPhase; order: number | null };
export type OrbitMotion = "still" | "idle" | "listening" | "thinking" | "searching" | "writing" | "complete";

type Observation = { key: string | null; active: boolean; complete: boolean };
export const restingObservation: Observation = { key: null, active: false, complete: false };

/** A completion belongs to an exchange observed here, never to a chat opened from history. */
export function observeActivity(previous: Observation, threadId: string | null, activity: Activity): Observation {
  const key = threadId !== null && activity.order !== null ? `${threadId}:${activity.order}` : null;
  const active = ["thinking", "searching", "writing", "waiting", "stopping"].includes(activity.phase);
  if (previous.key !== key) return { key, active, complete: false };
  if (active) return previous.active && !previous.complete ? previous : { key, active: true, complete: false };
  if (previous.active) return { key, active: false, complete: activity.phase === "complete" };
  return previous;
}
