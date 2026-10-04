"use client";

import { readFunderNames } from "@/app/actions/funders";
import { createNameLookup } from "./use-entity-names";

const funders = createNameLookup("funder", readFunderNames);

/** Names for funder ids such as F4320311904. */
export const useFunderNames = funders.useNames;
export const rememberFunderNames = funders.remember;
