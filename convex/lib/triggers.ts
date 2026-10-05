/**
 * Database triggers: code that runs in the same transaction as every insert, update and
 * delete of a table, whichever function makes it. Counters kept from a table register
 * here, so they can't drift from the rows they count (#351). The builders in
 * `./functions.ts` apply them, and so does `t.run` in tests (tests/convex-test-with-limits.ts).
 */
import { Triggers } from "convex-helpers/server/triggers";
import type { DataModel } from "../_generated/dataModel";
import { settleEndedJob } from "../billing/spend";
import { countJobChange, countPaperChange, countPaperErrorChange, countResultChange, reviseQuestionChange } from "../extraction/counts";
import { nameJob } from "../extraction/jobList";
import { recordRevisionApprovedQueries } from "../evidenceLibraries/approvedQueries";
import { countChange } from "../research/recordCounts";
import { ADMIN_LIST, countList, libraryVersionList, organizationLibrariesOf, walletKeyList } from "./listCounts";

export const triggers = new Triggers<DataModel>();

triggers.register("extractionJobs", countJobChange);
triggers.register("extractionJobs", nameJob);
triggers.register("extractionJobs", countChange("extractionJobs"));
triggers.register("extractionJobs", settleEndedJob);
triggers.register("extractionResults", countResultChange);
triggers.register("extractionQuestions", reviseQuestionChange);
triggers.register("extractionPaperErrors", countPaperErrorChange);
triggers.register("extractionPapers", countPaperChange);
triggers.register("evidenceLibraryConfigSections", recordRevisionApprovedQueries);
triggers.register("searches", countChange("searches"));
triggers.register("queryShortcuts", countChange("queryShortcuts"));
triggers.register("screeningJobs", countChange("screeningJobs"));
triggers.register("walletKeys", countList(walletKeyList));
triggers.register("admins", countList(() => ADMIN_LIST));
triggers.register("evidenceLibraryConfigOperations", countList(libraryVersionList));
triggers.register("evidenceLibraries", countList((library) => organizationLibrariesOf(library.organizationId)));
