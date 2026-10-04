import { describe, expect, it } from "vitest";
import { observeActivity, restingObservation, type Activity } from "./activity";

describe("Orbit activity", () => {
  it("celebrates only a successful exchange that this viewer saw running", () => {
    const done: Activity = { phase: "complete", order: 4 };
    expect(observeActivity(restingObservation, "chat-a", done).complete).toBe(false);
    const running = observeActivity(restingObservation, "chat-a", { phase: "thinking", order: 4 });
    const finished = observeActivity(running, "chat-a", done);
    expect(finished.complete).toBe(true);
    expect(observeActivity({ ...finished, complete: false }, "chat-a", done).complete).toBe(false);
  });

  it("never celebrates a stop, a failure, or a different chat's old reply", () => {
    const running = observeActivity(restingObservation, "chat-a", { phase: "writing", order: 4 });
    for (const phase of ["stopped", "failed", "waiting"] as const) {
      expect(observeActivity(running, "chat-a", { phase, order: 4 }).complete).toBe(false);
    }
    expect(observeActivity(running, "chat-b", { phase: "complete", order: 4 }).complete).toBe(false);
    expect(observeActivity(running, "chat-a", { phase: "complete", order: 5 }).complete).toBe(false);
  });

  it("keeps a waiting exchange observed until it resumes and finishes", () => {
    const waiting = observeActivity(restingObservation, "chat-a", { phase: "waiting", order: 4 });
    const resumed = observeActivity(waiting, "chat-a", { phase: "searching", order: 4 });
    expect(observeActivity(resumed, "chat-a", { phase: "complete", order: 4 }).complete).toBe(true);
  });
});
