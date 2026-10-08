import { describe, expect, it } from "vitest";
import { highlightSegments, parseBooleanQuery, queryMatcher } from "./boolean-query";

const marked = (text: string, query: string, expansions = {}) =>
  highlightSegments(text, queryMatcher(query, expansions))
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

  it("finds the singular from a plural query", () => {
    expect(marked("A possum and possums", "possums")).toEqual(["0:possum", "0:possums"]);
  });

  it("stems phrase words, and takes them as written on the exact search", () => {
    expect(marked("Case studies", '"case study"')).toEqual(["0:Case studies"]);
    expect(marked("Case studies", '"case study" OR x*')).toEqual([]);
  });

  it("never marks excluded terms", () => {
    expect(marked("Online school", "school NOT online")).toEqual(["0:school"]);
  });
});

describe("review fixes", () => {
  it("keeps words side by side together around an explicit AND", () => {
    expect(parseBooleanQuery("climate change AND health effects").concepts).toEqual([
      ["climate", "change"],
      ["health", "effects"],
    ]);
  });

  it("reads JavaScript property names as plain words", () => {
    expect(parseBooleanQuery("constructor school").concepts).toEqual([["constructor", "school"]]);
  });

  it("marks the longer phrase whatever order the OR lists it in", () => {
    expect(marked("school teacher", 'school OR "school teacher"')).toEqual(["0:school teacher"]);
  });

  it("marks a proximity phrase only where its words sit close together", () => {
    expect(marked("Health care alone", '"mental health"~2')).toEqual([]);
    expect(marked("mental and physical health", '"mental health"~2')).toEqual(["0:mental", "0:health"]);
  });
});

describe("OpenAlex search rules", () => {
  it("counts a swapped proximity phrase as two moves and gives each word its own place", () => {
    expect(marked("health mental", '"mental health"~1 OR care')).toEqual([]);
    expect(marked("health mental", '"mental health"~2')).toEqual(["0:health", "0:mental"]);
    expect(marked("one very word", '"very very"~1')).toEqual([]);
  });

  it("gives a shortcut one concept on both sides", () => {
    const expansions = { methods: "randomized AND blinded NOT open" };
    const { tokens, concepts } = parseBooleanQuery("methods... OR tutoring", expansions);
    expect(tokens[0]).toMatchObject({ text: "methods...", concept: 0 });
    expect(concepts).toEqual([["randomized", "blinded", "tutoring"]]);
    expect(marked("A blinded, open trial", "methods... OR tutoring", expansions)).toEqual(["0:blinded"]);
  });

  it("drops stop words on the stemmed search", () => {
    expect(marked("the education of the young", "education AND the")).toEqual(["0:education"]);
    expect(marked("state of the art", '"state of the art"')).toEqual(["0:state of the art"]);
  });

  it("allows a fuzzy term its edits", () => {
    expect(marked("colour and color", "color~1")).toEqual(["0:colour", "0:color"]);
    expect(marked("collar", "color~1")).toEqual([]);
  });

  it("keeps two phrases intact and within their distance", () => {
    const query = '"machine learning"~3~"neural network"';
    expect(marked("neural network models use machine learning", query)).toEqual(["0:neural network", "0:machine learning"]);
    expect(marked("machine learning in one two three four five neural network", query)).toEqual([]);
  });
});
