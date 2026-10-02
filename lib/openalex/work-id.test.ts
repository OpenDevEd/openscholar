import { describe, expect, it } from "vitest";
import { openAlexWorkPage, SHORT_WORK_ID, shortWorkId } from "./work-id";

describe("shortWorkId", () => {
  it("reads each kind of id on its own site, in http or https, short or in full", () => {
    const ids = [
      "W2741809807", "https://openalex.org/W2741809807", "http://openalex.org/W2741809807",
      "OS150911088", "https://openscholar.ai/OS150911088", "http://openscholar.ai/OS150911088", " W1 ",
    ];
    expect(ids.map(shortWorkId)).toEqual(["W2741809807", "W2741809807", "W2741809807", "OS150911088", "OS150911088", "OS150911088", "W1"]);
  });

  it("reads no id on the other kind's site, nor any other text", () => {
    const ids = ["https://openalex.org/OS1", "https://openscholar.ai/W1", "https://example.org/W1", "w1", "os1", "W", "WOS1", "doi:10.1/x", ""];
    expect(ids.map(shortWorkId)).toEqual(ids.map(() => null));
  });
});

describe("SHORT_WORK_ID", () => {
  it("takes W or OS and digits, and nothing else", () => {
    const ids = ["W2741809807", "OS150911088", "w1", "os1", "W", "OS", "WOS1", "A123", "W1x", " W1"];
    expect(ids.map((id) => SHORT_WORK_ID.test(id))).toEqual([true, true, false, false, false, false, false, false, false, false]);
  });
});

describe("openAlexWorkPage", () => {
  it("links an OpenAlex work to its page, and no other work, since OpenAlex has no page for an OS one", () => {
    const ids = [
      "W2741809807", "https://openalex.org/W2741809807", "http://openalex.org/W2741809807",
      "OS150911088", "https://openscholar.ai/OS150911088", "https://openalex.org/OS1", "https://example.org/W1",
    ];
    expect(ids.map(openAlexWorkPage)).toEqual([
      "https://openalex.org/W2741809807", "https://openalex.org/W2741809807", "https://openalex.org/W2741809807",
      null, null, null, null,
    ]);
  });
});
