"use client";

import { readAuthorNames } from "@/app/actions/openalex-authors";
import { createNameLookup } from "./use-entity-names";

const authors = createNameLookup("author", readAuthorNames);

/** Names for author ids such as A5023888391. */
export const useAuthorNames = authors.useNames;
export const rememberAuthorNames = authors.remember;
