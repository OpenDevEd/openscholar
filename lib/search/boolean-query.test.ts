import { describe, expect, it } from "vitest";
import { highlightSegments, parseBooleanQuery, queryMatcher } from "./boolean-query";

const marked = (text: string, query: string) =>
  highlightSegments(text, queryMatcher(query))
    .filter((s) => s.concept !== undefined)
    .map((s) => `${s.concept}:${s.text}`);

describe("parseBooleanQuery", () => {
  it("gives OR synonyms one concept and each side of AND its own", () => {
    const { concepts } = parseBooleanQuery('(AI OR "artificial intelligence") AND (impact OR transform*)');
    expect(concepts).toEqual([["AI", '"artificial intelligence"'], ["impact", "transform*"]]);
  });

  it("keeps a plain keyword query as one concept", () => {
    expect(parseBooleanQuery("climate change adaptation").concepts).toEqual([["climate", "change", "adaptation"]]);
  });

  it("splits OR branches that hold their own AND", () => {
    expect(parseBooleanQuery("(teacher AND training) OR mentoring").concepts).toEqual([["teacher"], ["training"], ["mentoring"]]);
  });

  it("leaves NOT terms out of every concept", () => {
    const { concepts, tokens } = parseBooleanQuery("(school OR college) NOT (online OR remote)");
    expect(concepts).toEqual([["school", "college"]]);
    expect(tokens.filter((t) => t.excluded && t.kind === "term").map((t) => t.text)).toEqual(["online", "remote"]);
  });

  it("reads every half-typed query", () => {
    for (const query of ["NOT", "a NOT", "(", "a AND", "OR", "a OR (", "NOT )", "\"open phrase"]) {
      expect(() => parseBooleanQuery(query)).not.toThrow();
    }
  });

  it("marks a parenthesis that has no partner while typing", () => {
    const { tokens } = parseBooleanQuery("(a OR b");
    expect(tokens[0]).toMatchObject({ kind: "open", unmatched: true });
    expect(parseBooleanQuery("a) OR b").tokens[1]).toMatchObject({ kind: "close", unmatched: true });
  });
});

describe("highlightSegments", () => {
  it("colours matches by concept, with phrases and wildcards", () => {
    const query = '(AI OR "artificial intelligence") AND (impact OR transform*)';
    expect(marked("Artificial Intelligence impacts how AI transformed AIDS care, an impact", query)).toEqual([
      "0:Artificial Intelligence",
      "0:AI",
      "1:transformed",
      "1:impact",
    ]);
  });

  it("matches stems only on the stemmed field", () => {
    expect(marked("impacts", "impact")).toEqual(["0:impacts"]);
    expect(marked("impacts", "impact OR transform*")).toEqual([]);
  });

  it("finds plural forms of words ending in y", () => {
    expect(marked("Case studies of a study", "study")).toEqual(["0:studies", "0:study"]);
  });

  it("never marks excluded terms", () => {
    expect(marked("Online school", "school NOT online")).toEqual(["0:school"]);
  });
});
