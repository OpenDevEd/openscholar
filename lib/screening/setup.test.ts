import { describe, expect, it } from "vitest";
import { defaultStars, maxScore, phaseOf, questionsOf, scoringOf, type Question } from "./setup";

const questions: Question[] = [
  { key: "a", text: "Randomized?", yes: 2, no: 0, unclear: 1 },
  { key: "b", text: "Primary schools?", yes: 1, no: 0, unclear: 0 },
];

describe("a screening's setup", () => {
  it("makes a job's questions and scoring config, which read back as the same questions and points", () => {
    const job = scoringOf(questions, 2, [1, 2, 2, 3, 3]);
    expect(job.questions).toEqual([{ key: "q0", question: "Randomized?" }, { key: "q1", question: "Primary schools?" }]);
    expect(job.scoringConfig).toMatchObject({ minimumScore: 2, starThresholds: [{ minScore: 1, stars: 1 }, { minScore: 2, stars: 2 }, { minScore: 2, stars: 3 }, { minScore: 3, stars: 4 }, { minScore: 3, stars: 5 }] });
    expect(questionsOf(job).map(({ text, yes, no, unclear }) => ({ text, yes, no, unclear }))).toEqual(questions.map(({ text, yes, no, unclear }) => ({ text, yes, no, unclear })));
  });

  it("spreads five star thresholds across the highest score, never under 1", () => {
    expect(maxScore(questions)).toBe(3);
    expect(defaultStars(3)).toEqual([1, 2, 2, 3, 3]);
    expect(defaultStars(0)).toEqual([1, 1, 1, 1, 1]);
  });

  it("calls a processing job waiting only while another of the person's jobs has papers being read", () => {
    const first = { _id: "a" as never, status: "processing" as const, running: 20 };
    const second = { _id: "b" as never, status: "processing" as const, running: 0 };
    expect(phaseOf(second, [first, second])).toBe("waiting");
    expect(phaseOf(first, [first, second])).toBe("running");
    expect(phaseOf(second, [second])).toBe("running");
    expect(phaseOf({ ...second, status: "cancelled" }, [first])).toBe("cancelled");
  });
});
