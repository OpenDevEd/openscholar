import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { readBalance } from "../credits/balanceCounter";
import { EXTRACTION_COST_CONSTANTS } from "../../lib/extraction/cost-estimate";
import { assertValidJobTransition, type JobStatus } from "./stateMachine";
import { PAPER_LIMIT_MAX } from "./bucket/limits";

type ExtractionJob = Doc<"extractionJobs">;
type ExtractionPaper = Doc<"extractionPapers">;

export type PaperQuestionAdmissionResult =
  | { status: "admitted"; estimateCredits: number }
  | { status: "already_admitted"; estimateCredits: number }
  | { status: "not_needed"; estimateCredits: 0 };

export type QuestionAdmissionBalance = {
  walletCredits: number;
  activeAdmissionCredits: number;
  availableCredits: number;
};

export function getPaperQuestionAdmissionEstimate({
  questionCount,
  pdfEnabled,
}: {
  questionCount: number;
  pdfEnabled: boolean;
}): number {
  const perQuestionCredit = pdfEnabled
    ? EXTRACTION_COST_CONSTANTS.PDF_Q_CREDIT_HIGH
    : EXTRACTION_COST_CONSTANTS.ABSTRACT_Q_CREDIT_HIGH;
  return questionCount * perQuestionCredit;
}

function isPausableJobStatus(
  status: ExtractionJob["status"],
): status is "pending" | "downloading_pdfs" | "indexing" | "extracting" {
  return (
    status === "pending" ||
    status === "downloading_pdfs" ||
    status === "indexing" ||
    status === "extracting"
  );
}

async function getAvailableCredits(
  ctx: MutationCtx,
  job: ExtractionJob,
): Promise<number> {
  const credits = await ctx.db
    .query("credits")
    .withIndex("by_user", (q) => q.eq("userId", job.userId))
    .unique();
  return credits ? (await readBalance(ctx, credits._id)).total : 0;
}

async function sumActiveAdmissionCredits(
  ctx: MutationCtx,
  args: {
    userId: ExtractionJob["userId"];
    excludePaperId?: ExtractionPaper["_id"];
  },
): Promise<number> {
  const activeRows = (
    await Promise.all(
      (["leased", "running"] as const).map((status) =>
        ctx.db
          .query("extractionPaperQueue")
          .withIndex("by_user_and_status", (q) =>
            q.eq("userId", args.userId).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();

  let total = 0;
  for (const row of activeRows) {
    if (row.paperId === args.excludePaperId) continue;
    const paper = await ctx.db.get(row.paperId);
    if (
      paper?.admittedRunEpoch !== row.runEpoch ||
      paper.admittedEstimateCredits === undefined ||
      paper.questionsBilled
    ) {
      continue;
    }
    total += paper.admittedEstimateCredits;
  }
  return total;
}

export async function readQuestionAdmissionBalanceTx(
  ctx: MutationCtx,
  args: {
    job: ExtractionJob;
    expectedEpoch: number;
  },
): Promise<QuestionAdmissionBalance> {
  const [walletCredits, activeAdmissionCredits] = await Promise.all([
    getAvailableCredits(ctx, args.job),
    sumActiveAdmissionCredits(ctx, {
      userId: args.job.userId,
    }),
  ]);
  return {
    walletCredits,
    activeAdmissionCredits,
    availableCredits: walletCredits - activeAdmissionCredits,
  };
}

export async function markJobCreditsExhaustedTx(
  ctx: MutationCtx,
  job: ExtractionJob,
  details: {
    estimateNeeded: number;
    papersNeeded: number;
    questionCount: number;
    available?: number;
  },
): Promise<void> {
  const available = details.available ?? (await getAvailableCredits(ctx, job));
  assertValidJobTransition(job.status as JobStatus, "creditsExhausted");
  await ctx.db.patch(job._id, {
    status: "creditsExhausted",
    pausedAt: Date.now(),
    pausedFromStatus: isPausableJobStatus(job.status) ? job.status : undefined,
    error: {
      code: "insufficient_credits",
      message: `Need ~${details.estimateNeeded} credits to extract ${details.papersNeeded} papers x ${details.questionCount} questions but only have ${available}`,
      at: Date.now(),
    },
    updatedAt: Date.now(),
  });
}

export async function admitPaperQuestionCreditsTx(
  ctx: MutationCtx,
  {
    paper,
    expectedEpoch,
    estimateCredits,
  }: {
    paper: ExtractionPaper;
    expectedEpoch: number;
    estimateCredits: number;
  },
): Promise<PaperQuestionAdmissionResult> {
  if (
    paper.admittedRunEpoch === expectedEpoch &&
    paper.admittedEstimateCredits !== undefined
  ) {
    return {
      status: "already_admitted",
      estimateCredits: paper.admittedEstimateCredits,
    };
  }

  if (estimateCredits <= 0 || paper.questionsBilled) {
    return { status: "not_needed", estimateCredits: 0 };
  }

  await ctx.db.patch(paper._id, {
    admittedEstimateCredits: estimateCredits,
    admittedRunEpoch: expectedEpoch,
    admittedAt: Date.now(),
  });
  return { status: "admitted", estimateCredits };
}

export async function clearPaperQuestionAdmissionTx(
  ctx: MutationCtx,
  paperId: ExtractionPaper["_id"],
): Promise<void> {
  await ctx.db.patch(paperId, {
    admittedEstimateCredits: undefined,
    admittedRunEpoch: undefined,
    admittedAt: undefined,
  });
}

export async function clearJobPaperQuestionAdmissionsTx(
  ctx: MutationCtx,
  args: { jobId: ExtractionJob["_id"] },
): Promise<{ cleared: number }> {
  const papers = await ctx.db
    .query("extractionPapers")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .take(PAPER_LIMIT_MAX);

  let cleared = 0;
  for (const paper of papers) {
    if (paper.admittedEstimateCredits === undefined) continue;
    await clearPaperQuestionAdmissionTx(ctx, paper._id);
    cleared += 1;
  }
  return { cleared };
}
