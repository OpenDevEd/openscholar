import { describe, expect, it } from "vitest";
import { isOqlSentence, oqlForOwnIndex } from "./oql-for-own-index";

const where = (conditions: string) => `works where ${conditions}`;
const rewritten = (conditions: string) => oqlForOwnIndex(where(conditions)).replace(/^works where /, "");

describe("OQL as our index reads it", () => {
  it.each([
    // A search's one word or phrase.
    ["title has kelp", "title has (kelp)"],
    ['title/abstract has "school feeding"', 'title/abstract has ("school feeding")'],
    ['title/abstract has stemmed "school feeding"', 'title/abstract has (stemmed "school feeding")'],
    ["title/abstract has feed*", "title/abstract has (feed*)"],
    ["full text has kelp", "full text has (kelp)"],
    ["title and abstract has kelp", "title and abstract has (kelp)"],
    ["title_and_abstract.search has kelp", "title_and_abstract.search has (kelp)"],
    ['title has "(kelp)"', 'title has ("(kelp)")'],
    // One value.
    ["is_retracted is false", "is_retracted is (false)"],
    ["retracted is true", "retracted is (true)"],
    ["is_retracted is not true", "is_retracted is not (true)"],
    ["type is article", "type is (article)"],
    ["type is not article", "type is not (article)"],
    ["type is book-chapter", "type is (book-chapter)"],
    ['primary_location.source.type is "book series"', 'primary_location.source.type is ("book series")'],
    ["year is 2024", "year is (2024)"],
    ["authorships.author.id is A5015565298", "authorships.author.id is (A5015565298)"],
    ["oa status is gold", "oa status is (gold)"],
    ["has doi is true", "has doi is (true)"],
    // Comparisons.
    ["year > 2020", "year > (2020)"],
    ["year >=2020", "year >=(2020)"],
    ["year>=2020", "year>=(2020)"],
    ["cited_by_count >= 10", "cited_by_count >= (10)"],
    ["citation count is above 100", "citation count > (100)"],
    ["citation count is at least 100", "citation count >= (100)"],
    ["citation count is below 100", "citation count < (100)"],
    ["citation count is at most 100", "citation count <= (100)"],
    ["year is above 2020", "year > (2020)"],
    // Dates and years in words.
    ["published since 2020", "year >= (2020)"],
    ["published before 2020", "year < (2020)"],
    ["published after 2020", "year > (2020)"],
    ["published in 2020", "year is (2020)"],
    ["published through 2020", "year <= (2020)"],
    ["published since 2020-06-01", "from_publication_date is (2020-06-01)"],
    ["published through 2020-06-01", "to_publication_date is (2020-06-01)"],
    ["published before 2020-03-01", "to_publication_date is (2020-02-29)"],
    ["published before 2021-01-01", "to_publication_date is (2020-12-31)"],
    // Yes/no sentences.
    ["it's open access", "open access is (true)"],
    ["it's not open access", "open access is (false)"],
    ["it's closed access", "open access is (false)"],
    ["it's retracted", "retracted is (true)"],
    ["it's not retracted", "retracted is (false)"],
    ["it has a DOI", "has doi is (true)"],
    ["it doesn't have a DOI", "has doi is (false)"],
    ["it has an abstract", "has abstract is (true)"],
    ["it doesn't have an abstract", "has abstract is (false)"],
    ["it's in the top 10% by citations", "citation_normalized_percentile.is_in_top_10_percent is (true)"],
    ["it's in the top 1% by citations", "citation_normalized_percentile.is_in_top_1_percent is (true)"],
    // Relations.
    ["it cites W2741809807", "it cites (W2741809807)"],
    ["it's cited by W2741809807", "it's cited by (W2741809807)"],
    ["it's related to W2741809807", "it's related to (W2741809807)"],
    // Links and groups.
    ["type is ([article](article) or [review](review))", "type is (article or review)"],
    ["type is (not [article](article) or [review](review))", "type is (not article or review)"],
    ["type is (article and review)", "(type is (article) and type is (review))"],
    ["funder is (F1 and not F2)", "(funder is (F1) and funder is not (F2))"],
    ["type is ([article](article) and [review](review))", "(type is (article) and type is (review))"],
  ])("%s", (typed, read) => {
    expect(rewritten(typed)).toBe(read);
  });

  it("rewrites each clause of a longer query, whatever joins or groups them", () => {
    expect(rewritten('(title has kelp or abstract has "sea urchin") and not type is review and year >= 2020 and it\'s open access')).toBe(
      '(title has (kelp) or abstract has ("sea urchin")) and not type is (review) and year >= (2020) and open access is (true)',
    );
  });

  it("keeps a sample at the end, and doesn't read its words as a value", () => {
    expect(oqlForOwnIndex("works where year is 2024 sample 5 seed 7")).toBe("works where year is (2024) sample 5 seed 7");
  });

  it("reads the words in any case, and keeps what was typed", () => {
    expect(oqlForOwnIndex("WORKS WHERE Type IS Article AND Title HAS Kelp")).toBe("WORKS WHERE Type IS (Article) AND Title HAS (Kelp)");
  });

  it("takes the general form's get", () => {
    expect(oqlForOwnIndex("get works where year is 2024")).toBe("works where year is (2024)");
    expect(oqlForOwnIndex("  GET works")).toBe("works");
  });

  it("reads curly quotes and apostrophes as plain ones, but not inside a phrase", () => {
    expect(rewritten("title has “kelp”")).toBe('title has ("kelp")');
    expect(rewritten("it’s open access")).toBe("open access is (true)");
    expect(rewritten('title has "it’s kelp"')).toBe('title has ("it’s kelp")');
  });

  it.each([
    // What the app itself writes, and every other query our index reads already.
    'title/abstract has ("school feeding")',
    "title/abstract has (school feeding)",
    'title/abstract has (stemmed "school feeding")',
    "title/abstract has (kelp OR urchin)",
    "title/abstract has (kelp and not urchin)",
    'title has (road traffic "and" ghana)',
    "is_retracted is (false)",
    "type is (article or review)",
    "type is not (article or review)",
    "type is (not article)",
    "type is [article](article)",
    "country is [Kenya](KE)",
    "institution is [MIT](I63966007)",
    "year is (2020 or 2021)",
    "cited_by_count > (9)",
    'primary_location.source.type is (journal or conference or "book series")',
    "it cites (W2741809807)",
    "it cites [The state](W2741809807)",
    '(title/abstract has ("school feeding")) and is_retracted is (false)',
    "not is_retracted is (false)",
  ])("leaves %s as it is", (query) => {
    expect(rewritten(query)).toBe(query);
  });

  it.each([
    // Words inside a phrase or a search's text are never read as OQL.
    'title has ("it is false")',
    'title has ("type is article")',
    "title has (is false)",
    "title has (type is article and year > 2020)",
    'title has ("published since 2020" OR "it\'s open access")',
    'title has ("[not a link](really)")',
  ])("doesn't read inside %s", (query) => {
    expect(rewritten(query)).toBe(query);
  });

  it.each([
    // Refused by OpenAlex too: there's no meaning to keep, so the API says why.
    "title/abstract has school feeding",
    "type is (article review)",
    "type is (article, review)",
    "title/abstract has (\"kelp\"",
    "type is",
    "title has",
    "title",
    "",
    // Forms our index doesn't serve, and meanings a rewrite would change.
    'title-abstract is similar to ("ocean acidification")',
    "published after 2020-06-01",
    "published in 2020-06-01",
    "published since soon",
    "published before 2021-02-30",
    "type is ((article or review) and not book)",
    "type is not (article and review)",
    "type is (article and review or book)",
    "funder is (F1 and)",
    "funder is (F1 or)",
    "funder is (and F1)",
    "language is (en or unknown and fr)",
  ])("leaves %s for the API to answer", (query) => {
    const once = oqlForOwnIndex(where(query));
    expect(once).toBe(where(query));
  });

  it("brackets the first value of a bare list, which the API then refuses, so it never means something else", () => {
    expect(rewritten('title/abstract has "a" or "b"')).toBe('title/abstract has ("a") or "b"');
    expect(rewritten("type is article or review")).toBe("type is (article) or review");
  });

  it("leaves a query it can't read as it was typed, unclosed quotes and labels included", () => {
    for (const query of ['works where title has "kelp', "works where type is [article", "year is 2024", "kelp", "", "   "]) {
      expect(oqlForOwnIndex(query)).toBe(query);
    }
  });

  it("never changes its own result, whatever the query", () => {
    const queries = [
      "title has kelp",
      'title has "kelp"',
      "type is article",
      "type is not article",
      "type is ([a](a) or [b](b))",
      "type is (a and not b)",
      "citation count is at least 100",
      "published since 2020",
      "published before 2020-03-01",
      "it's open access",
      "it has a DOI",
      "it cites W1",
      "(title has kelp or type is article) and not year > 2020",
      "title has (a or b) and type is c",
    ].map(where);
    for (const query of queries) {
      const once = oqlForOwnIndex(query);
      expect(oqlForOwnIndex(once)).toBe(once);
    }
  });

  it("gets through a long query, as the saved community queries are", () => {
    const terms = Array.from({ length: 3_000 }, (_, at) => `"term ${at}"`).join(" or ");
    const query = where(`title/abstract has (${terms}) and type is article`);
    expect(oqlForOwnIndex(query).endsWith("type is (article)")).toBe(true);
  });
});

describe("the sentence form", () => {
  it.each(["get works about kelp", 'GET works about "school feeding"', "get articles since 2020", "get the count of works about kelp", "get authors where works count is above 10"])(
    "knows %s for what it is, and leaves it as typed",
    (query) => {
      expect(isOqlSentence(query)).toBe(true);
      expect(oqlForOwnIndex(query)).toBe(query);
    },
  );

  it.each(["get works", "get works where year is (2024)", "works where year is (2024)", "works", "getting works"])("doesn't take %s for one", (query) => {
    expect(isOqlSentence(query)).toBe(false);
  });
});
