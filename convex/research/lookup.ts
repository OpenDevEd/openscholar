/**
 * Finds what a search can be filtered by but only by ID (#327): an author, a funder, a
 * journal, an institution, a research area. The search page's filters look the same things
 * up as the person types; the assistant asks by name and gets the IDs the search tools take
 * (./searches.ts).
 */
import { v, type Infer } from "convex/values";
import { internal } from "../_generated/api";
import { createError } from "../lib/errors";
import { assistantAction, defineUserAction, userAction } from "../lib/userActions";
import { autocomplete, readNames } from "../paperSets/openalex";
import { spender } from "../paperSets/search";
import { OpenAlexLimitedError } from "../../lib/openalex/limited";
import { LOOKUP_MAX, NAMES_MAX, lookupKindValidator, lookupValidator, namesValidator } from "./searchValidators";

const ENTITIES = { author: "authors", funder: "funders", journal: "sources", institution: "institutions" } as const;

export const findAction = defineUserAction({
  path: "research/lookup:find",
  description:
    "Finds an author, a funder, a journal, an institution or a research area by name, to filter a saved search by: each match's ID, its name, and what tells it from others of that name (where an author works, whether a journal is a journal or a repository and who publishes it, where an institution is, what an area sits under). " +
    "Give the IDs to research/searches:create or :update as `authors`, `funders`, `journals`, `institutions` or `researchAreas`. Looking up anything but a research area counts against the person's OpenAlex allowance.",
  args: { kind: lookupKindValidator, text: v.string() },
  returns: lookupValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { kind, text }): Promise<Infer<typeof lookupValidator>> => {
    if (!text.trim()) throw createError("VALIDATION_ERROR", "Give a name to look for.");
    if (kind === "researchArea") return await ctx.runQuery(internal.research.topicCatalog.search, { text });
    const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    const { clerkId } = person;
    const matches = await autocomplete(ENTITIES[kind], text.trim(), spender(ctx, clerkId));
    return { matches: matches.slice(0, LOOKUP_MAX) };
  },
});
export const find = userAction(findAction);
export const findForAssistant = assistantAction(findAction);

/** What a filter names by ID, by the letter its ID starts with. */
const BY_LETTER = { A: "authors", F: "funders", S: "sources", I: "institutions" } as const;
const AREA = /^(?:T[1-9]\d*|(?:domains|fields|subfields)\/[1-9]\d*)$/i;
const RECORD = /^[AFSI]\d+$/i;

export const namesAction = defineUserAction({
  path: "research/lookup:names",
  description:
    `Names what a saved search's filters hold by ID, up to ${NAMES_MAX} at once, as research/records:getSearch gives them: authors (A…), funders (F…), journals (S…), institutions (I…) and research areas (T…, or fields/, subfields/ or domains/ with a number). ` +
    "Each comes back with its name; one OpenAlex has none for is left out. One request for each kind of ID but research areas, against the person's OpenAlex allowance.",
  args: { ids: v.array(v.string()) },
  returns: namesValidator,
  spendsCredits: false,
  outsideEffect: false,
  // It changes nothing, so there's nothing to undo.
  undoable: true,
  run: async (ctx, { userId }, { ids }): Promise<Array<{ id: string; name: string }>> => {
    const asked = [...new Set(ids.map((id) => id.trim().replace(/^https:\/\/openalex\.org\//i, "")))];
    if (!asked.length || asked.length > NAMES_MAX) throw createError("VALIDATION_ERROR", `Give between 1 and ${NAMES_MAX} IDs.`);
    const unknown = asked.find((id) => !AREA.test(id) && !RECORD.test(id));
    if (unknown) throw createError("VALIDATION_ERROR", `${unknown.slice(0, 100)} isn't an ID a filter names: an author, funder, journal or institution ID such as A5023888391, or a research area such as T10011 or fields/33.`);
    const areas = asked.filter((id) => AREA.test(id)).map((id) => (/^t/i.test(id) ? id.toUpperCase() : id.toLowerCase()));
    const records: Partial<Record<keyof typeof BY_LETTER, string[]>> = {};
    for (const id of asked.filter((one) => RECORD.test(one)).map((one) => one.toUpperCase())) (records[id[0] as keyof typeof BY_LETTER] ??= []).push(id);
    const named: Array<{ id: string; name: string }> = areas.length ? await ctx.runQuery(internal.research.topicCatalog.names, { ids: areas }) : [];
    if (Object.keys(records).length) {
      const person: { clerkId: string } | null = await ctx.runQuery(internal.users.internal.getUserById, { userId });
      if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
      const groups = Object.entries(records) as Array<[keyof typeof BY_LETTER, string[]]>;
      // One request a kind, all counted before the first is made: past the allowance, none is.
      if (!(await spender(ctx, person.clerkId)(groups.length))) throw createError("VALIDATION_ERROR", new OpenAlexLimitedError().message);
      for (const [letter, group] of groups) named.push(...(await readNames(BY_LETTER[letter], group, async () => true)));
    }
    return named;
  },
});
export const names = userAction(namesAction);
export const namesForAssistant = assistantAction(namesAction);
