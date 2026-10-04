"use client";

import { readAuthorNames } from "@/app/actions/openalex-authors";
import { isAuthorId } from "./author-filter";
import { createNameLookup } from "./use-entity-names";

const authors = createNameLookup("author", readAuthorNames);

/**
 * Names for the authors a search is filtered by. An id such as A5023888391 is
 * looked up; an author kept by name is already one.
 */
export function useAuthorNames(values: readonly string[]): Record<string, string> {
  const looked = authors.useNames(values.filter(isAuthorId));
  return { ...Object.fromEntries(values.filter((value) => !isAuthorId(value)).map((name) => [name, name])), ...looked };
}
export const rememberAuthorNames = authors.remember;
