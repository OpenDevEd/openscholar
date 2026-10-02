import { describe, expect, it } from "vitest";
import { openAlexWorkPage, SHORT_WORK_ID, withoutWorkSite } from "./work-id";

describe("withoutWorkSite", () => {
  it("takes the site off an OpenAlex or OpenScholar API id, and leaves any other text as it is", () => {
    const ids = ["https://openalex.org/W2741809807", "https://openscholar.ai/OS150911088", "W1", "OS1", "doi:10.1/x", ""];
    expect(ids.map(withoutWorkSite)).toEqual(["W2741809807", "OS150911088", "W1", "OS1", "doi:10.1/x", ""]);
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
    const ids = ["W2741809807", "https://openalex.org/W2741809807", "OS150911088", "https://openscholar.ai/OS150911088", "https://example.org/W1"];
    expect(ids.map(openAlexWorkPage)).toEqual(["https://openalex.org/W2741809807", "https://openalex.org/W2741809807", null, null, null]);
  });
});
