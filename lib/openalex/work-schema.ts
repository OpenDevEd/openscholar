/**
 * What Open Scholar takes for a Work, and for a page of them, from OpenAlex or the OpenScholar
 * API: each field's type as OpenAlex sends it, from its own Works recorded on 1 October 2026
 * (the OpenScholar API's compatibility suite keeps the record, and holds that API to it), with
 * the differences that suite allows the API: null for a work's year, date, type and open-access
 * status, and for its topics' scores, which its index does not know. A field of another shape
 * would break a card, a citation, COinS or an export, so it fails its page instead. A field OpenAlex sends as null may be null; a field OpenAlex adds later passes;
 * a field a page leaves out with `select` may be missing. Inside a field that is there, what
 * the app reads without a guard must be there too.
 */
import { z } from "zod";

const text = z.string();
const maybeText = text.nullable();
const texts = z.array(text);
const number = z.number();
const flag = z.boolean();

/** A field OpenAlex sends, which a page may leave out. */
const sent = <T extends z.ZodType>(schema: T) => schema.optional();

/** The app links a topic's subfield, field and domain by id and name. */
const named = z.looseObject({ id: text, display_name: text });
/** A keyword or an SDG: the detail card shows an SDG's score as a number. */
const scored = z.looseObject({ id: text, display_name: text, score: number });

const source = z.looseObject({
  id: sent(text),
  display_name: sent(text),
  issn_l: sent(maybeText),
  issn: sent(texts.nullable()),
  is_oa: sent(flag),
  is_in_doaj: sent(flag),
  is_core: sent(flag),
  listed_in: sent(texts),
  host_organization: sent(maybeText),
  host_organization_name: sent(maybeText),
  host_organization_lineage: sent(texts),
  host_organization_lineage_names: sent(texts),
  type: sent(text),
});

const location = z.looseObject({
  id: sent(text),
  is_oa: sent(flag),
  landing_page_url: sent(maybeText),
  pdf_url: sent(maybeText),
  source: sent(source.nullable()),
  license: sent(maybeText),
  license_id: sent(maybeText),
  version: sent(maybeText),
  is_accepted: sent(flag),
  is_published: sent(flag.nullable()),
  raw_source_name: sent(maybeText),
  raw_type: sent(maybeText),
});

const topic = z.looseObject({
  id: text,
  display_name: text,
  score: sent(number.nullable()),
  subfield: named,
  field: named,
  domain: named,
});

const authorship = z.looseObject({
  author_position: sent(text),
  // The card and the citations read each author's name without a guard.
  author: z.looseObject({
    id: sent(maybeText),
    display_name: text,
    orcid: sent(maybeText),
    observed_orcids: sent(texts),
  }),
  institutions: sent(z.array(z.looseObject({
    id: sent(text),
    display_name: sent(text),
    ror: sent(maybeText),
    country_code: sent(maybeText),
    type: sent(maybeText),
    lineage: sent(texts),
  }))),
  countries: sent(texts),
  is_corresponding: sent(flag),
  raw_author_name: sent(text),
  raw_affiliation_strings: sent(texts),
  raw_orcid: sent(maybeText),
  affiliations: sent(z.array(z.looseObject({ raw_affiliation_string: sent(text), institution_ids: sent(texts) }))),
});

const money = z.looseObject({ value: sent(number), currency: sent(text), value_usd: sent(number) }).nullable();

/** A Work. Only its id is always there: a page names each Work, whatever else it selects. */
export const workSchema = z.looseObject({
  id: text,
  doi: sent(maybeText),
  title: sent(maybeText),
  display_name: sent(maybeText),
  relevance_score: sent(number),
  publication_year: sent(number.nullable()),
  publication_date: sent(maybeText),
  ids: sent(z.looseObject({
    openalex: sent(text),
    doi: sent(text),
    mag: sent(text),
    pmid: sent(text),
    pmcid: sent(text),
  })),
  language: sent(maybeText),
  primary_location: sent(location.nullable()),
  type: sent(maybeText),
  indexed_in: sent(texts),
  open_access: sent(z.looseObject({
    is_oa: sent(flag),
    oa_status: sent(maybeText),
    oa_url: sent(maybeText),
    any_repository_has_fulltext: sent(flag),
  })),
  authorships: sent(z.array(authorship)),
  institutions: sent(z.array(z.unknown())),
  countries_distinct_count: sent(number),
  institutions_distinct_count: sent(number),
  corresponding_author_ids: sent(texts),
  corresponding_institution_ids: sent(texts),
  apc_list: sent(money),
  apc_paid: sent(money),
  fwci: sent(number.nullable()),
  has_fulltext: sent(flag),
  cited_by_count: sent(number),
  citation_normalized_percentile: sent(z.looseObject({
    value: sent(number),
    is_in_top_1_percent: sent(flag),
    is_in_top_10_percent: sent(flag),
  }).nullable()),
  cited_by_percentile_year: sent(z.looseObject({ min: sent(number), max: sent(number) }).nullable()),
  biblio: sent(z.looseObject({
    volume: sent(maybeText),
    issue: sent(maybeText),
    first_page: sent(maybeText),
    last_page: sent(maybeText),
  })),
  is_retracted: sent(flag),
  is_paratext: sent(flag),
  is_xpac: sent(flag),
  primary_topic: sent(topic.nullable()),
  topics: sent(z.array(topic)),
  keywords: sent(z.array(scored)),
  concepts: sent(z.array(z.looseObject({
    id: sent(text),
    wikidata: sent(maybeText),
    display_name: sent(text),
    level: sent(number),
    score: sent(number),
  }))),
  mesh: sent(z.array(z.looseObject({
    descriptor_ui: sent(text),
    descriptor_name: sent(text),
    qualifier_ui: sent(maybeText),
    qualifier_name: sent(maybeText),
    is_major_topic: sent(flag),
  }))),
  locations_count: sent(number),
  locations: sent(z.array(location)),
  best_oa_location: sent(location.nullable()),
  sustainable_development_goals: sent(z.array(scored)),
  x_sdgs: sent(z.array(z.unknown())),
  study_designs: sent(z.array(z.unknown())),
  awards: sent(z.array(z.looseObject({
    id: sent(text),
    display_name: sent(maybeText),
    funder_award_id: sent(maybeText),
    funder_id: sent(text),
    funder_display_name: sent(text),
  }))),
  funders: sent(z.array(z.looseObject({ id: sent(text), display_name: sent(text), ror: sent(maybeText) }))),
  has_content: sent(z.looseObject({ pdf: sent(flag), grobid_xml: sent(flag) })),
  content_urls: sent(z.looseObject({ pdf: sent(text), grobid_xml: sent(text) }).nullable()),
  referenced_works_count: sent(number),
  referenced_works: sent(texts),
  related_works: sent(texts),
  abstract_inverted_index: sent(z.record(text, z.array(z.number().int().nonnegative())).nullable()),
  counts_by_year: sent(z.array(z.looseObject({ year: sent(number), cited_by_count: sent(number) }))),
  updated_date: sent(text),
  created_date: sent(text),
});

/** What a page must hold to be read: its count, and works the search page can show. */
export const worksPageSchema = z.object({
  meta: z.looseObject({ count: z.number().int().nonnegative() }),
  results: z.array(workSchema),
});
