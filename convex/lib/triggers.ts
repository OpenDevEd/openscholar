/**
 * Database triggers: code that runs in the same transaction as every insert, update and
 * delete of a table, whichever function makes it. Counters kept from a table register
 * here, so they can't drift from the rows they count (#351). The builders in
 * `./functions.ts` apply them, and so does `t.run` in tests (tests/convex-test-with-limits.ts).
 */
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { countPaperChange } from "../extraction/jobCounters";
import { countPaperErrorChange, countResultChange } from "../extraction/resultCounts";
import { recordRevisionApprovedQueries } from "../evidenceLibraries/approvedQueries";
import { countScreeningResultChange } from "../screening/resultCounts";

export const triggers = new Triggers<DataModel>();

triggers.register("extractionResults", countResultChange);
triggers.register("extractionPaperErrors", countPaperErrorChange);
triggers.register("extractionPapers", countPaperChange);
triggers.register("screeningResults", countScreeningResultChange);
triggers.register("evidenceLibraryConfigSections", recordRevisionApprovedQueries);
