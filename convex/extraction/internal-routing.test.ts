import { convexTest } from "convex-test";
import { describe, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

/**
 * Safety net SN-2 (P3 plan): pin the INTERNAL `internal.extraction.*` routing
 * surface. Workflow / workpool / crons / tests resolve internal functions via
 * these paths; a bad split that drops an export (or moves an internal without
 * updating callers) is caught here.
 *
 * Path-level note: when Task 4 / Task 5 move internals under
 * `mutations/internal/*` and `queries/internal.ts`, the entries below that
 * reference the old root paths get updated in the SAME commit that moves the
 * caller. Between SN-2 and that commit, every listed path must resolve.
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

const INTERNAL_MUTATIONS: ReadonlyArray<string> = [
  "deleteExtractionInternal",
  "cleanupFailedPaperStorage",
  "backfillJobStats",
  "createPaperRecords",
  "updateJobStatus",
  "updatePaperStatus",
  "updatePaperProcessable",
  "setPaperStorage",
  "markPaperIndexed",
  "cleanupOldPdfs",
  "maybeFinalizeJob",
  "createJobDirect",
  "createQuestionDirect",
  "setJobWorkflowId",
  "enqueuePaperProcessing",
  "saveExtractionResultsAndComplete",
  "replacePaperEvidenceUnits",
];

const INTERNAL_QUERIES: ReadonlyArray<string> = [
  "getPaperResultsInternal",
  "getPdfExtractionEnabledInternal",
  "getJobInternal",
  "debugRecentPapers",
  "getQuestionsInternal",
  "getJobSourcesInternal",
  "getJobAndFlagsInternal",
  "getPapersByOpenAlexIds",
  "getPaperInternal",
  "getEvidenceUnitsInternal",
  "getJobProgressInternal",
  "getPapersDebug",
];

// Internal actions — workflow/workpool/crons call these via internal.*.
// `actions.ts` hosts OpenAlex fetch; `workpoolActions.ts` hosts pipeline
// actions; `debug_pdfjs_alignment.ts` hosts a debug action.
const INTERNAL_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ["actions", "fetchPapersFromHistory"],
  ["workpoolActions", "downloadAndIndexPdfAction"],
  ["workpoolActions", "waitAndExtractAction"],
  ["debug_pdfjs_alignment", "debugPdfAlignment"],
];

describe("SN-2 internal.extraction.mutations routing", () => {
  test.each(INTERNAL_MUTATIONS)(
    "internal.extraction.mutations.%s is registered and invokable",
    async (name) => {
      const t = convexTest(schema);
      const ref = (internal.extraction.mutations as Record<string, unknown>)[
        name
      ];
      await assertRoutes(() => t.mutation(ref as never, {} as never));
    }
  );
});

describe("SN-2 internal.extraction.queries routing", () => {
  test.each(INTERNAL_QUERIES)(
    "internal.extraction.queries.%s is registered and invokable",
    async (name) => {
      const t = convexTest(schema);
      const ref = (internal.extraction.queries as Record<string, unknown>)[
        name
      ];
      await assertRoutes(() => t.query(ref as never, {} as never));
    }
  );
});

describe("SN-2 internal.extraction.<actions> routing", () => {
  test.each(INTERNAL_ACTIONS)(
    "internal.extraction.%s.%s is registered and invokable",
    async (module, name) => {
      const t = convexTest(schema);
      const mod = (internal.extraction as Record<string, unknown>)[module] as
        | Record<string, unknown>
        | undefined;
      const ref = mod?.[name];
      await assertRoutes(() => t.action(ref as never, {} as never));
    }
  );
});
