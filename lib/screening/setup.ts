// What the screening page works out in the browser: a question's points, the scoring
// config they make, and how a job's row reads as running or waiting.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type Job = NonNullable<FunctionReturnType<typeof api.screening.queries.getScreeningJob>>;
export type JobRow = FunctionReturnType<typeof api.screening.queries.listUserScreeningJobs>["page"][number];
export type Paper = FunctionReturnType<typeof api.screening.papers.list>["page"][number];
export type PaperSet = NonNullable<Job["set"]>;
export type Outcome = Paper["outcome"];
export type Answer = "yes" | "no" | "unclear";
/** A question with the points each answer gives. `key` only tells the form's rows apart. */
export type Question = { key: string; text: string; yes: number; no: number; unclear: number };

export const OUTCOMES: Outcome[] = ["included", "unclear", "excluded", "failed"];
export const ANSWERS: Answer[] = ["yes", "no", "unclear"];
export const answerOf = (value: boolean | null): Answer => (value === true ? "yes" : value === false ? "no" : "unclear");
export const valueOf = (answer: Answer) => (answer === "yes" ? true : answer === "no" ? false : null);

/** Highest score a paper can get. */
export const maxScore = (questions: Question[]) => questions.reduce((sum, q) => sum + Math.max(q.yes, q.no, q.unclear), 0);
/** Starting star thresholds: where 1 to 5 stars begin, spread across the highest score. */
export const defaultStars = (max: number) => [1, 2, 3, 4, 5].map((k) => Math.max(1, Math.ceil((k / 5) * max)));

/** The questions and scoring config a job takes: questions keyed by their place, one rule each, a threshold per star. */
export function scoringOf(questions: Question[], minimumScore: number, stars: number[]) {
  return {
    questions: questions.map((q, i) => ({ key: `q${i}`, question: q.text })),
    scoringConfig: {
      rules: questions.map((q, i) => ({ questionKey: `q${i}`, yesPoints: q.yes, noPoints: q.no, nullPoints: q.unclear })),
      starThresholds: stars.map((minScore, i) => ({ minScore, stars: i + 1 })),
      minimumScore,
    },
  };
}

/** A job's questions with their points, as its scoring rules give them. */
export function questionsOf({ questions, scoringConfig }: Pick<Job, "questions" | "scoringConfig">): Question[] {
  return questions.map(({ key, question }) => {
    const points = (field: "yesPoints" | "noPoints" | "nullPoints") => scoringConfig.rules.reduce((sum, rule) => sum + (rule.questionKey === key ? rule[field] : 0), 0);
    return { key, text: question, yes: points("yesPoints"), no: points("noPoints"), unclear: points("nullPoints") };
  });
}

/** How a job reads on the page. A processing job with no paper being read waits while another of the person's jobs has the slots. */
export type Phase = "running" | "waiting" | JobRow["status"];
export function phaseOf(job: Pick<JobRow, "_id" | "status" | "running">, active: Array<Pick<JobRow, "_id" | "running">>): Exclude<Phase, "processing"> {
  if (job.status !== "processing") return job.status;
  return job.running === 0 && active.some((other) => other._id !== job._id && other.running > 0) ? "waiting" : "running";
}

/** Papers of a job that are settled one way or another. */
export const doneOf = (job: Pick<JobRow, "processedPapers" | "failedPapers">) => job.processedPapers + job.failedPapers;
