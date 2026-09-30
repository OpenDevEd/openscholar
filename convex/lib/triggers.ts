/**
 * Database triggers: code that runs in the same transaction as every insert, update and
 * delete of a table, whichever function makes it. Counters kept from a table register
 * here, so they can't drift from the rows they count (#351). The builders in
 * `./functions.ts` apply them; `t.run` in tests doesn't, so tests seed through
 * `withTriggers` from `./triggers.test-support.ts`.
 */
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { countPaperChange } from "../extraction/jobCounters";
import { countPaperErrorChange, countResultChange } from "../extraction/resultCounts";

export const triggers = new Triggers<DataModel>();

triggers.register("extractionResults", countResultChange);
triggers.register("extractionPaperErrors", countPaperErrorChange);
triggers.register("extractionPapers", countPaperChange);
