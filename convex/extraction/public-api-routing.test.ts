import { convexTest } from "convex-test";
import { describe, it, test, expect } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Safety net SN-1 (P3 plan): pin the PUBLIC `api.extraction.{mutations,queries}`
 * routing surface. For every entry, invoke via convex-test and assert that no
 * *routing* error is thrown. Business errors (validator, auth, not-found) prove
 * the function was reached and therefore routing works. The only errors that
 * fail this suite are the ones convex-test raises when the module or export is
 * missing — exactly the class of regression a bad barrel split would cause.
 */

const ROUTING_ERROR_RE =
  /Could not find module for|there is no such export|Expected a (query|mutation|action) function/;

async function assertRoutes(op: () => Promise<unknown>) {
  try {
    await op();
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (ROUTING_ERROR_RE.test(msg)) {
      throw new Error(`routing failure: ${msg}`);
    }
  }
}

const PUBLIC_MUTATIONS: ReadonlyArray<string> = [
  "startJob",
  "cancelExtraction",
  "duplicateJob",
  "setResultReviewState",
  "startJobFromTemplate",
  "saveExtractionSavedView",
  "deleteExtractionSavedView",
  "saveWorkflowTemplateFromJob",
  "saveWorkflowTemplate",
  "deleteWorkflowTemplate",
  "createExtractionReportSnapshot",
  "createExtractionRunDiff",
  "deleteExtraction",
];

// [scope, name] — scope is the dotted path under api.extraction.queries, or
// "" when the function is at the top level (e.g. still on the queries.ts
// barrel pending its split). Post T5.3 the papers queries moved under
// `queries.papers.<fn>`.
const PUBLIC_QUERIES: ReadonlyArray<readonly [string, string]> = [
  ["", "getMyJobs"],
  ["", "getJobDetails"],
  ["papers", "results"],
  ["papers", "pdfUrl"],
  ["", "getJobResults"],
  ["", "getJobResultsPaginated"],
  ["", "getJobInsights"],
  ["", "getQuestionInsights"],
  ["", "getQuestionDisagreements"],
  ["", "getReviewQueue"],
  ["", "getSavedViews"],
  ["", "getWorkflowTemplates"],
  ["", "getReportSnapshots"],
  ["", "getRunDiff"],
  ["", "subscribeToJobProgress"],
];

function resolve(root: unknown, scope: string): unknown {
  if (scope === "") return root;
  let ref: unknown = root;
  for (const seg of scope.split(".")) {
    ref = (ref as Record<string, unknown>)[seg];
  }
  return ref;
}

describe("SN-1 public mutation routing", () => {
  test.each(PUBLIC_MUTATIONS)(
    "api.extraction.mutations.%s is registered and invokable",
    async (name) => {
      const t = convexTest(schema);
      const ref = (api.extraction.mutations as unknown as Record<string, never>)[name];
      await assertRoutes(() => (t.mutation as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});

describe("SN-1 public query routing", () => {
  test.each(PUBLIC_QUERIES)(
    "api.extraction.queries.%s.%s is registered and invokable",
    async (scope, name) => {
      const t = convexTest(schema);
      const parent = resolve(api.extraction.queries, scope);
      const ref = (parent as Record<string, never>)[name];
      await assertRoutes(() => (t.query as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});

// ============================================================================
// P9.T5 — unified job creation (startJob / duplicateJob / startJobFromTemplate)
//
// Extraction-mode jobs call `workflow.start(...)` at the tail of the mutation,
// which requires the workflow Convex component to be registered in the test
// harness. Registering workflow + nested workpool components here is invasive
// (requires globbing the upstream component sources); following the existing
// SN-1 pattern above, we accept "workflow component not registered" as proof
// the mutation path reached workflow.start — i.e. every pre-workflow step
// (auth, rate-limit, flag, dedupe, bucket validation, insert) passed.
//
// Chat-mode jobs schedule `internal.chat.threads.ensureThreadForJob` instead
// of starting a workflow, so they complete cleanly against convex-test and
// support direct state assertions.
// ============================================================================

const STARTJOB_CLERK = "clerk_startjob";
const STARTJOB_IDENTITY = {
  subject: STARTJOB_CLERK,
  tokenIdentifier: `${STARTJOB_CLERK}|test`,
};

type FlagSeed = Partial<{
  enabled: boolean;
  start: boolean;
  chat: boolean;
}>;

async function seedUserAndFlags(
  t: ReturnType<typeof convexTest>,
  flags: FlagSeed = {},
): Promise<{ userId: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: STARTJOB_CLERK,
      email: "startjob@test.com",
      firstName: "S",
      lastName: "J",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: flags.enabled ?? true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: flags.start ?? true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.chat",
      enabled: flags.chat ?? false,
      minimumTier: 0,
      updatedAt: now,
    });
    return { userId };
  });
}

const BUCKET_ITEM_HISTORY = {
  bucketKey: "history:W1",
  source: "history" as const,
  sourceRefId: "W1",
  title: "Paper One",
  authors: ["A"],
  openalexId: "W1",
  searchFilters: { limit: 1 },
};

// Matches the runtime message convex-test emits when an un-registered
// Convex component is invoked. Reaching this point proves the mutation
// advanced through every server-side step before workflow.start.
const WORKFLOW_NOT_REGISTERED_RE =
  /Component "workflow" is not registered/;

describe("startJob — extraction mode", () => {
  it("reaches workflow.start with extraction args (auth + flag + bucket + insert succeed)", async () => {
    const t = convexTest(schema);
    await seedUserAndFlags(t);
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Extraction Job",
        mode: "extraction",
        bucketItems: [BUCKET_ITEM_HISTORY],
        questions: [
          { key: "q1", question: "What is the outcome?", type: "string" },
        ],
        usePdfs: false,
      }),
    ).rejects.toThrow(WORKFLOW_NOT_REGISTERED_RE);
  });
});

describe("startJob — chat mode", () => {
  it("creates a chat job with messageCount initialised when the chat flag is ON", async () => {
    const t = convexTest(schema);
    await seedUserAndFlags(t, { chat: true });
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    const { jobId } = await auth.mutation(api.extraction.mutations.startJob, {
      name: "Chat Job",
      mode: "chat",
      bucketItems: [BUCKET_ITEM_HISTORY],
    });
    expect(jobId).toBeTruthy();

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.mode).toBe("chat");
    expect(job?.status).toBeUndefined();
    expect(job?.messageCount).toBe(0);
    expect(job?.workflowId).toBeUndefined();
  });

  it("rejects chat mode when the extraction.chat flag is OFF", async () => {
    const t = convexTest(schema);
    await seedUserAndFlags(t, { chat: false });
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.startJob, {
        name: "Chat Job",
        mode: "chat",
        bucketItems: [BUCKET_ITEM_HISTORY],
      }),
    ).rejects.toThrow(/disabled/i);
  });
});

describe("duplicateJob", () => {
  it("reads the source job and reaches workflow.start for the (Copy) duplicate", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserAndFlags(t);

    // Seed an existing extraction job row + source rows directly — this lets
    // the duplicate path exercise its full read-then-write chain without the
    // original startJob attempting to call workflow.start.
    const sourceJobId = await t.run(async (ctx) => {
      const now = Date.now();
      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 1,
        processedPapers: 1,
        failedPapers: 0,
        name: "Base",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("extractionJobSources", {
        jobId,
        position: 0,
        bucketKey: BUCKET_ITEM_HISTORY.bucketKey,
        source: BUCKET_ITEM_HISTORY.source,
        sourceRefId: BUCKET_ITEM_HISTORY.sourceRefId,
        title: BUCKET_ITEM_HISTORY.title,
        authors: BUCKET_ITEM_HISTORY.authors,
        openalexId: BUCKET_ITEM_HISTORY.openalexId,
        searchFilters: BUCKET_ITEM_HISTORY.searchFilters,
      });
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: "q1",
        question: "What is the outcome?",
        type: "string" as const,
        order: 0,
        createdAt: now,
      });
      return jobId;
    });

    const auth = t.withIdentity(STARTJOB_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.duplicateJob, {
        jobId: sourceJobId,
      }),
    ).rejects.toThrow(WORKFLOW_NOT_REGISTERED_RE);
  });

  it("rejects chat-mode jobs as not yet duplicable", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserAndFlags(t);

    const chatJobId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        name: "Chat Base",
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    const auth = t.withIdentity(STARTJOB_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.duplicateJob, {
        jobId: chatJobId,
      }),
    ).rejects.toThrow(/cannot be duplicated/i);
  });
});

describe("startJobFromTemplate", () => {
  it("reads the template and reaches workflow.start for the rerun", async () => {
    const t = convexTest(schema);
    const { userId } = await seedUserAndFlags(t);
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    const templateId: Id<"extractionWorkflowTemplates"> = await t.run(
      async (ctx) => {
        const now = Date.now();
        return await ctx.db.insert("extractionWorkflowTemplates", {
          userId,
          name: "Template A",
          sourceType: "history",
          bucketItems: [BUCKET_ITEM_HISTORY],
          questions: [
            { key: "q1", question: "What is the outcome?", type: "string" },
          ],
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    await expect(
      auth.mutation(api.extraction.mutations.startJobFromTemplate, {
        templateId,
      }),
    ).rejects.toThrow(WORKFLOW_NOT_REGISTERED_RE);
  });
});
