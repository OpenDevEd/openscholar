import { describe, expect, it } from "vitest";
import { creativeCommons } from "./licence";

describe("a Creative Commons licence code", () => {
  it("names the licence, with its version and deed when the code gives the version", () => {
    expect(creativeCommons("cc-by-4.0")).toEqual({ name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
    expect(creativeCommons("cc-by-nc-nd")).toEqual({ name: "CC BY-NC-ND", url: null });
  });

  it("is none for codes that aren't Creative Commons licences", () => {
    expect(creativeCommons("other-oa")).toBeNull();
    expect(creativeCommons(null)).toBeNull();
  });
});
