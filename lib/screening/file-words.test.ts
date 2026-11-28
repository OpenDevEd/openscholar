// A file's English (messages/screening-fragments/words.json) is a copy of the pages' own words, kept apart so a file
// doesn't load every message: it must say what the English pages say.
import { expect, it } from "vitest";
import FILE_WORDS from "@/messages/screening-fragments/words.json";
import US from "@/messages/en-US.json";
import GB from "@/messages/en-GB.json";

it("names everything as the English pages do", () => {
  expect(FILE_WORDS).toEqual(US.screening.words);
  expect(FILE_WORDS).toEqual(GB.screening.words);
});
