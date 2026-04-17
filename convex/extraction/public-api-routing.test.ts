import { convexTest } from "convex-test";
import { describe, test } from "vitest";
import { api } from "../_generated/api";
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
  "startExtraction",
  "cancelExtraction",
  "duplicateExtraction",
  "setResultReviewState",
  "startExtractionFromTemplate",
  "saveExtractionSavedView",
  "deleteExtractionSavedView",
  "saveWorkflowTemplateFromJob",
  "saveWorkflowTemplate",
  "deleteWorkflowTemplate",
  "createExtractionReportSnapshot",
  "createExtractionRunDiff",
  "deleteExtraction",
];

const PUBLIC_QUERIES: ReadonlyArray<string> = [
  "getMyJobs",
  "getJobDetails",
  "getPaperResults",
  "getPaperPdfUrl",
  "getJobResults",
  "getJobResultsPaginated",
  "getJobInsights",
  "getQuestionInsights",
  "getQuestionDisagreements",
  "getReviewQueue",
  "getSavedViews",
  "getWorkflowTemplates",
  "getReportSnapshots",
  "getRunDiff",
  "subscribeToJobProgress",
];

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
    "api.extraction.queries.%s is registered and invokable",
    async (name) => {
      const t = convexTest(schema);
      const ref = (api.extraction.queries as unknown as Record<string, never>)[name];
      await assertRoutes(() => (t.query as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});
