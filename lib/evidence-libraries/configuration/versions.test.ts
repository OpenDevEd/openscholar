import { describe, expect, it } from "vitest";
import {
  canRestore,
  changedCards,
  runtimeUpdateState,
  shortCommit,
  splitNoteArea,
} from "./versions";

describe("shortCommit", () => {
  it("keeps the first seven characters of a commit", () => {
    expect(shortCommit("c353b55b1234567890abcdef")).toBe("c353b55");
    expect(shortCommit("abc")).toBe("abc");
  });
});

describe("runtimeUpdateState", () => {
  it("is up to date only when the running commit is the latest", () => {
    expect(runtimeUpdateState({ running: "a", latest: "a" })).toBe("up-to-date");
    expect(runtimeUpdateState({ running: "a", latest: "b" })).toBe(
      "update-available",
    );
  });
});

describe("splitNoteArea", () => {
  it("separates the area prefix from the note text", () => {
    expect(splitNoteArea("Sources: Zotero imports keep going.")).toEqual({
      area: "sources",
      text: "Zotero imports keep going.",
    });
    expect(splitNoteArea("Search results load faster: even on large libraries.")).toEqual({
      area: null,
      text: "Search results load faster: even on large libraries.",
    });
  });
});

describe("changedCards", () => {
  it("maps changed rows to their page cards once, in page order", () => {
    expect(changedCards(["localization", "email", "contact", "theme"])).toEqual([
      "theme",
      "contact",
      "languages",
    ]);
  });

  it("drops rows that no card shows", () => {
    expect(changedCards(["unknown"])).toEqual([]);
  });
});

describe("canRestore", () => {
  it("allows previous and failed versions only", () => {
    expect(canRestore("previous")).toBe(true);
    expect(canRestore("failed")).toBe(true);
    expect(canRestore("live")).toBe(false);
    expect(canRestore("deploying")).toBe(false);
  });
});
