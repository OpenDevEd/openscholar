"use client";

import { readOpenAlexRecordNames } from "@/app/actions/openalex-lookup";
import { createNameLookup } from "./use-entity-names";

const funders = createNameLookup("funder", (ids) => readOpenAlexRecordNames("funders", ids));
const journals = createNameLookup("journal", (ids) => readOpenAlexRecordNames("sources", ids));
const institutions = createNameLookup("institution", (ids) => readOpenAlexRecordNames("institutions", ids));

/** Names for funder ids such as F4320311904. */
export const useFunderNames = funders.useNames;
export const rememberFunderNames = funders.remember;
/** Names for journal (source) ids such as S137773608. */
export const useJournalNames = journals.useNames;
export const rememberJournalNames = journals.remember;
/** Names for institution ids such as I136199984. */
export const useInstitutionNames = institutions.useNames;
export const rememberInstitutionNames = institutions.remember;
