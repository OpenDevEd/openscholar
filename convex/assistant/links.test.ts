// Each record a read returns comes with the link a reply writes for it.
import { describe, expect, it } from "vitest";
import { linked, linkLabel } from "./links";

describe("linked", () => {
  it("links each saved search on a page by its query, escaped and cut to one short line", () => {
    const read = linked("research/records:listedSearches", { page: [{ id: "bc99", query: 'AI AND (teacher* OR "educator")' }], isDone: true });
    expect(read).toMatchObject({ page: [{ link: '[AI AND (teacher\\* OR "educator")](/results/bc99)' }] });
    expect(linkLabel(`a\n${"b".repeat(200)}`)).toHaveLength(80);
  });

  it("links collections, jobs, papers, chats and mentions, and leaves other reads alone", () => {
    expect(linked("library/collections:getCollection", { _id: "c1", name: "Trials" })).toMatchObject({ link: "[Trials](/library?col=c1)" });
    expect(linked("extraction/queries:getJobDetails", { status: "ok", job: { _id: "j1", name: "Sizes" } })).toMatchObject({ job: { link: "[Sizes](/extraction/j1)" } });
    expect(linked("library/queries:papers", { papers: [{ libraryItemId: "i1", id: "W12", title: "Paper" }] })).toMatchObject({ papers: [{ link: "[Paper](https://openalex.org/W12)" }] });
    // A search with no query yet is named by its questions, and a pipe stays inside a table cell.
    expect(linked("research/records:getSearch", { id: "s2", query: "", questionText: "Trial | design?" })).toMatchObject({ link: "[Trial \\| design?](/results/s2)" });
    expect(linked("research/records:getSearch", { id: "pubmed/1 (a)", query: "Tutoring" })).toMatchObject({ link: "[Tutoring](/results/pubmed%2F1%20%28a%29)" });
    expect(linked("assistant/threads:list", { page: [{ _id: "t1", title: "Notes" }] })).toMatchObject({ page: [{ link: "[Notes](/?chat=t1)" }] });
    expect(linked("assistant/mentions:find", [{ kind: "search", id: "s1", label: "Tutoring" }])).toEqual([{ kind: "search", id: "s1", label: "Tutoring", link: "[Tutoring](/results/s1)" }]);
    const other = { page: [{ id: "x", query: "y" }] };
    expect(linked("billing/usage:listCharges", other)).toBe(other);
  });
});
