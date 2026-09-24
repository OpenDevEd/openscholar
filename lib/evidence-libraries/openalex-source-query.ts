import { getCountryCodesForRegions } from "@/lib/constants";
import { hasUnquotedWildcard } from "@/lib/search/wildcard";
import type { SearchField } from "@/lib/types";
import type { OpenAlexQuery } from "./configuration/sources";

export type OpenAlexTopicLevel = "field" | "subfield" | "topic";
export type OpenAlexSearchScope = SearchField | "all";

export type OpenAlexSourceQueryBuilder = {
  search: string;
  scope: OpenAlexSearchScope;
  yearRange: [number, number] | null;
  locations: string[];
  types: string[];
  topicLevel: OpenAlexTopicLevel;
  topicIds: string[];
  sdgs: string[];
  openAccessOnly: boolean;
};

export const OPENALEX_WORK_TYPES = [
  { id: "article", name: "Article" },
  { id: "book", name: "Book" },
  { id: "book-review", name: "Book review" },
  { id: "book-chapter", name: "Book chapter" },
  { id: "conference-paper", name: "Conference paper" },
  { id: "data-paper", name: "Data paper" },
  { id: "dataset", name: "Dataset" },
  { id: "dissertation", name: "Dissertation" },
  { id: "edited-book", name: "Edited book" },
  { id: "editorial", name: "Editorial" },
  { id: "erratum", name: "Erratum" },
  { id: "grant", name: "Grant" },
  { id: "letter", name: "Letter" },
  { id: "libguides", name: "Library guide" },
  { id: "monograph", name: "Monograph" },
  { id: "other", name: "Other" },
  { id: "paratext", name: "Paratext" },
  { id: "peer-review", name: "Peer review" },
  { id: "preprint", name: "Preprint" },
  { id: "reference-entry", name: "Reference entry" },
  { id: "report", name: "Report" },
  { id: "retraction", name: "Retraction" },
  { id: "review", name: "Review" },
  { id: "software", name: "Software" },
  { id: "software-paper", name: "Software paper" },
  { id: "standard", name: "Standard" },
] as const;

export const OPENALEX_SDGS = [
  "No poverty",
  "Zero hunger",
  "Good health and well-being",
  "Quality education",
  "Gender equality",
  "Clean water and sanitation",
  "Affordable and clean energy",
  "Decent work and economic growth",
  "Industry, innovation and infrastructure",
  "Reduced inequalities",
  "Sustainable cities and communities",
  "Responsible consumption and production",
  "Climate action",
  "Life below water",
  "Life on land",
  "Peace, justice and strong institutions",
  "Partnerships for the goals",
].map((name, index) => ({
  id: String(index + 1),
  name: `${index + 1}. ${name}`,
}));

export function emptyOpenAlexSourceQuery(): OpenAlexSourceQueryBuilder {
  return {
    search: "",
    scope: "title_and_abstract",
    yearRange: null,
    locations: [],
    types: [],
    topicLevel: "subfield",
    topicIds: [],
    sdgs: [],
    openAccessOnly: false,
  };
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildOpenAlexSourceQuery(
  builder: OpenAlexSourceQueryBuilder,
): OpenAlexQuery {
  const filter: string[] = [];
  const search = builder.search.trim();
  const query: OpenAlexQuery = {};
  if (search) {
    if (builder.scope === "all") {
      query.search = search;
    } else {
      const suffix = hasUnquotedWildcard(search) ? "search.exact" : "search";
      filter.push(`${builder.scope}.${suffix}:${search}`);
    }
  }
  if (builder.yearRange) {
    filter.push(
      `publication_year:${builder.yearRange[0]}-${builder.yearRange[1]}`,
    );
  }
  const countries = sorted(
    getCountryCodesForRegions(builder.locations).countries,
  );
  if (countries.length)
    filter.push(`authorships.countries:${countries.join("|")}`);
  const types = sorted(builder.types);
  if (types.length) filter.push(`type:${types.join("|")}`);
  const topicIds = sorted(builder.topicIds);
  if (topicIds.length) {
    const prefix =
      builder.topicLevel === "topic"
        ? "topics.id"
        : `topics.${builder.topicLevel}.id`;
    filter.push(`${prefix}:${topicIds.join("|")}`);
  }
  const sdgs = sorted(builder.sdgs)
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => `https://metadata.un.org/sdg/${id}`);
  if (sdgs.length)
    filter.push(`sustainable_development_goals.id:${sdgs.join("|")}`);
  if (builder.openAccessOnly) filter.push("open_access.is_oa:true");
  if (filter.length) query.filter = filter.join(",");
  return query;
}

const FILTER_BOUNDARY =
  /,(?=(?:publication_year|authorships\.countries|type|topics(?:\.(?:field|subfield))?\.id|sustainable_development_goals\.id|open_access\.is_oa):)/;

export function parseOpenAlexSourceQuery(
  query: OpenAlexQuery,
): OpenAlexSourceQueryBuilder {
  const builder = emptyOpenAlexSourceQuery();
  if (query.search) {
    builder.search = query.search;
    builder.scope = "all";
  }
  for (const clause of query.filter?.split(FILTER_BOUNDARY) ?? []) {
    const scoped = clause.match(
      /^(title_and_abstract|title|abstract|fulltext|display_name)\.search(?:\.exact)?:(.*)$/s,
    );
    if (scoped) {
      builder.scope = scoped[1] as SearchField;
      builder.search = scoped[2];
      continue;
    }
    const year = clause.match(/^publication_year:(\d{4})-(\d{4})$/);
    if (year) {
      builder.yearRange = [Number(year[1]), Number(year[2])];
      continue;
    }
    if (clause.startsWith("authorships.countries:")) {
      builder.locations = clause
        .slice("authorships.countries:".length)
        .split("|");
      continue;
    }
    if (clause.startsWith("type:")) {
      builder.types = clause.slice("type:".length).split("|");
      continue;
    }
    const topic = clause.match(/^topics(?:\.(field|subfield))?\.id:(.+)$/);
    if (topic) {
      builder.topicLevel = (topic[1] ?? "topic") as OpenAlexTopicLevel;
      builder.topicIds = topic[2].split("|");
      continue;
    }
    if (clause.startsWith("sustainable_development_goals.id:")) {
      builder.sdgs = clause
        .slice("sustainable_development_goals.id:".length)
        .split("|")
        .map((id) => id.replace("https://metadata.un.org/sdg/", ""));
      continue;
    }
    if (clause === "open_access.is_oa:true") builder.openAccessOnly = true;
  }
  return builder;
}
