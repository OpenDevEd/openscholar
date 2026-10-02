/** What Open Scholar takes for a Work, and for a page of them, from OpenAlex or the OpenScholar API. */
import { z } from "zod";

/** A field a work may lack, or hold as null, as OpenAlex and the OpenScholar API allow. */
const maybe = <T extends z.ZodType>(schema: T) => schema.nullable().optional();
const named = z.looseObject({ display_name: maybe(z.string()) });

/**
 * A work, as far as the search page reads into it: its id, its abstract's index, and the
 * fields the paper card shows as text or numbers, loops over or reads into. Any of these but
 * the id may be missing or null; one of another shape would break the card, so it fails the page.
 */
export const workSchema = z.looseObject({
  id: z.string(),
  abstract_inverted_index: maybe(z.record(z.string(), z.array(z.number().int().nonnegative()))),
  display_name: maybe(z.string()),
  title: maybe(z.string()),
  doi: maybe(z.string()),
  type: maybe(z.string()),
  publication_year: maybe(z.number()),
  cited_by_count: maybe(z.number()),
  // The card reads each author's name without a guard; OpenAlex always sends the author.
  authorships: maybe(z.array(z.looseObject({ author: z.looseObject({ display_name: z.string() }) }))),
  primary_location: maybe(z.looseObject({ source: maybe(named) })),
  open_access: maybe(z.looseObject({ is_oa: maybe(z.boolean()), oa_url: maybe(z.string()) })),
  primary_topic: maybe(z.looseObject({ field: maybe(named), subfield: maybe(named), domain: maybe(named) })),
  related_works: maybe(z.array(z.string())),
  referenced_works: maybe(z.array(z.string())),
  sustainable_development_goals: maybe(z.array(z.looseObject({}))),
  biblio: maybe(z.looseObject({})),
});

/** What a page must hold to be read: its count, and works the search page can show. */
export const worksPageSchema = z.object({
  meta: z.looseObject({ count: z.number().int().nonnegative() }),
  results: z.array(workSchema),
});
