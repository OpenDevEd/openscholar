// A screening's addresses, in one place. Every page of a screening has its own, so the browser's Back
// returns to the page a person was on, and an address can be kept or sent to someone. They are paths
// in the person's own workspace: a link takes the organization's prefix where the page is one of its
// (components/workspaces/link.tsx).

import { useTranslations } from "next-intl";
import { SCREENINGS_PATH, screeningPath } from "@/lib/screening/links";

const BASE = SCREENINGS_PATH;

type Query = Record<string, string | number | null | undefined>;
const withQuery = (path: string, query?: Query, section?: string) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const search = params.toString();
  return `${path}${search ? `?${search}` : ""}${section ? `#${section}` : ""}`;
};

/** The list of screenings. */
export const SCREENINGS = BASE;
/** The trail every page under the list starts with, in the reader's language. */
export const useScreeningsCrumb = () => ({ label: useTranslations("screening.list")("title"), href: BASE });
/** The new-screening form: blank, started from another screening's settings (`from`), on a saved search (`search`), or on what a community handed over (`handoff`). */
export const newHref = (on?: { from?: string; search?: string; handoff?: string }) => withQuery(`${BASE}/new`, on);
/** An open screening's Overview, at one of its sections: "reviewers", "new-papers", "agreement" or "flow". */
export const overviewHref = (id: string, section?: "reviewers" | "new-papers" | "agreement" | "flow") => withQuery(screeningPath(id), undefined, section);
/**
 * Its Screen page: a queue (To do when left out), the paper open in it, the order of what is still to
 * do, and in Done which of your votes to show.
 */
export const screenHref = (id: string, query?: { queue?: "again" | "done" | "conflicts"; paper?: string; order?: "fresh" | "lean"; voted?: "include" | "maybe" | "exclude" }) => withQuery(`${BASE}/${id}/screen`, query);
/**
 * Its Papers page, narrowed to what a number or a name stood for, or with one paper open.
 * `result`: include, maybe, exclude, conflict or waiting. `source`: a source's id. `added`: "start" or
 * the time of a check for new papers. `reviewer`: a reviewer's id, for the papers they voted on, and
 * with `voted` (include, maybe, exclude, or none for the ones that wait for their vote) the papers they
 * voted that way, or with `voted=failed` the ones a model couldn't read; `voted` without `reviewer` is your own vote. `with`: a second reviewer's id, for the
 * papers both voted on. `reason`: why a paper was excluded, a criterion's key or another reason's.
 * `sort`: added, title, newest, split or points. `paper`: the paper open beside the table.
 */
export const papersHref = (id: string, query?: { result?: string; source?: string; added?: string; reviewer?: string; voted?: string; with?: string; reason?: string; sort?: string; paper?: string }) => withQuery(`${BASE}/${id}/papers`, query);
/**
 * A reviewer's papers: the ones they voted on, or, before their first vote, the ones that wait for it, or a model's
 * that it couldn't read, so the link never opens an empty list. Null where they have none of these yet: nothing to open.
 */
export const reviewerHref = (id: string, reviewer: { id: string; tally?: { cast: number; waiting: number; failed: number } }) => {
  const tally = reviewer.tally;
  if (!tally || tally.cast) return papersHref(id, { reviewer: reviewer.id });
  if (tally.waiting) return papersHref(id, { reviewer: reviewer.id, voted: "none" });
  if (tally.failed) return papersHref(id, { reviewer: reviewer.id, voted: "failed" });
  return null;
};
/** Its settings, at one of their sections. */
export const settingsHref = (id: string, section?: "papers" | "new-papers" | "criteria" | "reviewers" | "decided" | "goes-to") => withQuery(`${BASE}/${id}/settings`, undefined, section);
