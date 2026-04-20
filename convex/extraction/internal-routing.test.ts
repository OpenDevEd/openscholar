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
 * After T4.14, internal mutations surface at the long
 * `internal.extraction.mutations.<scope>.<fn>` path — the barrel no longer
 * re-exports them. Entries below track (scope, name) so a refactor that
 * moves an internal into a different submodule trips this test.
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

function resolve(root: unknown, segments: string[]): unknown {
  let ref: unknown = root;
  for (const seg of segments) {
    ref = (ref as Record<string, unknown>)[seg];
  }
  return ref;
}

// [scope, name] — scope is the dotted path under internal.extraction.mutations.
const INTERNAL_MUTATIONS: ReadonlyArray<readonly [string, string]> = [
  ["internal.admin", "deleteExtractionInternal"],
  ["internal.admin", "cleanupFailedPaperStorage"],
  ["internal.admin", "cleanupOldPdfs"],
  ["internal.lifecycle", "maybeFinalizeJob"],
  ["internal.lifecycle", "createJobDirect"],
  ["internal.lifecycle", "createQuestionDirect"],
  ["internal.lifecycle", "setJobWorkflowId"],
  ["internal.onComplete", "handleExtractionJobComplete"],
  ["papers", "createPaperRecords"],
  ["papers", "updatePaperStatus"],
  ["papers", "updatePaperProcessable"],
  ["papers", "setPaperStorage"],
  ["papers", "markPaperIndexed"],
  ["results", "updateJobStatus"],
  ["results", "recordOneAnswer"],
  ["results", "recordOneAnswerFailure"],
  ["results", "finalizePaper"],
  ["evidence", "replacePaperEvidenceUnits"],
];

// [scope, name] — post T5.3 the papers internals moved under
// `queries.papers.*` with Task 12 renames. Everything else still lives
// at the root of `internal.extraction.queries` until later Task 5
// commits peel it off.
const INTERNAL_QUERIES: ReadonlyArray<readonly [string, string]> = [
  ["internal", "getJobInternal"],
  ["internal", "debugRecentPapers"],
  ["internal", "getQuestionsInternal"],
  ["internal", "getJobSourcesInternal"],
  ["internal", "getJobAndFlagsInternal"],
  ["internal", "getEvidenceUnitsInternal"],
  ["internal", "getJobProgressInternal"],
  ["internal", "getPapersDebug"],
  ["internal", "getQuestionByIdInternal"],
  ["internal", "getResultByPaperAndQuestionInternal"],
  ["papers", "resultsInternal"],
  ["papers", "byOpenAlexIds"],
  ["papers", "byId"],
];

// Internal actions — workflow/workpool/crons call these via internal.*.
// `actions.ts` hosts OpenAlex fetch; `workpoolActions.ts` hosts pipeline
// actions; `debug_pdfjs_alignment.ts` hosts a debug action.
const INTERNAL_ACTIONS: ReadonlyArray<readonly [string, string]> = [
  ["actions", "fetchPapersFromHistory"],
  ["workpoolActions", "downloadAndIndexPdfAction"],
  ["workpoolActions", "extractOneQuestion"],
  ["debug_pdfjs_alignment", "debugPdfAlignment"],
];

describe("SN-2 internal.extraction.mutations routing", () => {
  test.each(INTERNAL_MUTATIONS)(
    "internal.extraction.mutations.%s.%s is registered and invokable",
    async (scope, name) => {
      const t = convexTest(schema);
      const parent = resolve(internal.extraction.mutations, scope.split("."));
      const ref = (parent as Record<string, never>)[name];
      await assertRoutes(() => (t.mutation as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});

describe("SN-2 internal.extraction.queries routing", () => {
  test.each(INTERNAL_QUERIES)(
    "internal.extraction.queries.%s.%s is registered and invokable",
    async (scope, name) => {
      const t = convexTest(schema);
      const parent = resolve(internal.extraction.queries, scope.split("."));
      const ref = (parent as Record<string, never>)[name];
      await assertRoutes(() => (t.query as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});

describe("SN-2 internal.extraction.<actions> routing", () => {
  test.each(INTERNAL_ACTIONS)(
    "internal.extraction.%s.%s is registered and invokable",
    async (module, name) => {
      const t = convexTest(schema);
      const mod = (internal.extraction as unknown as Record<string, Record<string, never> | undefined>)[module];
      const ref = mod?.[name];
      await assertRoutes(() => (t.action as unknown as (r: unknown, a: unknown) => Promise<unknown>)(ref, {}));
    }
  );
});
