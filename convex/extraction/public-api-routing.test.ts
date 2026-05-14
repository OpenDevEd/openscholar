/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, it, test, expect, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { register as registerAgentComponent } from "@convex-dev/agent/test";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../credits/aggregates.test-support";

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

function createTestConvex() {
  const t = convexTest(schema);
  setupTransactionAggregates(t);
  registerAgentComponent(t);
  return t;
}

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
  ["", "getJobShell"],
  ["", "getJobDetails"],
  ["papers", "results"],
  ["papers", "pdfUrl"],
  ["", "getJobResultsForExport"],
  ["", "getJobResultsPage"],
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
      setupTransactionAggregates(t);
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
      setupTransactionAggregates(t);
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
    // Seed a large credit balance so plan-03's preflight gate in
    // startJob does not block these routing tests.
    await seedCreditsForTest(ctx, { userId, free: 0, paid: 100_000, now });
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

const BUCKET_ITEM_SAVED_SEARCH = {
  bucketKey: "history:search_1",
  source: "history" as const,
  sourceRefId: "search_1",
  title: "heart disease",
  authors: [],
  searchFilters: {
    query: "heart disease",
    searchField: "title_and_abstract" as const,
    limit: 2,
  },
};

const BUCKET_ITEM_ZOTERO = {
  bucketKey: "zotero:item_1",
  source: "zotero" as const,
  sourceRefId: "item_1",
  title: "Zotero paper",
  authors: ["Z Author"],
  year: 2023,
  doi: "10.1000/zotero",
  abstract: "Zotero abstract",
  libraryType: "user" as const,
  zoteroUserId: "98765",
};

// Matches the runtime message convex-test emits when an un-registered
// Convex component is invoked. Reaching this point proves the mutation
// advanced through every server-side step before workflow.start.
const WORKFLOW_NOT_REGISTERED_RE =
  /Component "workflow" is not registered/;

describe("startJob — extraction mode", () => {
  it("reaches workflow.start with extraction args (auth + flag + bucket + insert succeed)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
    setupTransactionAggregates(t);
    await seedUserAndFlags(t, { chat: true });
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    const { jobId } = (await auth.mutation(api.extraction.mutations.startJob, {
      name: "Chat Job",
      mode: "chat",
      bucketItems: [BUCKET_ITEM_HISTORY],
    })) as { jobId: Id<"extractionJobs"> };
    expect(jobId).toBeTruthy();

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.mode).toBe("chat");
    expect(job?.status).toBeUndefined();
    expect(job?.messageCount).toBe(0);
    expect(job?.workflowId).toBeUndefined();
  });

  it("rejects chat mode when the extraction.chat flag is OFF", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

describe("startJob — chat source preparation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.OPENALEX_CONTACT_EMAIL;
  });

  it("expands saved-search history rows before creating the chat thread", async () => {
    const t = createTestConvex();
    await seedUserAndFlags(t, { chat: true });
    const auth = t.withIdentity(STARTJOB_IDENTITY);
    process.env.OPENALEX_CONTACT_EMAIL = "test@example.com";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                id: "https://openalex.org/W100",
                display_name: "Expanded paper one",
                publication_year: 2022,
                authorships: [{ author: { display_name: "Alpha" } }],
                abstract_inverted_index: { Expanded: [0], paper: [1], one: [2] },
                open_access: { oa_url: "https://example.com/one.pdf", is_oa: true },
              },
              {
                id: "https://openalex.org/W200",
                display_name: "Expanded paper two",
                publication_year: 2021,
                authorships: [{ author: { display_name: "Beta" } }],
                abstract_inverted_index: { Expanded: [0], paper: [1], two: [2] },
                open_access: { oa_url: "https://example.com/two.pdf", is_oa: true },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { jobId } = (await auth.mutation(api.extraction.mutations.startJob, {
      name: "Chat Job",
      mode: "chat",
      bucketItems: [BUCKET_ITEM_SAVED_SEARCH],
    })) as { jobId: Id<"extractionJobs"> };

    let job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.chatThreadId).toBeUndefined();

    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

    job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.chatThreadId).toBeTruthy();
    expect(job?.error).toBeUndefined();

    const sources = await t.run((ctx) =>
      ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.title)).toEqual([
      "Expanded paper one",
      "Expanded paper two",
    ]);
    expect(sources.every((source) => source.searchFilters === undefined)).toBe(
      true,
    );
    expect(sources.every((source) => source.openalexId?.startsWith("W"))).toBe(
      true,
    );
  });

  it("normalizes zotero rows before creating the chat thread", async () => {
    const t = createTestConvex();
    const { userId } = await seedUserAndFlags(t, { chat: true });
    const auth = t.withIdentity(STARTJOB_IDENTITY);

    await t.run(async (ctx) => {
      await ctx.db.insert("zoteroConnections", {
        userId,
        zoteroUserId: "98765",
        encryptedApiKey: "encrypted",
        keyPrefix: "zot",
        connectedAt: Date.now(),
      });
    });

    const { jobId } = (await auth.mutation(api.extraction.mutations.startJob, {
      name: "Zotero Chat Job",
      mode: "chat",
      bucketItems: [BUCKET_ITEM_ZOTERO],
    })) as { jobId: Id<"extractionJobs"> };

    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.chatThreadId).toBeTruthy();
    expect(job?.error).toBeUndefined();

    const sources = await t.run((ctx) =>
      ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].openalexId).toBe("zotero:user:item_1");
    expect(sources[0].pdfUrl).toBe("zotero://select/users/98765/items/item_1");
    expect(sources[0].searchFilters).toBeUndefined();
  });
});

describe("duplicateJob", () => {
  it("reads the source job and reaches workflow.start for the (Copy) duplicate", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

  it("rejects chat-mode duplicate when the extraction.chat flag is OFF", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserAndFlags(t, { chat: false });

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
    ).rejects.toThrow(/extraction\.chat/i);
  });

  it("duplicates a chat-mode job with sources and chatPapers when extraction.chat is ON", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedUserAndFlags(t, { chat: true });

    const { chatJobId, oldSourceIds } = await t.run(async (ctx) => {
      const now = Date.now();
      const chatJobId = await ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        name: "Chat Base",
        sourceType: "history" as const,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      const s1 = await ctx.db.insert("extractionJobSources", {
        jobId: chatJobId,
        position: 0,
        bucketKey: BUCKET_ITEM_HISTORY.bucketKey,
        source: "history" as const,
        sourceRefId: BUCKET_ITEM_HISTORY.sourceRefId,
        title: BUCKET_ITEM_HISTORY.title,
        authors: BUCKET_ITEM_HISTORY.authors,
        openalexId: BUCKET_ITEM_HISTORY.openalexId,
        searchFilters: BUCKET_ITEM_HISTORY.searchFilters,
      });
      const s2 = await ctx.db.insert("extractionJobSources", {
        jobId: chatJobId,
        position: 1,
        bucketKey: "history:W2",
        source: "history" as const,
        sourceRefId: "W2",
        title: "Paper Two",
        authors: ["B"],
        openalexId: "W2",
        searchFilters: { limit: 1 },
      });
      await ctx.db.insert("chatPapers", {
        jobId: chatJobId,
        sourceId: s1,
        included: true,
      });
      await ctx.db.insert("chatPapers", {
        jobId: chatJobId,
        sourceId: s2,
        included: false,
      });
      return { chatJobId, oldSourceIds: [s1, s2] };
    });

    const auth = t.withIdentity(STARTJOB_IDENTITY);
    const { jobId: newJobId } = await auth.mutation(
      api.extraction.mutations.duplicateJob,
      { jobId: chatJobId },
    );

    await t.run(async (ctx) => {
      const newJob = await ctx.db.get("extractionJobs", newJobId);
      expect(newJob).not.toBeNull();
      expect(newJob!.mode).toBe("chat");
      expect(newJob!.name).toBe("Chat Base (Copy)");

      const newSources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", newJobId))
        .collect();
      expect(newSources).toHaveLength(2);

      const newPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", newJobId))
        .collect();
      expect(newPapers).toHaveLength(2);
      const bySourceIncluded = new Map(
        newPapers.map((p) => [p.sourceId, p.included]),
      );
      const newBySourceRef = new Map(
        newSources.map((s) => [s.sourceRefId, s._id]),
      );
      expect(bySourceIncluded.get(newBySourceRef.get("W1")!)).toBe(true);
      expect(bySourceIncluded.get(newBySourceRef.get("W2")!)).toBe(false);

      // New chatPapers must NOT reference the old sourceIds — they were
      // remapped to the cloned sources.
      for (const oldId of oldSourceIds) {
        expect(bySourceIncluded.has(oldId)).toBe(false);
      }
    });
  });
});

describe("startJobFromTemplate", () => {
  it("reads the template and reaches workflow.start for the rerun", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
